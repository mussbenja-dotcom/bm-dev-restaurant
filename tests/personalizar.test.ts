import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../server/db.ts';
import { buildApp } from '../server/app.ts';
import { seed, TEST_PASSWORD } from '../server/seed.ts';

// Personalizar mi restaurante: borrador → vista previa → publicar, fotos, combos y aislamiento entre locales.
let app: FastifyInstance;
let db: Awaited<ReturnType<typeof openDb>>;
let dir: string;
const jar: Record<string, string> = {};
let n = 0;
const op = () => `pz-${Date.now()}-${++n}`;
const OWNER = 'dueno@esquina.test', OWNER_B = 'dueno@fuego.test', MOZO = 'mozo1@esquina.test', CAJA = 'caja@esquina.test';

async function api(who: string | null, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { ...(who ? { cookie: jar[who] } : {}), ...headers } });
  return { status: r.statusCode, body: (() => { try { return JSON.parse(r.body); } catch { return r.body; } })() };
}
const ok = async (who: string | null, method: string, url: string, payload?: unknown) => {
  const r = await api(who, method, url, payload);
  expect(r.status, `${method} ${url} -> ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
/** Sube un archivo como lo haría el navegador (multipart/form-data). */
async function upload(who: string, url: string, buf: Buffer, type = 'image/jpeg') {
  const b = '----bmr' + n++;
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="foto.jpg"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
  return api(who, 'POST', url, body, { 'content-type': `multipart/form-data; boundary=${b}` });
}
const photo = (w = 2400, h = 1600) => sharp({ create: { width: w, height: h, channels: 3, background: '#c0603a' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'GPS-PRUEBA' } } }).toBuffer();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bmr-pz-'));
  db = await openDb(null);
  await seed(db);
  ({ app } = await buildApp({ db, dataDir: dir, publicUrl: 'http://localhost', env: 'test' }));
  for (const u of [OWNER, OWNER_B, MOZO, CAJA]) {
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email: u, password: TEST_PASSWORD } });
    jar[u] = String(r.headers['set-cookie']).split(';')[0];
  }
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('marca: borrador, vista previa y publicación', () => {
  it('los cambios no se ven en la carta pública hasta publicar; después se ven en el enlace y en el QR', async () => {
    const before = await ok(null, 'GET', '/api/public/r/esquina');
    expect(before.restaurant.brand.style).toBe('clasica');

    await ok(OWNER, 'PUT', '/api/brand', { name: 'La Esquina de Boedo', style: 'moderna', color: '#ffd60a', paper: 'oscuro', tagline: 'Nueva portada', instagram: '@esquina.boedo' });
    const logo = await upload(OWNER, '/api/brand/image/logo', await photo(800, 800));
    expect(logo.status, JSON.stringify(logo.body)).toBe(200);

    const still = await ok(null, 'GET', '/api/public/r/esquina');
    expect(still.restaurant.brand.style).toBe('clasica');
    expect(still.restaurant.brand.logo).toBeNull();
    const prev = await ok(OWNER, 'GET', '/api/editor/preview');
    expect(prev.restaurant.brand).toMatchObject({ style: 'moderna', color: '#ffd60a', paper: 'oscuro', instagram: 'esquina.boedo', logo: logo.body.logo });
    expect((await ok(OWNER, 'GET', '/api/brand')).pending).toBe(1);

    await ok(OWNER, 'POST', '/api/editor/publish', {});
    const after = await ok(null, 'GET', '/api/public/r/esquina');
    expect(after.restaurant.brand).toMatchObject({ style: 'moderna', color: '#ffd60a', logo: logo.body.logo });
    expect(after.restaurant.settings.tagline).toBe('Nueva portada');
    const qr = (await db.query<any>(`SELECT t.qr_token FROM tables t JOIN restaurants r ON r.id=t.restaurant_id WHERE r.slug='esquina' LIMIT 1`)).rows[0].qr_token;
    expect((await ok(null, 'GET', `/api/public/t/${qr}`)).restaurant.brand.logo).toBe(logo.body.logo);
    expect((await ok(OWNER, 'GET', '/api/brand')).pending).toBe(0);
  });

  it('valida y comprime las fotos: WebP, sin metadatos, tamaño acotado', async () => {
    const m = await ok(OWNER, 'GET', '/api/editor/menu');
    const id = m.products.find((p: any) => p.name.startsWith('Provoleta')).id;
    const up = await upload(OWNER, `/api/editor/products/${id}/photo`, await photo());
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const meta = await sharp(readFileSync(join(dir, 'uploads', up.body.photo))).metadata(); // por buffer: en Windows sharp retiene el archivo abierto
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(1200);
    expect(meta.exif).toBeUndefined();
    // Un archivo que dice ser JPG pero no es imagen, uno minúsculo y un PDF se rechazan.
    expect((await upload(OWNER, `/api/editor/products/${id}/photo`, Buffer.from('no soy una imagen'))).status).toBe(400);
    expect((await upload(OWNER, `/api/editor/products/${id}/photo`, await photo(50, 50))).status).toBe(400);
    expect((await upload(OWNER, `/api/editor/products/${id}/photo`, Buffer.from('%PDF-1.4'), 'application/pdf')).status).toBe(400);
    // Reemplazar en borrador borra el archivo anterior que nunca se publicó.
    const again = await upload(OWNER, `/api/editor/products/${id}/photo`, await photo());
    expect(existsSync(join(dir, 'uploads', up.body.photo))).toBe(false);
    await ok(OWNER, 'POST', '/api/editor/publish', {});
    const pub = await ok(null, 'GET', '/api/public/r/esquina');
    expect(pub.products.find((p: any) => p.id === id).photo).toBe(again.body.photo);
    // Quitar la foto y publicar: la carta sigue completa sin foto y el archivo se elimina.
    await ok(OWNER, 'DELETE', `/api/editor/products/${id}/photo`);
    await ok(OWNER, 'POST', '/api/editor/publish', {});
    expect((await ok(null, 'GET', '/api/public/r/esquina')).products.find((p: any) => p.id === id).photo).toBeNull();
    expect(existsSync(join(dir, 'uploads', again.body.photo))).toBe(false);
  });
});

describe('carta: crear, editar, ordenar, ocultar y publicar', () => {
  it('un cambio de precio se aplica a pedidos nuevos al publicar; lo ya pedido conserva su precio', async () => {
    let m = await ok(OWNER, 'GET', '/api/editor/menu');
    const p = m.products.find((x: any) => x.name.startsWith('Flan'));
    const tables = await ok(MOZO, 'GET', '/api/tables');
    const v = await ok(MOZO, 'POST', '/api/visits', { tableId: tables.find((t: any) => t.number === '8').id, guests: 2 });
    await ok(MOZO, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: p.id, qty: 1 }] });

    await ok(OWNER, 'POST', '/api/editor/products', { id: p.id, categoryId: p.category_id, stationId: p.station_id, name: 'Flan casero con dulce de leche', priceCents: p.price_cents + 100_000, course: p.course, description: 'Receta de la abuela' });
    // Antes de publicar, el salón y la carta pública siguen con el precio vigente.
    expect((await ok(MOZO, 'GET', '/api/menu')).products.find((x: any) => x.id === p.id).price_cents).toBe(p.price_cents);
    expect((await ok(null, 'GET', '/api/public/r/esquina')).products.find((x: any) => x.id === p.id).price_cents).toBe(p.price_cents);
    m = await ok(OWNER, 'GET', '/api/editor/menu');
    expect(m.products.find((x: any) => x.id === p.id)).toMatchObject({ pending: true, price_cents: p.price_cents + 100_000 });

    await ok(OWNER, 'POST', '/api/editor/publish', {});
    expect((await ok(null, 'GET', '/api/public/r/esquina')).products.find((x: any) => x.id === p.id)).toMatchObject({ price_cents: p.price_cents + 100_000, description: 'Receta de la abuela' });
    const lines = (await db.query<any>('SELECT unit_price_cents FROM order_lines WHERE visit_id=$1', [v.id])).rows;
    expect(lines[0].unit_price_cents).toBe(p.price_cents);
    const r2 = await ok(MOZO, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: p.id, qty: 1 }] });
    expect(r2.lines[0].unit_price_cents).toBe(p.price_cents + 100_000);
    const audit = (await db.query<any>(`SELECT data FROM audit_log WHERE action='product.price' AND entity_id=$1`, [String(p.id)])).rows;
    expect(audit.at(-1).data).toEqual({ from: p.price_cents, to: p.price_cents + 100_000 });
  });

  it('un plato y una categoría nuevos no aparecen en ningún lado hasta publicar; descartar los borra', async () => {
    const m = await ok(OWNER, 'GET', '/api/editor/menu');
    const cat = await ok(OWNER, 'POST', '/api/editor/categories', { name: 'Para compartir' });
    const st = m.stations[0].id;
    const np = await ok(OWNER, 'POST', '/api/editor/products', { categoryId: cat.id, stationId: st, name: 'Tabla de fiambres', priceCents: 1_800_000, options: [{ grp: 'Tamaño', name: 'Chica', priceDeltaCents: 0 }, { grp: 'Tamaño', name: 'Grande', priceDeltaCents: 600_000 }, { grp: 'Extras', name: 'Pan casero', priceDeltaCents: 90_000, multi: true }] });
    expect((await ok(MOZO, 'GET', '/api/menu')).products.some((x: any) => x.id === np.id)).toBe(false);
    expect((await ok(null, 'GET', '/api/public/r/esquina')).products.some((x: any) => x.id === np.id)).toBe(false);
    const prev = await ok(OWNER, 'GET', '/api/editor/preview');
    expect(prev.categories.map((c: any) => c.name)).toContain('Para compartir');
    expect(prev.products.find((x: any) => x.id === np.id).options).toHaveLength(3);

    await ok(OWNER, 'POST', '/api/editor/discard', {});
    expect((await ok(OWNER, 'GET', '/api/editor/menu')).products.some((x: any) => x.id === np.id)).toBe(false);
    expect((await ok(OWNER, 'GET', '/api/editor/menu')).categories.some((x: any) => x.name === 'Para compartir')).toBe(false);
  });

  it('ordenar categorías y ocultar/mostrar una categoría y un plato', async () => {
    const m = await ok(OWNER, 'GET', '/api/editor/menu');
    const ids = m.categories.map((c: any) => c.id);
    await ok(OWNER, 'POST', '/api/editor/order', { kind: 'categories', ids: [...ids].reverse() });
    const postres = m.categories.find((c: any) => c.name === 'Postres');
    await ok(OWNER, 'POST', '/api/editor/categories', { id: postres.id, name: 'Postres', visible: false });
    const agua = m.products.find((p: any) => p.name.startsWith('Agua'));
    await ok(OWNER, 'POST', `/api/editor/products/${agua.id}/visible`, { visible: false });
    await ok(OWNER, 'POST', '/api/editor/publish', {});
    const pub = await ok(null, 'GET', '/api/public/r/esquina');
    expect(pub.categories.map((c: any) => c.id)).toEqual([...ids].reverse().filter((id: number) => id !== postres.id));
    expect(pub.products.some((p: any) => p.id === agua.id)).toBe(false);
    // El personal sigue viendo los platos ocultos de la carta pública (los puede cargar en el salón).
    expect((await ok(MOZO, 'GET', '/api/menu')).products.some((p: any) => p.id === agua.id)).toBe(true);
    await ok(OWNER, 'POST', `/api/editor/products/${agua.id}/visible`, { visible: true });
    await ok(OWNER, 'POST', '/api/editor/categories', { id: postres.id, name: 'Postres', visible: true });
    await ok(OWNER, 'POST', '/api/editor/publish', {});
    expect((await ok(null, 'GET', '/api/public/r/esquina')).products.some((p: any) => p.id === agua.id)).toBe(true);
  });
});

describe('aislamiento entre locales y roles', () => {
  it('un dueño solo edita su local; el mozo no entra al editor', async () => {
    const a = await ok(OWNER, 'GET', '/api/editor/menu');
    const pA = a.products[0];
    expect((await api(OWNER_B, 'POST', '/api/editor/products', { id: pA.id, categoryId: pA.category_id, stationId: pA.station_id, name: 'Hackeado', priceCents: 1 })).status).toBe(404);
    expect((await api(OWNER_B, 'POST', `/api/editor/products/${pA.id}/visible`, { visible: false })).status).toBe(404);
    expect((await upload(OWNER_B, `/api/editor/products/${pA.id}/photo`, await photo())).status).toBe(404);
    expect((await api(OWNER_B, 'POST', '/api/editor/order', { kind: 'products', ids: [pA.id] })).status).toBe(404);
    expect((await api(OWNER_B, 'POST', '/api/editor/categories', { id: a.categories[0].id, name: 'X' })).status).toBe(404);
    // Usar una categoría de otro local en un plato propio también se rechaza.
    const b = await ok(OWNER_B, 'GET', '/api/editor/menu');
    expect((await api(OWNER_B, 'POST', '/api/editor/products', { categoryId: a.categories[0].id, stationId: b.stations[0].id, name: 'X', priceCents: 1 })).status).toBe(400);
    // Publicar o descartar en B no toca nada de A.
    await ok(OWNER, 'PUT', '/api/brand', { name: 'La Esquina de Boedo', color: '#2563eb' });
    await ok(OWNER_B, 'POST', '/api/editor/discard', {});
    await ok(OWNER_B, 'POST', '/api/editor/publish', {});
    expect((await ok(OWNER, 'GET', '/api/brand')).draft.color).toBe('#2563eb');
    expect((await ok(null, 'GET', '/api/public/r/fuego')).restaurant.brand.color).toBe('#a8231b');
    expect((await api(MOZO, 'GET', '/api/editor/menu')).status).toBe(403);
    expect((await api(MOZO, 'POST', '/api/editor/publish', {})).status).toBe(403);
    expect((await api(null, 'GET', '/api/editor/preview')).status).toBe(401);
    await ok(OWNER, 'POST', '/api/editor/discard', {});
  });
});

describe('combos', () => {
  it('muestra el ahorro real y al pedirlo cada plato va a su estación con su parte del precio', async () => {
    const m = await ok(OWNER, 'GET', '/api/editor/menu');
    const mila = m.products.find((p: any) => p.name.startsWith('Milanesa'));
    const vino = m.products.find((p: any) => p.name.startsWith('Copa de Malbec'));
    const flan = m.products.find((p: any) => p.name.startsWith('Flan'));
    expect((await api(OWNER, 'POST', '/api/editor/products', { categoryId: mila.category_id, stationId: mila.station_id, name: 'Combo solo', priceCents: 100, kind: 'combo', components: [{ productId: mila.id }] })).status).toBe(400);
    const full = vino.price_cents + flan.price_cents * 2;
    const c = await ok(OWNER, 'POST', '/api/editor/products', { categoryId: flan.category_id, stationId: flan.station_id, name: 'Combo dulce', priceCents: full - 150_000, kind: 'combo', components: [{ productId: vino.id, qty: 1 }, { productId: flan.id, qty: 2 }] });
    await ok(OWNER, 'POST', '/api/editor/publish', {});
    const pub = (await ok(null, 'GET', '/api/public/r/esquina')).products.find((p: any) => p.id === c.id);
    expect(pub).toMatchObject({ kind: 'combo', savings_cents: 150_000, components: [{ name: vino.name, qty: 1 }, { name: flan.name, qty: 2 }] });

    const tables = await ok(MOZO, 'GET', '/api/tables');
    const v = await ok(MOZO, 'POST', '/api/visits', { tableId: tables.find((t: any) => t.number === '9').id, guests: 2 });
    const r = await ok(MOZO, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: c.id, qty: 2 }] });
    expect(r.lines).toHaveLength(2);
    expect(new Set(r.lines.map((l: any) => l.station_id)).size).toBe(2); // barra y cocina
    expect(r.lines.reduce((s: number, l: any) => s + l.unit_price_cents * l.qty, 0)).toBe((full - 150_000) * 2);
    expect(r.lines.every((l: any) => l.options[0].grp === 'Combo' && l.qty === 2)).toBe(true);
    const bal = await ok(MOZO, 'GET', `/api/visits/${v.id}`);
    expect(bal.balance?.total ?? bal.total).toBe((full - 150_000) * 2);
  });
});

describe('auditoría del PIN de supervisor', () => {
  it('registra cada PIN errado y el bloqueo, sin guardar el PIN ingresado', async () => {
    for (let i = 0; i < 5; i++) expect((await api(CAJA, 'POST', '/api/payments/999999/refund', { opId: op(), reason: 'x', supervisorPin: '9876' })).status).toBe(403);
    await new Promise((r) => setTimeout(r, 50));
    const rows = (await db.query<any>(`SELECT data::text AS d FROM audit_log WHERE action='pin.fail'`)).rows;
    expect(rows).toHaveLength(5);
    expect(rows.at(-1).d).toContain('"locked": true');
    expect(rows.some((x) => x.d.includes('9876'))).toBe(false);
  });
});

describe('traspaso de mesa entre mozos', () => {
  it('lista solo mozos del local, exige permiso y solo acepta mozos en visitas abiertas', async () => {
    const floor = await ok(OWNER, 'GET', '/api/floor');
    const free = floor.tables.find((t: any) => !t.visit_id);
    const v = await ok(MOZO, 'POST', '/api/visits', { tableId: free.id, guests: 2 });
    const waiters = await ok(OWNER, 'GET', '/api/staff/waiters');
    expect(waiters.map((w: any) => w.name).sort()).toEqual(['Lucas Mozo', 'Sofía Moza']);
    expect((await api(MOZO, 'GET', '/api/staff/waiters')).status).toBe(403); // mozo1 no tiene "ve todas las mesas"
    const caja = (await ok(CAJA, 'GET', '/api/me')).user.id;
    expect((await api(OWNER, 'POST', `/api/visits/${v.id}/waiter`, { userId: caja })).status).toBe(400);
    const sofia = waiters.find((w: any) => w.name === 'Sofía Moza').id;
    expect((await api(OWNER_B, 'POST', `/api/visits/${v.id}/waiter`, { userId: sofia })).status).toBe(400); // otro local
    await ok(OWNER, 'POST', `/api/visits/${v.id}/waiter`, { userId: sofia });
    expect((await ok(OWNER, 'GET', `/api/visits/${v.id}`)).visit.waiter_id).toBe(sofia);
    expect((await api(OWNER, 'POST', '/api/visits/999999/waiter', { userId: sofia })).status).toBe(404);
  });
});

describe('correcciones de la revisión', () => {
  it('publicar la marca no pisa lo que se cambió después en Configuración', async () => {
    await ok(OWNER, 'PUT', '/api/brand', { ...(await ok(OWNER, 'GET', '/api/brand')).published, tagline: 'Frase en borrador' });
    const r = await ok(OWNER, 'GET', '/api/me');
    await ok(OWNER, 'PUT', '/api/restaurant', { name: r.restaurant.name, theme: r.restaurant.theme, settings: { whatsapp_phone: '5491199998888' } });
    await ok(OWNER, 'POST', '/api/editor/publish', {});
    const pub = (await ok(null, 'GET', '/api/public/r/esquina')).restaurant.settings;
    expect(pub.tagline).toBe('Frase en borrador');
    expect(pub.whatsapp_phone).toBe('5491199998888');
  });

  it('marca sin cambios reales no queda como pendiente y rechaza claves del prototipo', async () => {
    const b = await ok(OWNER, 'GET', '/api/brand');
    await ok(OWNER, 'PUT', '/api/brand', { ...b.published, paper: 'constructor' });
    const after = await ok(OWNER, 'GET', '/api/brand');
    expect(after.draft).toBeNull();
    expect(after.pending).toBe(0);
  });

  it('un plato nuevo sin publicar no se puede pedir, ni como mitad de pizza', async () => {
    const m = await ok(OWNER, 'GET', '/api/editor/menu');
    const flan = m.products.find((p: any) => p.name.startsWith('Flan'));
    const nuevo = await ok(OWNER, 'POST', '/api/editor/products', { categoryId: flan.category_id, stationId: flan.station_id, name: 'Postre secreto', priceCents: 1 });
    const floor = await ok(MOZO, 'GET', '/api/floor');
    const v = await ok(MOZO, 'POST', '/api/visits', { tableId: floor.tables.find((t: any) => !t.visit_id).id });
    expect((await api(MOZO, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: nuevo.id, qty: 1 }] })).status).toBe(400);

    const mb = await ok(OWNER_B, 'GET', '/api/editor/menu');
    const muzza = mb.products.find((p: any) => p.name === 'Muzzarella');
    const pizza = await ok(OWNER_B, 'POST', '/api/editor/products', { categoryId: muzza.category_id, stationId: muzza.station_id, name: 'Pizza borrador', priceCents: 1, kind: 'pizza' });
    const q = await api(null, 'POST', '/api/public/r/fuego/quote', { channel: 'retiro', items: [{ productId: muzza.id, qty: 1, halves: pizza.id }] });
    expect(q.status).toBe(400);
    expect(JSON.stringify(q.body)).not.toContain('Pizza borrador');
    await ok(OWNER, 'POST', '/api/editor/discard', {});
    await ok(OWNER_B, 'POST', '/api/editor/discard', {});
  });

  it('una categoría oculta y publicada deja de aceptar pedidos públicos', async () => {
    const m = await ok(OWNER_B, 'GET', '/api/editor/menu');
    const beb = m.categories.find((c: any) => c.name === 'Bebidas');
    const gas = m.products.find((p: any) => p.category_id === beb.id);
    await ok(OWNER_B, 'POST', '/api/editor/categories', { id: beb.id, name: beb.name, visible: false });
    await ok(OWNER_B, 'POST', '/api/editor/publish', {});
    expect((await api(null, 'POST', '/api/public/r/fuego/quote', { channel: 'retiro', items: [{ productId: gas.id, qty: 1 }] })).status).toBe(400);
    await ok(OWNER_B, 'POST', '/api/editor/categories', { id: beb.id, name: beb.name, visible: true });
    await ok(OWNER_B, 'POST', '/api/editor/publish', {});
  });

  it('si falta un componente, el problema se informa con el id del combo', async () => {
    const m = await ok(OWNER, 'GET', '/api/editor/menu');
    const combo = m.products.find((p: any) => p.name === 'Combo dulce');
    const vino = m.products.find((p: any) => p.name.startsWith('Copa de Malbec'));
    await ok(OWNER, 'POST', `/api/products/${vino.id}/availability`, { available: false, stockQty: null });
    const floor = await ok(MOZO, 'GET', '/api/floor');
    const v = await ok(MOZO, 'POST', '/api/visits', { tableId: floor.tables.find((t: any) => !t.visit_id).id });
    const r = await api(MOZO, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: combo.id, qty: 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.problems[0].productId).toBe(combo.id);
    await ok(OWNER, 'POST', `/api/products/${vino.id}/availability`, { available: true, stockQty: null });
    // Un componente de combo no puede pasar a ser combo o pizza (los combos no se anidan).
    expect((await api(OWNER, 'PUT', `/api/products/${vino.id}`, { categoryId: vino.category_id, stationId: vino.station_id, name: vino.name, priceCents: vino.price_cents, kind: 'pizza', options: [] })).status).toBe(400);
  });

  it('un combo que incluye un plato sin publicar no se puede pedir (aunque se cree por la API vieja)', async () => {
    const m = await ok(OWNER, 'GET', '/api/editor/menu');
    const flan = m.products.find((p: any) => p.name.startsWith('Flan'));
    const nuevo = await ok(OWNER, 'POST', '/api/editor/products', { categoryId: flan.category_id, stationId: flan.station_id, name: 'Borrador en combo', priceCents: 100 });
    const combo = await ok(OWNER, 'POST', '/api/products', { categoryId: flan.category_id, stationId: flan.station_id, name: 'Combo con borrador', priceCents: 500, kind: 'combo', components: [{ productId: flan.id }, { productId: nuevo.id }], options: [] });
    const floor = await ok(MOZO, 'GET', '/api/floor');
    const v = await ok(MOZO, 'POST', '/api/visits', { tableId: floor.tables.find((t: any) => !t.visit_id).id });
    expect((await api(MOZO, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: combo.id, qty: 1 }] })).status).toBe(400);
  });

  it('solo acepta imágenes reales JPG/PNG/WebP aunque el navegador declare otro tipo', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600"/></svg>');
    expect((await upload(OWNER, '/api/brand/image/cover', svg, 'image/png')).status).toBe(400);
    const gif = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#000' } }).gif().toBuffer();
    expect((await upload(OWNER, '/api/brand/image/cover', gif, 'image/png')).status).toBe(400);
  });
});
