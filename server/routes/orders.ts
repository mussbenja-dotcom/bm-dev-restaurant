import type { FastifyPluginAsync } from 'fastify';
import { all, one, type Q } from '../db.ts';
import { audit, authorize, bad, conflict, emit, HttpError, lockRestaurant, need, newToken, notFound, opHash, optStr, reqInt, reqStr, TZ, type Ctx } from '../core.ts';
import { balance, createRound } from '../engine.ts';
import { bookReservation, quote } from './public.ts';

const FLOW: Record<string, string[]> = {
  aceptado: ['cancelado'], en_preparacion: [], listo: ['en_reparto', 'entregado'],
  en_reparto: ['entregado', 'no_entregado'], no_entregado: ['en_reparto', 'cancelado'],
};

async function finishDelivered(q: Q, rid: number, orderId: number) {
  const o = (await one(q, 'SELECT * FROM orders WHERE id=$1', [orderId]))!;
  // Sello de fidelidad por compra entregada, solo con adhesión explícita (independiente de reseñas).
  if (o.loyalty_opt_in && o.phone) await q.query('UPDATE customers SET stamps=stamps+1 WHERE restaurant_id=$1 AND phone=$2 AND opt_in', [rid, o.phone]);
  await q.query(`UPDATE order_lines SET qty_delivered=qty, status=CASE WHEN status='void' THEN status ELSE 'delivered' END WHERE order_id=$1`, [orderId]);
}

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;

  app.get('/api/orders', async (req: any) => {
    const a = need(req, 'cashier', 'pass');
    const active = req.query.scope !== 'all';
    const rows = await all(db, `SELECT o.*, z.name AS zone, u.name AS rider,
        coalesce((SELECT sum(amount_cents) FROM payments p WHERE p.order_id=o.id),0) AS paid
      FROM orders o LEFT JOIN delivery_zones z ON z.id=o.zone_id LEFT JOIN users u ON u.id=o.rider_id
      WHERE o.restaurant_id=$1 AND (NOT $2 OR o.status NOT IN ('entregado','rechazado','cancelado') OR o.updated_at > now() - interval '3 hours')
      ORDER BY CASE WHEN o.status IN ('recibido','solicitud') THEN 0 ELSE 1 END, o.slot NULLS LAST, o.id DESC LIMIT 200`, [a.restaurantId, active]);
    const s = (await one(db, 'SELECT settings FROM restaurants WHERE id=$1', [a.restaurantId]))!.settings;
    return { orders: rows.map(({ token, op_hash: _hash, ...o }) => ({ ...o, trackPath: `/pedido/${token}` })), pausedUntil: s.delivery_paused_until, settings: { takeaway: s.takeaway, delivery: s.delivery } };
  });

  // Aceptar genera una única comanda (índice único por pedido) y reserva las porciones.
  app.post('/api/orders/:id/accept', async (req: any) => {
    const a = need(req, 'cashier');
    const id = reqInt(req.params.id, 'pedido', 1);
    const eta = optStr(req.body?.eta, 40);
    const o = await db.transaction(async (tx) => {
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, a.restaurantId]);
      if (!o) throw notFound();
      if (!['recibido', 'solicitud'].includes(o.status)) throw conflict(`El pedido ya está ${o.status.replace('_', ' ')}`);
      const { lines } = await createRound(tx, ctx, a.restaurantId, { orderId: id }, `order-${id}-accept`, o.items, 'web', a.userId);
      // Lo confirmado al cliente conserva su precio aunque la carta o el happy hour hayan cambiado al aceptar (A06).
      const kept: unknown[] = [];
      for (const [i, l] of lines.entries()) {
        const it = o.items[i];
        if (it?.total == null || !it.qty || it.total % it.qty) continue;
        const unit = it.total / it.qty;
        if (unit !== l.unit_price_cents) { await tx.query('UPDATE order_lines SET unit_price_cents=$1 WHERE id=$2', [unit, l.id]); kept.push({ line: l.id, from: l.unit_price_cents, to: unit }); }
      }
      if (kept.length) await audit(tx, a.restaurantId, a.userId, 'order.price_kept', 'order', id, null, kept);
      await tx.query(`UPDATE orders SET status='aceptado', eta=$1, updated_at=now() WHERE id=$2`, [eta || null, id]);
      await audit(tx, a.restaurantId, a.userId, 'order.accept', 'order', id, null, { eta });
      return o;
    });
    emit(ctx, a.restaurantId, 'orders');
    return { ok: true, number: o.number };
  });

  app.post('/api/orders/:id/reject', async (req: any) => {
    const a = need(req, 'cashier');
    const id = reqInt(req.params.id, 'pedido', 1);
    const reason = reqStr(req.body?.reason, 'motivo', 200);
    if ((await one(db, 'SELECT coalesce(sum(amount_cents),0)::bigint AS n FROM payments WHERE order_id=$1 AND restaurant_id=$2', [id, a.restaurantId]))!.n > 0) throw conflict('El pedido tiene cobros: devolvelos desde Caja antes de rechazar');
    const o = await one(db, `UPDATE orders SET status='rechazado', reject_reason=$1, updated_at=now() WHERE id=$2 AND restaurant_id=$3 AND status IN ('recibido','solicitud') RETURNING id`, [reason, id, a.restaurantId]);
    if (!o) throw conflict('Solo se rechaza un pedido sin aceptar');
    await audit(db, a.restaurantId, a.userId, 'order.reject', 'order', id, reason);
    emit(ctx, a.restaurantId, 'orders');
    return { ok: true };
  });

  app.post('/api/orders/:id/eta', async (req: any) => {
    const a = need(req, 'cashier');
    await db.query('UPDATE orders SET eta=$1, updated_at=now() WHERE id=$2 AND restaurant_id=$3', [reqStr(req.body?.eta, 'estimado', 40), reqInt(req.params.id, 'pedido', 1), a.restaurantId]);
    emit(ctx, a.restaurantId, 'orders');
    return { ok: true };
  });

  app.post('/api/orders/:id/status', async (req: any) => {
    const a = need(req, 'cashier', 'pass');
    const id = reqInt(req.params.id, 'pedido', 1);
    const to = String(req.body?.status);
    await db.transaction(async (tx) => {
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, a.restaurantId]);
      if (!o) throw notFound();
      if (!(FLOW[o.status] ?? []).includes(to)) throw conflict(`No se puede pasar de ${o.status} a ${to}`);
      if (to === 'en_reparto' && (o.channel !== 'delivery' || !o.rider_id)) throw bad('Asigná un repartidor antes de despachar');
      if (to === 'cancelado') {
        const by = await authorize(tx, a, req.body?.supervisorPin);
        if (await one(tx, `SELECT 1 FROM order_lines WHERE order_id=$1 AND (status<>'pending' OR qty_ready>0) AND status<>'void'`, [id]) && o.status !== 'no_entregado') throw conflict('La cocina ya empezó: anulá las líneas indicando el destino');
        const paid = (await one(tx, 'SELECT coalesce(sum(amount_cents),0)::int AS n FROM payments WHERE order_id=$1', [id]))!.n;
        if (paid > 0) throw conflict('El pedido tiene cobros: devolvelos desde Caja antes de cancelar');
        // Igual que anular una línea: lo no preparado vuelve al stock; lo preparado (no entregado) queda como merma.
        for (const l of await all(tx, `SELECT * FROM order_lines WHERE order_id=$1 AND status NOT IN ('void','delivered')`, [id])) {
          const prepared = l.status !== 'pending' || l.qty_ready > 0;
          if (!prepared) {
            const p = await one(tx, 'UPDATE products SET available = available OR stock_qty = 0, stock_qty=stock_qty+$1 WHERE id=$2 AND stock_qty IS NOT NULL RETURNING id', [l.qty, l.product_id]);
            if (p) await tx.query('INSERT INTO stock_moves (restaurant_id, product_id, delta, reason, line_id, user_id) VALUES ($1,$2,$3,$4,$5,$6)', [a.restaurantId, l.product_id, l.qty, 'pedido cancelado', l.id, a.userId]);
          }
          for (const c of await all(tx, `SELECT ingredient_id, delta FROM inv_moves WHERE line_id=$1 AND kind='consumo'`, [l.id])) {
            if (prepared) await tx.query(`INSERT INTO inv_moves (restaurant_id, ingredient_id, delta, kind, reason, line_id, user_id) VALUES ($1,$2,0,'merma',$3,$4,$5)`, [a.restaurantId, c.ingredient_id, 'Pedido cancelado sin entregar', l.id, a.userId]);
            else {
              await tx.query(`INSERT INTO inv_moves (restaurant_id, ingredient_id, delta, kind, reason, line_id, user_id) VALUES ($1,$2,$3,'ajuste',$4,$5,$6)`, [a.restaurantId, c.ingredient_id, -c.delta, 'Pedido cancelado', l.id, a.userId]);
              await tx.query('UPDATE ingredients SET stock_qty=stock_qty+$1 WHERE id=$2', [-c.delta, c.ingredient_id]);
            }
          }
          await tx.query('DELETE FROM discounts WHERE line_id=$1', [l.id]);
          await tx.query(`UPDATE order_lines SET status='void', void_reason='pedido cancelado', updated_at=now() WHERE id=$1`, [l.id]);
        }
        await audit(tx, a.restaurantId, a.userId, 'order.cancel', 'order', id, reqStr(req.body?.reason, 'motivo', 200), null, by);
      }
      await tx.query('UPDATE orders SET status=$1, updated_at=now(), delivered_at=CASE WHEN $1=\'entregado\' THEN now() ELSE delivered_at END WHERE id=$2', [to, id]);
      if (to === 'entregado') await finishDelivered(tx, a.restaurantId, id);
      await audit(tx, a.restaurantId, a.userId, `order.${to}`, 'order', id);
    });
    emit(ctx, a.restaurantId, 'orders');
    emit(ctx, a.restaurantId, 'lines');
    return { ok: true };
  });

  app.post('/api/orders/:id/assign', async (req: any) => {
    const a = need(req, 'cashier');
    const id = reqInt(req.params.id, 'pedido', 1);
    const rider = reqInt(req.body?.riderId, 'repartidor', 1);
    if (!(await one(db, `SELECT 1 FROM memberships WHERE user_id=$1 AND restaurant_id=$2 AND active AND 'rider'=ANY(roles)`, [rider, a.restaurantId]))) throw bad('Esa persona no es repartidora del local');
    const o = await one(db, `UPDATE orders SET rider_id=$1, eta=coalesce(nullif($2,''), eta), updated_at=now() WHERE id=$3 AND restaurant_id=$4 AND channel='delivery' AND status NOT IN ('entregado','rechazado','cancelado') RETURNING id`, [rider, optStr(req.body?.eta, 40), id, a.restaurantId]);
    if (!o) throw conflict('No se puede asignar este pedido');
    await audit(db, a.restaurantId, a.userId, 'order.assign', 'order', id, null, { rider });
    emit(ctx, a.restaurantId, 'orders');
    return { ok: true };
  });

  // Mostrador o teléfono: mismo flujo, entra aceptado con su comanda.
  app.post('/api/orders', async (req: any) => {
    const a = need(req, 'cashier');
    const b = req.body ?? {};
    const r = (await one(db, 'SELECT id, settings FROM restaurants WHERE id=$1', [a.restaurantId]))!;
    const counter = b.channel === 'mostrador';
    const opId = String(b.opId ?? '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(opId)) throw bad('Identificador de operación inválido');
    const o = await db.transaction(async (tx) => {
      await lockRestaurant(tx, a.restaurantId);
      const prev = await one(tx, 'SELECT * FROM orders WHERE restaurant_id=$1 AND op_id=$2', [a.restaurantId, opId]);
      if (prev) return prev;
      // Para mostrador se cotiza como retiro (sin envío) aunque el canal web esté deshabilitado.
      const q = await quote(tx, { ...r, settings: { ...r.settings, takeaway: true, delivery: r.settings.delivery || b.channel === 'delivery', delivery_paused_until: null } }, { ...b, channel: counter ? 'retiro' : b.channel });
      const number = (await one(tx, 'SELECT coalesce(max(number),0)+1 AS n FROM orders WHERE restaurant_id=$1', [a.restaurantId]))!.n;
      const o = (await one(tx, `INSERT INTO orders (restaurant_id, number, channel, status, customer_name, phone, address, address_notes, zone_id, slot, fee_cents, items, subtotal_cents, total_cents, notes, token, op_id, op_hash)
        VALUES ($1,$2,$3,'aceptado',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [a.restaurantId, number, counter ? 'mostrador' : q.channel, reqStr(b.name, 'nombre o número de retiro', 60), optStr(b.phone, 30), optStr(b.address, 160), optStr(b.addressNotes, 200), q.zone?.id ?? null, b.slot || null, q.fee, JSON.stringify(b.items.map((it: any, i: number) => ({ ...it, label: q.lines[i].name, total: q.lines[i].total }))), q.subtotal, q.total, optStr(b.notes, 300), newToken(18), opId, opHash(b)]))!;
      await createRound(tx, ctx, a.restaurantId, { orderId: o.id }, `order-${o.id}-accept`, b.items, 'counter', a.userId);
      await audit(tx, a.restaurantId, a.userId, 'order.counter', 'order', o.id);
      return o;
    });
    emit(ctx, a.restaurantId, 'orders');
    return { id: o.id, number: o.number, trackPath: `/pedido/${o.token}`, total: o.total_cents };
  });

  app.get('/api/orders/:id', async (req: any) => {
    const a = need(req, 'cashier', 'pass');
    const id = reqInt(req.params.id, 'pedido', 1);
    const o = await one(db, 'SELECT o.*, z.name AS zone FROM orders o LEFT JOIN delivery_zones z ON z.id=o.zone_id WHERE o.id=$1 AND o.restaurant_id=$2', [id, a.restaurantId]);
    if (!o) throw notFound();
    const [lines, payments] = await Promise.all([
      all(db, 'SELECT * FROM order_lines WHERE order_id=$1 ORDER BY id', [id]),
      all(db, 'SELECT * FROM payments WHERE order_id=$1 ORDER BY id', [id]),
    ]);
    const { op_hash: _hash, ...rest } = o;
    return { order: { ...rest, trackPath: `/pedido/${o.token}` }, lines, payments, balance: await balance(db, a.restaurantId, { orderId: id }) };
  });

  app.get('/api/riders', async (req) => {
    const a = need(req, 'cashier');
    return all(db, `SELECT u.id, u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=$1 AND m.active AND 'rider'=ANY(m.roles) ORDER BY u.name`, [a.restaurantId]);
  });

  // ---------- Repartidor ----------
  // Descarga solo lo necesario para entregar: sin historial ni datos de otros pedidos.
  app.get('/api/rider/deliveries', async (req) => {
    const a = need(req, 'rider');
    return all(db, `SELECT o.id, o.number, o.status, o.customer_name, o.phone, o.address, o.address_notes, z.name AS zone, o.total_cents,
        o.total_cents - coalesce((SELECT sum(amount_cents) FROM payments p WHERE p.order_id=o.id),0) AS to_collect, o.eta, o.notes, o.updated_at
      FROM orders o LEFT JOIN delivery_zones z ON z.id=o.zone_id WHERE o.restaurant_id=$1 AND o.rider_id=$2 AND o.status IN ('listo','en_reparto') ORDER BY o.id`, [a.restaurantId, a.userId]);
  });

  // Sincronización offline: cada cambio se aplica una vez (rider_ops) validando asignación y estado.
  app.post('/api/rider/sync', async (req: any) => {
    const a = need(req, 'rider');
    const changes = Array.isArray(req.body?.changes) ? req.body.changes.slice(0, 50) : [];
    const results = [];
    for (const c of changes) {
      const opId = String(c.opId ?? '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(opId)) { results.push({ opId, ok: false, error: 'operación inválida' }); continue; }
      // Un cambio inválido (ej. efectivo mal tipeado) no se aplica ni se descarta: vuelve con el error y queda en la cola del teléfono para corregirlo; el resto del lote sigue.
      const r = await db.transaction(async (tx) => {
        const prev = await one(tx, 'SELECT result FROM rider_ops WHERE restaurant_id=$1 AND op_id=$2', [a.restaurantId, opId]);
        if (prev) return { ...prev.result, duplicate: true };
        const id = reqInt(c.orderId, 'pedido', 1);
        const result = c.result === 'entregado' ? 'entregado' : 'no_entregado';
        const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, a.restaurantId]);
        let out;
        if (!o || o.rider_id !== a.userId || !['en_reparto', 'listo'].includes(o.status)) {
          const why = !o ? 'pedido inexistente' : o.rider_id !== a.userId ? 'el pedido fue reasignado' : `el pedido está ${o.status}`;
          await audit(tx, a.restaurantId, a.userId, 'rider.conflict', 'order', id, `Pedido #${o?.number ?? id}: ${why}. Resultado declarado: ${result}`, c);
          out = { opId, ok: false, conflict: true, error: why, orderId: id };
        } else {
          const cash = c.cashDeclaredCents == null ? null : reqInt(c.cashDeclaredCents, 'efectivo declarado', 0, 1e11);
          await tx.query(`UPDATE orders SET status=$1, cash_declared_cents=$2, delivered_at=CASE WHEN $1='entregado' THEN least(now(), greatest(coalesce($3::timestamptz, now()), now() - interval '24 hours')) END, updated_at=now() WHERE id=$4`, [result, cash, c.at ?? null, id]);
          if (result === 'entregado') await finishDelivered(tx, a.restaurantId, id);
          await audit(tx, a.restaurantId, a.userId, `rider.${result}`, 'order', id, optStr(c.note, 200) || null, { cash, at: c.at });
          out = { opId, ok: true, orderId: id, status: result };
        }
        await tx.query('INSERT INTO rider_ops (restaurant_id, op_id, order_id, result) VALUES ($1,$2,$3,$4)', [a.restaurantId, opId, id, JSON.stringify(out)]);
        return out;
      }).catch((e: any) => { if (e instanceof HttpError && e.status < 500) return { opId, ok: false, error: e.message, orderId: c.orderId }; throw e; });
      results.push(r);
    }
    emit(ctx, a.restaurantId, 'orders');
    return { results };
  });

  // ---------- Reservas (personal) ----------
  app.get('/api/reservations', async (req: any) => {
    const a = need(req, 'reservations', 'waiter');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date)) ? String(req.query.date) : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    const rows = await all(db, `SELECT x.*, t.number AS table_number FROM reservations x LEFT JOIN tables t ON t.id=x.table_id
      WHERE x.restaurant_id=$1 AND (x.slot AT TIME ZONE '${TZ}')::date = $2::date ORDER BY x.slot, x.id`, [a.restaurantId, day]);
    const s = (await one(db, 'SELECT settings FROM restaurants WHERE id=$1', [a.restaurantId]))!.settings.reservations ?? {};
    return { day, reservations: rows.map(({ token: _token, ...x }) => x), config: s };
  });

  app.post('/api/reservations', async (req: any) => {
    const a = need(req, 'reservations');
    const r = (await one(db, 'SELECT id, settings FROM restaurants WHERE id=$1', [a.restaurantId]))!;
    const x = await db.transaction((tx) => bookReservation(tx, r, req.body ?? {}));
    await audit(db, a.restaurantId, a.userId, 'reservation.create', 'reservation', x.id);
    emit(ctx, a.restaurantId, 'reservations');
    return x;
  });

  app.post('/api/reservations/:id/status', async (req: any) => {
    const a = need(req, 'reservations', 'waiter');
    const id = reqInt(req.params.id, 'reserva', 1);
    const to = String(req.body?.status);
    if (!['confirmada', 'cancelada', 'ausente'].includes(to)) throw bad('Estado inválido');
    await db.transaction(async (tx) => {
      await lockRestaurant(tx, a.restaurantId);
      const x = await one(tx, 'SELECT * FROM reservations WHERE id=$1 AND restaurant_id=$2', [id, a.restaurantId]);
      if (!x) throw notFound();
      if (to === 'confirmada' && x.status === 'espera') {
        const cfg = (await one(tx, 'SELECT settings FROM restaurants WHERE id=$1', [a.restaurantId]))!.settings.reservations ?? {};
        const used = (await one(tx, `SELECT coalesce(sum(party),0)::int AS n FROM reservations WHERE restaurant_id=$1 AND slot=$2 AND status IN ('confirmada','sentada')`, [a.restaurantId, x.slot]))!.n;
        if (used + x.party > (cfg.capacity ?? 24)) throw conflict('Todavía no hay lugar en ese horario');
      }
      await tx.query('UPDATE reservations SET status=$1 WHERE id=$2', [to, id]);
      await audit(tx, a.restaurantId, a.userId, `reservation.${to}`, 'reservation', id);
    });
    emit(ctx, a.restaurantId, 'reservations');
    return { ok: true };
  });

};
export default plugin;
