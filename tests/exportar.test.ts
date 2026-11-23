import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../server/db.ts';
import { buildApp } from '../server/app.ts';
import { seed, TEST_PASSWORD, TEST_PIN } from '../server/seed.ts';

// Planillas Excel: estructura del .xlsx, totales con la cuenta de caja, permisos y separación por local.
let app: FastifyInstance;
let dir: string;
const jar: Record<string, string> = {};
let n = 0;
const op = () => `op-x-${++n}-${Math.random().toString(36).slice(2, 8)}`;
const OWNER = 'dueno@esquina.test', MOZO = 'mozo1@esquina.test', CAJA = 'caja@esquina.test', OWNER_B = 'dueno@fuego.test';

async function api(who: string | null, method: string, url: string, payload?: unknown) {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: who ? { cookie: jar[who] } : {} });
  return { status: r.statusCode, raw: r.rawPayload, headers: r.headers, body: (() => { try { return JSON.parse(r.body); } catch { return r.body; } })() };
}
const ok = async (who: string, method: string, url: string, payload?: unknown) => {
  const r = await api(who, method, url, payload);
  expect(r.status, `${method} ${url} -> ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};

/** Lector mínimo de .xlsx para el test: descomprime el ZIP y devuelve las celdas de la hoja como { A1: {v, s, str} }. */
function readXlsx(buf: Buffer) {
  const files: Record<string, string> = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    files[name] = inflateRawSync(buf.subarray(start, start + size)).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  const sheet = files['xl/worksheets/sheet1.xml'];
  const un = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const cells: Record<string, { v: string | number | null; s: number; str: boolean }> = {};
  for (const m of sheet.matchAll(/<c r="([A-Z]+\d+)" s="(\d+)"(?: t="inlineStr")?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const t = m[3]?.match(/<t[^>]*>([\s\S]*?)<\/t>/), v = m[3]?.match(/<v>(.*?)<\/v>/);
    cells[m[1]] = { v: t ? un(t[1]) : v ? Number(v[1]) : null, s: Number(m[2]), str: !!t };
  }
  const rowsOf = (col: string) => Object.entries(cells).filter(([k]) => k.match(/^[A-Z]+/)![0] === col).map(([k, c]) => ({ row: Number(k.slice(col.length)), ...c }));
  return { files, sheet, cells, rowsOf };
}
const header = (x: ReturnType<typeof readXlsx>) => Number(x.sheet.match(/<pane ySplit="(\d+)"/)![1]);
const column = (x: ReturnType<typeof readXlsx>, title: string) => {
  const h = header(x);
  const ref = Object.entries(x.cells).find(([k, c]) => Number(k.replace(/^[A-Z]+/, '')) === h && c.v === title)![0];
  const col = ref.replace(/\d+$/, '');
  return x.rowsOf(col).filter((c) => c.row > h);
};
const summary = (x: ReturnType<typeof readXlsx>, label: string) => {
  const a = Object.entries(x.cells).find(([k, c]) => k.startsWith('A') && c.v === label)![0];
  return x.cells['D' + a.slice(1)].v as number; // la etiqueta ocupa A:C (combinadas)
};
const cents = (v: number) => Math.round(v * 100);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bmr-exp-'));
  const db = await openDb(null);
  await seed(db);
  ({ app } = await buildApp({ db, dataDir: dir, publicUrl: 'http://localhost', env: 'test' }));
  for (const u of [OWNER, MOZO, CAJA, OWNER_B]) {
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email: u, password: TEST_PASSWORD } });
    jar[u] = String(r.headers['set-cookie']).split(';')[0];
  }
  // Datos de ejemplo: una mesa con una línea anulada, un descuento a la cuenta, cobro en efectivo con vuelto y una reversión parcial.
  const menu = await ok(OWNER, 'GET', '/api/menu');
  const pid = (name: string) => menu.products.find((p: any) => p.name.startsWith(name)).id;
  const t = await ok(OWNER, 'POST', '/api/tables', { number: 'X1', area: 'Pruebas', seats: 2 });
  const v = await ok(MOZO, 'POST', '/api/visits', { tableId: t.id, guests: 2 });
  const r = await ok(MOZO, 'POST', `/api/visits/${v.id}/rounds`, { opId: op(), items: [{ productId: pid('Flan'), qty: 2 }, { productId: pid('Agua mineral'), qty: 1 }] });
  const flan = r.lines.find((l: any) => l.name.startsWith('Flan'));
  await ok(OWNER, 'POST', `/api/lines/${flan.id}/void`, { reason: '=HYPERLINK("http://x","clic")', destination: 'merma' });
  await ok(OWNER, 'POST', `/api/visits/${v.id}/discounts`, { amountCents: 10_000, reason: 'Cliente habitual' });
  const due = (await ok(CAJA, 'GET', `/api/visits/${v.id}`)).balance.due;
  const pay = await ok(CAJA, 'POST', '/api/payments', { opId: op(), visitId: v.id, method: 'efectivo', amountCents: due, tenderedCents: due + 50_000 });
  await ok(OWNER, 'POST', `/api/payments/${pay.payment.id}/refund`, { opId: op(), reason: 'Cobrado de más', amountCents: 5_000, supervisorPin: TEST_PIN });
  // Tope: descuento de $10 a una cuenta cuyo único plato se anula después → el descuento aplicado queda en 0.
  const t2 = await ok(OWNER, 'POST', '/api/tables', { number: 'X2', area: 'Pruebas', seats: 2 });
  const v2 = await ok(MOZO, 'POST', '/api/visits', { tableId: t2.id, guests: 1 });
  const r2 = await ok(MOZO, 'POST', `/api/visits/${v2.id}/rounds`, { opId: op(), items: [{ productId: pid('Agua mineral'), qty: 1 }] });
  await ok(OWNER, 'POST', `/api/visits/${v2.id}/discounts`, { amountCents: 1_000, reason: 'Tope <b>&</b> "comillas" \u0007 ]]>' });
  await ok(OWNER, 'POST', `/api/lines/${r2.lines[0].id}/void`, { reason: '=cmd|\'/C calc\'!A0', destination: 'merma' });
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('exportar planillas Excel', () => {
  it('cada botón descarga su propio .xlsx con título, local, período, encabezado fijo y filtros', async () => {
    for (const kind of ['ventas', 'cobros', 'turnos', 'auditoria']) {
      const r = await api(OWNER, 'GET', `/api/export/${kind}.xlsx`);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(String(r.headers['content-disposition'])).toMatch(new RegExp(`^attachment; filename="${kind}-[a-z0-9-]+-\\d{4}-\\d{2}-\\d{2}\\.xlsx"$`));
      const x = readXlsx(r.raw);
      expect(x.cells.A2.v).toBe('La Esquina de Boedo');
      expect(String(x.cells.A3.v)).toMatch(/Período: \d{1,2}\/\d{1,2}\/\d{2,4}|Generado el/);
      const h = header(x);
      expect(x.sheet).toContain(`state="frozen"`);
      expect(x.sheet).toMatch(new RegExp(`<autoFilter ref="A${h}:[A-Z]+\\d+"/>`));
      expect(x.files['xl/workbook.xml']).toContain('_xlnm._FilterDatabase');
      expect(x.files['xl/styles.xml']).toContain('formatCode="dd/mm/yyyy hh:mm"');
    }
  });

  it('Ventas: importes y fechas numéricos; la columna Total suma lo mismo que la caja; la anulada se identifica y no suma', async () => {
    const x = readXlsx((await api(OWNER, 'GET', '/api/export/ventas.xlsx')).raw);
    const total = column(x, 'Total'), estado = column(x, 'Estado'), fecha = column(x, 'Fecha y hora');
    expect(fecha.every((c) => typeof c.v === 'number' && c.v > 45000)).toBe(true);
    const sum = total.reduce((s, c) => s + (typeof c.v === 'number' ? cents(c.v) : 0), 0);
    expect(sum).toBe(cents(summary(x, 'Ventas del período (cálculo de caja)')));
    const voided = estado.find((c) => c.v === 'Anulada')!;
    expect(voided).toBeTruthy();
    expect(total.find((c) => c.row === voided.row)!.v).toBeNull(); // celda vacía
    expect(x.sheet).toContain('=HYPERLINK(&quot;http://x&quot;,&quot;clic&quot;)'); // texto, nunca fórmula
    expect(x.sheet).not.toContain('<f>');
    expect(column(x, 'Detalle').some((c) => c.v === 'Descuento a la cuenta')).toBe(true);
    const open = (await ok(OWNER, 'GET', '/api/shifts/current')).shift.id;
    expect(column(x, 'Turno').find((c) => c.row === voided.row)!.v).toBe(open); // la venta cae en el turno abierto
    expect(column(x, 'Turno')[0].v).toBeNull(); // ventas del seed anteriores a cualquier turno: celda vacía
  });

  it('Ventas: los descuentos aplicados respetan el tope, igual que el turno de caja', async () => {
    const x = readXlsx((await api(OWNER, 'GET', '/api/export/ventas.xlsx')).raw);
    expect(cents(summary(x, 'Descuentos y cortesías aplicados'))).toBe(10_000); // $100 aplicado + $10 sin efecto por el tope
    const shift = await ok(OWNER, 'GET', '/api/shifts/current');
    expect(shift.descuentos.reduce((s: number, d: any) => s + Number(d.total), 0)).toBe(10_000);
    expect(shift.descuentos.find((d: any) => d.kind === 'tope').total).toBe(-1_000);
  });

  it('texto con caracteres especiales queda como texto en XML bien formado', async () => {
    const x = readXlsx((await api(OWNER, 'GET', '/api/export/ventas.xlsx')).raw);
    expect(column(x, 'Motivo').some((c) => c.v === 'Tope <b>&</b> "comillas"  ]]>')).toBe(true); // el carácter de control se quita
    expect(column(x, 'Motivo').some((c) => c.v === "=cmd|'/C calc'!A0" && c.str)).toBe(true);
    expect(x.sheet).not.toMatch(/[\u0000-\u0008]/); // oxlint-disable-line no-control-regex -- justamente se busca que no haya caracteres de control
    expect(x.sheet).not.toContain('<f>');
  });

  it('Cobros: la reversión se marca con texto y color; el neto es cobros − reversiones', async () => {
    const x = readXlsx((await api(OWNER, 'GET', '/api/export/cobros.xlsx')).raw);
    const tipo = column(x, 'Tipo'), importe = column(x, 'Importe');
    const rev = tipo.find((c) => c.v === 'Reversión')!;
    const revAmount = importe.find((c) => c.row === rev.row)!;
    expect(revAmount.v).toBe(-50);
    expect(revAmount.s).not.toBe(importe.find((c) => c.row !== rev.row)!.s); // otro estilo (rojo)
    expect(cents(summary(x, 'Total neto cobrado (cobros − reversiones)'))).toBe(importe.reduce((s, c) => s + cents(c.v as number), 0));
    expect(column(x, 'Vuelto').some((c) => c.v === 500)).toBe(true);
  });

  it('Cobros conserva el filtro por turno', async () => {
    const all = readXlsx((await api(OWNER, 'GET', '/api/export/cobros.xlsx')).raw);
    const shift = column(all, 'Turno')[0].v as number;
    const r = await api(OWNER, 'GET', `/api/export/cobros.xlsx?shift=${shift}`);
    expect(String(r.headers['content-disposition'])).toContain(`cobros-turno${shift}-`);
    expect(column(readXlsx(r.raw), 'Turno').every((c) => c.v === shift)).toBe(true);
  });

  it('Turnos: diferencia distinta de cero resaltada; turno abierto indicado', async () => {
    const x = readXlsx((await api(OWNER, 'GET', '/api/export/turnos.xlsx')).raw);
    const diff = column(x, 'Diferencia'), estado = column(x, 'Estado');
    const neg = diff.find((c) => c.v === -500)!; // el turno cerrado del seed: contado $24.500, esperado $25.000
    const zeroOrEmpty = estado.find((c) => c.v === 'Abierto (en curso)')!;
    expect(neg).toBeTruthy();
    expect(zeroOrEmpty).toBeTruthy();
    expect(diff.find((c) => c.row === zeroOrEmpty.row)!.v).toBeNull();
    expect(neg.s).not.toBe(column(x, 'Fondo inicial').find((c) => c.row === neg.row)!.s);
  });

  it('Auditoría: detalle con ajuste de texto', async () => {
    const x = readXlsx((await api(OWNER, 'GET', '/api/export/auditoria.xlsx')).raw);
    const det = column(x, 'Detalle').find((c) => String(c.v).includes('paymentId'))!;
    expect(det).toBeTruthy();
    const xf = [...x.files['xl/styles.xml'].matchAll(/<xf fontId[^>]*>(.*?)<\/xf>/g)][det.s][1];
    expect(xf).toContain('wrapText="1"');
  });

  it('permisos y separación por local: mismos que el CSV', async () => {
    expect((await api(null, 'GET', '/api/export/ventas.xlsx')).status).toBe(401);
    expect((await api(MOZO, 'GET', '/api/export/ventas.xlsx')).status).toBe(403);
    expect((await api(CAJA, 'GET', '/api/export/auditoria.xlsx')).status).toBe(403);
    expect((await api(OWNER, 'GET', '/api/export/pedidos.xlsx')).status).toBe(404);
    const shiftA = column(readXlsx((await api(OWNER, 'GET', '/api/export/cobros.xlsx')).raw), 'Turno')[0].v;
    expect((await api(OWNER_B, 'GET', `/api/export/cobros.xlsx?shift=${shiftA}`)).status).toBe(404); // turno de otro local
    for (const k of ['ventas', 'turnos', 'auditoria']) {
      const xb = readXlsx((await api(OWNER_B, 'GET', `/api/export/${k}.xlsx`)).raw);
      expect(xb.sheet).not.toContain('Cliente habitual');
      expect(xb.sheet).not.toContain('Marta Dueña');
    }
    const b = readXlsx((await api(OWNER_B, 'GET', '/api/export/cobros.xlsx')).raw);
    expect(b.cells.A2.v).not.toBe('La Esquina de Boedo');
    expect(b.sheet).not.toContain('Cobrado de más');
    const csv = await api(OWNER, 'GET', '/api/export/ventas');
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(String(csv.body).split('\n')[0]).toContain('precio_unitario'); // el CSV sigue igual
  });
});
