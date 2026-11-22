import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../server/db.ts';
import { buildApp } from '../server/app.ts';
import { seed, TEST_PASSWORD } from '../server/seed.ts';
import { ensureSuperadmin } from '../server/routes/platform.ts';

// Superadmin: alta con enlace de activación, aislamiento entre dueños, suspensión, papelera y eliminación definitiva. Base temporal propia.
let app: FastifyInstance;
let db: Awaited<ReturnType<typeof openDb>>;
let dir: string;
const jar: Record<string, string> = {};
let n = 0;
const ADMIN = 'admin@bmdev.test', OWNER = 'dueno@esquina.test', MOZO = 'mozo1@esquina.test';

async function api(who: string | null, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { ...(who ? { cookie: jar[who] } : {}), ...headers } });
  return { status: r.statusCode, body: (() => { try { return JSON.parse(r.body); } catch { return r.body; } })(), headers: r.headers };
}
const ok = async (who: string | null, method: string, url: string, payload?: unknown) => {
  const r = await api(who, method, url, payload);
  expect(r.status, `${method} ${url} -> ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
async function login(email: string, password = TEST_PASSWORD) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email, password } });
  if (r.statusCode === 200) jar[email] = String(r.headers['set-cookie']).split(';')[0];
  return r.statusCode;
}
async function upload(who: string, url: string, buf: Buffer) {
  const b = '----sa' + n++;
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="logo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
  return api(who, 'POST', url, body, { 'content-type': `multipart/form-data; boundary=${b}` });
}
const photo = () => sharp({ create: { width: 800, height: 800, channels: 3, background: '#1f4d3a' } }).jpeg().toBuffer();
const token = (url: string) => url.split('/activar/')[1];
/** Activa la cuenta con el enlace, guarda la sesión y devuelve el resultado. */
async function activate(email: string, url: string, password: string) {
  const r = await app.inject({ method: 'POST', url: `/api/account-links/${token(url)}`, payload: { password } });
  if (r.statusCode === 200 && r.headers['set-cookie']) jar[email] = String(r.headers['set-cookie']).split(';')[0];
  return r;
}
/** Carga un plato y un logo en el local del dueño (datos y fotos reales para verificar la papelera y el borrado). */
async function fillRestaurant(who: string, dish: string) {
  const m = await ok(who, 'GET', '/api/menu');
  const st = await ok(who, 'GET', '/api/stations');
  await ok(who, 'POST', '/api/products', { categoryId: m.categories[0].id, stationId: st[0].id, name: dish, priceCents: 150000, options: [] });
  const up = await upload(who, '/api/brand/image/logo', await photo());
  expect(up.status, JSON.stringify(up.body)).toBe(200);
  return up.body.logo as string;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bmr-sa-'));
  db = await openDb(null);
  await seed(db);
  ({ app } = await buildApp({ db, dataDir: dir, publicUrl: 'http://localhost', env: 'test' }));
  for (const u of [ADMIN, OWNER, MOZO]) await login(u);
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('Superadmin · permisos', () => {
  it('solo la cuenta de plataforma usa /api/admin: dueño y mozo reciben 403, sin sesión 401', async () => {
    const calls: [string, string, unknown?][] = [['GET', '/api/admin/restaurants'], ['GET', '/api/admin/restaurants/1'], ['POST', '/api/admin/restaurants', { name: 'X', slug: 'xxx', ownerName: 'X', ownerEmail: 'x@x.test' }],
      ['POST', '/api/admin/restaurants/1/status', { action: 'suspend', reason: 'x' }], ['POST', '/api/admin/restaurants/1/purge', { confirm: 'esquina', reason: 'x' }],
      ['POST', '/api/admin/restaurants/1/link', { email: OWNER }], ['POST', '/api/admin/restaurants/1/assist', { reason: 'x' }], ['GET', '/api/admin/audit']];
    for (const [m, u, b] of calls) {
      expect((await api(OWNER, m, u, b)).status, `${m} ${u}`).toBe(403);
      expect((await api(MOZO, m, u, b)).status, `${m} ${u}`).toBe(403);
      expect((await api(null, m, u, b)).status, `${m} ${u}`).toBe(401);
    }
    expect((await ok(null, 'GET', '/api/public/r/esquina')).restaurant.name).toBe('La Esquina de Boedo'); // nada cambió
  });
});

describe('Superadmin · ciclo completo de dos locales', () => {
  let A: any, B: any, logoA: string, logoB: string;
  const OA = 'uno@prueba.test', OB = 'dos@prueba.test';

  it('crea dos locales; cada dueño activa su cuenta con un enlace de un solo uso y define su contraseña', async () => {
    A = await ok(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Uno', slug: 'prueba-uno', ownerName: 'Ana Uno', ownerEmail: OA });
    B = await ok(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Dos', slug: 'prueba-dos', ownerName: 'Beto Dos', ownerEmail: OB });
    expect(A.link.kind).toBe('activate');
    expect(A.panelUrl).toBe('http://localhost/app');
    expect(new Date(A.link.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
    expect((await api(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Otra', slug: 'prueba-uno', ownerName: 'X', ownerEmail: 'x@prueba.test' })).status).toBe(409);
    // Sin contraseña todavía: no puede entrar. Solo se guarda el hash del token.
    expect(await login(OA, '')).toBe(401);
    expect((await db.query('SELECT 1 FROM account_links WHERE token_hash=$1', [token(A.link.url)])).rows).toHaveLength(0);

    const info = await ok(null, 'GET', `/api/account-links/${token(A.link.url)}`);
    expect(info).toMatchObject({ kind: 'activate', email: OA, restaurant: 'Prueba Uno' });
    expect((await activate(OA, A.link.url, 'corta')).statusCode).toBe(400); // contraseña inválida: el enlace sigue sirviendo
    expect((await activate(OA, A.link.url, 'clave-uno-123')).statusCode).toBe(200);
    expect((await activate(OA, A.link.url, 'otra-clave-123')).statusCode).toBe(410); // un solo uso
    expect((await activate(OB, B.link.url, 'clave-dos-123')).statusCode).toBe(200);
    expect((await ok(OA, 'GET', '/api/me')).restaurant.slug).toBe('prueba-uno');
    expect(await login(OA, 'clave-uno-123')).toBe(200);

    // Enlace vencido
    const C = await ok(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Vence', slug: 'prueba-vence', ownerName: 'C', ownerEmail: 'vence@prueba.test' });
    await db.query(`UPDATE account_links SET expires_at = now() - interval '1 minute' WHERE restaurant_id=$1`, [C.restaurant.id]);
    expect((await api(null, 'GET', `/api/account-links/${token(C.link.url)}`)).status).toBe(410);
    // Uno nuevo anula el anterior y sí funciona
    const again = await ok(ADMIN, 'POST', `/api/admin/restaurants/${C.restaurant.id}/link`, { email: 'vence@prueba.test' });
    expect((await activate('vence@prueba.test', again.url, 'clave-vence-1')).statusCode).toBe(200);
  });

  it('dueño con cuenta existente: invitación que lo vincula sin cambiarle la contraseña', async () => {
    const I = await ok(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Invita', slug: 'prueba-invita', ownerName: 'Marta', ownerEmail: OWNER });
    expect(I.link.kind).toBe('invite');
    expect((await ok(OWNER, 'GET', '/api/me')).restaurants.map((r: any) => r.slug)).not.toContain('prueba-invita'); // todavía no aceptó
    const r = await app.inject({ method: 'POST', url: `/api/account-links/${token(I.link.url)}`, payload: { password: 'intento-de-cambio' } });
    expect(r.json()).toMatchObject({ ok: true, kind: 'invite', loggedIn: false });
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(await login(OWNER, 'intento-de-cambio')).toBe(401);
    expect(await login(OWNER)).toBe(200); // su contraseña de siempre
    expect((await ok(OWNER, 'GET', '/api/me')).restaurants.map((x: any) => x.slug)).toEqual(expect.arrayContaining(['esquina', 'prueba-invita']));
  });

  it('cada dueño entra únicamente a su local', async () => {
    logoA = await fillRestaurant(OA, 'Milanesa de Prueba Uno');
    logoB = await fillRestaurant(OB, 'Pizza de Prueba Dos');
    expect((await api(OA, 'POST', '/api/me/restaurant', { restaurantId: B.restaurant.id })).status).toBe(403);
    expect((await api(OB, 'POST', '/api/me/restaurant', { restaurantId: A.restaurant.id })).status).toBe(403);
    const ma = await ok(OA, 'GET', '/api/menu');
    expect(ma.products.map((p: any) => p.name)).toEqual(['Milanesa de Prueba Uno']);
    expect((await ok(OB, 'GET', '/api/menu')).products.map((p: any) => p.name)).toEqual(['Pizza de Prueba Dos']);
    expect((await api(OA, 'GET', '/api/admin/restaurants')).status).toBe(403);
    expect(existsSync(join(dir, 'uploads', logoA))).toBe(true);
  });

  it('suspender pausa al personal y a la carta pública sin perder datos; reactivar lo devuelve', async () => {
    expect((await api(ADMIN, 'POST', `/api/admin/restaurants/${A.restaurant.id}/status`, { action: 'suspend' })).status).toBe(400); // sin motivo
    await ok(ADMIN, 'POST', `/api/admin/restaurants/${A.restaurant.id}/status`, { action: 'suspend', reason: 'Falta de pago (prueba)' });
    expect((await api(OA, 'GET', '/api/menu')).status).toBe(403);
    const lg = await app.inject({ method: 'POST', url: '/api/login', payload: { email: OA, password: 'clave-uno-123' } });
    expect(lg.statusCode).toBe(403);
    expect(lg.json().error).toMatch(/suspendido o fuera de servicio/);
    expect((await api(null, 'GET', '/api/public/r/prueba-uno')).status).toBe(404);
    expect((await api(null, 'POST', '/api/public/r/prueba-uno/orders', { channel: 'retiro', items: [] })).status).toBe(404);
    expect((await ok(OB, 'GET', '/api/menu')).products).toHaveLength(1); // el otro local sigue
    expect((await api(ADMIN, 'POST', `/api/admin/restaurants/${A.restaurant.id}/status`, { action: 'suspend', reason: 'x' })).status).toBe(409);
    await ok(ADMIN, 'POST', `/api/admin/restaurants/${A.restaurant.id}/status`, { action: 'reactivate', reason: 'Pagó' });
    expect(await login(OA, 'clave-uno-123')).toBe(200);
    expect((await ok(OA, 'GET', '/api/menu')).products.map((p: any) => p.name)).toEqual(['Milanesa de Prueba Uno']);
  });

  it('papelera: sale de los activos y se restaura con carta, fotos y enlaces', async () => {
    expect((await api(ADMIN, 'POST', `/api/admin/restaurants/${A.restaurant.id}/purge`, { confirm: 'prueba-uno', reason: 'x' })).status).toBe(409); // no está en papelera
    await ok(ADMIN, 'POST', `/api/admin/restaurants/${A.restaurant.id}/status`, { action: 'trash', reason: 'Cierre del local (prueba)' });
    const list = await ok(ADMIN, 'GET', '/api/admin/restaurants');
    expect(list.find((r: any) => r.slug === 'prueba-uno').status).toBe('trashed');
    expect((await api(null, 'GET', '/api/public/r/prueba-uno')).status).toBe(404);
    expect((await api(OA, 'GET', '/api/menu')).status).toBe(403);
    await ok(ADMIN, 'POST', `/api/admin/restaurants/${A.restaurant.id}/status`, { action: 'restore', reason: 'Vuelve a abrir' });
    expect((await ok(ADMIN, 'GET', `/api/admin/restaurants/${A.restaurant.id}`)).status).toBe('active');
    expect((await ok(OA, 'GET', '/api/menu')).products.map((p: any) => p.name)).toEqual(['Milanesa de Prueba Uno']);
    expect((await api(null, 'GET', '/api/public/r/prueba-uno')).status).toBe(200);
    expect(existsSync(join(dir, 'uploads', logoA))).toBe(true);
  });

  it('eliminar definitivamente: solo desde la papelera, con el identificador; borra solo ese local y deja registro', async () => {
    const id = A.restaurant.id;
    await ok(ADMIN, 'POST', `/api/admin/restaurants/${id}/status`, { action: 'trash', reason: 'Baja definitiva (prueba)' });
    const d = await ok(ADMIN, 'GET', `/api/admin/restaurants/${id}`);
    expect(d.preview.counts.products).toBe(1);
    expect(d.preview.files).toBe(1);
    expect((await api(ADMIN, 'POST', `/api/admin/restaurants/${id}/purge`, { confirm: 'prueba-dos', reason: 'x' })).status).toBe(400);
    expect((await api(ADMIN, 'POST', `/api/admin/restaurants/${id}/purge`, { confirm: 'prueba-uno' })).status).toBe(400); // sin motivo
    const esquinaBefore = (await ok(OWNER, 'GET', '/api/menu')).products.length;
    const out = await ok(ADMIN, 'POST', `/api/admin/restaurants/${id}/purge`, { confirm: 'prueba-uno', reason: 'Pedido del dueño' });
    expect(out.accountsClosed).toBe(1);

    // Ese local ya no existe, ni sus filas ni sus fotos
    expect((await db.query('SELECT 1 FROM restaurants WHERE id=$1', [id])).rows).toHaveLength(0);
    for (const t of ['products', 'categories', 'memberships', 'account_links', 'stations', 'tables']) expect((await db.query(`SELECT 1 FROM ${t} WHERE restaurant_id=$1`, [id])).rows, t).toHaveLength(0);
    expect(existsSync(join(dir, 'uploads', String(id)))).toBe(false);
    expect((await api(null, 'GET', '/api/public/r/prueba-uno')).status).toBe(404);
    expect(await login(OA, 'clave-uno-123')).toBe(401); // su cuenta solo era de ese local: dada de baja y anonimizada
    expect((await db.query('SELECT 1 FROM users WHERE email=$1', [OA])).rows).toHaveLength(0);

    // El otro local sigue con sus datos y su foto; los locales reales no se tocaron
    expect((await ok(OB, 'GET', '/api/menu')).products.map((p: any) => p.name)).toEqual(['Pizza de Prueba Dos']);
    expect(existsSync(join(dir, 'uploads', logoB))).toBe(true);
    expect(readdirSync(join(dir, 'uploads', String(B.restaurant.id)))).toHaveLength(1);
    expect((await ok(OWNER, 'GET', '/api/menu')).products.length).toBe(esquinaBefore);
    expect((await ok(null, 'GET', '/api/public/r/fuego')).restaurant.name).toBeTruthy();

    // Registro administrativo: quién, cuándo y qué local
    const log = await ok(ADMIN, 'GET', '/api/admin/audit');
    const purge = log.find((x: any) => x.action === 'platform.restaurant_purge');
    expect(purge).toMatchObject({ user_name: 'Soporte BM Dev', reason: 'Pedido del dueño', restaurant: 'Prueba Uno' });
    expect(purge.data.restaurant_slug).toBe('prueba-uno');
    for (const act of ['platform.restaurant_create', 'platform.restaurant_suspended', 'platform.restaurant_active', 'platform.restaurant_trashed', 'platform.restaurant_restored'])
      expect(log.some((x: any) => x.action === act && x.data?.restaurant_slug === 'prueba-uno'), act).toBe(true);
  });
});

describe('Superadmin · cuenta inicial', () => {
  it('se crea sin credenciales fijas: enlace de activación de 24 h; una cuenta existente se promueve sin tocar su contraseña', async () => {
    const r = await ensureSuperadmin(db, { email: 'yo@bmdev.test', name: 'Yo' }, 'http://localhost');
    expect(r.state).toBe('created');
    expect(r.link?.kind).toBe('activate');
    expect(new Date(r.link!.expiresAt).getTime()).toBeLessThan(Date.now() + 25 * 3600_000);
    const info = await ok(null, 'GET', `/api/account-links/${token(r.link!.url)}`);
    expect(info.restaurant).toBeNull();
    expect((await activate('yo@bmdev.test', r.link!.url, 'mi-clave-segura')).statusCode).toBe(200);
    expect((await ok('yo@bmdev.test', 'GET', '/api/me')).user.isPlatformAdmin).toBe(true);
    expect((await ok('yo@bmdev.test', 'GET', '/api/admin/restaurants')).length).toBeGreaterThan(0);
    expect((await ensureSuperadmin(db, { email: 'yo@bmdev.test' }, 'http://localhost')).state).toBe('existing');

    const p = await ensureSuperadmin(db, { email: MOZO, password: 'no-se-usa-123' }, 'http://localhost');
    expect(p).toMatchObject({ state: 'promoted', link: null });
    expect(await login(MOZO)).toBe(200); // misma contraseña
    await db.query('UPDATE users SET is_platform_admin=false WHERE email=$1', [MOZO]);
  });
});

describe('Superadmin · regresiones de la revisión', () => {
  it('restaurar vuelve al estado previo (suspendido) y una acción inexistente es 400, no 500', async () => {
    const R = await ok(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Previo', slug: 'prueba-previo', ownerName: 'P', ownerEmail: 'previo@prueba.test' });
    const id = R.restaurant.id;
    await ok(ADMIN, 'POST', `/api/admin/restaurants/${id}/status`, { action: 'suspend', reason: 'x' });
    await ok(ADMIN, 'POST', `/api/admin/restaurants/${id}/status`, { action: 'trash', reason: 'x' });
    await ok(ADMIN, 'POST', `/api/admin/restaurants/${id}/status`, { action: 'restore', reason: 'x' });
    expect((await ok(ADMIN, 'GET', `/api/admin/restaurants/${id}`)).status).toBe('suspended');
    for (const action of ['constructor', 'toString', '__proto__', 'borrar']) expect((await api(ADMIN, 'POST', `/api/admin/restaurants/${id}/status`, { action, reason: 'x' })).status, action).toBe(400);
  });

  it('enlace nuevo: el anterior deja de servir con «venció» y no se le da rol de dueño a otro integrante', async () => {
    const R = await ok(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Reenvío', slug: 'prueba-reenvio', ownerName: 'R', ownerEmail: 'reenvio@prueba.test' });
    const nuevo = await ok(ADMIN, 'POST', `/api/admin/restaurants/${R.restaurant.id}/link`, { email: 'reenvio@prueba.test' });
    const old = await api(null, 'GET', `/api/account-links/${token(R.link.url)}`);
    expect(old.status).toBe(410);
    expect(old.body.error).toMatch(/venció/);
    expect((await activate('reenvio@prueba.test', nuevo.url, 'clave-reenvio-1')).statusCode).toBe(200);
    // Un mozo de La Esquina no es dueño ni invitado: no se le emite enlace (aceptarlo lo haría dueño).
    expect((await api(ADMIN, 'POST', '/api/admin/restaurants/1/link', { email: MOZO })).status).toBe(400);
  });

  it('alta con el email de una cuenta dada de baja: 409 y no se crea el local', async () => {
    await db.query(`INSERT INTO users (email, name, password_hash, active) VALUES ('baja@prueba.test', 'Baja', '', false)`);
    expect((await api(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Baja', slug: 'prueba-baja', ownerName: 'B', ownerEmail: 'baja@prueba.test' })).status).toBe(409);
    expect((await db.query(`SELECT 1 FROM restaurants WHERE slug='prueba-baja'`)).rows).toHaveLength(0);
    // Tampoco la reactiva el arranque con SUPERADMIN_EMAIL.
    await expect(ensureSuperadmin(db, { email: 'baja@prueba.test' }, 'http://localhost')).rejects.toThrow(/dada de baja/);
    expect((await db.query(`SELECT active, is_platform_admin FROM users WHERE email='baja@prueba.test'`)).rows[0]).toEqual({ active: false, is_platform_admin: false });
  });

  it('identificador con espacios ya usado: mensaje propio de conflicto', async () => {
    const r = await api(ADMIN, 'POST', '/api/admin/restaurants', { name: 'X', slug: ' prueba-dos ', ownerName: 'X', ownerEmail: 'x2@prueba.test' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/identificador ya está en uso/);
  });
});

describe('Superadmin · regresiones de la auditoría de seguridad', () => {
  it('una cuenta de plataforma nunca queda como dueña: alta, invitación y enlace nuevo dan 409', async () => {
    expect((await api(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Trampa', slug: 'trampa-1', ownerName: 'X', ownerEmail: ADMIN })).status).toBe(409);
    await ensureSuperadmin(db, { email: 'sa-pendiente@bmdev.test' }, 'http://localhost'); // sin contraseña todavía
    expect((await api(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Trampa', slug: 'trampa-2', ownerName: 'X', ownerEmail: 'sa-pendiente@bmdev.test' })).status).toBe(409);
    expect((await db.query(`SELECT 1 FROM restaurants WHERE slug LIKE 'trampa-%'`)).rows).toHaveLength(0);
    expect((await api(ADMIN, 'POST', '/api/admin/restaurants/1/link', { email: ADMIN })).status).toBe(409);
  });

  it('si un dueño pendiente se promueve a Superadmin, el enlace del local deja de servir', async () => {
    const R = await ok(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Promo', slug: 'prueba-promo', ownerName: 'P', ownerEmail: 'promo@prueba.test' });
    const p = await ensureSuperadmin(db, { email: 'promo@prueba.test' }, 'http://localhost');
    expect(p.state).toBe('promoted');
    expect((await api(null, 'GET', `/api/account-links/${token(R.link.url)}`)).status).toBe(410);
    expect((await activate('promo@prueba.test', R.link.url, 'clave-trampa-1')).statusCode).toBe(410);
    // Solo sirve su propio enlace de plataforma
    expect((await activate('promo@prueba.test', p.link!.url, 'clave-propia-1')).statusCode).toBe(200);
  });

  it('al arrancar con SUPERADMIN_EMAIL no se promueve ni reactiva nada: solo se crea si no existe', async () => {
    await expect(ensureSuperadmin(db, { email: OWNER, fromBoot: true }, 'http://localhost')).rejects.toThrow(/npm run superadmin/);
    expect((await db.query('SELECT is_platform_admin FROM users WHERE email=$1', [OWNER])).rows[0]).toEqual({ is_platform_admin: false });
    expect((await ensureSuperadmin(db, { email: ADMIN, fromBoot: true }, 'http://localhost'))).toMatchObject({ state: 'existing', link: null });
    expect((await ensureSuperadmin(db, { email: 'boot@bmdev.test', fromBoot: true }, 'http://localhost')).state).toBe('created');
  });

  it('el restablecimiento de contraseña de plataforma ya no existe; salir de la asistencia exige Superadmin', async () => {
    expect((await api(ADMIN, 'POST', '/api/admin/users/1/reset-password', { password: 'x-12345678', reason: 'x' })).status).toBe(404);
    expect((await api(OWNER, 'POST', '/api/admin/leave', {})).status).toBe(403);
    expect((await api(null, 'POST', '/api/admin/leave', {})).status).toBe(401);
  });
});

describe('Superadmin · invitación ya aceptada', () => {
  it('un ex-dueño dado de baja por el local no recupera el rol con un enlace nuevo', async () => {
    const I = await ok(ADMIN, 'POST', '/api/admin/restaurants', { name: 'Prueba Ex', slug: 'prueba-ex', ownerName: 'C', ownerEmail: 'caja@esquina.test' });
    expect(I.link.kind).toBe('invite');
    expect((await app.inject({ method: 'POST', url: `/api/account-links/${token(I.link.url)}`, payload: {} })).statusCode).toBe(200);
    await db.query(`UPDATE memberships SET roles='{waiter}', active=false WHERE restaurant_id=$1 AND user_id=(SELECT id FROM users WHERE email='caja@esquina.test')`, [I.restaurant.id]);
    expect((await api(ADMIN, 'POST', `/api/admin/restaurants/${I.restaurant.id}/link`, { email: 'caja@esquina.test' })).status).toBe(400);
  });
});
