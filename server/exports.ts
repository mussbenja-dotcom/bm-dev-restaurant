// Las cuatro planillas Excel del panel (Ventas, Cobros, Turnos, Auditoría). Todo filtrado por el local de la sesión.
import { all, one, type Q, type Row as DbRow } from './db.ts';
import { TZ } from './core.ts';
import { FEE_EXCLUDED, salesTotals, shiftSummary } from './routes/cash.ts';
import { buildXlsx, type Report, type Row } from './xlsx.ts';

export const XLSX_KINDS = ['ventas', 'cobros', 'turnos', 'auditoria'] as const;
export type XlsxKind = (typeof XLSX_KINDS)[number];

const $ = (c: unknown) => (c == null ? null : Number(c) / 100);
/** DD/MM/AAAA HH:mm en la hora del local. */
const when = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
};
const CHANNEL: Record<string, string> = { retiro: 'Retiro', delivery: 'Delivery', mostrador: 'Mostrador' };
const LINE_STATUS: Record<string, string> = { pending: 'Pendiente', preparing: 'En preparación', ready: 'Lista', delivered: 'Entregada', void: 'Anulada' };
const ENTITY: Record<string, string> = { visit: 'Cuenta', order: 'Pedido', user: 'Usuario', payment: 'Cobro', line: 'Línea', shift: 'Turno', product: 'Producto', table: 'Mesa', restaurant: 'Local', reservation: 'Reserva' };
const METHOD: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };
const label = (map: Record<string, string>, v: string | null) => (v == null ? null : map[v] ?? v.charAt(0).toUpperCase() + v.slice(1));
const where = (r: DbRow) => (r.mesa ? `Salón · Mesa ${r.mesa}` : r.visit_id ? `Salón · cuenta ${r.visit_id}` : r.order_id ? `${label(CHANNEL, r.channel)} · pedido ${r.pedido}` : null);
// Mesas de cada cuenta (todas las que tuvo, también si se juntaron o se cambiaron), agregadas una sola vez: JOIN, no subconsulta por fila.
const TABLES = (col: string) => `LEFT JOIN (SELECT vt.visit_id, string_agg(DISTINCT t.number, '+') AS mesa FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.restaurant_id=$1 GROUP BY vt.visit_id) m ON m.visit_id=${col}`;

/** Turno de caja en curso en cada momento (los turnos no se superponen): se cargan una vez y se busca en memoria. */
async function shiftFinder(q: Q, rid: number) {
  const s = await all(q, 'SELECT id, opened_at, closed_at FROM cash_shifts WHERE restaurant_id=$1 ORDER BY opened_at', [rid]);
  return (d: Date) => {
    let lo = 0, hi = s.length - 1, at = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (+s[mid].opened_at <= +d) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    return at >= 0 && (s[at].closed_at == null || +d < +s[at].closed_at) ? s[at].id : null;
  };
}

/** Arma la planilla pedida. shift solo filtra Cobros (igual que el CSV). */
export async function xlsxReport(q: Q, rid: number, kind: XlsxKind, shift: number | null): Promise<{ file: Buffer; name: string }> {
  const r = (await one(q, 'SELECT name, slug FROM restaurants WHERE id=$1', [rid]))!;
  const now = new Date();
  const generated = `Generado el ${when(now)}`;
  const span = async (sql: string) => {
    const x = (await one(q, sql, [rid]))!;
    return x.desde ? `Período: ${when(x.desde)} a ${when(x.hasta)} (todo el historial) · ${generated}` : `Sin registros · ${generated}`;
  };
  let rep: Report;

  if (kind === 'ventas') {
    const turno = await shiftFinder(q, rid);
    // Todo hasta «now», el mismo corte que el resumen.
    const lines = await all(q, `SELECT l.created_at AS fecha, l.visit_id, l.order_id, l.name, l.qty, l.unit_price_cents, l.status, l.void_reason, o.number AS pedido, o.channel, m.mesa, ld.descuento
      FROM order_lines l LEFT JOIN orders o ON o.id=l.order_id AND o.restaurant_id=l.restaurant_id ${TABLES('l.visit_id')}
      LEFT JOIN (SELECT line_id, sum(amount_cents) AS descuento FROM discounts WHERE restaurant_id=$1 AND line_id IS NOT NULL GROUP BY line_id) ld ON ld.line_id=l.id
      WHERE l.restaurant_id=$1 AND l.created_at < $2`, [rid, now]);
    // Envíos que cuentan como venta y descuentos a la cuenta entera (sin plato): filas propias para que la columna Total sume lo mismo que la caja.
    const fees = await all(q, `SELECT o.created_at AS fecha, o.id AS order_id, o.number AS pedido, o.channel, o.fee_cents, o.status
      FROM orders o WHERE o.restaurant_id=$1 AND o.created_at < $2 AND o.fee_cents > 0 AND o.status NOT IN ${FEE_EXCLUDED}`, [rid, now]);
    const discs = await all(q, `SELECT d.at AS fecha, d.visit_id, d.kind, d.amount_cents, d.reason, m.mesa
      FROM discounts d ${TABLES('d.visit_id')} WHERE d.restaurant_id=$1 AND d.at < $2 AND d.line_id IS NULL`, [rid, now]);
    const rows: (Row & { t: number })[] = [
      ...lines.map((l) => {
        const voided = l.status === 'void', amount = $(l.unit_price_cents * l.qty);
        return { t: +l.fecha, tone: voided ? ('bad' as const) : undefined,
          c: [l.fecha, turno(l.fecha), where(l), l.order_id ? `Pedido ${l.pedido}` : l.visit_id ? `Cuenta ${l.visit_id}` : null, l.name, l.qty, $(l.unit_price_cents), $(l.descuento), voided ? null : amount, label(LINE_STATUS, l.status), voided ? amount : null, l.void_reason] };
      }),
      ...fees.map((o) => ({ t: +o.fecha, c: [o.fecha, turno(o.fecha), where(o), `Pedido ${o.pedido}`, 'Envío', 1, $(o.fee_cents), null, $(o.fee_cents), 'Envío cobrado', null, null] })),
      ...discs.map((d) => ({ t: +d.fecha, c: [d.fecha, turno(d.fecha), where(d), `Cuenta ${d.visit_id}`, `${d.kind === 'cortesia' ? 'Cortesía' : 'Descuento'} a la cuenta`, null, null, $(d.amount_cents), null, d.kind === 'cortesia' ? 'Cortesía' : 'Descuento', null, d.reason] })),
    ].sort((a, b) => a.t - b.t);
    const t = await salesTotals(q, rid, new Date(0), now);
    const descuentos = t.disc.reduce((s, d) => s + Number(d.total), 0);
    rep = {
      sheet: 'Ventas', title: 'Reporte de ventas', restaurant: r.name,
      period: await span(`SELECT min(created_at) AS desde, max(created_at) AS hasta FROM order_lines WHERE restaurant_id=$1`),
      summary: [
        ['Ventas del período (cálculo de caja)', $(t.sales.ventas + t.fees.envios), 'money'],
        ['  de las cuales, envíos', $(t.fees.envios), 'money'],
        ['Descuentos y cortesías aplicados', $(descuentos), 'money'],
        [`Anulado (${t.sales.anulaciones} ${t.sales.anulaciones === 1 ? 'línea' : 'líneas'}, no suma a las ventas)`, $(t.sales.anulado), 'money'],
      ],
      cols: [
        { header: 'Fecha y hora', width: 17, kind: 'date' }, { header: 'Turno', width: 8, kind: 'int' }, { header: 'Mesa o canal', width: 22 },
        { header: 'Pedido o cuenta', width: 16 }, { header: 'Detalle', width: 40 }, { header: 'Cantidad', width: 10, kind: 'int' },
        { header: 'Precio unitario', width: 15, kind: 'money' }, { header: 'Descuento', width: 14, kind: 'money' }, { header: 'Total', width: 15, kind: 'money' },
        { header: 'Estado', width: 15 }, { header: 'Importe anulado', width: 15, kind: 'money' }, { header: 'Motivo', width: 32, kind: 'wrap' },
      ],
      rows,
    };
  } else if (kind === 'cobros') {
    const pays = await all(q, `SELECT p.id, p.shift_id, p.created_at, p.method, p.amount_cents, p.tip_cents, p.tendered_cents, p.change_cents, p.payer, p.status, p.reverses_id, p.reason,
        p.visit_id, p.order_id, o.number AS pedido, o.channel, m.mesa, u.name AS cajero
      FROM payments p LEFT JOIN users u ON u.id=p.created_by LEFT JOIN orders o ON o.id=p.order_id AND o.restaurant_id=p.restaurant_id ${TABLES('p.visit_id')}
      WHERE p.restaurant_id=$1 AND ($2::int IS NULL OR p.shift_id=$2) ORDER BY p.id`, [rid, shift]);
    const net = (m?: string) => pays.filter((p) => !m || p.method === m).reduce((s, p) => s + Number(p.amount_cents), 0);
    const methods = [...new Set(pays.map((p) => p.method as string))].sort();
    rep = {
      sheet: 'Cobros', title: shift ? `Cobros del turno ${shift}` : 'Reporte de cobros', restaurant: r.name,
      period: shift ? `Turno ${shift} · ${generated}` : await span(`SELECT min(created_at) AS desde, max(created_at) AS hasta FROM payments WHERE restaurant_id=$1`),
      // Regla de caja: el neto suma cobros y reversiones (que se guardan en negativo); la propina va aparte.
      summary: [
        ['Total neto cobrado (cobros − reversiones)', $(net()), 'money'],
        ...methods.map((m): [string, number | null, 'money'] => [`  Neto ${label(METHOD, m)}`, $(net(m)), 'money']),
        ['Propinas', $(pays.reduce((s, p) => s + Number(p.tip_cents), 0)), 'money'],
      ],
      cols: [
        { header: 'Fecha y hora', width: 17, kind: 'date' }, { header: 'Nº cobro', width: 10, kind: 'int' }, { header: 'Turno', width: 8, kind: 'int' },
        { header: 'Tipo', width: 16 }, { header: 'Medio de pago', width: 15 }, { header: 'Importe', width: 15, kind: 'money' },
        { header: 'Propina', width: 13, kind: 'money' }, { header: 'Recibido', width: 14, kind: 'money' }, { header: 'Vuelto', width: 13, kind: 'money' },
        { header: 'Pagador', width: 18 }, { header: 'Mesa o pedido', width: 22 }, { header: 'Revierte el cobro Nº', width: 12, kind: 'int' },
        { header: 'Motivo', width: 30, kind: 'wrap' }, { header: 'Cajero', width: 18 },
      ],
      rows: pays.map((p) => {
        const isRev = p.reverses_id != null, cash = p.method === 'efectivo' || p.tendered_cents != null;
        return { tone: isRev ? 'bad' : undefined, hot: !isRev && p.status === 'reversed' ? [3] : undefined,
          c: [p.created_at, p.id, p.shift_id, isRev ? 'Reversión' : p.status === 'reversed' ? 'Cobro revertido' : 'Cobro', label(METHOD, p.method), $(p.amount_cents),
            $(p.tip_cents), $(p.tendered_cents), cash ? $(p.change_cents) : null, p.payer, where(p), p.reverses_id, p.reason, p.cajero] };
      }),
    };
  } else if (kind === 'turnos') {
    const shifts = await all(q, `SELECT s.*, ou.name AS abrio, cu.name AS cerro FROM cash_shifts s LEFT JOIN users ou ON ou.id=s.opened_by LEFT JOIN users cu ON cu.id=s.closed_by WHERE s.restaurant_id=$1 ORDER BY s.id`, [rid]);
    const rows: Row[] = [];
    let diffs = 0, closedN = 0;
    for (const s of shifts) {
      const open = s.status === 'open';
      // Turno abierto: el esperado se calcula en vivo con la misma cuenta del cierre.
      const expected = open ? (await shiftSummary(q, rid, s)).expected : s.expected_cents;
      const diff = s.counted_cents == null || expected == null ? null : s.counted_cents - expected;
      if (diff != null) { diffs += diff; closedN++; }
      rows.push({ hot: [...(open ? [1] : []), ...(diff ? [9] : [])],
        c: [s.id, open ? 'Abierto (en curso)' : 'Cerrado', s.opened_at, s.closed_at, s.abrio, s.cerro, $(s.opening_cents), $(expected), $(s.counted_cents), $(diff)] });
    }
    rep = {
      sheet: 'Turnos', title: 'Reporte de turnos de caja', restaurant: r.name,
      period: await span(`SELECT min(opened_at) AS desde, max(coalesce(closed_at, opened_at)) AS hasta FROM cash_shifts WHERE restaurant_id=$1`),
      summary: [
        ['Turnos cerrados', closedN, 'int'],
        ['Diferencia acumulada (contado − esperado)', $(diffs), 'money'],
        ['Turno abierto', shifts.some((s) => s.status === 'open') ? 'Sí: el esperado es parcial y todavía no hay conteo' : 'No'],
      ],
      cols: [
        { header: 'Turno', width: 8, kind: 'int' }, { header: 'Estado', width: 19 }, { header: 'Apertura', width: 17, kind: 'date' }, { header: 'Cierre', width: 17, kind: 'date' },
        { header: 'Abrió', width: 18 }, { header: 'Cerró', width: 18 }, { header: 'Fondo inicial', width: 15, kind: 'money' },
        { header: 'Efectivo esperado', width: 17, kind: 'money' }, { header: 'Efectivo contado', width: 17, kind: 'money' }, { header: 'Diferencia', width: 15, kind: 'money' },
      ],
      rows,
    };
  } else {
    const logs = await all(q, `SELECT a.at, a.action, a.entity, a.entity_id, a.reason, a.data, u.name AS usuario, z.name AS autorizo
      FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN users z ON z.id=a.authorized_by WHERE a.restaurant_id=$1 ORDER BY a.id`, [rid]);
    const detail = (d: unknown) => (d && typeof d === 'object' ? Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n') : d == null ? null : String(d));
    rep = {
      sheet: 'Auditoría', title: 'Registro de auditoría', restaurant: r.name,
      period: await span(`SELECT min(at) AS desde, max(at) AS hasta FROM audit_log WHERE restaurant_id=$1`),
      summary: [['Registros', logs.length, 'int']],
      cols: [
        { header: 'Fecha y hora', width: 17, kind: 'date' }, { header: 'Usuario', width: 18 }, { header: 'Autorizó', width: 18 }, { header: 'Acción', width: 22 },
        { header: 'Registro afectado', width: 18 }, { header: 'Motivo', width: 30, kind: 'wrap' }, { header: 'Detalle', width: 48, kind: 'wrap' },
      ],
      rows: logs.map((l) => ({ c: [l.at, l.usuario, l.autorizo, l.action, l.entity ? `${label(ENTITY, l.entity)}${l.entity_id ? ' #' + l.entity_id : ''}` : null, l.reason, detail(l.data)] })),
    };
  }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  return { file: await buildXlsx(rep), name: `${kind}${shift && kind === 'cobros' ? '-turno' + shift : ''}-${r.slug}-${day}.xlsx` };
}
