import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../server/db.ts';
import { buildApp } from '../server/app.ts';
import { seed, TEST_PASSWORD } from '../server/seed.ts';
import { initSetupCode } from '../server/routes/auth.ts';

let app: FastifyInstance;
let rawDb: Awaited<ReturnType<typeof openDb>>;
let dir: string;
const jar: Record<string, string> = {};
let n = 0;
const op = () => `op-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function login(email: string) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email, password: TEST_PASSWORD } });
  expect(r.statusCode, r.body).toBe(200);
  jar[email] = String(r.headers['set-cookie']).split(';')[0];
}
async function api(who: string | null, method: string, url: string, payload?: unknown) {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: who ? { cookie: jar[who] } : {} });
  return { status: r.statusCode, body: r.body ? (() => { try { return JSON.parse(r.body); } catch { return r.body; } })() : null, headers: r.headers };
}
const ok = async (who: string | null, method: string, url: string, payload?: unknown) => {
  const r = await api(who, method, url, payload);
  expect(r.status, `${method} ${url} -> ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};

const OWNER = 'dueno@esquina.test', MOZO1 = 'mozo1@esquina.test', MOZO2 = 'mozo2@esquina.test', COCINA = 'cocina@esquina.test', BARRA = 'barra@esquina.test', CAJA = 'caja@esquina.test', RIDER = 'reparto@esquina.test', OWNER_B = 'dueno@fuego.test', CAJA_B = 'caja@fuego.test';
let menu: any;
const pid = (name: string) => menu.products.find((p: any) => p.name.startsWith(name)).id;
const opt = (name: string, o: string) => menu.products.find((p: any) => p.name.startsWith(name)).options.find((x: any) => x.name === o).id;
let tables: any[];
const tid = (num: string) => tables.find((t) => t.number === num).id;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bmr-test-'));
  const db = await openDb(null);
  rawDb = db;
  await seed(db);
  ({ app } = await buildApp({ db, dataDir: dir, publicUrl: 'http://localhost', env: 'test' }));
  for (const u of [OWNER, MOZO1, MOZO2, COCINA, BARRA, CAJA, RIDER, OWNER_B, CAJA_B]) await login(u);
  menu = await ok(OWNER, 'GET', '/api/menu');
  tables = await ok(OWNER, 'GET', '/api/tables');
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('A01 · turno de la mesa 4', () => {
  let visitId: number;
  it('el mozo abre la mesa 4 y envía milanesa sin cebolla + dos bebidas', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('4'), guests: 2 });
    visitId = v.id;
    expect(v.access_code).toMatch(/^\d{6}$/);
    const r = await ok(MOZO1, 'POST', `/api/visits/${visitId}/rounds`, { opId: op(), items: [
      { productId: pid('Milanesa'), qty: 1, optionIds: [opt('Milanesa', 'Papas fritas')], note: 'sin cebolla' },
      { productId: pid('Gaseosa'), qty: 1 }, { productId: pid('Agua mineral'), qty: 1 },
    ] });
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0].unit_price_cents).toBe(1_450_000);
  });
  it('cocina ve solo el plato con la nota; barra solo las bebidas', async () => {
    // cocina también tiene rol pase: en la vista de estación igual ve solo su sector (regresión)
    const k = await ok(COCINA, 'GET', '/api/kds?view=station');
    const mine = k.lines.filter((l: any) => l.visit_id === visitId);
    expect(mine).toHaveLength(1);
    expect(mine[0].station_kind).toBe('kitchen');
    expect(mine[0].note).toBe('sin cebolla');
    const pase = await ok(COCINA, 'GET', '/api/kds?view=pass');
    expect(pase.lines.filter((l: any) => l.visit_id === visitId)).toHaveLength(3);
    const b = await ok(BARRA, 'GET', '/api/kds?view=station');
    const bar = b.lines.filter((l: any) => l.visit_id === visitId);
    expect(bar).toHaveLength(2);
    expect(bar.every((l: any) => l.station_kind === 'bar')).toBe(true);
  });
  it('cada sector marca listo, el mozo entrega y la caja cobra; otro dispositivo ve el estado', async () => {
    const d = await ok(MOZO1, 'GET', `/api/visits/${visitId}`);
    for (const l of d.lines) {
      const who = l.station_kind === 'bar' ? BARRA : COCINA;
      await ok(who, 'POST', `/api/lines/${l.id}/start`);
      await ok(who, 'POST', `/api/lines/${l.id}/ready`);
    }
    // barra no puede tocar líneas de cocina
    const kLine = d.lines.find((l: any) => l.station_kind === 'kitchen');
    expect((await api(BARRA, 'POST', `/api/lines/${kLine.id}/ack`)).status).toBe(403);
    for (const l of d.lines) await ok(MOZO1, 'POST', `/api/lines/${l.id}/deliver`);
    const other = await ok(MOZO2, 'GET', `/api/visits/${visitId}`);
    expect(other.lines.every((l: any) => l.status === 'delivered')).toBe(true);
    expect(other.balance.due).toBe(1_450_000 + 320_000 + 260_000);
  });
});

describe('A02/A03 · última porción y doble toque', () => {
  it('dos mozos piden la última porción a la vez: se confirma una sola', async () => {
    const v1 = await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('1') });
    const v2 = await ok(MOZO2, 'POST', '/api/visits', { tableId: tid('2') });
    const item = [{ productId: pid('Vacío'), qty: 1 }];
    const [a, b] = await Promise.all([
      api(MOZO1, 'POST', `/api/visits/${v1.id}/rounds`, { opId: op(), items: item }),
      api(MOZO2, 'POST', `/api/visits/${v2.id}/rounds`, { opId: op(), items: item }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const lost = a.status === 409 ? a : b;
    expect(lost.body.error).toMatch(/agot/i);
    expect(lost.body.problems[0].productId).toBe(pid('Vacío'));
    const pub = await ok(null, 'GET', '/api/public/r/esquina');
    const vacio = pub.products.find((p: any) => p.name.startsWith('Vacío'));
    expect(vacio.available).toBe(false);
    expect(vacio.stock_qty).toBeUndefined(); // la carta pública no expone cupos
  });
  it('repetir el mismo envío no duplica ronda, stock ni preparación', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('3') });
    await ok(OWNER, 'POST', `/api/products/${pid('Flan')}/availability`, { available: true, stockQty: 5 });
    const id = op();
    const body = { opId: id, items: [{ productId: pid('Flan'), qty: 2 }] };
    const [r1, r2] = await Promise.all([api(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, body), api(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, body)]);
    expect(r1.status).toBe(200); expect(r2.status).toBe(200);
    expect(r1.body.round.id).toBe(r2.body.round.id);
    const r3 = await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, body);
    expect(r3.duplicate).toBe(true);
    const m = await ok(OWNER, 'GET', '/api/menu');
    expect(m.products.find((p: any) => p.name.startsWith('Flan')).stock_qty).toBe(3);
    const d = await ok(MOZO1, 'GET', `/api/visits/${v.id}`);
    expect(d.lines).toHaveLength(1);
    // mismo opId con otro contenido se rechaza
    expect((await api(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: id, items: [{ productId: pid('Flan'), qty: 1 }] })).status).toBe(409);
    // A04: la confirmación perdida se consulta por opId
    expect((await ok(MOZO1, 'GET', `/api/rounds/by-op/${id}`)).found).toBe(true);
  });
});

describe('A06 · cambio de precio', () => {
  it('lo ya pedido conserva el precio y la próxima ronda usa el nuevo', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('5') });
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Copa de Malbec'), qty: 1 }] });
    const p = menu.products.find((x: any) => x.name.startsWith('Copa de Malbec'));
    await ok(OWNER, 'PUT', `/api/products/${p.id}`, { categoryId: p.category_id, stationId: p.station_id, name: p.name, priceCents: 500_000, course: 'bebida', options: [] });
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: p.id, qty: 1 }] });
    const d = await ok(MOZO1, 'GET', `/api/visits/${v.id}`);
    expect(d.lines.map((l: any) => l.unit_price_cents)).toEqual([450_000, 500_000]);
    const pub = await ok(null, 'GET', '/api/public/r/esquina');
    expect(pub.products.find((x: any) => x.id === p.id).price_cents).toBe(500_000);
  });
});

describe('A08/A10/A19 · cobro mixto, ticket X y caja que cruza medianoche', () => {
  it('cierra la caja abierta y abre otra con $20.000', async () => {
    const cur = await ok(CAJA, 'GET', '/api/shifts/current');
    await ok(CAJA, 'POST', '/api/shifts/close', { shiftId: cur.shift.id, countedCents: cur.expected });
    expect((await api(CAJA, 'POST', '/api/shifts/close', { shiftId: cur.shift.id, countedCents: 0 })).status).toBe(409); // no se cierra dos veces
    await ok(CAJA, 'POST', '/api/shifts/open', { openingCents: 2_000_000 });
    expect((await api(CAJA, 'POST', '/api/shifts/open', { openingCents: 0 })).status).toBe(409);
  });
  let visitId: number;
  it('cuenta de $18.000: transferencia $10.000 + efectivo $10.000 por $8.000 → vuelto $2.000', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('6') });
    visitId = v.id;
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Bife'), qty: 1, optionIds: [opt('Bife', 'Jugoso')] }] });
    // descuento sin PIN desde caja se rechaza; con PIN del encargado se aplica
    expect((await api(CAJA, 'POST', `/api/visits/${v.id}/discounts`, { amountCents: 180_000, reason: 'Demora en cocina' })).status).toBe(403);
    await ok(CAJA, 'POST', `/api/visits/${v.id}/discounts`, { amountCents: 180_000, reason: 'Demora en cocina', supervisorPin: '1234' });
    const pre = await ok(CAJA, 'POST', '/api/tickets/precuenta', { visitId: v.id });
    expect(pre.snapshot.total).toBe(1_800_000);
    expect((await api(CAJA, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'transferencia', amountCents: 1_000_000 })).status).toBe(400); // falta verificar
    await ok(CAJA, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'transferencia', amountCents: 1_000_000, transferVerified: true });
    const cashOp = op();
    const pay = { opId: cashOp, visitId: v.id, method: 'efectivo', amountCents: 800_000, tenderedCents: 1_000_000 };
    const r = await ok(CAJA, 'POST', '/api/payments', pay);
    expect(r.payment.change_cents).toBe(200_000);
    expect(r.balance.due).toBe(0);
    const again = await ok(CAJA, 'POST', '/api/payments', pay); // reintento: mismo resultado, sin nuevo cobro
    expect(again.duplicate).toBe(true);
    expect(again.payment.id).toBe(r.payment.id);
  });
  it('cerrar genera el ticket X; reimprimir devuelve el mismo número e importes', async () => {
    const c = await ok(CAJA, 'POST', `/api/visits/${visitId}/close`);
    expect(c.ticket.kind).toBe('x');
    expect(c.ticket.snapshot.payments.map((p: any) => [p.method, p.amount, p.change])).toEqual([['transferencia', 1_000_000, 0], ['efectivo', 800_000, 200_000]]);
    const copy = await ok(CAJA, 'GET', `/api/tickets/${c.ticket.id}`);
    expect(copy.number).toBe(c.ticket.number);
    expect(copy.snapshot).toEqual(c.ticket.snapshot);
    const d = await ok(CAJA, 'GET', `/api/visits/${visitId}`);
    expect(d.payments).toHaveLength(2);
  });
  it('retiro de $3.000 y arqueo con $24.500 contados: esperado $25.000, diferencia −$500', async () => {
    expect((await api(CAJA, 'POST', '/api/cash-moves', { kind: 'retiro', amountCents: 300_000, reason: 'Retiro a caja fuerte' })).status).toBe(403);
    await ok(CAJA, 'POST', '/api/cash-moves', { kind: 'retiro', amountCents: 300_000, reason: 'Retiro a caja fuerte', supervisorPin: '1234' });
    const cur = await ok(CAJA, 'GET', '/api/shifts/current');
    expect(cur.expected).toBe(2_500_000);
    const s = await ok(CAJA, 'POST', '/api/shifts/close', { shiftId: cur.shift.id, countedCents: 2_450_000 });
    expect(s.difference).toBe(-50_000);
    expect(s.moves.map((m: any) => m.kind)).toEqual(['retiro']);
    expect(s.byMethod.find((m: any) => m.method === 'transferencia').neto).toBe(1_000_000);
    await ok(CAJA, 'POST', '/api/shifts/open', { openingCents: 0 });
  });
});

describe('A07/A09 · pago parcial, mover y unir', () => {
  it('pago parcial se conserva al mover y unir; el historial registra origen y destino', async () => {
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('7') });
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Provoleta'), qty: 2 }] });
    await ok(CAJA, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'tarjeta', amountCents: 500_000, payer: 'Persona 1' });
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/move`, { fromTableId: tid('7'), toTableId: tid('9') });
    const w = await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('10') });
    await ok(MOZO1, 'POST', `/api/visits/${w.id}/rounds`, { opId: op(), items: [{ productId: pid('Agua mineral'), qty: 1 }] });
    await ok(MOZO1, 'POST', `/api/visits/${w.id}/merge`, { visitId: v.id });
    const d = await ok(MOZO1, 'GET', `/api/visits/${w.id}`);
    expect(d.balance.paid).toBe(500_000);
    expect(d.balance.due).toBe(2 * 780_000 + 260_000 - 500_000);
    expect(d.tables.map((t: any) => t.number).sort()).toEqual(['10', '9']);
    expect(d.history.map((h: any) => h.action)).toContain('visit.merge');
    expect((await api(CAJA, 'POST', `/api/visits/${w.id}/close`)).status).toBe(409); // con saldo no cierra
  });
});

describe('A05 · QR, código temporal y vencimiento de la visita', () => {
  it('llamados repetidos se agrupan y el acceso vence al cerrar', async () => {
    const qr = 'mesa4-esquina-demo';
    const before = await ok(null, 'GET', `/api/public/t/${qr}`);
    expect(before.table.number).toBe('4');
    expect((await api(null, 'POST', `/api/public/t/${qr}/call`, { reason: 'cuenta' })).status).toBe(403); // sin código no hay acciones
    const floor = await ok(MOZO1, 'GET', '/api/floor');
    const visit = floor.visits.find((v: any) => floor.tables.find((t: any) => t.number === '4').visit_id === v.id);
    expect((await api(null, 'POST', `/api/public/t/${qr}/join`, { code: '0000' })).status).toBe(403);
    // El mozo habilita el QR de la visita y dicta el código.
    const { code } = await ok(MOZO1, 'POST', `/api/visits/${visit.id}/qr`, { enabled: true });
    const j = await app.inject({ method: 'POST', url: `/api/public/t/${qr}/join`, payload: { code } });
    const diner = String(j.headers['set-cookie']).split(';')[0];
    const call = async () => (await app.inject({ method: 'POST', url: `/api/public/t/${qr}/call`, payload: { reason: 'cuenta' }, headers: { cookie: diner } })).json();
    await call();
    const c2 = await call();
    expect(c2.taps).toBe(2);
    const calls = (await ok(MOZO1, 'GET', '/api/floor')).calls.filter((c: any) => c.visit_id === visit.id && c.reason === 'cuenta');
    expect(calls).toHaveLength(1);
    // saldar y cerrar
    await ok(CAJA, 'POST', '/api/payments', { opId: op(), visitId: visit.id, method: 'efectivo', amountCents: visit.due, tenderedCents: visit.due });
    await ok(CAJA, 'POST', `/api/visits/${visit.id}/close`);
    const after = await app.inject({ method: 'POST', url: `/api/public/t/${qr}/call`, payload: { reason: 'mozo' }, headers: { cookie: diner } });
    expect(after.statusCode).toBe(403);
    await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('4') }); // nueva visita en la misma mesa
    const again = await app.inject({ method: 'POST', url: `/api/public/t/${qr}/call`, payload: { reason: 'mozo' }, headers: { cookie: diner } });
    expect(again.statusCode).toBe(403); // el QR guardado no habilita la visita posterior
    expect((await ok(null, 'GET', `/api/public/t/${qr}`)).products.length).toBeGreaterThan(0);
  });
});

describe('A11 · aislamiento entre locales y roles', () => {
  it('el local B no ve datos del A; cocina no entra a caja', async () => {
    const floorA = await ok(OWNER, 'GET', '/api/floor');
    const anyVisit = floorA.visits[0].id;
    expect((await api(OWNER_B, 'GET', `/api/visits/${anyVisit}`)).status).toBe(404);
    expect((await api(COCINA, 'GET', '/api/shifts/current')).status).toBe(403);
    expect((await api(COCINA, 'GET', '/api/export/cobros')).status).toBe(403);
    expect((await api(MOZO1, 'GET', '/api/team')).status).toBe(403);
    expect((await api(null, 'GET', '/api/floor')).status).toBe(401);
    const ordersB = await ok(CAJA_B, 'GET', '/api/orders');
    expect(JSON.stringify(ordersB)).not.toContain('Esquina');
    const kdsB = await ok(OWNER_B, 'GET', '/api/kds');
    expect(kdsB.lines.every((l: any) => !floorA.visits.some((v: any) => v.id === l.visit_id))).toBe(true);
    // un producto de A no se puede pedir desde B
    const vb = await ok(OWNER_B, 'POST', '/api/visits', { tableId: (await ok(OWNER_B, 'GET', '/api/tables'))[0].id });
    expect((await api(OWNER_B, 'POST', `/api/visits/${vb.id}/rounds`, { opId: op(), items: [{ productId: pid('Milanesa'), qty: 1 }] })).status).toBe(400);
    const pub = await ok(null, 'GET', '/api/public/r/esquina');
    expect(JSON.stringify(pub)).not.toMatch(/cost|stock_qty|access_code/);
  });
});

describe('A13/A14 · retiro con franjas, pizza por mitades y docena', () => {
  it('mitades con extras y docena por gustos', async () => {
    const pub = await ok(null, 'GET', '/api/public/r/fuego');
    const p = (n: string) => pub.products.find((x: any) => x.name === n);
    const q = await ok(null, 'POST', '/api/public/r/fuego/quote', { channel: 'retiro', items: [
      { productId: p('Fugazzeta').id, qty: 1, halves: p('Napolitana').id, halfExtras: [[p('Fugazzeta').options.find((o: any) => o.name === 'Aceitunas').id], []] },
      { productId: p('Docena de empanadas surtidas').id, qty: 1, dozen: Object.fromEntries(p('Docena de empanadas surtidas').options.map((o: any, i: number) => [o.id, [4, 3, 2, 1, 2][i]])) },
    ] });
    expect(q.lines[0].unit).toBe(1_300_000 + 90_000); // mayor precio + extra en una mitad
    expect(q.lines[0].options.map((o: any) => o.grp)).toEqual(['Mitad 1', 'Mitad 2', 'Extra mitad 1']);
    expect(q.lines[1].unit).toBe(2_100_000 + 2 * 20_000);
    const bad = await api(null, 'POST', '/api/public/r/fuego/quote', { channel: 'retiro', items: [{ productId: p('Docena de empanadas surtidas').id, qty: 1, dozen: { [p('Docena de empanadas surtidas').options[0].id]: 11 } }] });
    expect(bad.status).toBe(400);
  });
  it('se llena una franja, el siguiente cliente ve la próxima; aceptar genera una sola comanda', async () => {
    await ok(OWNER_B, 'PUT', '/api/restaurant', { name: 'Pizzería Fuego de Almagro', theme: 'pizzeria', settings: { slot_start: '00:00', slot_end: '23:50', slot_minutes: 10, slot_capacity: 2 } });
    const pub = await ok(null, 'GET', '/api/public/r/fuego');
    const slot = pub.slots.find((s: any) => !s.past && s.left > 0).slot;
    const muzza = pub.products.find((x: any) => x.name === 'Muzzarella').id;
    const order = (o: string) => api(null, 'POST', '/api/public/r/fuego/orders', { opId: o, channel: 'retiro', name: 'Cliente ' + o.slice(-4), phone: '1155550000', slot, items: [{ productId: muzza, qty: 1 }] });
    const o1op = op();
    const o1 = await order(o1op);
    const dup = await order(o1op); // reenvío (p. ej. compartido por WhatsApp): mismo número
    expect(dup.body.number).toBe(o1.body.number);
    expect((await order(op())).status).toBe(200);
    const full = await order(op());
    expect(full.status).toBe(409);
    expect(full.body.nextSlot).not.toBe(slot);
    const list = await ok(CAJA_B, 'GET', '/api/orders');
    const mine = list.orders.find((x: any) => x.number === o1.body.number);
    await ok(CAJA_B, 'POST', `/api/orders/${mine.id}/accept`, { eta: '20 min' });
    expect((await api(CAJA_B, 'POST', `/api/orders/${mine.id}/accept`, {})).status).toBe(409);
    const kds = await ok(OWNER_B, 'GET', '/api/kds');
    expect(kds.lines.filter((l: any) => l.order_id === mine.id)).toHaveLength(1);
    const track = await ok(null, 'GET', `/api/public/orders/${o1.body.token}`);
    expect(track.status).toBe('aceptado');
    expect(track.eta).toBe('20 min');
  });
});

describe('A15 · receta y margen', () => {
  it('venta $12.000 − ingredientes $4.000 − envase $500 = $7.500; costo faltante se marca incompleto', async () => {
    const r = await ok(OWNER, 'GET', '/api/reports/menu?days=60');
    const ej = r.products.find((p: any) => p.name.startsWith('Menú ejecutivo'));
    expect(ej.current_cost).toBe(450_000);
    expect(ej.unit_margin).toBe(750_000);
    expect(ej.cost_complete).toBe(true);
    const bife = r.products.find((p: any) => p.name === 'Bife de chorizo');
    expect(bife.cost_complete).toBe(false);
    expect(bife.missing).toContain('Bife de chorizo (corte)');
  });
  it('vender una milanesa descuenta insumos una sola vez', async () => {
    const before = (await ok(COCINA, 'GET', '/api/ingredients')).find((i: any) => i.name === 'Nalga').stock_qty;
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: tid('8') });
    const body = { opId: op(), items: [{ productId: pid('Milanesa'), qty: 1, optionIds: [opt('Milanesa', 'Puré de papas')] }] };
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, body);
    await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, body);
    const after = (await ok(COCINA, 'GET', '/api/ingredients')).find((i: any) => i.name === 'Nalga').stock_qty;
    expect(before - after).toBe(250);
  });
});

describe('A20 · repartidor sin datos', () => {
  it('sincronizar dos veces aplica el resultado una sola vez; un pedido reasignado avisa al encargado', async () => {
    const zones = await ok(CAJA, 'GET', '/api/zones');
    const o = await ok(CAJA, 'POST', '/api/orders', { opId: op(), channel: 'delivery', name: 'Ana', phone: '1150000000', address: 'Calle Falsa 123', zoneId: zones[0].id, items: [{ productId: pid('Milanesa'), qty: 1, optionIds: [opt('Milanesa', 'Papas fritas')] }] });
    const riders = await ok(CAJA, 'GET', '/api/riders');
    await ok(CAJA, 'POST', `/api/orders/${o.id}/assign`, { riderId: riders[0].id, eta: '21:15 a 21:30' });
    const d = await ok(CAJA, 'GET', `/api/orders/${o.id}`);
    for (const l of d.lines) { await ok(COCINA, 'POST', `/api/lines/${l.id}/ready`); }
    expect((await ok(CAJA, 'GET', `/api/orders/${o.id}`)).order.status).toBe('listo');
    await ok(CAJA, 'POST', `/api/orders/${o.id}/status`, { status: 'en_reparto' });
    const list = await ok(RIDER, 'GET', '/api/rider/deliveries');
    expect(list.map((x: any) => x.id)).toContain(o.id);
    const change = { opId: op(), orderId: o.id, result: 'entregado', cashDeclaredCents: d.balance.due, at: new Date().toISOString() };
    const s1 = await ok(RIDER, 'POST', '/api/rider/sync', { changes: [change] });
    const s2 = await ok(RIDER, 'POST', '/api/rider/sync', { changes: [change] });
    expect(s1.results[0].ok).toBe(true);
    expect(s2.results[0].duplicate).toBe(true);
    const fin = await ok(CAJA, 'GET', `/api/orders/${o.id}`);
    expect(fin.order.status).toBe('entregado');
    expect(fin.order.cash_declared_cents).toBe(d.balance.due);
    const late = await ok(RIDER, 'POST', '/api/rider/sync', { changes: [{ ...change, opId: op() }] });
    expect(late.results[0].conflict).toBe(true);
  });
});

describe('Reservas · último cupo', () => {
  it('dos solicitudes simultáneas por el último lugar: una confirmada, otra rechazada', async () => {
    await ok(OWNER, 'PUT', '/api/restaurant', { name: 'La Esquina de Boedo', theme: 'bodegon', settings: { reservations: { enabled: true, times: ['21:00'], capacity: 4 } } });
    const date = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    const req = (name: string) => api(null, 'POST', '/api/public/r/esquina/reservations', { name, party: 3, date, time: '21:00' });
    const [a, b] = await Promise.all([req('Uno'), req('Dos')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const w = await ok(null, 'POST', '/api/public/r/esquina/reservations', { name: 'Tres', party: 2, date, time: '21:00', waitlist: true });
    expect(w.status).toBe('espera');
  });

  it('disponibilidad real por día, lista de espera según el local y confirmación con la marca pública', async () => {
    const date = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    await ok(OWNER, 'PUT', '/api/restaurant', { name: 'La Esquina de Boedo', theme: 'bodegon', settings: { reservations: { enabled: true, times: ['21:00', '20:00'], capacity: 4, waitlist: false } } });
    const av = await ok(null, 'GET', `/api/public/r/esquina/availability?date=${date}`);
    expect(av).toMatchObject({ waitlist: false, times: [{ time: '20:00', left: 4, past: false }, { time: '21:00', left: 4 }] });
    expect(av.capacity).toBeUndefined();
    expect((await api(null, 'GET', '/api/public/r/esquina/availability?date=mañana')).status).toBe(400);
    // Fecha imposible: 400 (no 500) y no se reserva corrida a marzo.
    expect((await api(null, 'GET', '/api/public/r/esquina/availability?date=2027-02-30')).status).toBe(400);
    expect((await api(null, 'POST', '/api/public/r/esquina/reservations', { name: 'X', party: 2, date: '2027-02-30', time: '21:00' })).status).toBe(400);
    const x = await ok(null, 'POST', '/api/public/r/esquina/reservations', { name: 'Cuatro', phone: '1155', party: 3, date, time: '21:00' });
    expect((await ok(null, 'GET', `/api/public/r/esquina/availability?date=${date}`)).times[1].left).toBe(1);
    // Sin lista de espera en el local, el público no puede anotarse aunque lo pida; el personal sí.
    expect((await api(null, 'POST', '/api/public/r/esquina/reservations', { name: 'Cinco', party: 2, date, time: '21:00', waitlist: true })).status).toBe(409);
    expect((await ok(OWNER, 'POST', '/api/reservations', { name: 'Seis', party: 2, date, time: '21:00', waitlist: true })).status).toBe('espera');
    const st = await ok(null, 'GET', `/api/public/reservations/${x.token}`);
    expect(st).toMatchObject({ status: 'confirmada', party: 3, slug: 'esquina', brand: { name: 'La Esquina de Boedo' } });
    expect(st.settings).toBeUndefined();
    expect(st.brand.reservations).toBeUndefined();
    // Horarios de reserva: se normalizan a HH:MM y se rechaza lo que no es una hora.
    const put = (times: unknown) => api(OWNER, 'PUT', '/api/restaurant', { name: 'La Esquina de Boedo', theme: 'bodegon', settings: { reservations: { enabled: true, times, capacity: 4 } } });
    expect((await put(['tarde'])).status).toBe(400);
    expect((await put('21:00')).status).toBe(400);
    expect((await put(['9:00', '21:00'])).status).toBe(200);
    expect((await ok(null, 'GET', `/api/public/r/esquina/availability?date=${date}`)).times.map((t: any) => t.time)).toEqual(['09:00', '21:00']);
  });
});

describe('Alta real', () => {
  it('BM Dev crea un local vacío con su dueño; el dueño solo ve su local', async () => {
    await login('admin@bmdev.test');
    const alta = await ok('admin@bmdev.test', 'POST', '/api/admin/restaurants', { name: 'Café Nuevo', slug: 'cafe-nuevo', template: 'cafeteria', ownerEmail: 'duena@cafe.test', ownerName: 'Duena' });
    // La dueña define su contraseña con el enlace de activación (nadie la elige por ella).
    expect((await app.inject({ method: 'POST', url: `/api/account-links/${alta.link.url.split('/activar/')[1]}`, payload: { password: 'clave-segura-1' } })).statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'duena@cafe.test', password: 'clave-segura-1' } });
    const cookie = String(r.headers['set-cookie']).split(';')[0];
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.restaurant.slug).toBe('cafe-nuevo');
    expect(me.restaurants).toHaveLength(1);
    const m = (await app.inject({ method: 'GET', url: '/api/menu', headers: { cookie } })).json();
    expect(m.products).toHaveLength(0);
    expect(m.categories.length).toBeGreaterThan(0);
    expect((await api(MOZO1, 'POST', '/api/admin/restaurants', {})).status).toBe(403);
  });
  it('el primer administrador requiere el código de instalación', async () => {
    const db = await openDb(null);
    const { app: fresh, ctx } = await buildApp({ db, dataDir: dir, publicUrl: 'http://x', env: 'test' });
    const code = await initSetupCode(ctx);
    expect((await fresh.inject({ method: 'POST', url: '/api/setup', payload: { code: 'mal', email: 'a@b.cd', name: 'A', password: '12345678' } })).statusCode).toBe(403);
    expect((await fresh.inject({ method: 'POST', url: '/api/setup', payload: { code, email: 'a@b.cd', name: 'A', password: '12345678' } })).statusCode).toBe(200);
    expect((await fresh.inject({ method: 'POST', url: '/api/setup', payload: { code, email: 'c@b.cd', name: 'C', password: '12345678' } })).statusCode).toBe(403);
    await fresh.close();
  });
});

describe('Regresiones de la revisión de código y seguridad', () => {
  it('un dueño no puede vincular ni restablecer la cuenta de plataforma', async () => {
    expect((await api(OWNER, 'POST', '/api/team', { email: 'admin@bmdev.test', name: 'x', roles: ['waiter'] })).status).toBe(403);
    const admin = (await rawDb.query<{ id: number }>("SELECT id FROM users WHERE email='admin@bmdev.test'")).rows[0].id;
    expect((await api(OWNER, 'POST', `/api/team/${admin}/reset-password`, { password: 'tomada12345' })).status).not.toBe(200);
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'admin@bmdev.test', password: 'tomada12345' } });
    expect(r.statusCode).toBe(401);
  });

  it('el código de la mesa se bloquea tras 5 intentos fallidos', async () => {
    const t = await ok(OWNER, 'POST', '/api/tables', { number: 'R1', area: 'Pruebas', seats: 2 });
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: t.id, guests: 2 });
    const qr = t.qr_token;
    const { code } = await ok(MOZO1, 'POST', `/api/visits/${v.id}/qr`, { enabled: true });
    const wrong = code === '100000' ? '100001' : '100000';
    for (let i = 0; i < 5; i++) expect((await api(null, 'POST', `/api/public/t/${qr}/join`, { code: wrong })).status).toBe(403);
    expect((await api(null, 'POST', `/api/public/t/${qr}/join`, { code })).status).toBe(429);
  });

  it('anular una línea con cortesía la quita del saldo; entregar una línea anulada se rechaza', async () => {
    const t = await ok(OWNER, 'POST', '/api/tables', { number: 'R2', area: 'Pruebas', seats: 2 });
    const v = await ok(MOZO1, 'POST', '/api/visits', { tableId: t.id, guests: 1 });
    const r = await ok(MOZO1, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Flan'), qty: 1 }, { productId: pid('Agua mineral'), qty: 1 }] });
    const flan = r.lines.find((l: any) => l.name.startsWith('Flan'));
    await ok(COCINA, 'POST', `/api/lines/${flan.id}/ready`);
    await ok(OWNER, 'POST', `/api/visits/${v.id}/discounts`, { kind: 'cortesia', lineId: flan.id, reason: 'cumpleaños' });
    expect((await api(OWNER, 'POST', `/api/visits/${v.id}/discounts`, { kind: 'cortesia', lineId: flan.id, reason: 'doble clic' })).status).toBe(409);
    await ok(OWNER, 'POST', `/api/lines/${flan.id}/void`, { reason: 'se cayó', destination: 'merma' });
    expect((await api(MOZO1, 'POST', `/api/lines/${flan.id}/deliver`)).status).toBe(409);
    expect((await ok(MOZO1, 'GET', `/api/visits/${v.id}`)).balance.due).toBe(260_000);
  });

  it('cancelar un pedido cobrado se rechaza; sin cobro devuelve el stock con su movimiento', async () => {
    await rawDb.query("UPDATE products SET stock_qty=5, available=true WHERE restaurant_id=1 AND name LIKE 'Provoleta%'");
    const mk = () => ok(CAJA, 'POST', '/api/orders', { opId: op(), channel: 'retiro', name: 'Prueba', items: [{ productId: pid('Provoleta'), qty: 2 }] });
    const o1 = await mk();
    const d1 = await ok(CAJA, 'GET', `/api/orders/${o1.id}`);
    await ok(CAJA, 'POST', '/api/payments', { opId: op(), orderId: o1.id, method: 'efectivo', amountCents: d1.balance.due, tenderedCents: d1.balance.due });
    expect((await api(OWNER, 'POST', `/api/orders/${o1.id}/status`, { status: 'cancelado', reason: 'x' })).status).toBe(409);
    const o2 = await mk();
    await ok(OWNER, 'POST', `/api/orders/${o2.id}/status`, { status: 'cancelado', reason: 'el cliente desistió' });
    expect((await rawDb.query<{ s: number }>("SELECT stock_qty AS s FROM products WHERE restaurant_id=1 AND name LIKE 'Provoleta%'")).rows[0].s).toBe(3);
    expect((await rawDb.query<{ n: number }>("SELECT count(*)::int AS n FROM stock_moves WHERE reason='pedido cancelado'")).rows[0].n).toBe(1);
  });

  it('aceptar un pedido web conserva el precio confirmado aunque cambie la carta', async () => {
    await ok(OWNER_B, 'PUT', '/api/restaurant', { name: 'Pizzería Fuego de Almagro', theme: 'pizzeria', settings: { slot_start: '00:00', slot_end: '23:50', slot_minutes: 10, slot_capacity: 50 } });
    const pub = await ok(null, 'GET', '/api/public/r/fuego');
    const slot = pub.slots.find((s: any) => !s.past && s.left > 0).slot;
    const muzza = pub.products.find((x: any) => x.name === 'Muzzarella');
    const o = await ok(null, 'POST', '/api/public/r/fuego/orders', { opId: op(), channel: 'retiro', name: 'Precio', phone: '1155550001', slot, items: [{ productId: muzza.id, qty: 2 }] });
    await rawDb.query('UPDATE products SET price_cents=price_cents+100000 WHERE id=$1', [muzza.id]);
    const mine = (await ok(CAJA_B, 'GET', '/api/orders')).orders.find((x: any) => x.number === o.number);
    await ok(CAJA_B, 'POST', `/api/orders/${mine.id}/accept`, {});
    expect((await ok(CAJA_B, 'GET', `/api/orders/${mine.id}`)).balance.total).toBe(o.total);
  });

  it('un cambio inválido del repartidor se informa sin trabar la cola', async () => {
    const s = await ok(RIDER, 'POST', '/api/rider/sync', { changes: [{ opId: op(), orderId: -5, result: 'entregado' }] });
    expect(s.results[0]).toMatchObject({ ok: false });
    expect(s.results[0].conflict).toBeUndefined(); // no es conflicto: el teléfono lo conserva para corregirlo
  });

  it('el PIN de supervisor se bloquea tras 5 intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) expect((await api(CAJA_B, 'POST', '/api/payments/999999/refund', { opId: op(), reason: 'x', supervisorPin: '9999' })).status).toBe(403);
    expect((await api(CAJA_B, 'POST', '/api/payments/999999/refund', { opId: op(), reason: 'x', supervisorPin: '1234' })).status).toBe(429);
  });
});

describe('cocina: comandas de una mesa ya cerrada', () => {
  it('siguen mostrando el número de mesa (no «Mesa ?»)', async () => {
    const t = await ok(OWNER, 'POST', '/api/tables', { number: 'K1', area: 'Patio' });
    const v = await ok(OWNER, 'POST', '/api/visits', { tableId: t.id, guests: 2 });
    await ok(OWNER, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Flan'), qty: 1 }] });
    if (!(await ok(OWNER, 'GET', '/api/shifts/current'))) await ok(OWNER, 'POST', '/api/shifts/open', { openingCents: 0 });
    const due = (await ok(OWNER, 'GET', `/api/visits/${v.id}`)).balance.due;
    await ok(OWNER, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'efectivo', amountCents: due });
    await ok(OWNER, 'POST', `/api/visits/${v.id}/close`, {});
    const k = await ok(OWNER, 'GET', '/api/kds?view=station');
    const mine = k.lines.filter((l: any) => l.visit_id === v.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].tables).toBe('K1');
    expect(mine[0].visit_status).toBe('closed');
  });
});
