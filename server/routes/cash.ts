import type { FastifyPluginAsync } from 'fastify';
import { all, one, type Q, type Row } from '../db.ts';
import { audit, authorize, bad, conflict, emit, lockRestaurant, need, notFound, opHash, operationalDate, optStr, reqInt, reqOp, reqStr, send, toCsv, type Ctx } from '../core.ts';
import { balance, type RoundTarget } from '../engine.ts';
import { cashChange, expectedCash } from '../../shared/money.ts';

export async function currentShift(q: Q, rid: number) {
  return one(q, `SELECT * FROM cash_shifts WHERE restaurant_id=$1 AND status='open'`, [rid]);
}

/** Resumen de un turno: ventas, cobros por medio, propinas, descuentos, anulaciones, devoluciones, movimientos y efectivo esperado. */
export async function shiftSummary(q: Q, rid: number, s: Row) {
  const to = s.closed_at ?? new Date();
  const byMethod = await all(q, `SELECT method, sum(amount_cents) FILTER (WHERE amount_cents>0) AS cobrado, coalesce(sum(-amount_cents) FILTER (WHERE amount_cents<0),0) AS devuelto,
      sum(amount_cents) AS neto, sum(tip_cents) AS propinas, count(*)::int AS n FROM payments WHERE shift_id=$1 GROUP BY method ORDER BY method`, [s.id]);
  const moves = await all(q, 'SELECT m.*, u.name AS by_name FROM cash_moves m LEFT JOIN users u ON u.id=m.created_by WHERE shift_id=$1 ORDER BY m.id', [s.id]);
  const sum = (k: string) => moves.filter((m) => m.kind === k).reduce((t, m) => t + m.amount_cents, 0);
  const cash = byMethod.find((m) => m.method === 'efectivo');
  const totals = { opening: s.opening_cents, cashPayments: cash?.neto ?? 0, cashTips: cash?.propinas ?? 0, ingresos: sum('ingreso'), retiros: sum('retiro'), gastos: sum('gasto') };
  const { sales, fees, disc } = await salesTotals(q, rid, s.opened_at, to);
  const openRows = await all(q, `SELECT v.id, (SELECT string_agg(t.number,'+') FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.visit_id=v.id AND vt.released_at IS NULL) AS tables
      FROM visits v WHERE v.restaurant_id=$1 AND v.status='open'`, [rid]);
  const open = await Promise.all(openRows.map(async (v) => ({ ...v, due: (await balance(q, rid, { visitId: v.id })).due }) as Row));
  const expected = expectedCash(totals);
  const settings = (await one(q, 'SELECT settings FROM restaurants WHERE id=$1', [rid]))!.settings;
  return {
    shift: { id: s.id, status: s.status, openedAt: s.opened_at, closedAt: s.closed_at, operationalDate: operationalDate(new Date(s.opened_at), settings.cutoff_hour ?? 6) },
    ventas: sales.ventas + fees.envios, envios: fees.envios, anulado: sales.anulado, anulaciones: sales.anulaciones,
    byMethod, descuentos: disc, moves, totals, expected,
    counted: s.counted_cents, difference: s.counted_cents == null ? null : s.counted_cents - expected,
    openVisits: open.filter((v) => v.due !== 0 || v.tables),
  };
}

/** Pedidos cuyo envío no cuenta como venta. */
export const FEE_EXCLUDED = "('rechazado','cancelado','solicitud','recibido')";
/** Ventas de un período con el cálculo de caja: líneas no anuladas + envíos de pedidos aceptados; descuentos aplicados (descontado el tope). */
export async function salesTotals(q: Q, rid: number, from: Date, to: Date) {
  const sales = (await one(q, `SELECT coalesce(sum(unit_price_cents*qty) FILTER (WHERE status<>'void'),0) AS ventas, coalesce(sum(unit_price_cents*qty) FILTER (WHERE status='void'),0) AS anulado,
      count(*) FILTER (WHERE status='void')::int AS anulaciones FROM order_lines WHERE restaurant_id=$1 AND created_at >= $2 AND created_at < $3`, [rid, from, to]))!;
  const fees = (await one(q, `SELECT coalesce(sum(fee_cents),0) AS envios FROM orders WHERE restaurant_id=$1 AND created_at >= $2 AND created_at < $3 AND status NOT IN ${FEE_EXCLUDED}`, [rid, from, to]))!;
  const disc = await all(q, `SELECT kind, sum(amount_cents) AS total, count(*)::int AS n FROM discounts WHERE restaurant_id=$1 AND at >= $2 AND at < $3 GROUP BY kind`, [rid, from, to]);
  // Descuentos que quedaron sin efecto por el tope (se anuló lo descontado): se restan para que el turno muestre lo aplicado, igual que balance().
  // Una sola consulta (no un balance() por cuenta): aplicado por cuenta = least(todos sus descuentos, subtotal no anulado).
  const excess = Number((await one(q, `SELECT coalesce(sum(greatest(0, c.raw - least(d.total, coalesce(l.sub, 0)))), 0)::bigint AS n
      FROM (SELECT visit_id, sum(amount_cents) AS raw FROM discounts WHERE restaurant_id=$1 AND at >= $2 AND at < $3 AND visit_id IS NOT NULL GROUP BY visit_id) c
      CROSS JOIN LATERAL (SELECT sum(amount_cents) AS total FROM discounts WHERE restaurant_id=$1 AND visit_id=c.visit_id) d
      CROSS JOIN LATERAL (SELECT sum(unit_price_cents * qty) AS sub FROM order_lines WHERE restaurant_id=$1 AND visit_id=c.visit_id AND status <> 'void') l`, [rid, from, to]))!.n);
  if (excess) disc.push({ kind: 'tope', total: -excess, n: 0 });
  return { sales, fees, disc };
}

/** Ticket interno (precuenta o X). Toma una foto del detalle: reimprimirlo muestra exactamente lo mismo. */
export async function createTicket(q: Q, rid: number, kind: 'precuenta' | 'x', target: RoundTarget, userId: number) {
  await lockRestaurant(q, rid);
  const r = (await one(q, 'SELECT name, settings FROM restaurants WHERE id=$1', [rid]))!;
  const isVisit = 'visitId' in target;
  const id = isVisit ? target.visitId : target.orderId;
  const col = isVisit ? 'visit_id' : 'order_id';
  const lines = await all(q, `SELECT name, qty, unit_price_cents, options, note FROM order_lines WHERE ${col}=$1 AND restaurant_id=$2 AND status<>'void' ORDER BY id`, [id, rid]);
  const discounts = isVisit ? await all(q, 'SELECT kind, amount_cents, reason FROM discounts WHERE visit_id=$1 ORDER BY id', [id]) : [];
  const payments = await all(q, `SELECT method, amount_cents, tendered_cents, change_cents, tip_cents, payer FROM payments WHERE ${col}=$1 AND restaurant_id=$2 ORDER BY id`, [id, rid]);
  const where = isVisit
    ? 'Mesa ' + ((await one(q, `SELECT string_agg(t.number,'+') AS n FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.visit_id=$1 AND (vt.released_at IS NULL OR vt.released_at > now() - interval '1 second')`, [id]))?.n ?? '')
    : await (async () => { const o = (await one(q, 'SELECT number, channel, customer_name FROM orders WHERE id=$1', [id]))!; return `Pedido #${o.number} · ${o.channel} · ${o.customer_name}`; })();
  const b = await balance(q, rid, target);
  const number = (await one(q, 'SELECT coalesce(max(number),0)+1 AS n FROM tickets WHERE restaurant_id=$1 AND kind=$2', [rid, kind]))!.n;
  const snapshot = {
    restaurant: r.name, address: r.settings.address ?? '', where, kind, number, at: new Date().toISOString(),
    lines: lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit_price_cents, total: l.unit_price_cents * l.qty, options: l.options, note: l.note })),
    discounts: [...discounts.map((d) => ({ kind: d.kind, amount: d.amount_cents, reason: d.reason })),
      // Si se anularon platos después de un descuento fijo, el ticket muestra el ajuste para que los renglones sumen el total.
      ...(discounts.reduce((t, d) => t + d.amount_cents, 0) > b.discounts ? [{ kind: 'tope', amount: b.discounts - discounts.reduce((t, d) => t + d.amount_cents, 0), reason: 'el descuento no supera el total' }] : [])],
    subtotal: b.subtotal, fee: b.fee, discountTotal: b.discounts, total: b.total,
    payments: kind === 'x' ? payments.map((p) => ({ method: p.method, amount: p.amount_cents, tendered: p.tendered_cents, change: p.change_cents, tip: p.tip_cents, payer: p.payer })) : [],
    paid: b.paid, due: b.due,
  };
  return (await one(q, `INSERT INTO tickets (restaurant_id, kind, number, visit_id, order_id, snapshot, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [rid, kind, number, isVisit ? id : null, isVisit ? null : id, JSON.stringify(snapshot), userId]))!;
}

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;

  app.get('/api/shifts/current', async (req) => {
    const a = need(req, 'cashier');
    const s = await currentShift(db, a.restaurantId);
    return s ? await shiftSummary(db, a.restaurantId, s) : null;
  });

  app.post('/api/shifts/open', async (req: any) => {
    const a = need(req, 'cashier');
    const opening = reqInt(req.body?.openingCents, 'fondo inicial', 0, 1e11);
    const s = await db.transaction(async (tx) => {
      if (await currentShift(tx, a.restaurantId)) throw conflict('Ya hay una caja abierta');
      const s = (await one(tx, 'INSERT INTO cash_shifts (restaurant_id, opened_by, opening_cents) VALUES ($1,$2,$3) RETURNING *', [a.restaurantId, a.userId, opening]))!;
      await audit(tx, a.restaurantId, a.userId, 'shift.open', 'shift', s.id, null, { opening });
      return s;
    });
    emit(ctx, a.restaurantId, 'cash');
    return s;
  });

  // Cierre: el UPDATE condicionado a 'open' impide cerrar dos veces la misma caja.
  app.post('/api/shifts/close', async (req: any) => {
    const a = need(req, 'cashier');
    const counted = reqInt(req.body?.countedCents, 'efectivo contado', 0, 1e11);
    const shiftId = reqInt(req.body?.shiftId, 'turno', 1);
    const out = await db.transaction(async (tx) => {
      const s = await one(tx, `UPDATE cash_shifts SET status='closed', closed_at=now(), closed_by=$1, counted_cents=$2 WHERE id=$3 AND restaurant_id=$4 AND status='open' RETURNING *`, [a.userId, counted, shiftId, a.restaurantId]);
      if (!s) throw conflict('Esta caja ya estaba cerrada');
      const sum = await shiftSummary(tx, a.restaurantId, s);
      await tx.query('UPDATE cash_shifts SET expected_cents=$1, summary=$2 WHERE id=$3', [sum.expected, JSON.stringify(sum), s.id]);
      await audit(tx, a.restaurantId, a.userId, 'shift.close', 'shift', s.id, optStr(req.body?.note, 300) || null, { expected: sum.expected, counted, difference: sum.difference });
      return sum;
    });
    emit(ctx, a.restaurantId, 'cash');
    return out;
  });

  app.get('/api/shifts', async (req) => {
    const a = need(req, 'cashier');
    return all(db, `SELECT s.id, s.status, s.opened_at, s.closed_at, s.opening_cents, s.counted_cents, s.expected_cents, s.counted_cents - s.expected_cents AS difference, u.name AS closed_by_name
      FROM cash_shifts s LEFT JOIN users u ON u.id=s.closed_by WHERE s.restaurant_id=$1 ORDER BY s.id DESC LIMIT 60`, [a.restaurantId]);
  });
  app.get('/api/shifts/:id', async (req: any) => {
    const a = need(req, 'cashier');
    const s = await one(db, 'SELECT * FROM cash_shifts WHERE id=$1 AND restaurant_id=$2', [reqInt(req.params.id, 'turno', 1), a.restaurantId]);
    if (!s) throw notFound();
    return s.summary ?? (await shiftSummary(db, a.restaurantId, s));
  });

  app.post('/api/cash-moves', async (req: any) => {
    const a = need(req, 'cashier');
    const kind = ['gasto', 'retiro', 'ingreso'].includes(req.body?.kind) ? req.body.kind : null;
    if (!kind) throw bad('Tipo de movimiento inválido');
    const m = await db.transaction(async (tx) => {
      const s = await currentShift(tx, a.restaurantId);
      if (!s) throw conflict('Abrí la caja primero');
      const by = kind === 'retiro' ? await authorize(tx, a, req.body?.supervisorPin) : a.userId;
      const m = (await one(tx, 'INSERT INTO cash_moves (restaurant_id, shift_id, kind, amount_cents, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [a.restaurantId, s.id, kind, reqInt(req.body?.amountCents, 'importe', 1, 1e11), reqStr(req.body?.reason, 'motivo', 200), a.userId]))!;
      await audit(tx, a.restaurantId, a.userId, `cash.${kind}`, 'shift', s.id, m.reason, { amount: m.amount_cents }, by);
      return m;
    });
    emit(ctx, a.restaurantId, 'cash');
    return m;
  });

  // Cobro: idempotente por opId. Importe aplicado, recibido, vuelto y propina quedan separados.
  app.post('/api/payments', async (req: any) => {
    const a = need(req, 'cashier');
    const b = req.body ?? {};
    const opId = reqOp(b.opId);
    const target: RoundTarget = b.visitId ? { visitId: reqInt(b.visitId, 'visita', 1) } : { orderId: reqInt(b.orderId, 'pedido', 1) };
    const method = reqStr(b.method, 'medio de pago', 30);
    const amount = reqInt(b.amountCents, 'importe', 1, 1e11);
    const tip = reqInt(b.tipCents ?? 0, 'propina', 0, 1e10);
    const tendered = method === 'efectivo' ? reqInt(b.tenderedCents ?? amount + tip, 'efectivo recibido', 0, 1e11) : null;
    const hash = opHash({ target, method, amount, tip, tendered, payer: optStr(b.payer, 40) });
    const res = await db.transaction(async (tx) => {
      const prev = await one(tx, 'SELECT * FROM payments WHERE restaurant_id=$1 AND op_id=$2', [a.restaurantId, opId]);
      if (prev) {
        if (prev.op_hash !== hash) throw conflict('Este cobro ya se registró con otros datos. Revisá el historial antes de cobrar de nuevo.');
        return { payment: prev, balance: await balance(tx, a.restaurantId, target), duplicate: true };
      }
      const settings = (await one(tx, 'SELECT settings FROM restaurants WHERE id=$1', [a.restaurantId]))!.settings;
      if (!(settings.payment_methods ?? []).includes(method)) throw bad('Medio de pago no habilitado');
      if (method === 'transferencia' && b.transferVerified !== true) throw bad('Confirmá que verificaste la acreditación de la transferencia');
      const s = await currentShift(tx, a.restaurantId);
      if (!s) throw conflict('Abrí la caja antes de cobrar');
      if ('visitId' in target) {
        if (!(await one(tx, `SELECT 1 FROM visits WHERE id=$1 AND restaurant_id=$2 AND status='open' FOR UPDATE`, [target.visitId, a.restaurantId]))) throw conflict('La mesa no está abierta');
      } else if (!(await one(tx, `SELECT 1 FROM orders WHERE id=$1 AND restaurant_id=$2 AND status NOT IN ('rechazado','cancelado','solicitud') FOR UPDATE`, [target.orderId, a.restaurantId]))) throw conflict('El pedido no admite cobros');
      const bal = await balance(tx, a.restaurantId, target);
      if (amount > bal.due) throw conflict(`El importe supera el saldo (${(bal.due / 100).toFixed(2)})`, { balance: bal });
      let change = 0;
      if (method === 'efectivo') try { change = cashChange(amount, tip, tendered!); } catch (e: any) { throw bad(e.message); }
      const p = (await one(tx, `INSERT INTO payments (restaurant_id, shift_id, visit_id, order_id, method, amount_cents, tendered_cents, change_cents, tip_cents, payer, op_id, op_hash, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [a.restaurantId, s.id, 'visitId' in target ? target.visitId : null, 'orderId' in target ? target.orderId : null, method, amount, tendered, change, tip, optStr(b.payer, 40), opId, hash, a.userId]))!;
      await audit(tx, a.restaurantId, a.userId, 'payment.create', 'visitId' in target ? 'visit' : 'order', 'visitId' in target ? target.visitId : target.orderId, null, { paymentId: p.id, method, amount, tip, change });
      return { payment: p, balance: await balance(tx, a.restaurantId, target), duplicate: false };
    });
    emit(ctx, a.restaurantId, 'cash');
    emit(ctx, a.restaurantId, 'floor');
    return res;
  });

  app.get('/api/payments/by-op/:opId', async (req: any) => {
    const a = need(req, 'cashier');
    return { payment: (await one(db, 'SELECT * FROM payments WHERE restaurant_id=$1 AND op_id=$2', [a.restaurantId, String(req.params.opId)])) ?? null };
  });

  // Devolución: referencia al cobro y medio originales; se registra como movimiento de reversión.
  app.post('/api/payments/:id/refund', async (req: any) => {
    const a = need(req, 'cashier');
    const id = reqInt(req.params.id, 'cobro', 1);
    const reason = reqStr(req.body?.reason, 'motivo', 300);
    const opId = reqOp(req.body?.opId);
    const r = await db.transaction(async (tx) => {
      const by = await authorize(tx, a, req.body?.supervisorPin);
      const prev = await one(tx, 'SELECT * FROM payments WHERE restaurant_id=$1 AND op_id=$2', [a.restaurantId, opId]);
      if (prev) { if (prev.reverses_id !== id) throw conflict('Este envío ya se usó para otra operación'); return prev; }
      const p = await one(tx, 'SELECT * FROM payments WHERE id=$1 AND restaurant_id=$2 AND amount_cents>0 FOR UPDATE', [id, a.restaurantId]);
      if (!p) throw notFound();
      const done = (await one(tx, 'SELECT coalesce(sum(-amount_cents),0) AS n FROM payments WHERE reverses_id=$1', [id]))!.n;
      const amount = reqInt(req.body?.amountCents ?? p.amount_cents - done, 'importe', 1, p.amount_cents - done);
      const s = await currentShift(tx, a.restaurantId);
      if (!s) throw conflict('Abrí la caja primero');
      const r = (await one(tx, `INSERT INTO payments (restaurant_id, shift_id, visit_id, order_id, method, amount_cents, reverses_id, reason, op_id, op_hash, created_by, payer)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [a.restaurantId, s.id, p.visit_id, p.order_id, p.method, -amount, id, reason, opId, opHash({ id, amount }), a.userId, p.payer]))!;
      if (amount + done === p.amount_cents) await tx.query(`UPDATE payments SET status='reversed' WHERE id=$1`, [id]);
      await audit(tx, a.restaurantId, a.userId, 'payment.refund', p.visit_id ? 'visit' : 'order', p.visit_id ?? p.order_id, reason, { paymentId: id, amount, method: p.method }, by);
      return r;
    });
    emit(ctx, a.restaurantId, 'cash');
    return r;
  });

  // Descuentos y cortesías: requieren motivo y autorización de encargado.
  app.post('/api/visits/:id/discounts', async (req: any) => {
    const a = need(req, 'cashier', 'waiter');
    const vid = reqInt(req.params.id, 'visita', 1);
    const b = req.body ?? {};
    const kind = b.kind === 'cortesia' ? 'cortesia' : 'descuento';
    const reason = reqStr(b.reason, 'motivo', 300);
    const d = await db.transaction(async (tx) => {
      const by = await authorize(tx, a, b.supervisorPin);
      if (!(await one(tx, `SELECT 1 FROM visits WHERE id=$1 AND restaurant_id=$2 AND status='open' FOR UPDATE`, [vid, a.restaurantId]))) throw conflict('La mesa no está abierta');
      let amount: number;
      let lineId: number | null = null;
      if (b.lineId) {
        const l = await one(tx, `SELECT * FROM order_lines WHERE id=$1 AND visit_id=$2 AND status<>'void'`, [reqInt(b.lineId, 'línea', 1), vid]);
        if (!l) throw notFound();
        lineId = l.id;
        const lineTotal = l.unit_price_cents * l.qty;
        const prev = (await one(tx, 'SELECT coalesce(sum(amount_cents),0)::bigint AS n FROM discounts WHERE line_id=$1', [l.id]))!.n;
        const left = lineTotal - prev;
        if (left <= 0) throw conflict('Esta línea ya tiene descuento total');
        amount = kind === 'cortesia' ? left : b.pct ? Math.round((lineTotal * reqInt(b.pct, 'porcentaje', 1, 100)) / 100) : reqInt(b.amountCents, 'importe', 1, left);
        if (amount > left) throw conflict('El descuento supera lo que queda de la línea');
        if (amount > (await balance(tx, a.restaurantId, { visitId: vid })).due) throw conflict('El descuento supera el saldo');
      } else {
        const bal = await balance(tx, a.restaurantId, { visitId: vid });
        amount = b.pct ? Math.round((bal.total * reqInt(b.pct, 'porcentaje', 1, 100)) / 100) : reqInt(b.amountCents, 'importe', 1, 1e11);
        if (amount > bal.due) throw conflict('El descuento supera el saldo');
      }
      const d = (await one(tx, 'INSERT INTO discounts (restaurant_id, visit_id, line_id, kind, amount_cents, reason, created_by, authorized_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [a.restaurantId, vid, lineId, kind, amount, reason, a.userId, by]))!;
      await audit(tx, a.restaurantId, a.userId, `discount.${kind}`, 'visit', vid, reason, { amount, lineId }, by);
      return d;
    });
    emit(ctx, a.restaurantId, 'floor');
    return d;
  });

  // ---------- Tickets internos ----------
  app.post('/api/tickets/precuenta', async (req: any) => {
    const a = need(req, 'cashier', 'waiter');
    const target: RoundTarget = req.body?.visitId ? { visitId: reqInt(req.body.visitId, 'visita', 1) } : { orderId: reqInt(req.body?.orderId, 'pedido', 1) };
    const col = 'visitId' in target ? 'visits' : 'orders';
    if (!(await one(db, `SELECT 1 FROM ${col} WHERE id=$1 AND restaurant_id=$2`, ['visitId' in target ? target.visitId : target.orderId, a.restaurantId]))) throw notFound();
    return db.transaction((tx) => createTicket(tx, a.restaurantId, 'precuenta', target, a.userId));
  });
  // Ticket X de un pedido externo saldado (las mesas lo generan al cerrar).
  app.post('/api/tickets/x-order', async (req: any) => {
    const a = need(req, 'cashier');
    const orderId = reqInt(req.body?.orderId, 'pedido', 1);
    return db.transaction(async (tx) => {
      if (!(await one(tx, 'SELECT 1 FROM orders WHERE id=$1 AND restaurant_id=$2', [orderId, a.restaurantId]))) throw notFound();
      const existing = await one(tx, `SELECT * FROM tickets WHERE order_id=$1 AND kind='x'`, [orderId]);
      if (existing) return existing;
      const b = await balance(tx, a.restaurantId, { orderId });
      if (b.due !== 0) throw conflict('El pedido tiene saldo pendiente');
      return createTicket(tx, a.restaurantId, 'x', { orderId }, a.userId);
    });
  });
  app.get('/api/tickets', async (req: any) => {
    const a = need(req, 'cashier');
    return all(db, `SELECT id, kind, number, visit_id, order_id, created_at, snapshot->>'where' AS "where", (snapshot->>'total')::bigint AS total FROM tickets WHERE restaurant_id=$1 ORDER BY id DESC LIMIT 100`, [a.restaurantId]);
  });
  // Reimpresión: el mismo ticket (número e importes originales). No crea cobros ni tickets nuevos.
  app.get('/api/tickets/:id', async (req: any) => {
    const a = need(req, 'cashier', 'waiter');
    const t = await one(db, 'SELECT * FROM tickets WHERE id=$1 AND restaurant_id=$2', [reqInt(req.params.id, 'ticket', 1), a.restaurantId]);
    if (!t) throw notFound();
    return t;
  });

  // ---------- Panel del dueño ----------
  app.get('/api/dashboard', async (req) => {
    const a = need(req);
    const rid = a.restaurantId;
    const settings = (await one(db, 'SELECT settings FROM restaurants WHERE id=$1', [rid]))!.settings;
    const shift = await currentShift(db, rid);
    const summary = shift ? await shiftSummary(db, rid, shift) : null;
    const lastClosed = await one(db, `SELECT id, closed_at, counted_cents - expected_cents AS difference FROM cash_shifts WHERE restaurant_id=$1 AND status='closed' ORDER BY id DESC LIMIT 1`, [rid]);
    const alerts: { kind: string; text: string; link: string; weight: number }[] = [];
    const bills = await all(db, `SELECT c.id, c.visit_id, extract(epoch FROM now()-c.created_at)::int AS secs, (SELECT string_agg(t.number,'+') FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.visit_id=c.visit_id AND vt.released_at IS NULL) AS tables
      FROM calls c WHERE c.restaurant_id=$1 AND c.status='pending' ORDER BY c.created_at`, [rid]);
    for (const b of bills.filter((b) => b.secs >= (settings.bill_alert_min ?? 5) * 60)) alerts.push({ kind: 'cuenta', text: `Mesa ${b.tables} espera atención hace ${Math.round(b.secs / 60)} min`, link: `/app/mesa/${b.visit_id}`, weight: 3 + b.secs / 600 });
    const late = await all(db, `SELECT l.visit_id, l.order_id, l.name, s.name AS station, extract(epoch FROM now()-l.created_at)::int AS secs, s.delay_minutes,
      (SELECT string_agg(t.number,'+') FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.visit_id=l.visit_id AND (vt.released_at IS NULL OR NOT EXISTS (SELECT 1 FROM visit_tables v2 WHERE v2.visit_id=l.visit_id AND v2.released_at IS NULL))) AS tables
      FROM order_lines l JOIN stations s ON s.id=l.station_id WHERE l.restaurant_id=$1 AND l.status IN ('pending','preparing') AND NOT l.held AND now()-l.created_at > make_interval(mins => s.delay_minutes) ORDER BY l.created_at LIMIT 3`, [rid]);
    for (const l of late) alerts.push({ kind: 'demora', text: `${l.name} (${l.tables ? 'mesa ' + l.tables : 'pedido'}) lleva ${Math.round(l.secs / 60)} min en ${l.station}`, link: `/app/cocina`, weight: 2 + l.secs / 600 });
    if (lastClosed?.difference) alerts.push({ kind: 'caja', text: `La última caja cerró con diferencia de ${(lastClosed.difference / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}`, link: `/app/caja/turno/${lastClosed.id}`, weight: 2.5 });
    const low = await all(db, `SELECT id, name, stock_qty FROM products WHERE restaurant_id=$1 AND stock_qty IS NOT NULL AND stock_qty <= 2 AND published ORDER BY stock_qty LIMIT 3`, [rid]);
    for (const p of low) alerts.push({ kind: 'stock', text: p.stock_qty ? `Quedan ${p.stock_qty} de ${p.name}` : `${p.name} agotado`, link: '/app/config/carta', weight: 1.5 });
    const pendingOrders = (await one(db, `SELECT count(*)::int AS n FROM orders WHERE restaurant_id=$1 AND status IN ('recibido','solicitud')`, [rid]))!.n;
    if (pendingOrders) alerts.push({ kind: 'pedidos', text: `${pendingOrders} pedido(s) de retiro/delivery esperan aceptación`, link: '/app/pedidos', weight: 2.8 });
    const conflicts = await all(db, `SELECT entity_id, reason FROM audit_log WHERE restaurant_id=$1 AND action='rider.conflict' AND at > now() - interval '12 hours' ORDER BY id DESC LIMIT 1`, [rid]);
    for (const c of conflicts) alerts.push({ kind: 'reparto', text: `Repartidor: ${c.reason}`, link: '/app/pedidos', weight: 2.7 });
    alerts.sort((x, y) => y.weight - x.weight);
    const sold = (await one(db, `SELECT coalesce(sum(unit_price_cents*qty),0) AS ventas FROM order_lines WHERE restaurant_id=$1 AND status<>'void' AND created_at > now() - interval '24 hours'`, [rid]))!;
    return { alerts: alerts.slice(0, 3), allAlerts: alerts.length, summary, lastClosed, last24h: sold.ventas, operationalDate: operationalDate(new Date(), settings.cutoff_hour ?? 6) };
  });

  // Informe por sucursal: locales donde la persona es dueña.
  app.get('/api/reports/branches', async (req) => {
    const a = need(req);
    return all(db, `SELECT r.id, r.name,
      coalesce((SELECT sum(unit_price_cents*qty) FROM order_lines l WHERE l.restaurant_id=r.id AND l.status<>'void' AND l.created_at > now()-interval '7 days'),0) AS ventas_7d,
      coalesce((SELECT sum(amount_cents) FROM payments p WHERE p.restaurant_id=r.id AND p.created_at > now()-interval '7 days'),0) AS cobros_7d,
      (SELECT count(*)::int FROM visits v WHERE v.restaurant_id=r.id AND v.status='open') AS mesas_abiertas,
      (SELECT count(*)::int FROM orders o WHERE o.restaurant_id=r.id AND o.created_at > now()-interval '7 days' AND o.status NOT IN ('rechazado','cancelado')) AS pedidos_7d
      FROM restaurants r JOIN memberships m ON m.restaurant_id=r.id AND m.user_id=$1 AND m.active AND 'owner'=ANY(m.roles) ORDER BY r.name`, [a.userId]);
  });

  // ---------- Exportación CSV ----------
  app.get('/api/export/:kind', async (req: any, reply) => {
    const a = need(req);
    const rid = a.restaurantId;
    const shift = req.query.shift ? reqInt(req.query.shift, 'turno', 1) : null;
    // «ventas.xlsx»: planilla Excel con formato; sin extensión o «.csv»: el CSV de siempre.
    const xk = String(req.params.kind).match(/^(\w+)\.xlsx$/)?.[1];
    if (xk) {
      const { XLSX_KINDS, xlsxReport } = await import('../exports.ts'); // carga diferida: exports.ts usa funciones de este archivo
      if (!(XLSX_KINDS as readonly string[]).includes(xk)) throw notFound();
      if (shift && !(await one(db, 'SELECT 1 FROM cash_shifts WHERE id=$1 AND restaurant_id=$2', [shift, rid]))) throw notFound();
      const { file, name } = await xlsxReport(db, rid, xk as (typeof XLSX_KINDS)[number], shift);
      return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${name}"`).send(file);
    }
    const kind = String(req.params.kind).replace(/\.csv$/, '');
    let rows: Row[];
    if (kind === 'cobros') rows = await all(db, `SELECT p.id, p.shift_id AS turno, p.created_at AS fecha, p.method AS medio, p.amount_cents/100.0 AS importe, p.tip_cents/100.0 AS propina, p.tendered_cents/100.0 AS recibido, p.change_cents/100.0 AS vuelto, p.payer AS pagador, p.visit_id AS visita, p.order_id AS pedido, p.reverses_id AS revierte, p.reason AS motivo, u.name AS cajero FROM payments p LEFT JOIN users u ON u.id=p.created_by WHERE p.restaurant_id=$1 AND ($2::int IS NULL OR p.shift_id=$2) ORDER BY p.id`, [rid, shift]);
    else if (kind === 'ventas') rows = await all(db, `SELECT l.id, l.created_at AS fecha, l.visit_id AS visita, l.order_id AS pedido, l.name AS plato, l.qty AS cantidad, l.unit_price_cents/100.0 AS precio_unitario, (l.unit_price_cents*l.qty)/100.0 AS total, l.status AS estado, l.void_reason AS motivo_anulacion, l.unit_cost_cents/100.0 AS costo_unitario FROM order_lines l WHERE l.restaurant_id=$1 ORDER BY l.id`, [rid]);
    else if (kind === 'turnos') rows = await all(db, `SELECT id, status AS estado, opened_at AS apertura, closed_at AS cierre, opening_cents/100.0 AS fondo, expected_cents/100.0 AS esperado, counted_cents/100.0 AS contado, (counted_cents-expected_cents)/100.0 AS diferencia FROM cash_shifts WHERE restaurant_id=$1 ORDER BY id`, [rid]);
    else if (kind === 'movimientos') rows = await all(db, `SELECT m.id, m.shift_id AS turno, m.at AS fecha, m.kind AS tipo, m.amount_cents/100.0 AS importe, m.reason AS motivo, u.name AS responsable FROM cash_moves m LEFT JOIN users u ON u.id=m.created_by WHERE m.restaurant_id=$1 AND ($2::int IS NULL OR m.shift_id=$2) ORDER BY m.id`, [rid, shift]);
    else if (kind === 'pedidos') rows = await all(db, `SELECT number AS numero, channel AS canal, status AS estado, customer_name AS cliente, total_cents/100.0 AS total, slot AS franja, created_at AS fecha FROM orders WHERE restaurant_id=$1 ORDER BY id`, [rid]);
    else if (kind === 'auditoria') rows = await all(db, `SELECT a.at AS fecha, a.action AS accion, a.entity AS entidad, a.entity_id AS id, a.reason AS motivo, u.name AS usuario, z.name AS autorizo, a.data AS datos FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN users z ON z.id=a.authorized_by WHERE a.restaurant_id=$1 ORDER BY a.id`, [rid]);
    else throw notFound();
    return send(reply, toCsv(rows), `${kind}${shift ? '-turno' + shift : ''}.csv`);
  });

};
export default plugin;
