import type { FastifyPluginAsync } from 'fastify';
import { randomInt } from 'node:crypto';
import { all, one, type Q, type Row } from '../db.ts';
import { audit, auth, authorize, bad, conflict, emit, forbidden, HttpError, isBoss, loadAuth, need, notFound, optStr, reqInt, reqOp, reqStr, sseSlot, eventFor, stationScope, type Ctx } from '../core.ts';
import { balance, createRound, requireVisit } from '../engine.ts';
import { createTicket } from './cash.ts';

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;

  // Eventos en vivo (SSE) del local de la sesión. Solo mientras la pantalla está abierta.
  app.get('/api/events', async (req, reply) => {
    const a = auth(req);
    if (!a.restaurantId) throw forbidden();
    let mine = await stationScope(db, a);
    const release = sseSlot(`staff|${a.userId}`, 12);
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.write('retry: 2000\n\n');
    // Filtrado en el servidor por local, rol, estación y destinatario (ver eventFor).
    // Revisa la sesión: si la revocaron o cambiaron sus roles, se corta y el navegador reconecta con los permisos nuevos.
    // Corre en cada ping y al instante cuando alguien revoca sesiones o cambia permisos (evento interno __session).
    let closed = false;
    const verify = async () => {
      try {
        const still = await loadAuth(db, req.cookies.sid);
        if (closed) return false;
        if (still?.restaurantId !== a.restaurantId || still.roles.join() !== a.roles.join()) throw new Error('sesión cambiada');
        mine = await stationScope(db, a); // las estaciones del local pudieron cambiar
        return true;
      } catch {
        // Sesión revocada o base no disponible: se corta y el navegador reconecta solo (retry: 2000).
        if (!closed) { cleanup(); reply.raw.end(); }
        return false;
      }
    };
    const on = (ev: any) => {
      if (ev.type === '__session') { if ((ev.userId == null || ev.userId === a.userId) && (ev.sessionRid == null || ev.sessionRid === a.restaurantId)) void verify(); return; }
      if (eventFor(a, ev, mine)) { const { rid: _rid, toUser: _to, ...out } = ev; reply.raw.write(`data: ${JSON.stringify(out)}\n\n`); }
    };
    const ping = setInterval(async () => { if (await verify()) reply.raw.write(': ping\n\n'); }, 20_000);
    const cleanup = () => { if (closed) return; closed = true; clearInterval(ping); ctx.bus.off('ev', on); release(); };
    ctx.bus.on('ev', on);
    req.raw.on('close', cleanup);
  });

  // ---------- Salón ----------
  app.get('/api/floor', async (req) => {
    const a = need(req, 'waiter', 'cashier', 'reservations', 'pass');
    const onlyMine = !isBoss(a) && !a.roles.includes('all_tables') && !a.roles.includes('cashier') && a.roles.includes('waiter');
    const tables = await all(db, `SELECT t.id, t.number, t.area, t.seats, t.needs_cleaning, vt.visit_id
      FROM tables t LEFT JOIN visit_tables vt ON vt.table_id=t.id AND vt.released_at IS NULL WHERE t.restaurant_id=$1 AND t.active ORDER BY t.area, length(t.number), t.number`, [a.restaurantId]);
    const rows = await all(db, `SELECT v.id, v.guests, v.opened_at, v.waiter_id, v.qr_enabled, u.name AS waiter,
      (SELECT count(*)::int FROM order_lines l WHERE l.visit_id=v.id AND l.status='ready' AND l.qty_delivered < l.qty_ready) AS ready_count,
      (SELECT count(*)::int FROM order_lines l WHERE l.visit_id=v.id AND l.status IN ('pending','preparing')) AS cooking_count,
      (SELECT max(created_at) FROM rounds r WHERE r.visit_id=v.id) AS last_round_at
      FROM visits v LEFT JOIN users u ON u.id=v.waiter_id WHERE v.restaurant_id=$1 AND v.status='open'`, [a.restaurantId]);
    // Saldo y pagado con el mismo cálculo que caja, precuenta y ticket (descuentos con tope incluidos).
    const visits = await Promise.all(rows.map(async (v) => { const b = await balance(db, a.restaurantId, { visitId: v.id }); return { ...v, total: b.total, paid: b.paid, due: b.due } as Row; }));
    const calls = await all(db, `SELECT c.*, (SELECT string_agg(t.number, '+') FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.visit_id=c.visit_id AND vt.released_at IS NULL) AS tables
      FROM calls c WHERE c.restaurant_id=$1 AND c.status<>'closed' ORDER BY c.created_at`, [a.restaurantId]);
    const reservations = await all(db, `SELECT id, name, party, slot, table_id, status FROM reservations WHERE restaurant_id=$1 AND status='confirmada' AND slot BETWEEN now() - interval '30 minutes' AND now() + interval '4 hours' ORDER BY slot`, [a.restaurantId]);
    const vis = onlyMine ? visits.filter((v) => v.waiter_id === a.userId) : visits;
    return { tables, visits: vis, calls: onlyMine ? calls.filter((c) => vis.some((v) => v.id === c.visit_id)) : calls, reservations, onlyMine };
  });

  app.post('/api/visits', async (req: any) => {
    const a = need(req, 'waiter', 'reservations');
    const tableId = reqInt(req.body?.tableId, 'mesa', 1);
    const guests = reqInt(req.body?.guests ?? 2, 'personas', 1, 60);
    // El mozo que abre queda a cargo. Dueño o encargado: mozo opcional (sin mozo, los avisos le llegan a ellos).
    const waiterId = !isBoss(a) ? (a.roles.includes('waiter') ? a.userId : null) : req.body?.waiterId == null || req.body.waiterId === '' ? null : reqInt(req.body.waiterId, 'mozo', 1);
    const v = await db.transaction(async (tx) => {
      if (isBoss(a) && waiterId !== null) await requireWaiter(tx, waiterId, a.restaurantId);
      const t = await one(tx, 'SELECT id FROM tables WHERE id=$1 AND restaurant_id=$2 AND active', [tableId, a.restaurantId]);
      if (!t) throw notFound();
      if (await one(tx, 'SELECT 1 FROM visit_tables WHERE table_id=$1 AND released_at IS NULL', [tableId])) throw conflict('La mesa ya está abierta');
      // Código temporal para que los comensales habiliten llamados o pedidos desde el QR durante esta visita.
      const v = (await one(tx, 'INSERT INTO visits (restaurant_id, waiter_id, guests, access_code) VALUES ($1,$2,$3,$4) RETURNING *', [a.restaurantId, waiterId, guests, String(randomInt(100000, 1000000))]))!;
      await tx.query('INSERT INTO visit_tables (restaurant_id, visit_id, table_id) VALUES ($1,$2,$3)', [a.restaurantId, v.id, tableId]);
      await tx.query('UPDATE tables SET needs_cleaning=false WHERE id=$1', [tableId]);
      if (req.body?.reservationId) await tx.query(`UPDATE reservations SET status='sentada', visit_id=$1, table_id=$2 WHERE id=$3 AND restaurant_id=$4`, [v.id, tableId, reqInt(req.body.reservationId, 'reserva', 1), a.restaurantId]);
      await audit(tx, a.restaurantId, a.userId, 'visit.open', 'visit', v.id, null, { tableId, guests, waiterId });
      return v;
    });
    emit(ctx, a.restaurantId, 'floor');
    return v;
  });

  app.get('/api/visits/:id', async (req: any) => {
    const a = need(req, 'waiter', 'cashier', 'pass');
    const v = await requireVisit(db, a.restaurantId, req.params.id);
    const [tables, rounds, lines, payments, discounts, calls, history] = await Promise.all([
      all(db, 'SELECT t.id, t.number, t.area FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.visit_id=$1 AND vt.released_at IS NULL', [v.id]),
      all(db, 'SELECT r.*, u.name AS by_name FROM rounds r LEFT JOIN users u ON u.id=r.created_by WHERE r.visit_id=$1 ORDER BY r.id', [v.id]),
      all(db, `SELECT l.*, s.name AS station, s.kind AS station_kind FROM order_lines l JOIN stations s ON s.id=l.station_id WHERE l.visit_id=$1 ORDER BY l.id`, [v.id]),
      all(db, 'SELECT p.*, u.name AS by_name FROM payments p LEFT JOIN users u ON u.id=p.created_by WHERE p.visit_id=$1 ORDER BY p.id', [v.id]),
      all(db, 'SELECT d.*, u.name AS by_name FROM discounts d LEFT JOIN users u ON u.id=d.authorized_by WHERE d.visit_id=$1 ORDER BY d.id', [v.id]),
      all(db, `SELECT * FROM calls WHERE visit_id=$1 AND status<>'closed'`, [v.id]),
      all(db, `SELECT a.action, a.reason, a.data, a.at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.restaurant_id=$1 AND a.entity='visit' AND a.entity_id=$2 ORDER BY a.id`, [a.restaurantId, String(v.id)]),
    ]);
    const { access_code, ...visit } = v;
    const mayEnable = isBoss(a) || a.roles.includes('all_tables') || v.waiter_id === a.userId;
    return { visit: { ...visit, ...(mayEnable && v.qr_enabled ? { access_code } : {}) }, tables, rounds, lines, payments, discounts, calls, history, balance: await balance(db, a.restaurantId, { visitId: v.id }) };
  });

  // Enviar ronda (idempotente por opId). Revalida precio y disponibilidad en el servidor.
  app.post('/api/visits/:id/rounds', async (req: any) => {
    const a = need(req, 'waiter');
    const visitId = reqInt(req.params.id, 'visita', 1);
    const opId = reqOp(req.body?.opId);
    const r = await db.transaction((tx) => createRound(tx, ctx, a.restaurantId, { visitId }, opId, req.body?.items, 'staff', a.userId));
    return { round: r.round, lines: r.lines, duplicate: r.duplicate };
  });

  // Consultar el resultado de un envío cuya confirmación se perdió.
  app.get('/api/rounds/by-op/:opId', async (req: any) => {
    const a = need(req, 'waiter');
    const r = await one(db, 'SELECT * FROM rounds WHERE restaurant_id=$1 AND op_id=$2', [a.restaurantId, String(req.params.opId)]);
    return { found: !!r, round: r ?? null };
  });

  app.post('/api/visits/:id/guests', async (req: any) => {
    const a = need(req, 'waiter');
    const v = await one(db, `UPDATE visits SET guests=$1 WHERE id=$2 AND restaurant_id=$3 AND status='open' RETURNING id`, [reqInt(req.body?.guests, 'personas', 1, 60), reqInt(req.params.id, 'visita', 1), a.restaurantId]);
    if (!v) throw notFound();
    emit(ctx, a.restaurantId, 'floor');
    return { ok: true };
  });

  // Pedidos por QR de esta visita: el mozo a cargo (o quien ve todas las mesas) los habilita y recibe un código nuevo.
  // Deshabilitar renueva el código y revoca los celulares ya autorizados; el QR sigue mostrando la carta.
  app.post('/api/visits/:id/qr', async (req: any) => {
    const a = need(req, 'waiter');
    const vid = reqInt(req.params.id, 'visita', 1);
    const enabled = req.body?.enabled === true;
    const res = await db.transaction(async (tx) => {
      const v = await one(tx, `SELECT v.*, r.settings->>'mode' AS mode FROM visits v JOIN restaurants r ON r.id=v.restaurant_id WHERE v.id=$1 AND v.restaurant_id=$2 AND v.status='open' FOR UPDATE OF v`, [vid, a.restaurantId]);
      if (!v) throw notFound();
      if (!isBoss(a) && !a.roles.includes('all_tables') && v.waiter_id !== a.userId) throw new HttpError(403, 'Solo el mozo a cargo de la mesa puede habilitar o cortar los pedidos por QR');
      if (enabled && v.mode === 'menu') throw conflict('Este local usa el QR solo para mostrar la carta. Se cambia en Configuración.');
      const code = String(randomInt(100000, 1000000));
      await tx.query('UPDATE visits SET qr_enabled=$1, qr_enabled_at=CASE WHEN $1 THEN now() ELSE NULL END, access_code=$2 WHERE id=$3', [enabled, code, vid]);
      if (!enabled) await tx.query('DELETE FROM diner_sessions WHERE visit_id=$1', [vid]);
      await audit(tx, a.restaurantId, a.userId, enabled ? 'visit.qr_on' : 'visit.qr_off', 'visit', vid);
      return { enabled, code: enabled ? code : null };
    });
    emit(ctx, a.restaurantId, 'floor');
    emit(ctx, a.restaurantId, 'diner'); // los celulares de la mesa actualizan si pueden enviar
    return res;
  });

  // Mozos activos, para traspasar mesas.
  app.get('/api/staff/waiters', async (req) => {
    const a = need(req, 'all_tables');
    return all(db, `SELECT u.id, u.name FROM memberships m JOIN users u ON u.id=m.user_id AND u.active WHERE m.restaurant_id=$1 AND m.active AND 'waiter'=ANY(m.roles) ORDER BY u.name`, [a.restaurantId]);
  });

  // Traspasar la atención a otro mozo (cambio de turno).
  app.post('/api/visits/:id/waiter', async (req: any) => {
    const a = need(req, 'all_tables');
    const uid = reqInt(req.body?.userId, 'mozo', 1);
    await requireWaiter(db, uid, a.restaurantId);
    if (!(await one(db, `UPDATE visits SET waiter_id=$1 WHERE id=$2 AND restaurant_id=$3 AND status='open' RETURNING id`, [uid, reqInt(req.params.id, 'visita', 1), a.restaurantId]))) throw notFound();
    await audit(db, a.restaurantId, a.userId, 'visit.transfer', 'visit', req.params.id, null, { to: uid });
    emit(ctx, a.restaurantId, 'floor');
    return { ok: true };
  });

  // Mover la visita a otra mesa libre: consumos y pagos siguen en la misma visita.
  app.post('/api/visits/:id/move', async (req: any) => {
    const a = need(req, 'waiter');
    const vid = reqInt(req.params.id, 'visita', 1);
    const from = reqInt(req.body?.fromTableId, 'mesa de origen', 1);
    const to = reqInt(req.body?.toTableId, 'mesa de destino', 1);
    await db.transaction(async (tx) => {
      await requireOpen(tx, a.restaurantId, vid);
      if (!(await one(tx, 'SELECT 1 FROM tables WHERE id=$1 AND restaurant_id=$2 AND active', [to, a.restaurantId]))) throw notFound();
      if (await one(tx, 'SELECT 1 FROM visit_tables WHERE table_id=$1 AND released_at IS NULL', [to])) throw conflict('La mesa de destino está ocupada. Usá "Unir".');
      const r = await one(tx, 'UPDATE visit_tables SET released_at=now() WHERE visit_id=$1 AND table_id=$2 AND released_at IS NULL RETURNING id', [vid, from]);
      if (!r) throw bad('La visita no está en esa mesa');
      await tx.query('INSERT INTO visit_tables (restaurant_id, visit_id, table_id) VALUES ($1,$2,$3)', [a.restaurantId, vid, to]);
      await tx.query('UPDATE tables SET needs_cleaning=true WHERE id=$1', [from]);
      await audit(tx, a.restaurantId, a.userId, 'visit.move', 'visit', vid, null, { from, to });
    });
    emit(ctx, a.restaurantId, 'floor');
    return { ok: true };
  });

  // Unir: la visita origen pasa todo (mesas, consumos, pagos, descuentos, avisos) a la destino.
  app.post('/api/visits/:id/merge', async (req: any) => {
    const a = need(req, 'waiter');
    const into = reqInt(req.params.id, 'visita', 1);
    const src = reqInt(req.body?.visitId, 'visita a unir', 1);
    if (src === into) throw bad('Elegí otra mesa');
    await db.transaction(async (tx) => {
      await requireOpen(tx, a.restaurantId, into);
      await requireOpen(tx, a.restaurantId, src);
      const before = await balance(tx, a.restaurantId, { visitId: src });
      for (const t of ['order_lines', 'payments', 'discounts', 'rounds']) await tx.query(`UPDATE ${t} SET visit_id=$1 WHERE visit_id=$2 AND restaurant_id=$3`, [into, src, a.restaurantId]);
      await tx.query(`UPDATE calls SET status='closed' WHERE visit_id=$1`, [src]);
      const tabs = await all(tx, 'UPDATE visit_tables SET released_at=now() WHERE visit_id=$1 AND released_at IS NULL RETURNING table_id', [src]);
      for (const t of tabs) await tx.query('INSERT INTO visit_tables (restaurant_id, visit_id, table_id) VALUES ($1,$2,$3)', [a.restaurantId, into, t.table_id]);
      await tx.query(`UPDATE visits SET status='closed', closed_at=now() WHERE id=$1`, [src]);
      await tx.query('DELETE FROM diner_sessions WHERE visit_id=$1', [src]);
      await audit(tx, a.restaurantId, a.userId, 'visit.merge', 'visit', into, null, { from: src, paidMoved: before.paid, dueMoved: before.due });
      await audit(tx, a.restaurantId, a.userId, 'visit.merged_into', 'visit', src, null, { into });
    });
    emit(ctx, a.restaurantId, 'floor');
    return { ok: true };
  });

  // Separar: líneas elegidas pasan a una visita nueva en otra mesa libre. Los pagos quedan en la original.
  app.post('/api/visits/:id/split', async (req: any) => {
    const a = need(req, 'waiter');
    const vid = reqInt(req.params.id, 'visita', 1);
    const to = reqInt(req.body?.toTableId, 'mesa', 1);
    const ids = (Array.isArray(req.body?.lineIds) ? req.body.lineIds : []).map((x: unknown) => reqInt(x, 'línea', 1));
    if (!ids.length) throw bad('Elegí qué consumos separar');
    let stations: number[] = []; // solo se avisa a las estaciones de lo que se movió
    const nv = await db.transaction(async (tx) => {
      const v = await requireOpen(tx, a.restaurantId, vid);
      if (await one(tx, 'SELECT 1 FROM visit_tables WHERE table_id=$1 AND released_at IS NULL', [to])) throw conflict('La mesa de destino está ocupada');
      if (!(await one(tx, 'SELECT 1 FROM tables WHERE id=$1 AND restaurant_id=$2', [to, a.restaurantId]))) throw notFound();
      const nv = (await one(tx, 'INSERT INTO visits (restaurant_id, waiter_id, guests, access_code) VALUES ($1,$2,1,$3) RETURNING *', [a.restaurantId, v.waiter_id, String(randomInt(100000, 1000000))]))!;
      await tx.query('INSERT INTO visit_tables (restaurant_id, visit_id, table_id) VALUES ($1,$2,$3)', [a.restaurantId, nv.id, to]);
      const moved = await all(tx, 'UPDATE order_lines SET visit_id=$1 WHERE visit_id=$2 AND id = ANY($3::int[]) RETURNING id, station_id', [nv.id, vid, ids]);
      if (moved.length !== new Set(ids).size) throw conflict('Algún consumo no pertenece a esta mesa');
      stations = [...new Set(moved.map((m) => m.station_id))];
      await tx.query('UPDATE discounts SET visit_id=$1 WHERE visit_id=$2 AND line_id = ANY($3::int[])', [nv.id, vid, ids]);
      const b = await balance(tx, a.restaurantId, { visitId: vid });
      if (b.due < 0) throw conflict('No se pueden separar consumos que ya están pagados');
      await audit(tx, a.restaurantId, a.userId, 'visit.split', 'visit', vid, null, { to: nv.id, lines: moved.map((m) => m.id) });
      await audit(tx, a.restaurantId, a.userId, 'visit.split_from', 'visit', nv.id, null, { from: vid });
      return nv;
    });
    emit(ctx, a.restaurantId, 'floor');
    emit(ctx, a.restaurantId, 'lines', { visitId: nv.id, stations });
    return nv;
  });

  // Cerrar mesa: solo con saldo cero, comprobado dentro de la misma transacción. Genera el ticket interno X.
  app.post('/api/visits/:id/close', async (req: any) => {
    const a = need(req, 'cashier', 'waiter');
    const vid = reqInt(req.params.id, 'visita', 1);
    const ticket = await db.transaction(async (tx) => {
      await requireOpen(tx, a.restaurantId, vid);
      const b = await balance(tx, a.restaurantId, { visitId: vid });
      if (b.due !== 0) throw conflict(b.due > 0 ? `Falta cobrar ${(b.due / 100).toFixed(2)}` : 'Los pagos superan el total; revisá antes de cerrar', { balance: b });
      const t = await createTicket(tx, a.restaurantId, 'x', { visitId: vid }, a.userId);
      const tabs = await all(tx, 'UPDATE visit_tables SET released_at=now() WHERE visit_id=$1 AND released_at IS NULL RETURNING table_id', [vid]);
      await tx.query('UPDATE tables SET needs_cleaning=true WHERE id = ANY($1::int[])', [tabs.map((t) => t.table_id)]);
      await tx.query(`UPDATE visits SET status='closed', closed_at=now(), qr_enabled=false, access_code=$2 WHERE id=$1`, [vid, String(randomInt(100000, 1000000))]);
      await tx.query(`UPDATE calls SET status='closed' WHERE visit_id=$1`, [vid]);
      // El acceso de los comensales de esta visita vence al cerrar.
      await tx.query('DELETE FROM diner_sessions WHERE visit_id=$1', [vid]);
      await audit(tx, a.restaurantId, a.userId, 'visit.close', 'visit', vid, null, { total: b.total, ticket: t.number });
      return t;
    });
    emit(ctx, a.restaurantId, 'floor');
    emit(ctx, a.restaurantId, 'diner');
    return { ticket };
  });

  app.post('/api/visits/:id/reopen', async (req: any) => {
    const a = need(req, 'cashier');
    const vid = reqInt(req.params.id, 'visita', 1);
    const reason = reqStr(req.body?.reason, 'motivo', 300);
    await db.transaction(async (tx) => {
      const by = await authorize(tx, a, req.body?.supervisorPin);
      const v = await one(tx, `SELECT * FROM visits WHERE id=$1 AND restaurant_id=$2 AND status='closed'`, [vid, a.restaurantId]);
      if (!v) throw conflict('La visita no está cerrada');
      const last = await one(tx, 'SELECT table_id FROM visit_tables WHERE visit_id=$1 ORDER BY released_at DESC NULLS LAST LIMIT 1', [vid]);
      if (last && await one(tx, 'SELECT 1 FROM visit_tables WHERE table_id=$1 AND released_at IS NULL', [last.table_id])) throw conflict('La mesa ya tiene otra visita abierta');
      await tx.query(`UPDATE visits SET status='open', closed_at=NULL WHERE id=$1`, [vid]);
      if (last) await tx.query('INSERT INTO visit_tables (restaurant_id, visit_id, table_id) VALUES ($1,$2,$3)', [a.restaurantId, vid, last.table_id]);
      await audit(tx, a.restaurantId, a.userId, 'visit.reopen', 'visit', vid, reason, null, by);
    });
    emit(ctx, a.restaurantId, 'floor');
    return { ok: true };
  });

  app.post('/api/tables/:id/clean', async (req: any) => {
    const a = need(req, 'waiter');
    await db.query('UPDATE tables SET needs_cleaning=false WHERE id=$1 AND restaurant_id=$2', [reqInt(req.params.id, 'mesa', 1), a.restaurantId]);
    emit(ctx, a.restaurantId, 'floor');
    return { ok: true };
  });

  // ---------- Avisos de mesa ----------
  app.post('/api/calls/:id', async (req: any) => {
    const a = need(req, 'waiter', 'cashier');
    const status = req.body?.status === 'closed' ? 'closed' : 'ack';
    const c = await one(db, `UPDATE calls SET status=$1, ack_by=coalesce(ack_by,$2), ack_at=coalesce(ack_at, now()) WHERE id=$3 AND restaurant_id=$4 RETURNING *`, [status, a.userId, reqInt(req.params.id, 'aviso', 1), a.restaurantId]);
    if (!c) throw notFound();
    emit(ctx, a.restaurantId, 'floor');
    emit(ctx, a.restaurantId, 'diner', { visitId: c.visit_id });
    return c;
  });
  // El mozo marca "pidió la cuenta" a mano.
  app.post('/api/visits/:id/bill-request', async (req: any) => {
    const a = need(req, 'waiter');
    const vid = reqInt(req.params.id, 'visita', 1);
    await requireOpen(db, a.restaurantId, vid);
    await db.query(`INSERT INTO calls (restaurant_id, visit_id, reason, status, ack_by, ack_at) VALUES ($1,$2,'cuenta','ack',$3,now()) ON CONFLICT (visit_id, reason) WHERE status <> 'closed' DO NOTHING`, [a.restaurantId, vid, a.userId]);
    emit(ctx, a.restaurantId, 'floor');
    return { ok: true };
  });

  // ---------- Estaciones (cocina, barra) y pase ----------
  app.get('/api/kds', async (req: any) => {
    const a = need(req, 'kitchen', 'bar', 'pass', 'waiter');
    const station = req.query.station ? reqInt(req.query.station, 'estación', 1) : null;
    const own = [...(a.roles.includes('kitchen') ? ['kitchen'] : []), ...(a.roles.includes('bar') ? ['bar'] : [])];
    // La vista de estación muestra solo el sector propio aunque la persona también tenga pase.
    const kinds = req.query.view === 'station' && own.length ? own : isBoss(a) || a.roles.includes('pass') ? ['kitchen', 'bar'] : own;
    if (!kinds.length) throw forbidden();
    const lines = await all(db, `SELECT l.id, l.round_id, l.visit_id, l.order_id, l.station_id, l.name, l.qty, l.qty_ready, l.qty_delivered, l.options, l.note, l.seat, l.status, l.course, l.held,
        l.change_note, l.change_ack, l.created_at, l.updated_at, r.number AS round_number, r.source, u.name AS by_name, s.name AS station, s.kind AS station_kind, s.delay_minutes, p.prep_minutes,
        (SELECT string_agg(t.number, '+') FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.visit_id=l.visit_id AND (vt.released_at IS NULL OR NOT EXISTS (SELECT 1 FROM visit_tables v2 WHERE v2.visit_id=l.visit_id AND v2.released_at IS NULL))) AS tables,
        (SELECT vv.status FROM visits vv WHERE vv.id=l.visit_id) AS visit_status, o.number AS order_number, o.channel, o.customer_name
      FROM order_lines l JOIN rounds r ON r.id=l.round_id JOIN stations s ON s.id=l.station_id JOIN products p ON p.id=l.product_id
      LEFT JOIN users u ON u.id=r.created_by LEFT JOIN orders o ON o.id=l.order_id
      WHERE l.restaurant_id=$1 AND s.kind = ANY($2::text[]) AND ($3::int IS NULL OR l.station_id=$3)
        AND (l.status IN ('pending','preparing') OR (l.status='ready' AND l.qty_delivered < l.qty) OR (l.status='void' AND NOT l.change_ack))
      ORDER BY l.created_at, l.id`, [a.restaurantId, kinds, station]);
    return { lines, now: new Date().toISOString() };
  });

  // Avanzar estado: start | ready (cantidad parcial) | ack (reconocer cambio) | deliver (salón).
  app.post('/api/lines/:id/:action', async (req: any) => {
    const action = String(req.params.action);
    const a = action === 'deliver' ? need(req, 'waiter', 'pass') : need(req, 'kitchen', 'bar', 'pass');
    const id = reqInt(req.params.id, 'línea', 1);
    const line = await db.transaction(async (tx) => {
      const l = await one(tx, 'SELECT l.*, s.kind FROM order_lines l JOIN stations s ON s.id=l.station_id WHERE l.id=$1 AND l.restaurant_id=$2 FOR UPDATE OF l', [id, a.restaurantId]);
      if (!l) throw notFound();
      if (l.status === 'void' && action !== 'ack') throw conflict('La línea está anulada');
      if (action !== 'deliver' && !isBoss(a) && !a.roles.includes('pass') && !a.roles.includes(l.kind)) throw forbidden();
      let r;
      if (action === 'start') {
        if (l.status !== 'pending') throw conflict('Ya estaba en preparación');
        r = await one(tx, `UPDATE order_lines SET status='preparing', held=false, updated_at=now() WHERE id=$1 RETURNING *`, [id]);
      } else if (action === 'ready') {
        if (!['pending', 'preparing'].includes(l.status)) throw conflict('Esta línea ya estaba lista');
        const n = reqInt(req.body?.qty ?? l.qty - l.qty_ready, 'cantidad', 1, l.qty - l.qty_ready);
        const done = l.qty_ready + n;
        r = await one(tx, `UPDATE order_lines SET qty_ready=$2, status=$3, updated_at=now() WHERE id=$1 RETURNING *`, [id, done, done === l.qty ? 'ready' : 'preparing']);
      } else if (action === 'ack') {
        r = await one(tx, 'UPDATE order_lines SET change_ack=true WHERE id=$1 RETURNING *', [id]);
      } else if (action === 'deliver') {
        const n = reqInt(req.body?.qty ?? l.qty_ready - l.qty_delivered, 'cantidad', 1, Math.max(1, l.qty_ready - l.qty_delivered));
        if (l.qty_delivered + n > l.qty_ready) throw conflict('Todavía no está listo en el sector');
        const d = l.qty_delivered + n;
        r = await one(tx, `UPDATE order_lines SET qty_delivered=$2, status=CASE WHEN $2=qty THEN 'delivered' ELSE status END, updated_at=now() WHERE id=$1 RETURNING *`, [id, d]);
      } else throw notFound();
      if (l.order_id) await syncOrderStatus(tx, a.restaurantId, l.order_id);
      return r!;
    });
    emit(ctx, a.restaurantId, 'lines', { visitId: line.visit_id, orderId: line.order_id, stations: [line.station_id] });
    if (line.order_id) emit(ctx, a.restaurantId, 'orders');
    return line;
  });

  // Marchar los principales en espera de una visita.
  app.post('/api/visits/:id/fire', async (req: any) => {
    const a = need(req, 'waiter');
    const vid = reqInt(req.params.id, 'visita', 1);
    const r = await all(db, `UPDATE order_lines SET held=false, change_note='¡MARCHAR!', change_ack=false, updated_at=now() WHERE visit_id=$1 AND restaurant_id=$2 AND held AND status='pending' RETURNING id, station_id`, [vid, a.restaurantId]);
    await audit(db, a.restaurantId, a.userId, 'visit.fire', 'visit', vid, null, { lines: r.length });
    emit(ctx, a.restaurantId, 'lines', { visitId: vid, stations: [...new Set(r.map((x) => x.station_id))] });
    return { fired: r.length };
  });

  // Corrección de una línea enviada: la estación debe reconocer el aviso.
  app.post('/api/lines/:id/correct', async (req: any) => {
    const a = need(req, 'waiter');
    const id = reqInt(req.params.id, 'línea', 1);
    const note = reqStr(req.body?.note, 'aclaración', 300);
    const l = await one(db, `UPDATE order_lines SET note=$1, change_note=$2, change_ack=false, updated_at=now() WHERE id=$3 AND restaurant_id=$4 AND status IN ('pending','preparing') RETURNING *`, [note, `Cambio: ${note}`, id, a.restaurantId]);
    if (!l) throw conflict('Solo se corrige lo que no está listo');
    await audit(db, a.restaurantId, a.userId, 'line.correct', 'visit', l.visit_id, note, { lineId: id });
    emit(ctx, a.restaurantId, 'lines', { visitId: l.visit_id, stations: [l.station_id] });
    return l;
  });

  // Anular: sin preparar libera la porción; preparado exige destino (merma o reutilizar). Requiere autorización.
  app.post('/api/lines/:id/void', async (req: any) => {
    const a = need(req, 'waiter', 'cashier');
    const id = reqInt(req.params.id, 'línea', 1);
    const reason = reqStr(req.body?.reason, 'motivo', 300);
    const l = await db.transaction(async (tx) => {
      const by = await authorize(tx, a, req.body?.supervisorPin);
      const l = await one(tx, 'SELECT * FROM order_lines WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, a.restaurantId]);
      if (!l) throw notFound();
      if (l.status === 'void') throw conflict('Ya estaba anulada');
      if (l.qty_delivered > 0) throw conflict('Ya se entregó; usá un descuento o cortesía');
      const started = l.status !== 'pending' || l.qty_ready > 0;
      const dest = started ? req.body?.destination : 'liberar';
      if (started && !['merma', 'reutilizar'].includes(dest)) throw bad('Ya se preparó: indicá si va a merma o se reutiliza');
      const p = await one(tx, 'SELECT stock_qty FROM products WHERE id=$1', [l.product_id]);
      if (dest !== 'merma' && p?.stock_qty !== null && p?.stock_qty !== undefined) {
        await tx.query('UPDATE products SET available = available OR stock_qty = 0, stock_qty=stock_qty+$1 WHERE id=$2', [l.qty, l.product_id]);
        await tx.query('INSERT INTO stock_moves (restaurant_id, product_id, delta, reason, line_id, user_id) VALUES ($1,$2,$3,$4,$5,$6)', [a.restaurantId, l.product_id, l.qty, 'anulación', id, a.userId]);
      }
      // Insumos: sin preparar vuelven al stock; preparado y descartado queda como merma con causa.
      const consumed = await all(tx, `SELECT ingredient_id, delta FROM inv_moves WHERE line_id=$1 AND kind='consumo'`, [id]);
      for (const c of consumed) {
        if (dest === 'merma') await tx.query(`INSERT INTO inv_moves (restaurant_id, ingredient_id, delta, kind, reason, line_id, user_id) VALUES ($1,$2,0,'merma',$3,$4,$5)`, [a.restaurantId, c.ingredient_id, `Plato devuelto/anulado: ${reason} (${-c.delta})`, id, a.userId]);
        else {
          await tx.query(`INSERT INTO inv_moves (restaurant_id, ingredient_id, delta, kind, reason, line_id, user_id) VALUES ($1,$2,$3,'ajuste',$4,$5,$6)`, [a.restaurantId, c.ingredient_id, -c.delta, `Anulación: ${reason}`, id, a.userId]);
          await tx.query('UPDATE ingredients SET stock_qty=stock_qty+$1 WHERE id=$2', [-c.delta, c.ingredient_id]);
        }
      }
      await tx.query('DELETE FROM discounts WHERE line_id=$1', [id]);
      const r = await one(tx, `UPDATE order_lines SET status='void', void_reason=$2, change_note=$3, change_ack=false, updated_at=now() WHERE id=$1 RETURNING *`, [id, reason, `ANULADO: ${reason}`]);
      await audit(tx, a.restaurantId, a.userId, 'line.void', l.visit_id ? 'visit' : 'order', l.visit_id ?? l.order_id, reason, { lineId: id, name: l.name, qty: l.qty, amount: l.unit_price_cents * l.qty, destination: dest }, by);
      return r!;
    });
    emit(ctx, a.restaurantId, 'lines', { visitId: l.visit_id, stations: [l.station_id] });
    emit(ctx, a.restaurantId, 'menu');
    return l;
  });

  app.post('/api/lines/:id/seat', async (req: any) => {
    const a = need(req, 'waiter', 'cashier');
    const l = await one(db, 'UPDATE order_lines SET seat=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING visit_id, station_id', [optStr(req.body?.seat, 40), reqInt(req.params.id, 'línea', 1), a.restaurantId]);
    if (!l) throw notFound();
    emit(ctx, a.restaurantId, 'lines', { visitId: l.visit_id, stations: [l.station_id] });
    return { ok: true };
  });
};

async function requireOpen(q: any, rid: number, vid: number) {
  const v = await one(q, `SELECT * FROM visits WHERE id=$1 AND restaurant_id=$2 AND status='open' FOR UPDATE`, [vid, rid]);
  if (!v) throw conflict('La mesa no está abierta');
  return v;
}

/** Estado de un pedido externo según su comanda: en preparación al empezar, listo cuando todo está listo. */
export async function syncOrderStatus(q: any, rid: number, orderId: number) {
  const s = (await one(q, `SELECT count(*) FILTER (WHERE status<>'void')::int AS n, count(*) FILTER (WHERE status IN ('ready','delivered'))::int AS ready, count(*) FILTER (WHERE status='preparing' OR qty_ready>0)::int AS started FROM order_lines WHERE order_id=$1`, [orderId]))!;
  const next = s.n && s.ready === s.n ? 'listo' : s.started || s.ready ? 'en_preparacion' : null;
  if (next) await q.query(`UPDATE orders SET status=$1, updated_at=now() WHERE id=$2 AND restaurant_id=$3 AND status IN ('aceptado','en_preparacion')`, [next, orderId, rid]);
}

export default plugin;

/** La persona es mozo activo de este local (para abrir una mesa a su nombre o traspasarla). */
async function requireWaiter(q: Q, uid: number, rid: number) {
  if (!(await one(q, `SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.active WHERE m.user_id=$1 AND m.restaurant_id=$2 AND m.active AND 'waiter'=ANY(m.roles)`, [uid, rid]))) throw bad('Esa persona no es mozo del local');
}
