import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { all, one, type Q, type Row } from '../db.ts';
import { bad, conflict, emit, failLimiter, windowLimiter, sseSlot, HttpError, lockRestaurant, newToken, notFound, opHash, optStr, reqInt, reqOp, reqStr, sha256, TZ, type Ctx } from '../core.ts';
import { createRound, priceSelection, type Selection } from '../engine.ts';
import { brandOf, publishedMenu } from './brand.ts';
// Código de mesa: 5 fallos por IP y visita; tope global alto por visita para que un ex-comensal no pueda bloquear la mesa solo.
const joinFails = failLimiter(5, 10 * 60_000);
const joinFailsVisit = failLimiter(50, 10 * 60_000);
// Por IP: generoso para acciones de mesa (varios comensales pueden compartir IP), estricto para lo que consume cupo.
const anyPost = windowLimiter(300, 10 * 60_000);
const capacityPost = windowLimiter(15, 10 * 60_000);

const PUBLIC_SETTINGS = ['mode', 'takeaway', 'delivery', 'delivery_paused_until', 'whatsapp_only', 'whatsapp_phone', 'google_review_url', 'hours', 'address', 'last_order', 'tagline', 'features', 'dish_of_day', 'pizza_rule', 'loyalty_goal'];

const todayAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nowHHMM = () => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
/** AAAA-MM-DD que existe en el calendario (Date.parse acepta 2026-02-30 y lo corre a marzo). */
const realDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fromMin = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** Franjas de retiro/entrega de hoy con su cupo restante. */
export async function slots(q: Q, rid: number, settings: Row) {
  const day = todayAR();
  const start = toMin(settings.slot_start ?? '20:00'), end = toMin(settings.slot_end ?? '23:30'), step = Math.max(10, settings.slot_minutes ?? 30);
  const earliest = toMin(nowHHMM()) + 15;
  const used = await all(q, `SELECT slot, count(*)::int AS n FROM orders WHERE restaurant_id=$1 AND slot LIKE $2 AND status NOT IN ('rechazado','cancelado') AND NOT (status='recibido' AND created_at < now() - interval '30 minutes') GROUP BY slot`, [rid, `${day} %`]);
  const out = [];
  for (let m = start; m <= end; m += step) {
    const key = `${day} ${fromMin(m)}`;
    const n = used.find((u) => u.slot === key)?.n ?? 0;
    out.push({ slot: key, time: fromMin(m), left: Math.max(0, (settings.slot_capacity ?? 6) - n), past: m < earliest });
  }
  return out;
}

async function restaurantBySlug(q: Q, slug: string) {
  const r = await one(q, `SELECT id, name, slug, theme, settings FROM restaurants WHERE slug=$1 AND status='active'`, [slug]);
  if (!r) throw notFound();
  return r;
}

async function publicMenu(q: Q, r: Row) {
  // Solo lo publicado: nunca costo, cupo exacto, borradores ni datos internos.
  const settings = Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, r.settings[k]]));
  return { restaurant: { name: r.name, slug: r.slug, theme: r.theme, settings, brand: brandOf(r) }, ...(await publishedMenu(q, r.id)) };
}

// Sesión del comensal: cookie por visita; vence al cerrar la mesa (se borra la fila).
async function dinerVisit(q: Q, req: FastifyRequest, qrToken: string) {
  const tok = req.cookies.diner;
  if (!tok) return null;
  return one(q, `SELECT v.*, t.id AS table_id, t.number AS table_number FROM diner_sessions d JOIN visits v ON v.id=d.visit_id AND v.status='open' AND v.qr_enabled
    JOIN restaurants r ON r.id=v.restaurant_id AND r.status='active'
    JOIN visit_tables vt ON vt.visit_id=v.id AND vt.released_at IS NULL JOIN tables t ON t.id=vt.table_id AND t.qr_token=$2 AND t.active
    WHERE d.token_hash=$1 AND d.created_at > now() - interval '12 hours'`, [sha256(tok), qrToken]);
}

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  app.addHook('onRequest', async (req) => {
    if (req.method !== 'POST') return;
    anyPost(req.ip, 'Demasiadas solicitudes. Probá en unos minutos.');
    if (/^\/api\/public\/r\/[^/]+\/(orders|reservations)$/.test(req.url.split('?')[0])) capacityPost(req.ip, 'Demasiados pedidos o reservas desde esta conexión. Llamá al local.');
  });
  const db = ctx.db;

  app.get('/api/public/r/:slug', async (req: any) => {
    const r = await restaurantBySlug(db, String(req.params.slug));
    const menu = await publicMenu(db, r);
    const zones = await all(db, 'SELECT id, name, fee_cents, min_cents FROM delivery_zones WHERE restaurant_id=$1 ORDER BY name', [r.id]);
    return { ...menu, zones, slots: r.settings.takeaway || r.settings.delivery ? await slots(db, r.id, r.settings) : [], reservations: r.settings.reservations?.enabled ? { times: r.settings.reservations.times, waitlist: r.settings.reservations.waitlist !== false } : null };
  });

  // Cambios de carta en vivo (agotados) para la carta pública.
  app.get('/api/public/r/:slug/events', async (req: any, reply) => {
    const r = await restaurantBySlug(db, String(req.params.slug));
    const release = sseSlot(`pub|${req.ip}`, 20);
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    reply.raw.write('retry: 3000\n\n');
    const on = (ev: any) => { if (ev.rid === r.id && (ev.type === 'menu' || ev.type === 'diner')) reply.raw.write(`data: ${JSON.stringify({ type: ev.type })}\n\n`); };
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    ctx.bus.on('ev', on);
    req.raw.on('close', () => { clearInterval(ping); ctx.bus.off('ev', on); release(); });
  });

  // ---------- Mesa por QR ----------
  app.get('/api/public/t/:qr', async (req: any) => {
    const t = await one(db, `SELECT t.id, t.number, t.area, t.restaurant_id, r.slug FROM tables t JOIN restaurants r ON r.id=t.restaurant_id AND r.status='active' WHERE t.qr_token=$1 AND t.active`, [String(req.params.qr)]);
    if (!t) throw notFound();
    const r = await restaurantBySlug(db, t.slug);
    const open = await one(db, `SELECT v.qr_enabled FROM visit_tables vt JOIN visits v ON v.id=vt.visit_id AND v.status='open' WHERE vt.table_id=$1 AND vt.released_at IS NULL`, [t.id]);
    const v = await dinerVisit(db, req, String(req.params.qr));
    let visit = null;
    if (v) {
      const lines = await all(db, `SELECT id, name, qty, qty_ready, qty_delivered, status, options, note, unit_price_cents FROM order_lines WHERE visit_id=$1 AND status<>'void' ORDER BY id`, [v.id]);
      const calls = await all(db, `SELECT reason, status, taps, created_at, ack_at FROM calls WHERE visit_id=$1 AND status<>'closed' AND reason<>'pedido'`, [v.id]);
      visit = { id: v.id, lines, calls, total: lines.reduce((s: number, l: Row) => s + l.unit_price_cents * l.qty, 0) };
    }
    return { ...(await publicMenu(db, r)), table: { number: t.number, area: t.area }, tableOpen: !!open, qrEnabled: !!open?.qr_enabled, visit };
  });

  // El código temporal lo da el mozo; habilita acciones solo durante esta visita.
  app.post('/api/public/t/:qr/join', async (req: any, reply) => {
    const qr = String(req.params.qr);
    const code = String(req.body?.code ?? '');
    const v = await one(db, `SELECT v.id, v.restaurant_id, v.access_code, v.qr_enabled, v.qr_enabled_at FROM tables t JOIN visit_tables vt ON vt.table_id=t.id AND vt.released_at IS NULL JOIN visits v ON v.id=vt.visit_id AND v.status='open' WHERE t.qr_token=$1`, [qr]);
    if (!v) throw conflict('La mesa todavía no está abierta. Avisale al personal del local.');
    if (!v.qr_enabled) throw new HttpError(403, 'Todavía no habilitaron los pedidos por QR en esta mesa. Pedíselo al personal y te dan un código.');
    // 5 códigos errados bloquean la visita 10 minutos: impide probar los 9000 códigos desde afuera.
    const k = `${v.id}|${req.ip}`;
    joinFails.check(k, 'Demasiados intentos desde este teléfono. Pedile el código al personal y probá en unos minutos.');
    const kv = `${v.id}|${new Date(v.qr_enabled_at).getTime()}`;
    joinFailsVisit.check(kv, 'Demasiados intentos con esta mesa. Pedile al mozo que te ayude: si renueva el código se destraba.');
    if (v.access_code !== code) { joinFails.fail(k); joinFailsVisit.fail(kv); throw new HttpError(403, 'Código incorrecto. Pedíselo al personal.'); }
    joinFails.ok(k);
    const tok = newToken();
    await db.query('INSERT INTO diner_sessions (token_hash, restaurant_id, visit_id) VALUES ($1,$2,$3)', [sha256(tok), v.restaurant_id, v.id]);
    reply.setCookie('diner', tok, { path: '/api/public/t/', httpOnly: true, sameSite: 'strict', maxAge: 12 * 3600, secure: req.protocol === 'https' });
    return { ok: true };
  });

  // Llamar al mozo / pedir la cuenta / avisar alergia. Toques repetidos se agrupan en el mismo aviso.
  app.post('/api/public/t/:qr/call', async (req: any) => {
    const v = await dinerVisit(db, req, String(req.params.qr));
    if (!v) throw new HttpError(403, 'Ingresá el código de la mesa');
    const r = (await one(db, 'SELECT settings FROM restaurants WHERE id=$1', [v.restaurant_id]))!;
    if (r.settings.mode === 'menu') throw new HttpError(403, 'Este local muestra solo la carta');
    const reason = ['mozo', 'cuenta', 'alergia'].includes(req.body?.reason) ? req.body.reason : 'mozo';
    const c = await one(db, `INSERT INTO calls (restaurant_id, visit_id, reason, detail) VALUES ($1,$2,$3,$4)
      ON CONFLICT (visit_id, reason) WHERE status <> 'closed' DO UPDATE SET taps = calls.taps + 1 RETURNING *`, [v.restaurant_id, v.id, reason, optStr(req.body?.detail, 300)]);
    emit(ctx, v.restaurant_id, 'floor');
    return c;
  });

  // Pedido desde la mesa: solo celulares autorizados con el código que dio el mozo, mientras la visita esté abierta y habilitada.
  app.post('/api/public/t/:qr/order', async (req: any) => {
    const v = await dinerVisit(db, req, String(req.params.qr));
    if (!v) throw new HttpError(403, req.cookies.diner ? 'Este celular ya no puede enviar pedidos en esta mesa. Pedile al personal un código nuevo.' : 'Ingresá el código de la mesa para enviar el pedido.');
    const r = (await one(db, 'SELECT settings FROM restaurants WHERE id=$1', [v.restaurant_id]))!;
    if (r.settings.mode !== 'orders') throw new HttpError(403, 'Este local toma los pedidos con el mozo');
    const items: Selection[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw bad('El pedido está vacío');
    const opId = reqOp(req.body?.opId);
    // El comensal solo puede pedir lo que ve en la carta pública.
    const ids = items.flatMap((i: any) => [Number(i?.productId), Number(i?.halves)]); // incluye la otra mitad de la pizza
    if (ids.length > 80) throw bad('Máximo 40 ítems por ronda');
    if (await one(db, 'SELECT 1 FROM products p JOIN categories c ON c.id=p.category_id WHERE p.restaurant_id=$1 AND p.id = ANY($2::int[]) AND NOT (p.published AND c.visible)', [v.restaurant_id, ids.filter(Number.isInteger)])) throw conflict('Algún plato ya no está en la carta');
    const expected: unknown[] = Array.isArray(req.body?.expected) ? req.body.expected : [];
    const tok = sha256(String(req.cookies.diner));
    const res = await db.transaction(async (tx) => {
    // Con la visita bloqueada: si el mozo cortó el QR o cerró la cuenta mientras tanto, no entra.
    if (!(await one(tx, `SELECT 1 FROM visits v JOIN diner_sessions d ON d.visit_id=v.id AND d.token_hash=$2 WHERE v.id=$1 AND v.status='open' AND v.qr_enabled FOR UPDATE OF v`, [v.id, tok])))
      throw new HttpError(403, 'Este celular ya no puede enviar pedidos en esta mesa. Pedile al personal un código nuevo.');
    // Un reintento del mismo envío ya registrado no se vuelve a revisar: devuelve la comanda original.
    const already = await one(tx, 'SELECT 1 FROM rounds WHERE restaurant_id=$1 AND op_id=$2', [v.restaurant_id, opId]);
    // Antes de confirmar: si algo se agotó o cambió de precio desde que el cliente armó el carrito, se le muestra qué cambió.
    if (!already) {
      const changes: { index: number; name: string; before?: number; after?: number; unavailable?: boolean; left?: number }[] = [];
      for (const [i, it] of items.entries()) {
        try {
          const p = await priceSelection(tx, v.restaurant_id, it, r.settings);
          const qty = Number(it.qty) || 1;
          const fixedOut = p.product.kind === 'combo' && await one(tx, 'SELECT 1 FROM combo_items c JOIN products x ON x.id=c.product_id WHERE c.combo_id=$1 AND NOT x.available', [p.product.id]);
          if (!p.product.available || fixedOut) changes.push({ index: i, name: p.name, unavailable: true });
          else if (p.product.stock_qty !== null && p.product.stock_qty < qty) changes.push({ index: i, name: p.name, unavailable: true, left: p.product.stock_qty });
          else if (expected[i] != null && Number(expected[i]) !== p.unit) changes.push({ index: i, name: p.name, before: Number(expected[i]), after: p.unit });
        } catch (e) {
          if (e instanceof HttpError && e.status === 409) changes.push({ index: i, name: String((e.extra as any)?.problems?.[0]?.message ?? e.message), unavailable: true });
          else throw e;
        }
      }
      if (changes.length) throw conflict('Cambió algo de tu pedido. Revisalo antes de enviarlo.', { changes });
    }
    return createRound(tx, ctx, v.restaurant_id, { visitId: v.id }, opId, items, 'diner', null);
    });
    if (!res.duplicate) {
      // Aviso al mozo que tiene la mesa ahora (si la reasignaron, le llega al nuevo); sin mozo, al dueño y encargados.
      // Si el mozo a cargo ya no está activo en el local, el aviso va al dueño (toUser null).
      const cur = (await one(db, `SELECT (SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.restaurant_id=v.restaurant_id AND m.active WHERE u.id=v.waiter_id AND u.active) AS waiter_id, (SELECT string_agg(t.number,'+') FROM visit_tables vt JOIN tables t ON t.id=vt.table_id WHERE vt.visit_id=v.id AND vt.released_at IS NULL) AS tables FROM visits v WHERE v.id=$1`, [v.id]))!;
      await db.query(`INSERT INTO calls (restaurant_id, visit_id, reason, detail) VALUES ($1,$2,'pedido',$3)
        ON CONFLICT (visit_id, reason) WHERE status <> 'closed' DO UPDATE SET taps = calls.taps + 1, detail = EXCLUDED.detail, status = 'pending'`, [v.restaurant_id, v.id, `Comanda ${res.round.number}`]);
      emit(ctx, v.restaurant_id, 'notice', { toUser: cur.waiter_id, kind: 'qr_order', visitId: v.id, tables: cur.tables, round: res.round.number, at: res.round.created_at });
    }
    emit(ctx, v.restaurant_id, 'floor');
    emit(ctx, v.restaurant_id, 'diner');
    return { ok: true, duplicate: res.duplicate, round: { number: res.round.number, at: res.round.created_at }, lines: res.lines.map((l) => ({ name: l.name, qty: l.qty })) };
  });

  // ---------- Retiro y delivery ----------
  app.post('/api/public/r/:slug/quote', async (req: any) => {
    const r = await restaurantBySlug(db, String(req.params.slug));
    return quote(db, r, req.body ?? {});
  });

  app.post('/api/public/r/:slug/orders', async (req: any) => {
    const r = await restaurantBySlug(db, String(req.params.slug));
    const b = req.body ?? {};
    const opId = reqOp(b.opId);
    const order = await db.transaction(async (tx) => {
      await lockRestaurant(tx, r.id);
      const hash = opHash(b);
      const prev = await one(tx, 'SELECT * FROM orders WHERE restaurant_id=$1 AND op_id=$2', [r.id, opId]);
      if (prev) { if (prev.op_hash !== hash) throw conflict('Este pedido ya se envió con otro contenido'); return prev; }
      const fresh = (await one(tx, 'SELECT settings FROM restaurants WHERE id=$1', [r.id]))!.settings;
      const q = await quote(tx, { ...r, settings: fresh }, b);
      if (q.unavailable.length) throw conflict(`Ya no está disponible: ${q.unavailable.join(', ')}`, { quote: q });
      if (!b.slot) throw bad('Elegí una franja horaria');
      const s = (await slots(tx, r.id, fresh)).find((x) => x.slot === b.slot);
      if (!s || s.past) throw bad('La franja elegida ya no está disponible');
      if (s.left <= 0) {
        const next = (await slots(tx, r.id, fresh)).find((x) => !x.past && x.left > 0);
        throw conflict(`La franja de las ${s.time} se llenó${next ? `. La próxima disponible es ${next.time}` : ''}`, { nextSlot: next?.slot ?? null });
      }
      const number = (await one(tx, 'SELECT coalesce(max(number),0)+1 AS n FROM orders WHERE restaurant_id=$1', [r.id]))!.n;
      const o = (await one(tx, `INSERT INTO orders (restaurant_id, number, channel, status, customer_name, phone, address, address_notes, zone_id, slot, fee_cents, items, subtotal_cents, total_cents, notes, token, op_id, op_hash, loyalty_opt_in)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [r.id, number, q.channel, fresh.whatsapp_only ? 'solicitud' : 'recibido', reqStr(b.name, 'nombre', 60), q.channel === 'delivery' ? reqStr(b.phone, 'teléfono', 30) : optStr(b.phone, 30),
          q.channel === 'delivery' ? reqStr(b.address, 'domicilio', 160) : '', q.channel === 'delivery' ? optStr(b.addressNotes, 200) : '', q.zone?.id ?? null, b.slot, q.fee, JSON.stringify(b.items.map((it: any, i: number) => ({ ...it, label: q.lines[i].name, total: q.lines[i].total }))), q.subtotal, q.total, optStr(b.notes, 300),
          newToken(18), opId, hash, !!b.loyaltyOptIn && !!b.phone]))!;
      if (o.loyalty_opt_in) await tx.query(`INSERT INTO customers (restaurant_id, phone, name, opt_in, opt_in_at) VALUES ($1,$2,$3,true,now()) ON CONFLICT (restaurant_id, phone) DO UPDATE SET opt_in=true, opt_in_at=now(), opt_out_at=NULL, name=EXCLUDED.name`, [r.id, o.phone, o.customer_name]);
      return o;
    });
    emit(ctx, r.id, 'orders');
    return { number: order.number, token: order.token, status: order.status, total: order.total_cents };
  });

  // Enlace privado del pedido: último estado confirmado, hora de actualización y estimado.
  app.get('/api/public/orders/:token', async (req: any) => {
    const o = await one(db, `SELECT o.number, o.channel, o.status, o.items, o.subtotal_cents, o.fee_cents, o.total_cents, o.slot, o.eta, o.reject_reason, o.updated_at, o.created_at, o.customer_name, o.loyalty_opt_in, r.name AS restaurant, r.slug, r.settings->>'google_review_url' AS review_url, r.settings->>'whatsapp_phone' AS whatsapp
      FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.token=$1 AND o.created_at > now() - interval '30 days'`, [String(req.params.token)]);
    if (!o) throw notFound();
    const lines = await all(db, `SELECT l.name, l.qty, l.unit_price_cents, l.options FROM order_lines l JOIN orders x ON x.id=l.order_id WHERE x.token=$1 AND l.status<>'void'`, [String(req.params.token)]);
    return { ...o, lines };
  });

  app.post('/api/public/r/:slug/feedback', async (req: any) => {
    const r = await restaurantBySlug(db, String(req.params.slug));
    await db.query('INSERT INTO feedback (restaurant_id, text) VALUES ($1,$2)', [r.id, reqStr(req.body?.text, 'comentario', 1000)]);
    return { ok: true };
  });

  app.post('/api/public/orders/:token/loyalty-optout', async (req: any) => {
    const o = await one(db, 'SELECT restaurant_id, phone FROM orders WHERE token=$1 AND phone IS NOT NULL', [String(req.params.token)]);
    if (!o) throw notFound();
    await db.query('UPDATE customers SET opt_in=false, opt_out_at=now() WHERE restaurant_id=$1 AND phone=$2', [o.restaurant_id, o.phone]);
    return { ok: true };
  });

  // ---------- Reservas ----------
  // Cupo real por horario de un día: lo mismo que cuenta bookReservation (confirmadas y sentadas).
  app.get('/api/public/r/:slug/availability', async (req: any) => {
    const r = await restaurantBySlug(db, String(req.params.slug));
    const cfg = r.settings.reservations;
    if (!cfg?.enabled) throw bad('Este local no toma reservas por la web');
    const date = String(req.query.date ?? '');
    if (!realDate(date)) throw bad('Fecha inválida');
    const cap = cfg.capacity ?? 24;
    const used = await all(db, `SELECT to_char(slot AT TIME ZONE '${TZ}', 'HH24:MI') AS t, sum(party)::int AS n FROM reservations
      WHERE restaurant_id=$1 AND (slot AT TIME ZONE '${TZ}')::date = $2::date AND status IN ('confirmada','sentada') GROUP BY 1`, [r.id, date]);
    const now = Date.now();
    const times = [...(cfg.times ?? [])].sort().map((t: string) => ({
      time: t, left: Math.max(0, cap - (used.find((u) => u.t === t)?.n ?? 0)), past: new Date(`${date}T${t}:00-03:00`).getTime() < now - 60_000,
    }));
    return { date, waitlist: cfg.waitlist !== false, times };
  });
  app.post('/api/public/r/:slug/reservations', async (req: any) => {
    const r = await restaurantBySlug(db, String(req.params.slug));
    if (!r.settings.reservations?.enabled) throw bad('Este local no toma reservas por la web');
    const res = await db.transaction((tx) => bookReservation(tx, r, req.body ?? {}, false));
    emit(ctx, r.id, 'reservations');
    return { token: res.token, status: res.status, slot: res.slot };
  });
  app.get('/api/public/reservations/:token', async (req: any) => {
    const x = await one(db, 'SELECT x.name, x.party, x.slot, x.status, r.name AS restaurant, r.slug, r.theme, r.settings FROM reservations x JOIN restaurants r ON r.id=x.restaurant_id WHERE x.token=$1', [String(req.params.token)]);
    if (!x) throw notFound();
    const { theme, settings, ...rest } = x;
    return { ...rest, brand: brandOf({ name: x.restaurant, theme, settings }) }; // solo la marca pública, nunca la configuración
  });
  app.post('/api/public/reservations/:token/cancel', async (req: any) => {
    const x = await one(db, `UPDATE reservations SET status='cancelada' WHERE token=$1 AND status IN ('confirmada','espera') RETURNING restaurant_id`, [String(req.params.token)]);
    if (!x) throw conflict('La reserva ya no se puede cancelar');
    emit(ctx, x.restaurant_id, 'reservations');
    return { ok: true };
  });
};

/** Total del carrito con precios vigentes; marca lo agotado. El servidor decide los importes. */
export async function quote(q: Q, r: Row, b: any) {
  const s = r.settings;
  const channel = b.channel === 'delivery' ? 'delivery' : 'retiro';
  if (channel === 'delivery' && !s.delivery) throw bad('Este local no hace delivery');
  if (channel === 'retiro' && !s.takeaway) throw bad('Este local no toma pedidos para retirar');
  if (channel === 'delivery' && s.delivery_paused_until && new Date(s.delivery_paused_until) > new Date()) throw conflict(`El delivery está pausado hasta las ${new Date(s.delivery_paused_until).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}. Podés pedir para retirar.`);
  const items: Selection[] = Array.isArray(b.items) ? b.items : [];
  if (items.length > 40) throw bad('Máximo 40 ítems por pedido');
  if (!items.length) throw bad('El carrito está vacío');
  const lines = [];
  const unavailable: string[] = [];
  for (const it of items) {
    const p = await priceSelection(q, r.id, it, s);
    if (!p.product.published || !(await one(q, 'SELECT 1 FROM categories WHERE id=$1 AND visible', [p.product.category_id]))) throw bad('Plato no publicado');
    const comboOut = p.product.kind === 'combo' && await one(q, 'SELECT 1 FROM combo_items c JOIN products x ON x.id=c.product_id WHERE c.combo_id=$1 AND NOT x.available', [p.product.id]);
    if (!p.product.available || comboOut) unavailable.push(p.product.name);
    const qty = reqInt(it.qty, 'cantidad', 1, 50);
    lines.push({ productId: p.product.id, name: p.name, qty, unit: p.unit, total: p.unit * qty, options: p.options });
  }
  const subtotal = lines.reduce((t, l) => t + l.total, 0);
  let zone = null, fee = 0;
  if (channel === 'delivery') {
    zone = await one(q, 'SELECT * FROM delivery_zones WHERE id=$1 AND restaurant_id=$2', [Number(b.zoneId), r.id]);
    if (!zone) throw bad('Elegí tu barrio');
    if (subtotal < zone.min_cents) throw bad(`El mínimo para ${zone.name} es $${(zone.min_cents / 100).toLocaleString('es-AR')}`);
    fee = zone.fee_cents;
  }
  return { channel, lines, subtotal, fee, total: subtotal + fee, zone, unavailable };
}

/** Asigna cupo de reserva en serie (bloqueo del local): dos pedidos por el último lugar no se confirman ambos. */
export async function bookReservation(q: Q, r: Row, b: any, staff = true) {
  await lockRestaurant(q, r.id);
  const cfg = (await one(q, 'SELECT settings FROM restaurants WHERE id=$1', [r.id]))!.settings.reservations ?? {};
  const party = reqInt(b.party, 'personas', 1, 40);
  const date = reqStr(b.date, 'fecha', 10);
  const time = reqStr(b.time, 'horario', 5);
  if (!realDate(date) || !(cfg.times ?? []).includes(time)) throw bad('Horario no disponible');
  const slot = new Date(`${date}T${time}:00-03:00`);
  if (slot.getTime() < Date.now() - 60_000) throw bad('Ese horario ya pasó');
  const used = (await one(q, `SELECT coalesce(sum(party),0)::int AS n FROM reservations WHERE restaurant_id=$1 AND slot=$2 AND status IN ('confirmada','sentada')`, [r.id, slot]))!.n;
  const fits = used + party <= (cfg.capacity ?? 24);
  // El personal siempre puede anotar en espera; el público, solo si el local la ofrece.
  const canWait = staff || cfg.waitlist !== false;
  if (!fits && !(b.waitlist && canWait)) throw conflict(canWait ? 'No quedan lugares en ese horario. Probá otro o anotate en la lista de espera.' : 'No quedan lugares en ese horario. Probá otro.', { left: Math.max(0, (cfg.capacity ?? 24) - used) });
  return (await one(q, 'INSERT INTO reservations (restaurant_id, name, phone, party, slot, area, status, notes, token) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [r.id, reqStr(b.name, 'nombre', 60), optStr(b.phone, 30), party, slot, optStr(b.area, 30) || null, fits ? 'confirmada' : 'espera', optStr(b.notes, 300), newToken(16)]))!;
}

export default plugin;
