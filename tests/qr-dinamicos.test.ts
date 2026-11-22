import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../server/db.ts';
import { buildApp } from '../server/app.ts';
import { seed, TEST_PASSWORD } from '../server/seed.ts';
import { isLocalUrl, reviewUrlError, tableTargetError } from '../shared/qr.ts';

// QR dinámicos (mesa y reseñas), corte inmediato de eventos en vivo y aviso de «separar mesa» solo a sus estaciones.
let app: FastifyInstance;
let ctx: any;
let db: Awaited<ReturnType<typeof openDb>>;
let dir: string;
const jar: Record<string, string> = {};
let n = 0;
const op = () => `qd-${Date.now()}-${++n}`;
const OWNER = 'dueno@esquina.test', OWNER_B = 'dueno@fuego.test', MOZO1 = 'mozo1@esquina.test', MOZO2 = 'mozo2@esquina.test';

async function login(email: string) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email, password: TEST_PASSWORD } });
  expect(r.statusCode, r.body).toBe(200);
  return String(r.headers['set-cookie']).split(';')[0];
}
async function api(who: string | null, method: string, url: string, payload?: unknown) {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: who ? { cookie: jar[who] } : {} });
  return { status: r.statusCode, body: (() => { try { return JSON.parse(r.body); } catch { return r.body; } })(), headers: r.headers };
}
const ok = async (who: string | null, method: string, url: string, payload?: unknown) => {
  const r = await api(who, method, url, payload);
  expect(r.status, `${method} ${url} -> ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
const scan = async (path: string) => { const r = await app.inject({ method: 'GET', url: path }); return { status: r.statusCode, to: r.headers.location, cache: r.headers['cache-control'] }; };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bmr-qd-'));
  db = await openDb(null);
  await seed(db);
  ({ app, ctx } = await buildApp({ db, dataDir: dir, publicUrl: 'http://localhost:4100', env: 'test' }));
  for (const u of [OWNER, OWNER_B, MOZO1, MOZO2]) jar[u] = await login(u);
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('D01 · validaciones (shared/qr)', () => {
  it('enlaces de reseñas, destinos de mesa y direcciones de prueba', () => {
    expect(reviewUrlError('https://g.page/r/abc/review')).toBeNull();
    expect(reviewUrlError('https://search.google.com/local/writereview?placeid=X')).toBeNull();
    expect(reviewUrlError('https://maps.app.goo.gl/xyz')).toBeNull();
    expect(reviewUrlError('http://g.page/r/abc/review')).toMatch(/https/);
    expect(reviewUrlError('https://google.com.evil.io/x')).toMatch(/Google/);
    expect(reviewUrlError('https://user:pw@g.page/x')).toMatch(/usuario/);
    expect(reviewUrlError('javascript:alert(1)')).not.toBeNull();
    expect(tableTargetError(null)).toBeNull();
    expect(tableTargetError('reservar')).toBeNull();
    expect(tableTargetError('https://instagram.com/esquina')).toBeNull();
    expect(tableTargetError('javascript:alert(1)')).not.toBeNull();
    expect(tableTargetError('ftp://x.test/a')).not.toBeNull();
    expect(tableTargetError('http://instagram.com/esquina')).toMatch(/https/); // solo https
    expect(tableTargetError('constructor')).not.toBeNull();
    expect(reviewUrlError('https://google.xyz/r')).toMatch(/Google/);
    expect(reviewUrlError('https://www.google.com.ar/maps/place/x')).toBeNull();
    expect(tableTargetError('/m/otro-local')).not.toBeNull(); // solo destinos internos de la lista
    for (const u of ['http://localhost:4100', 'http://127.0.0.1', 'http://192.168.0.20:4000', 'http://10.1.2.3', 'http://172.20.0.5', 'http://caja.local']) expect(isLocalUrl(u), u).toBe(true);
    for (const u of ['https://esquina.com.ar', 'https://172.32.0.1', 'https://app.bmdev.solutions']) expect(isLocalUrl(u), u).toBe(false);
  });
});

describe('D02 · QR de mesa dinámico', () => {
  let mesa2: any;
  it('por defecto abre la carta de esa mesa; el destino se cambia sin reimprimir', async () => {
    const qr = await ok(OWNER, 'GET', '/api/qr');
    expect(qr.local).toBe(true);
    mesa2 = qr.tables.find((t: any) => t.number === '2');
    expect(await scan(`/q/${mesa2.qr_token}`)).toEqual({ status: 302, to: `/mesa/${mesa2.qr_token}`, cache: 'no-store' });

    await ok(OWNER, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'reservar' });
    expect((await scan(`/q/${mesa2.qr_token}`)).to).toBe(`/reservar/esquina?mesa=${mesa2.qr_token}`); // conserva la mesa
    await ok(OWNER, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'https://instagram.com/esquina.boedo' });
    expect((await scan(`/q/${mesa2.qr_token}`)).to).toBe('https://instagram.com/esquina.boedo');
    expect((await api(OWNER, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'javascript:alert(1)' })).status).toBe(400);
    // Se guarda normalizado: un salto de línea pegado o un dominio con acentos no rompen la redirección.
    await ok(OWNER, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'https://ejemplo.com/a\nb' });
    expect(await scan(`/q/${mesa2.qr_token}`)).toMatchObject({ status: 302, to: 'https://ejemplo.com/ab' });
    await ok(OWNER, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'https://café.example/carta' });
    expect(await scan(`/q/${mesa2.qr_token}`)).toMatchObject({ status: 302, to: 'https://xn--caf-dma.example/carta' });
    await ok(OWNER, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'mesa' });
    expect((await scan(`/q/${mesa2.qr_token}`)).to).toBe(`/mesa/${mesa2.qr_token}`);
    expect((await ok(OWNER, 'GET', '/api/qr')).tables.find((t: any) => t.id === mesa2.id).qr_target).toBeNull();
  });

  it('solo el dueño o encargado de ese local lo edita', async () => {
    expect((await api(OWNER_B, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'reservar' })).status).toBe(404);
    expect((await api(MOZO1, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'reservar' })).status).toBe(403);
    expect((await api(null, 'PUT', `/api/qr/tables/${mesa2.id}`, { target: 'reservar' })).status).toBe(401);
    expect((await api(MOZO1, 'GET', '/api/qr')).status).toBe(403);
    expect((await ok(OWNER_B, 'GET', '/api/qr')).tables.some((t: any) => t.id === mesa2.id)).toBe(false);
    expect(await scan('/q/no-existe')).toMatchObject({ status: 302, to: '/mesa/no-existe' }); // la página de la mesa explica que no está activo
    expect((await scan('/q/resenas/no-existe')).status).toBe(404);
    expect(tableTargetError('toString')).not.toBeNull(); // solo claves propias de la lista
  });

  it('el QR de la mesa 2 identifica la mesa: con el código del mozo, el pedido entra en su cuenta', async () => {
    const tables = await ok(OWNER, 'GET', '/api/tables');
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: mesa2.id, guests: 2 });
    const { code } = await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true });
    const dest = (await scan(`/q/${mesa2.qr_token}`)).to!.split('/').pop()!;
    const pub = await ok(null, 'GET', `/api/public/t/${dest}`);
    expect(pub.table.number).toBe('2');
    const j = await app.inject({ method: 'POST', url: `/api/public/t/${dest}/join`, payload: { code } });
    const cel = String(j.headers['set-cookie']).split(';')[0];
    const flan = pub.products.find((p: any) => p.name.startsWith('Flan'));
    const events: any[] = [];
    const on = (e: any) => events.push(e);
    ctx.bus.on('ev', on);
    const r = await app.inject({ method: 'POST', url: `/api/public/t/${dest}/order`, payload: { opId: op(), items: [{ productId: flan.id, qty: 1 }], expected: [flan.price_cents] }, headers: { cookie: cel } });
    ctx.bus.off('ev', on);
    expect(r.statusCode, r.body).toBe(200);
    expect((await ok(MOZO1, 'GET', `/api/visits/${v.id}`)).lines.map((l: any) => l.name)).toEqual([flan.name]);
    const mozo1 = (await db.query<any>(`SELECT id FROM users WHERE email=$1`, [MOZO1])).rows[0].id;
    expect(events.find((e) => e.type === 'notice')).toMatchObject({ toUser: mozo1, tables: '2' });
    expect(tables.length).toBeGreaterThan(0);
  });
});

describe('D03 · QR de reseñas', () => {
  it('un QR por local que abre el enlace guardado en ese momento', async () => {
    const qr = await ok(OWNER, 'GET', '/api/qr');
    const path = `/q/resenas/${qr.review.token}`;
    expect((await scan(path)).to).toBe('https://g.page/r/ejemplo-ficticio/review'); // el de los datos de prueba
    expect((await api(OWNER, 'PUT', '/api/qr/review', { url: 'https://evil.example/review' })).status).toBe(400);
    await ok(OWNER, 'PUT', '/api/qr/review', { url: 'https://g.page/r/nuevo-enlace/review' });
    expect(await scan(path)).toEqual({ status: 302, to: 'https://g.page/r/nuevo-enlace/review', cache: 'no-store' });
    // Sin enlace: el panel avisa y el QR abre la carta del local.
    await ok(OWNER, 'PUT', '/api/qr/review', { url: '' });
    expect((await ok(OWNER, 'GET', '/api/qr')).review.url).toBeNull();
    expect((await scan(path)).to).toBe('/m/esquina');
    // Otro local tiene su propio QR y no puede tocar este.
    const b = await ok(OWNER_B, 'GET', '/api/qr');
    expect(b.review.token).not.toBe(qr.review.token);
    await ok(OWNER_B, 'PUT', '/api/qr/review', { url: 'https://g.page/r/fuego/review' });
    expect((await scan(path)).to).toBe('/m/esquina');
    // La validación también rige desde Configuración → Horarios y cobros.
    const me = await ok(OWNER, 'GET', '/api/me');
    expect((await api(OWNER, 'PUT', '/api/restaurant', { name: me.restaurant.name, theme: me.restaurant.theme, settings: { google_review_url: 'https://evil.example/x' } })).status).toBe(400);
  });
});

describe('D04 · eventos en vivo', () => {
  it('revocar las sesiones corta el stream al instante (sin esperar el ping)', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const cookie = await login(MOZO2);
    const ctrl = new AbortController();
    const res = await fetch(`${address}/api/events`, { headers: { cookie }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    const ended = (async () => { for (;;) { const { done } = await reader.read(); if (done) return Date.now(); } })();
    await new Promise((r) => setTimeout(r, 50));
    const uid = (await db.query<any>(`SELECT id FROM users WHERE email=$1`, [MOZO2])).rows[0].id;
    const t0 = Date.now();
    await ok(OWNER, 'POST', `/api/team/${uid}/revoke-sessions`);
    const t1 = await Promise.race([ended, new Promise<number>((r) => setTimeout(() => r(-1), 3000))]);
    ctrl.abort();
    expect(t1).toBeGreaterThan(0);
    expect(t1 - t0).toBeLessThan(1000);
    jar[MOZO2] = await login(MOZO2);
  });

  it('separar una mesa avisa solo a las estaciones de lo que se movió', async () => {
    const menu = await ok(OWNER, 'GET', '/api/menu');
    const tables = await ok(OWNER, 'GET', '/api/tables');
    const pid = (s: string) => menu.products.find((p: any) => p.name.startsWith(s));
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: tables.find((t: any) => t.number === '5').id });
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Flan').id, qty: 1 }, { productId: pid('Gaseosa').id, qty: 1 }] });
    const gas = (await ok(MOZO1, 'GET', `/api/visits/${v.id}`)).lines.find((l: any) => l.name.startsWith('Gaseosa'));
    const events: any[] = [];
    const on = (e: any) => events.push(e);
    ctx.bus.on('ev', on);
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/split`, { toTableId: tables.find((t: any) => t.number === '7').id, lineIds: [gas.id] });
    ctx.bus.off('ev', on);
    expect(events.find((e) => e.type === 'lines').stations).toEqual([gas.station_id]);
  });
});
