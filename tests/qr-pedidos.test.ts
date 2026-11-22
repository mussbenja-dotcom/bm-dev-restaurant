import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../server/db.ts';
import { buildApp } from '../server/app.ts';
import { seed, TEST_PASSWORD } from '../server/seed.ts';
import { eventFor, stationScope } from '../server/core.ts';
import { purgeLoginAttempts } from '../server/routes/auth.ts';

// Pedidos por QR autorizados por el mozo, combos con elección, totales iguales en todas las pantallas,
// registro de ingresos y eventos en vivo filtrados por rol.
let app: FastifyInstance;
let ctx: any;
let db: Awaited<ReturnType<typeof openDb>>;
let dir: string;
const jar: Record<string, string> = {};
let n = 0;
const op = () => `qr-${Date.now()}-${++n}`;
const OWNER = 'dueno@esquina.test', OWNER_B = 'dueno@fuego.test', MOZO1 = 'mozo1@esquina.test', MOZO2 = 'mozo2@esquina.test', COCINA = 'cocina@esquina.test', BARRA = 'barra@esquina.test', CAJA = 'caja@esquina.test';

async function api(who: string | null, method: string, url: string, payload?: unknown, cookie?: string) {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: cookie ? { cookie } : who ? { cookie: jar[who] } : {} });
  return { status: r.statusCode, body: (() => { try { return JSON.parse(r.body); } catch { return r.body; } })(), headers: r.headers };
}
const ok = async (who: string | null, method: string, url: string, payload?: unknown, cookie?: string) => {
  const r = await api(who, method, url, payload, cookie);
  expect(r.status, `${method} ${url} -> ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
let menu: any, tables: any[], users: any[];
const pid = (name: string) => menu.products.find((p: any) => p.name.startsWith(name)).id;
const opt = (name: string, o: string) => menu.products.find((p: any) => p.name.startsWith(name)).options.find((x: any) => x.name === o).id;
const table = (num: string) => tables.find((t) => t.number === num);
const uid = (email: string) => users.find((u) => u.email === email).id;
const events: any[] = [];

/** Un celular de la mesa: entra con el código y guarda su cookie. */
async function phone(qr: string, code: string) {
  const r = await api(null, 'POST', `/api/public/t/${qr}/join`, { code });
  return { status: r.status, cookie: r.status === 200 ? String(r.headers['set-cookie']).split(';')[0] : '' };
}
const milanesa = () => ({ productId: pid('Milanesa'), qty: 1, optionIds: [opt('Milanesa', 'Papas fritas')] });
const gaseosa = () => ({ productId: pid('Gaseosa'), qty: 2 });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bmr-qr-'));
  db = await openDb(null);
  await seed(db);
  ({ app, ctx } = await buildApp({ db, dataDir: dir, publicUrl: 'http://localhost', env: 'test' }));
  ctx.bus.on('ev', (e: any) => events.push(e));
  for (const u of [OWNER, OWNER_B, MOZO1, MOZO2, COCINA, BARRA, CAJA]) {
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email: u, password: TEST_PASSWORD } });
    expect(r.statusCode, r.body).toBe(200);
    jar[u] = String(r.headers['set-cookie']).split(';')[0];
  }
  menu = await ok(OWNER, 'GET', '/api/menu');
  tables = await ok(OWNER, 'GET', '/api/tables');
  users = (await db.query('SELECT id, email FROM users')).rows as any[];
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('Q01 · pedido desde la mesa autorizado por el mozo', () => {
  let visit: any, qr: string, code: string, cel1: string;

  it('sin habilitar se ve la carta pero no se puede enviar; solo el mozo a cargo habilita', async () => {
    qr = table('1').qr_token;
    visit = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('1').id, guests: 3 });
    const pub = await ok(null, 'GET', `/api/public/t/${qr}`);
    expect(pub.tableOpen).toBe(true);
    expect(pub.qrEnabled).toBe(false);
    expect(pub.products.length).toBeGreaterThan(0);
    expect(JSON.stringify(pub)).not.toContain(visit.access_code); // el código nunca viaja a la carta pública
    expect((await api(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [milanesa()] })).status).toBe(403);
    expect((await phone(qr, visit.access_code)).status).toBe(403); // ni siquiera con el código previo
    expect((await api(COCINA, 'POST', `/api/visits/${visit.id}/qr`, { enabled: true })).status).toBe(403);

    const on = await ok(MOZO1, 'POST', `/api/visits/${visit.id}/qr`, { enabled: true });
    expect(on.code).toMatch(/^\d{6}$/);
    code = on.code;
    expect((await ok(null, 'GET', `/api/public/t/${qr}`)).qrEnabled).toBe(true);
    expect((await phone(qr, '000000')).status).toBe(403);
  });

  it('con el código envía: comida a cocina, bebidas a barra, cuenta de la mesa marcada QR y aviso al mozo asignado', async () => {
    cel1 = (await phone(qr, code)).cookie;
    expect(cel1).toMatch(/^diner=/);
    const from = events.length;
    const opId = op();
    const body = { opId, items: [milanesa(), gaseosa()], expected: [14_500_00, 3_200_00] };
    const r = await ok(null, 'POST', `/api/public/t/${qr}/order`, body, cel1);
    expect(r.round.number).toBeGreaterThan(0);
    expect(r.lines.map((l: any) => l.name).sort()).toEqual(['Gaseosa línea Coca-Cola 500 ml', 'Milanesa de nalga']);

    const kitchen = (await ok(COCINA, 'GET', '/api/kds?view=station')).lines.filter((l: any) => l.visit_id === visit.id);
    const bar = (await ok(BARRA, 'GET', '/api/kds?view=station')).lines.filter((l: any) => l.visit_id === visit.id);
    expect(kitchen.map((l: any) => [l.name, l.source])).toEqual([['Milanesa de nalga', 'diner']]);
    expect(bar.map((l: any) => [l.name, l.qty])).toEqual([['Gaseosa línea Coca-Cola 500 ml', 2]]);

    const v = await ok(MOZO1, 'GET', `/api/visits/${visit.id}`);
    expect(v.balance.total).toBe(14_500_00 + 2 * 3_200_00);
    const notice = events.slice(from).find((e) => e.type === 'notice');
    expect(notice).toMatchObject({ toUser: uid(MOZO1), visitId: visit.id, tables: '1', round: r.round.number });
    const calls = (await ok(MOZO1, 'GET', '/api/floor')).calls.filter((c: any) => c.visit_id === visit.id && c.reason === 'pedido');
    expect(calls).toHaveLength(1);

    // Doble toque / reintento con el mismo envío: una sola comanda.
    const again = await ok(null, 'POST', `/api/public/t/${qr}/order`, body, cel1);
    expect(again.duplicate).toBe(true);
    expect(again.round.number).toBe(r.round.number);
    expect((await ok(MOZO1, 'GET', `/api/visits/${visit.id}`)).balance.total).toBe(v.balance.total);
  });

  it('un segundo celular y una segunda ronda; el aviso llega al mozo nuevo si reasignan la mesa', async () => {
    const cel2 = (await phone(qr, code)).cookie;
    expect(cel2).toMatch(/^diner=/);
    await ok(MOZO2, 'POST', `/api/visits/${visit.id}/waiter`, { userId: uid(MOZO2) });
    const from = events.length;
    const r = await ok(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [{ productId: pid('Agua mineral'), qty: 1 }] }, cel2);
    const notices = events.slice(from).filter((e) => e.type === 'notice');
    expect(notices.map((e) => e.toUser)).toEqual([uid(MOZO2)]);
    expect(notices[0].round).toBe(r.round.number);
    const r2 = await ok(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [{ productId: pid('Flan'), qty: 1 }] }, cel1);
    expect(r2.round.number).toBeGreaterThan(r.round.number);
    const call = (await ok(MOZO2, 'GET', '/api/floor')).calls.find((c: any) => c.visit_id === visit.id && c.reason === 'pedido');
    expect(call.taps).toBe(3);
  });

  it('si algo se agotó o cambió de precio, lo informa antes de confirmar y no crea comanda', async () => {
    const before = (await ok(MOZO2, 'GET', `/api/visits/${visit.id}`)).balance.total;
    const price = await api(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [gaseosa()], expected: [2_900_00] }, cel1);
    expect(price.status).toBe(409);
    expect(price.body.changes).toEqual([{ index: 0, name: 'Gaseosa línea Coca-Cola 500 ml', before: 2_900_00, after: 3_200_00 }]);
    await ok(COCINA, 'POST', `/api/products/${pid('Provoleta')}/availability`, { available: false });
    const out = await api(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [{ productId: pid('Provoleta'), qty: 1 }, gaseosa()], expected: [7_800_00, 3_200_00] }, cel1);
    expect(out.status).toBe(409);
    expect(out.body.changes).toEqual([{ index: 0, name: 'Provoleta a la plancha', unavailable: true }]);
    const last = await api(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [{ productId: pid('Vacío'), qty: 3 }] }, cel1);
    expect(last.body.changes[0]).toMatchObject({ unavailable: true, left: 1 });
    expect((await ok(MOZO2, 'GET', `/api/visits/${visit.id}`)).balance.total).toBe(before);
    await ok(COCINA, 'POST', `/api/products/${pid('Provoleta')}/availability`, { available: true });
  });

  it('el código de otra mesa no sirve, y deshabilitar revoca los celulares (solo el mozo a cargo)', async () => {
    const other = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('2').id });
    const otherCode = (await ok(MOZO1, 'POST', `/api/visits/${other.id}/qr`, { enabled: true })).code;
    expect((await phone(qr, otherCode)).status).toBe(403);
    const otherCel = (await phone(table('2').qr_token, otherCode)).cookie;
    expect((await api(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [gaseosa()] }, otherCel)).status).toBe(403); // cookie de la mesa 2 en el QR de la mesa 1

    expect((await api(MOZO1, 'POST', `/api/visits/${visit.id}/qr`, { enabled: false })).status).toBe(403); // ya no es su mesa
    await ok(MOZO2, 'POST', `/api/visits/${visit.id}/qr`, { enabled: false });
    expect((await api(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [gaseosa()] }, cel1)).status).toBe(403);
    const pub = await ok(null, 'GET', `/api/public/t/${qr}`, undefined, cel1);
    expect(pub.visit).toBeNull();
    expect(pub.products.length).toBeGreaterThan(0); // el QR sigue mostrando la carta
    expect((await phone(qr, code)).status).toBe(403); // el código viejo no se reutiliza
    const again = await ok(MOZO2, 'POST', `/api/visits/${visit.id}/qr`, { enabled: true });
    expect(again.code).not.toBe(code);
    code = again.code;
    cel1 = (await phone(qr, code)).cookie;
    await ok(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [gaseosa()] }, cel1);
  });

  it('cerrar la cuenta revoca el acceso; la próxima visita requiere habilitar de nuevo', async () => {
    const due = (await ok(CAJA, 'GET', `/api/visits/${visit.id}`)).balance.due;
    await ok(CAJA, 'POST', '/api/payments', { opId: op(), visitId: visit.id, method: 'efectivo', amountCents: due, tenderedCents: due });
    await ok(CAJA, 'POST', `/api/visits/${visit.id}/close`);
    expect((await api(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [gaseosa()] }, cel1)).status).toBe(403);
    const next = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('1').id });
    expect((await ok(null, 'GET', `/api/public/t/${qr}`)).qrEnabled).toBe(false);
    expect((await api(null, 'POST', `/api/public/t/${qr}/order`, { opId: op(), items: [gaseosa()] }, cel1)).status).toBe(403);
    expect((await phone(qr, code)).status).toBe(403);
    expect((await phone(qr, next.access_code)).status).toBe(403); // hasta que el mozo habilite
  });

  it('si el local usa el QR solo como carta, no se puede habilitar', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('3').id });
    await db.query(`UPDATE restaurants SET settings = settings || '{"mode":"menu"}' WHERE slug='esquina'`);
    expect((await api(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true })).status).toBe(409);
    await db.query(`UPDATE restaurants SET settings = settings || '{"mode":"orders"}' WHERE slug='esquina'`);
  });
});

describe('Q02 · combos con elección', () => {
  let combo: any, fixed: any;
  it('valida que lo elegible sean platos simples del mismo local', async () => {
    const base = { name: 'Combo picada', priceCents: 10_000_00, categoryId: menu.categories[0].id, stationId: menu.products[0].station_id, kind: 'combo', components: [{ productId: pid('Provoleta'), qty: 1 }] };
    const fuego = (await ok(OWNER_B, 'GET', '/api/menu')).products[0].id;
    expect((await api(OWNER, 'POST', '/api/products', { ...base, options: [{ grp: 'Bebida', name: 'X', itemId: fuego }] })).status).toBe(400);
    expect((await api(OWNER, 'POST', '/api/products', { ...base, kind: 'normal', options: [{ grp: 'Bebida', name: 'X', itemId: pid('Gaseosa') }] })).status).toBe(400);
    combo = await ok(OWNER, 'POST', '/api/products', { ...base, options: [
      { grp: 'Bebida', name: 'Gaseosa', itemId: pid('Gaseosa') },
      { grp: 'Bebida', name: 'Copa de Malbec', itemId: pid('Copa de Malbec'), priceDeltaCents: 500_00 },
    ] });
    fixed = await ok(OWNER, 'POST', '/api/products', { ...base, name: 'Combo fijo', components: [{ productId: pid('Provoleta'), qty: 1 }, { productId: pid('Agua mineral'), qty: 1 }] });
    const pub = await ok(null, 'GET', '/api/public/r/esquina');
    const c = pub.products.find((p: any) => p.id === combo.id);
    expect(c.choice).toBe(true);
    expect(c.options.map((o: any) => o.item_id)).toEqual([pid('Gaseosa'), pid('Copa de Malbec')]);
    expect(c.savings_cents).toBe(7_800_00 + 3_200_00 - 10_000_00); // con la opción más barata
    menu = await ok(OWNER, 'GET', '/api/menu');
  });

  it('el mozo elige dentro del combo: cada parte va a su estación y el total es el del combo', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('5').id });
    expect((await api(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: combo.id, qty: 1 }] })).status).toBe(400); // falta elegir
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: combo.id, qty: 2, optionIds: [opt('Combo picada', 'Copa de Malbec')] }] });
    const kitchen = (await ok(COCINA, 'GET', '/api/kds?view=station')).lines.filter((l: any) => l.visit_id === v.id);
    const bar = (await ok(BARRA, 'GET', '/api/kds?view=station')).lines.filter((l: any) => l.visit_id === v.id);
    expect(kitchen.map((l: any) => [l.name, l.qty])).toEqual([['Provoleta a la plancha', 2]]);
    expect(bar.map((l: any) => [l.name, l.qty])).toEqual([['Copa de Malbec de la casa', 2]]);
    expect((await ok(MOZO1, 'GET', `/api/visits/${v.id}`)).balance.total).toBe(2 * 10_500_00);

    await ok(BARRA, 'POST', `/api/products/${pid('Copa de Malbec')}/availability`, { available: false });
    expect((await api(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: combo.id, qty: 1, optionIds: [opt('Combo picada', 'Copa de Malbec')] }] })).status).toBe(409);
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: combo.id, qty: 1, optionIds: [opt('Combo picada', 'Gaseosa')] }] });
    await ok(BARRA, 'POST', `/api/products/${pid('Copa de Malbec')}/availability`, { available: true });
    // El combo fijo de siempre sigue igual.
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: fixed.id, qty: 1 }] });
    expect((await ok(MOZO1, 'GET', `/api/visits/${v.id}`)).balance.total).toBe(4 * 10_000_00 + 500_00 * 2); // 2 con Malbec + 1 con gaseosa + 1 fijo
  });

  it('el cliente elige dentro del combo desde el QR', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('6').id });
    const { code } = await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true });
    const cel = (await phone(table('6').qr_token, code)).cookie;
    await ok(null, 'POST', `/api/public/t/${table('6').qr_token}/order`, { opId: op(), items: [{ productId: combo.id, qty: 1, optionIds: [opt('Combo picada', 'Gaseosa')] }], expected: [10_000_00] }, cel);
    const bar = (await ok(BARRA, 'GET', '/api/kds?view=station')).lines.filter((l: any) => l.visit_id === v.id);
    expect(bar.map((l: any) => l.name)).toEqual(['Gaseosa línea Coca-Cola 500 ml']);
  });
});

describe('Q03 · totales: Salón, precuenta, Caja y ticket dan lo mismo', () => {
  const amounts = async (vid: number) => {
    const floor = (await ok(MOZO1, 'GET', '/api/floor')).visits.find((v: any) => v.id === vid);
    const caja = (await ok(CAJA, 'GET', `/api/visits/${vid}`)).balance;
    const pre = (await ok(MOZO1, 'POST', '/api/tickets/precuenta', { visitId: vid })).snapshot;
    return { floor, caja, pre };
  };

  it('descuento dentro del límite, por encima del tope, anulación posterior, cobro dividido y vuelto', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('7').id, guests: 2 });
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Bife'), qty: 1, optionIds: [opt('Bife', 'Jugoso')] }, { productId: pid('Agua mineral'), qty: 1 }] });
    const subtotal = 19_800_00 + 2_600_00;
    expect((await api(CAJA, 'POST', `/api/visits/${v.id}/discounts`, { amountCents: subtotal + 1, reason: 'Excede', supervisorPin: '1234' })).status).toBe(409); // tope: el saldo
    await ok(CAJA, 'POST', `/api/visits/${v.id}/discounts`, { amountCents: 5_000_00, reason: 'Cliente frecuente', supervisorPin: '1234' });
    let a = await amounts(v.id);
    expect(a.caja.total).toBe(subtotal - 5_000_00);
    expect(a.floor.due).toBe(a.caja.due);
    expect(a.pre.total).toBe(a.caja.total);
    expect(a.pre.lines.reduce((s: number, l: any) => s + l.total, 0) - a.pre.discounts.reduce((s: number, d: any) => s + d.amount, 0)).toBe(a.pre.total);

    // Se anula el bife después del descuento: el descuento queda topeado al subtotal y todos los números siguen cerrando.
    const bife = (await ok(CAJA, 'GET', `/api/visits/${v.id}`)).lines.find((l: any) => l.name.startsWith('Bife'));
    await ok(CAJA, 'POST', `/api/lines/${bife.id}/void`, { reason: 'Error de carga', supervisorPin: '1234' });
    a = await amounts(v.id);
    expect(a.caja.total).toBe(0);
    expect(a.floor.due).toBe(0);
    expect(a.pre.total).toBe(0);
    expect(a.pre.discountTotal).toBe(2_600_00);
    expect(a.pre.lines.reduce((s: number, l: any) => s + l.total, 0) - a.pre.discounts.reduce((s: number, d: any) => s + d.amount, 0)).toBe(0);
    expect(a.pre.discounts.find((d: any) => d.kind === 'tope').amount).toBe(-(5_000_00 - 2_600_00));
    // El resumen del turno también muestra lo aplicado: el ajuste resta lo que quedó sin efecto.
    const turno = await ok(CAJA, 'GET', '/api/shifts/current');
    expect(turno.descuentos.find((d: any) => d.kind === 'tope').total).toBe(-(5_000_00 - 2_600_00));
    expect(turno.openVisits.find((x: any) => x.id === v.id).due).toBe(0);
  });

  it('cobro dividido en partes con vuelto en efectivo; reimprimir el ticket no cobra de nuevo; los precios cargados se conservan', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('8').id, guests: 3 });
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Provoleta'), qty: 1 }, { productId: pid('Flan'), qty: 2 }] });
    const total = 7_800_00 + 2 * 5_200_00;
    // El precio cambia después de pedir: la cuenta conserva el precio del pedido.
    const flan = menu.products.find((p: any) => p.name.startsWith('Flan'));
    await ok(OWNER, 'PUT', `/api/products/${flan.id}`, { name: flan.name, priceCents: 9_999_00, categoryId: flan.category_id, stationId: flan.station_id, course: flan.course });
    expect((await ok(CAJA, 'GET', `/api/visits/${v.id}`)).balance.total).toBe(total);

    const parts = [6_067_00, 6_067_00, 6_066_00]; // splitEqual en 3
    expect(parts.reduce((s, x) => s + x, 0)).toBe(total);
    const pay1 = await ok(CAJA, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'efectivo', amountCents: parts[0], tenderedCents: 10_000_00, payer: 'Persona 1' });
    expect(pay1.payment.change_cents).toBe(10_000_00 - parts[0]);
    await ok(CAJA, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'tarjeta', amountCents: parts[1], payer: 'Persona 2' });
    expect((await api(CAJA, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'tarjeta', amountCents: parts[2] + 1 })).status).toBe(409); // más que el saldo
    const last = await ok(CAJA, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'tarjeta', amountCents: parts[2], payer: 'Persona 3' });
    expect(last.balance.due).toBe(0);
    const floor = (await ok(MOZO1, 'GET', '/api/floor')).visits.find((x: any) => x.id === v.id);
    expect([floor.total, floor.paid, floor.due]).toEqual([total, total, 0]);

    const { ticket } = await ok(CAJA, 'POST', `/api/visits/${v.id}/close`);
    expect(ticket.snapshot.total).toBe(total);
    const count = async () => Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM payments WHERE visit_id=$1', [v.id])).rows[0].n);
    const before = await count();
    const t1 = await ok(CAJA, 'GET', `/api/tickets/${ticket.id}`);
    const t2 = await ok(CAJA, 'GET', `/api/tickets/${ticket.id}`);
    expect(t2.snapshot).toEqual(t1.snapshot);
    expect(await count()).toBe(before);
  });
});

describe('Q04 · registro de ingresos', () => {
  it('guarda resultado, persona e IP pero nunca la contraseña; se consulta por local y se purga a los 30 días', async () => {
    const secret = 'clave-equivocada-XYZ';
    expect((await api(null, 'POST', '/api/login', { email: MOZO1, password: secret })).status).toBe(401);
    expect((await api(null, 'POST', '/api/login', { email: 'nadie@x.test', password: secret })).status).toBe(401);
    const dump = JSON.stringify((await db.query('SELECT * FROM login_attempts')).rows);
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain(TEST_PASSWORD);
    expect(dump).not.toContain('1234');

    const list = await ok(OWNER, 'GET', '/api/audit/logins');
    expect(list.some((x: any) => x.email === MOZO1 && !x.ok && x.reason === 'clave incorrecta')).toBe(true);
    expect(list.some((x: any) => x.email === MOZO1 && x.ok)).toBe(true);
    expect(list.some((x: any) => x.email === 'nadie@x.test')).toBe(false); // emails ajenos al local no se muestran
    expect((await ok(OWNER_B, 'GET', '/api/audit/logins')).some((x: any) => x.email === MOZO1)).toBe(false);
    expect((await api(MOZO1, 'GET', '/api/audit/logins')).status).toBe(403);

    await db.query(`INSERT INTO login_attempts (at, email, ip, ok) VALUES (now() - interval '31 days', 'viejo@x.test', '1.1.1.1', false)`);
    await purgeLoginAttempts(db);
    expect((await db.query(`SELECT 1 FROM login_attempts WHERE email='viejo@x.test'`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM login_attempts WHERE email=$1`, [MOZO1])).rows.length).toBeGreaterThan(0);
  });

  it('cinco fallos bloquean el ingreso un minuto y queda registrado', async () => {
    for (let i = 0; i < 5; i++) await api(null, 'POST', '/api/login', { email: BARRA, password: 'x' + i });
    expect((await api(null, 'POST', '/api/login', { email: BARRA, password: TEST_PASSWORD })).status).toBe(429);
    expect((await db.query(`SELECT 1 FROM login_attempts WHERE email=$1 AND reason='bloqueado'`, [BARRA])).rows).toHaveLength(1);
  });
});

describe('Q05 · eventos en vivo por restaurante y rol', () => {
  const who = async (email: string) => {
    const r = await db.query<any>(`SELECT u.id AS "userId", m.restaurant_id AS "restaurantId", m.roles FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1`, [email]);
    return r.rows[0];
  };
  it('cada rol recibe solo lo suyo y nunca eventos de otro local', async () => {
    const [mozo, cocina, barra, caja, otro] = await Promise.all([MOZO1, COCINA, BARRA, CAJA, OWNER_B].map(who));
    const stations = (await db.query<any>('SELECT id, kind FROM stations WHERE restaurant_id=$1', [mozo.restaurantId])).rows;
    const k = stations.find((s) => s.kind === 'kitchen').id, b = stations.find((s) => s.kind === 'bar').id;
    const rid = mozo.restaurantId;
    const can = async (a: any, ev: any) => eventFor(a, ev, await stationScope(db, a));
    const lines = { rid, type: 'lines', stations: [k] };
    expect(await can(cocina, lines)).toBe(true);
    expect(await can(barra, lines)).toBe(false); // comanda de cocina: barra no la recibe
    expect(await can(barra, { ...lines, stations: [b] })).toBe(true);
    expect(await can(mozo, lines)).toBe(true);
    expect(await can(caja, { rid, type: 'cash' })).toBe(true);
    expect(await can(cocina, { rid, type: 'cash' })).toBe(false);
    expect(await can(barra, { rid, type: 'floor' })).toBe(false);
    expect(await can(otro, { rid, type: 'floor' })).toBe(false); // otro restaurante
    expect(await can(mozo, { rid, type: 'notice', toUser: mozo.userId })).toBe(true);
    expect(await can(caja, { rid, type: 'notice', toUser: mozo.userId })).toBe(false);
    // Mesa sin mozo asignado: el aviso va al dueño del local, no a los mozos ni a otro local.
    const dueno = await who(OWNER);
    expect(await can(dueno, { rid, type: 'notice', toUser: null })).toBe(true);
    expect(await can(mozo, { rid, type: 'notice', toUser: null })).toBe(false);
    expect(await can(otro, { rid, type: 'notice', toUser: null })).toBe(false);
    expect(await can(dueno, { rid, type: 'notice', toUser: mozo.userId })).toBe(false);
  });

  it('por HTTP: el mozo recibe su aviso, cocina no; al reconectar sigue filtrado', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const listen = async (email: string, ms: number, act: () => Promise<void>) => {
      const ctrl = new AbortController();
      const res = await fetch(`${address}/api/events`, { headers: { cookie: jar[email] }, signal: ctrl.signal });
      const reader = res.body!.getReader();
      let text = '';
      const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } } catch { /* cortado */ } })();
      await new Promise((r) => setTimeout(r, 50));
      await act();
      await new Promise((r) => setTimeout(r, ms));
      ctrl.abort();
      await pump;
      return text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
    };
    const fire = async () => { ctx.bus.emit('ev', { rid: (await who(MOZO1)).restaurantId, type: 'notice', toUser: uid(MOZO1), visitId: 1, round: 99 }); };
    for (let round = 0; round < 2; round++) { // la segunda vuelta simula la reconexión
      const m = await listen(MOZO1, 100, fire);
      expect(m.filter((e) => e.type === 'notice')).toHaveLength(1);
      expect(m[0].toUser).toBeUndefined(); // no se reenvían datos internos
      const c = await listen(COCINA, 100, fire);
      expect(c.filter((e) => e.type === 'notice')).toHaveLength(0);
      const x = await listen(OWNER_B, 100, fire);
      expect(x).toHaveLength(0);
    }
  });
});

describe('Q06 · regresiones de la revisión', () => {
  it('el código vigente solo lo ve quien puede habilitar la mesa', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: table('9').id });
    const { code } = await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true });
    expect((await ok(MOZO1, 'GET', `/api/visits/${v.id}`)).visit.access_code).toBe(code);
    expect((await ok(OWNER, 'GET', `/api/visits/${v.id}`)).visit.access_code).toBe(code);
    expect((await ok(CAJA, 'GET', `/api/visits/${v.id}`)).visit.access_code).toBeUndefined();
    expect((await ok(COCINA, 'GET', `/api/visits/${v.id}`)).visit.access_code).toBeUndefined(); // pase
  });

  it('dos envíos simultáneos del mismo pedido con la última porción: una sola comanda, ninguno ve «se agotó»', async () => {
    const t = table('10');
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: t.id });
    const { code } = await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true });
    const cel = (await phone(t.qr_token, code)).cookie;
    const body = { opId: op(), items: [{ productId: pid('Vacío'), qty: 1 }], expected: [17_500_00] };
    const [a, b] = await Promise.all([api(null, 'POST', `/api/public/t/${t.qr_token}/order`, body, cel), api(null, 'POST', `/api/public/t/${t.qr_token}/order`, body, cel)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.duplicate, b.body.duplicate].sort()).toEqual([false, true]);
    expect(a.body.round.number).toBe(b.body.round.number);
    expect((await ok(MOZO1, 'GET', `/api/visits/${v.id}`)).rounds).toHaveLength(1);
  });

  it('una mesa trabada por códigos errados se destraba cuando el mozo renueva el código', async () => {
    const t = table('B1');
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: t.id });
    let { code } = await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true });
    const wrong = code === '100000' ? '100001' : '100000';
    // Se simulan IPs distintas: 10 × 5 errores alcanzan el tope por visita.
    for (let ip = 0; ip < 10; ip++) for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: `/api/public/t/${t.qr_token}/join`, payload: { code: wrong }, remoteAddress: `10.0.0.${ip}` });
    expect((await app.inject({ method: 'POST', url: `/api/public/t/${t.qr_token}/join`, payload: { code }, remoteAddress: '10.0.1.1' })).statusCode).toBe(429);
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: false });
    ({ code } = await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true }));
    expect((await app.inject({ method: 'POST', url: `/api/public/t/${t.qr_token}/join`, payload: { code }, remoteAddress: '10.0.1.1' })).statusCode).toBe(200);
  });

  it('modo «llamados»: el mozo habilita la mesa, el comensal llama, pero no puede pedir', async () => {
    await db.query(`UPDATE restaurants SET settings = settings || '{"mode":"calls"}' WHERE slug='esquina'`);
    try {
      const t = tables.find((x) => x.number === '6'); // la del combo por QR sigue abierta y habilitada
      const v = { id: (await ok(MOZO1, 'GET', '/api/floor')).tables.find((y: any) => y.id === t.id).visit_id };
      await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: false });
      const { code } = await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true });
      const cel = (await phone(t.qr_token, code)).cookie;
      await ok(null, 'POST', `/api/public/t/${t.qr_token}/call`, { reason: 'mozo' }, cel);
      expect((await api(null, 'POST', `/api/public/t/${t.qr_token}/order`, { opId: op(), items: [gaseosa()] }, cel)).status).toBe(403);
    } finally {
      await db.query(`UPDATE restaurants SET settings = settings || '{"mode":"orders"}' WHERE slug='esquina'`);
    }
  });

  it('el intento bloqueado queda a nombre de la persona y hay tope por IP para probar muchas cuentas', async () => {
    const r = await db.query<any>(`SELECT user_id FROM login_attempts WHERE email=$1 AND reason='bloqueado'`, [BARRA]);
    expect(r.rows[0].user_id).toBe(uid(BARRA));
    let status = 0;
    for (let i = 0; i < 40 && status !== 429; i++) status = (await app.inject({ method: 'POST', url: '/api/login', payload: { email: `x${i}@spray.test`, password: 'x' }, remoteAddress: '10.9.9.9' })).statusCode;
    expect(status).toBe(429);
    expect((await db.query(`SELECT count(*)::int AS n FROM login_attempts WHERE email LIKE '%@spray.test'`)).rows[0]).toEqual({ n: 30 });
  });
});

describe('Q07 · mesa sin mozo asignado', () => {
  // Mesas nuevas para cada caso: las del seed ya las usan las pruebas anteriores.
  let k = 0;
  const free = async () => Promise.all([1, 2, 3].map(() => ok(OWNER, 'POST', '/api/tables', { number: `SM${++k}`, area: 'Patio' })));
  const waiterOf = async (vid: number) => (await db.query<any>('SELECT waiter_id FROM visits WHERE id=$1', [vid])).rows[0].waiter_id;
  const userId = async (email: string) => (await db.query<any>('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;

  it('el dueño abre sin mozo o con uno del local; nunca con uno de otro local', async () => {
    const [t1, t2, t3] = await free();
    const sin = await ok(OWNER, 'POST', '/api/visits', { tableId: t1.id });
    expect(await waiterOf(sin.id)).toBeNull();
    const con = await ok(OWNER, 'POST', '/api/visits', { tableId: t2.id, waiterId: await userId(MOZO2) });
    expect(await waiterOf(con.id)).toBe(await userId(MOZO2));
    const otro = await userId(OWNER_B);
    expect((await api(OWNER, 'POST', '/api/visits', { tableId: t3.id, waiterId: otro })).status).toBe(400);
    expect((await ok(OWNER, 'GET', '/api/floor')).tables.find((t: any) => t.id === t3.id).visit_id).toBeNull(); // no quedó abierta
  });

  it('un mozo común abre siempre a su nombre aunque mande otro waiterId', async () => {
    const [t] = await free();
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: t.id, waiterId: await userId(MOZO2) });
    expect(await waiterOf(v.id)).toBe(await userId(MOZO1));
  });

  it('asignar mozo conserva la visita, el QR y lo pedido; el mozo pasa a verla', async () => {
    const [t] = await free();
    const v = await ok(OWNER, 'POST', '/api/visits', { tableId: t.id });
    expect((await ok(MOZO1, 'GET', '/api/floor')).visits.some((x: any) => x.id === v.id)).toBe(false);
    const { code } = await ok(OWNER, 'POST', `/api/visits/${v.id}/qr`, { enabled: true });
    await ok(OWNER, 'POST', `/api/visits/${v.id}/waiter`, { userId: await userId(MOZO1) });
    // Lucas solo ve sus mesas: antes no la veía; ahora ve la mesa y su cuenta.
    const d = await ok(OWNER, 'GET', `/api/visits/${v.id}`);
    expect(d.visit.id).toBe(v.id);
    expect(d.visit.access_code).toBe(code);
    expect((await ok(MOZO1, 'GET', '/api/floor')).visits.some((x: any) => x.id === v.id)).toBe(true);
  });
});
