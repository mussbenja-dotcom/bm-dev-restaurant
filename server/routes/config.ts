import type { FastifyPluginAsync } from 'fastify';
import { normalUrl, reviewUrlError } from '../../shared/qr.ts';
import { all, one, type Q } from '../db.ts';
import { audit, bad, conflict, emit, forbidden, kick, hashSecret, need, newToken, notFound, optStr, parseCsv, reqInt, reqStr, ROLES, type Ctx } from '../core.ts';
import { validEmail, validPassword, createRestaurant } from './auth.ts';
import { applyTemplate, TEMPLATES } from '../templates.ts';
import { parseArs } from '../../shared/money.ts';

const SETTING_KEYS = ['mode', 'pizza_rule', 'cutoff_hour', 'bill_alert_min', 'payment_methods', 'takeaway', 'delivery', 'whatsapp_only', 'whatsapp_phone', 'google_review_url', 'hours', 'address', 'last_order', 'slot_start', 'slot_end', 'slot_minutes', 'slot_capacity', 'reservations', 'loyalty_goal', 'dish_of_day', 'tagline', 'features'];

/** Valida un plato (campos, opciones y componentes de combo) sin guardarlo. Lo usan la carta en vivo y el borrador. */
export async function productFields(q: Q, rid: number, b: any, selfId?: number) {
  const fields = {
    category_id: reqInt(b.categoryId, 'categoría', 1),
    station_id: reqInt(b.stationId, 'estación', 1),
    name: reqStr(b.name, 'nombre', 120),
    description: optStr(b.description, 600),
    price_cents: reqInt(b.priceCents, 'precio', 0, 1e11),
    tags: Array.isArray(b.tags) ? b.tags.map((t: unknown) => optStr(t, 30)).filter(Boolean).slice(0, 8) : [],
    allergens: optStr(b.allergens, 300),
    published: b.published !== false,
    kind: ['normal', 'pizza', 'dozen', 'combo'].includes(b.kind) ? b.kind : 'normal',
    course: ['bebida', 'entrada', 'principal', 'postre'].includes(b.course) ? b.course : 'principal',
    prep_minutes: reqInt(b.prepMinutes ?? 10, 'minutos de preparación', 0, 240),
    favorite: !!b.favorite,
    suggestion_id: b.suggestionId ? reqInt(b.suggestionId, 'sugerencia', 1) : null,
  };
  // Referencias del mismo local (las FK compuestas también lo garantizan).
  if (!(await one(q, 'SELECT 1 FROM categories WHERE id=$1 AND restaurant_id=$2', [fields.category_id, rid]))) throw bad('Categoría de otro local');
  if (!(await one(q, 'SELECT 1 FROM stations WHERE id=$1 AND restaurant_id=$2', [fields.station_id, rid]))) throw bad('Estación de otro local');
  if (fields.suggestion_id && !(await one(q, 'SELECT 1 FROM products WHERE id=$1 AND restaurant_id=$2', [fields.suggestion_id, rid]))) throw bad('Sugerencia de otro local');
  // item_id: la opción es un plato de la carta que se elige dentro de un combo («elegí una bebida»).
  const options = Array.isArray(b.options) ? b.options.slice(0, 60).map((o: any) => {
    const item_id = o.itemId ? reqInt(o.itemId, 'plato a elegir', 1) : null;
    return { grp: reqStr(o.grp, 'grupo', 40), name: reqStr(o.name, 'opción', 60), price_delta_cents: reqInt(o.priceDeltaCents ?? 0, 'precio de la opción', 0, 1e10), multi: item_id ? false : !!o.multi, item_id };
  }) : null;
  const choices = (options ?? []).filter((o: any) => o.item_id);
  if (choices.length && fields.kind !== 'combo') throw bad('Solo un combo puede ofrecer platos para elegir');
  let components: { product_id: number; qty: number }[] | null = null;
  if (fields.kind === 'combo') {
    const list = Array.isArray(b.components) ? b.components : [];
    const groups = new Set(choices.map((o: any) => o.grp)).size;
    if (list.length > 10 || list.length + groups < 2) throw bad('Un combo lleva al menos 2 partes (platos fijos o grupos para elegir) y hasta 10 platos fijos');
    components = list.map((c: any) => ({ product_id: reqInt(c.productId, 'plato del combo', 1), qty: reqInt(c.qty ?? 1, 'cantidad del combo', 1, 20) }));
    const ids = [...new Set([...components!.map((c) => c.product_id), ...choices.map((o: any) => o.item_id as number)])];
    const ok = await all(q, `SELECT id FROM products WHERE restaurant_id=$1 AND id = ANY($2::int[]) AND kind IN ('normal') AND id <> $3`, [rid, ids, selfId ?? 0]);
    if (ok.length !== ids.length) throw bad('El combo solo puede incluir platos simples de este local');
  }
  if (selfId && fields.kind !== 'normal' && (await one(q, 'SELECT 1 FROM combo_items WHERE product_id=$1 AND restaurant_id=$2 UNION ALL SELECT 1 FROM product_options WHERE item_id=$1 AND restaurant_id=$2', [selfId, rid]))) throw bad('Este plato es parte de un combo: tiene que seguir siendo un plato simple');
  return { fields, options, components };
}

async function saveProduct(q: Q, rid: number, b: any, id?: number) {
  const { fields, options, components } = await productFields(q, rid, b, id);
  const cols = Object.keys(fields);
  const vals = Object.values(fields);
  let p;
  if (id) {
    p = await one(q, `UPDATE products SET ${cols.map((c, i) => `${c}=$${i + 3}`).join(', ')} WHERE id=$1 AND restaurant_id=$2 RETURNING *`, [id, rid, ...vals]);
    if (!p) throw notFound();
  } else {
    p = (await one(q, `INSERT INTO products (restaurant_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [rid, ...vals]))!;
  }
  await writeOptions(q, rid, p.id, options, components);
  return p;
}

/** Reemplaza opciones y componentes de combo de un plato (null = no tocar). */
export async function writeOptions(q: Q, rid: number, pid: number, options: any[] | null, components: any[] | null) {
  if (options) {
    await q.query('DELETE FROM product_options WHERE product_id=$1 AND restaurant_id=$2', [pid, rid]);
    for (const o of options) await q.query('INSERT INTO product_options (restaurant_id, product_id, grp, name, price_delta_cents, multi, item_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [rid, pid, o.grp, o.name, o.price_delta_cents, o.multi, o.item_id ?? null]);
  }
  if (components) {
    await q.query('DELETE FROM combo_items WHERE combo_id=$1 AND restaurant_id=$2', [pid, rid]);
    for (const c of components) await q.query('INSERT INTO combo_items (restaurant_id, combo_id, product_id, qty) VALUES ($1,$2,$3,$4)', [rid, pid, c.product_id, c.qty]);
  }
}

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;

  app.get('/api/templates', async () => Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, label: t.label })));

  // Un dueño puede incorporar otro local separado (sucursal) con sus propios datos.
  app.post('/api/restaurants', async (req: any) => {
    const a = need(req, 'owner');
    if (!a.roles.includes('owner')) throw forbidden();
    return db.transaction(async (tx) => {
      const r = await createRestaurant(tx, req.body ?? {});
      await tx.query(`INSERT INTO memberships (user_id, restaurant_id, roles) VALUES ($1,$2,'{owner}')`, [a.userId, r.id]);
      await audit(tx, r.id, a.userId, 'restaurant.create', 'restaurant', r.id);
      return r;
    });
  });

  app.put('/api/restaurant', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    const cur = (await one(db, 'SELECT settings FROM restaurants WHERE id=$1', [a.restaurantId]))!.settings;
    const next = { ...cur };
    for (const k of SETTING_KEYS) if (k in (b.settings ?? {})) next[k] = b.settings[k];
    if (!['menu', 'calls', 'orders'].includes(next.mode)) throw bad('Modo de mesa inválido');
    if (b.settings?.reservations) {
      // La disponibilidad pública y bookReservation comparan horarios como texto HH:MM: «9:00» pasa a «09:00».
      const rs = next.reservations;
      const times = Array.isArray(rs.times) ? rs.times.map((t: unknown) => String(t).trim().replace(/^(\d):/, '0$1:')) : null;
      if (!times || times.some((t: string) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw bad('Horarios de reserva inválidos: usá HH:MM, por ejemplo 21:00');
      if (rs.capacity != null && !(Number.isInteger(rs.capacity) && rs.capacity >= 1)) throw bad('Cubiertos por horario inválidos');
      next.reservations = { ...rs, times: [...new Set(times)] };
    }
    if (next.google_review_url && reviewUrlError(next.google_review_url)) throw bad(reviewUrlError(next.google_review_url)!);
    if (next.google_review_url) next.google_review_url = normalUrl(next.google_review_url);
    await db.query('UPDATE restaurants SET name=$1, theme=$2, settings=$3 WHERE id=$4', [reqStr(b.name, 'nombre', 80), b.theme === 'pizzeria' ? 'pizzeria' : 'bodegon', JSON.stringify(next), a.restaurantId]);
    await audit(db, a.restaurantId, a.userId, 'restaurant.update', 'restaurant', a.restaurantId);
    emit(ctx, a.restaurantId, 'menu');
    return { ok: true };
  });

  app.post('/api/restaurant/template', async (req: any) => {
    const a = need(req);
    await db.transaction((tx) => applyTemplate(tx, a.restaurantId, String(req.body?.template)));
    return { ok: true };
  });

  // Pausar delivery durante N minutos (por defecto 30).
  app.post('/api/restaurant/pause-delivery', async (req: any) => {
    const a = need(req, 'cashier');
    const min = req.body?.minutes === 0 ? 0 : reqInt(req.body?.minutes ?? 30, 'minutos', 1, 600);
    const until = min ? new Date(Date.now() + min * 60_000).toISOString() : null;
    await db.query(`UPDATE restaurants SET settings = jsonb_set(settings, '{delivery_paused_until}', $1::jsonb) WHERE id=$2`, [JSON.stringify(until), a.restaurantId]);
    emit(ctx, a.restaurantId, 'menu');
    return { until };
  });

  // ---------- Estaciones, mesas ----------
  app.get('/api/stations', async (req) => all(db, 'SELECT * FROM stations WHERE restaurant_id=$1 ORDER BY id', [need(req, 'waiter', 'kitchen', 'bar', 'pass', 'cashier').restaurantId]));
  app.post('/api/stations', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    const kind = b.kind === 'bar' ? 'bar' : 'kitchen';
    if (b.id) {
      const s = await one(db, 'UPDATE stations SET name=$1, kind=$2, delay_minutes=$3 WHERE id=$4 AND restaurant_id=$5 RETURNING *', [reqStr(b.name, 'nombre', 40), kind, reqInt(b.delayMinutes ?? 15, 'demora', 1, 240), b.id, a.restaurantId]);
      kick(ctx, null, a.restaurantId); // las pantallas del local recalculan sus estaciones
      return s;
    }
    return one(db, 'INSERT INTO stations (restaurant_id, name, kind, delay_minutes) VALUES ($1,$2,$3,$4) RETURNING *', [a.restaurantId, reqStr(b.name, 'nombre', 40), kind, reqInt(b.delayMinutes ?? 15, 'demora', 1, 240)]);
  });

  app.get('/api/tables', async (req) => all(db, 'SELECT * FROM tables WHERE restaurant_id=$1 AND active ORDER BY area, length(number), number', [need(req, 'waiter', 'cashier', 'reservations').restaurantId]));
  app.post('/api/tables', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    if (b.id) return one(db, 'UPDATE tables SET number=$1, area=$2, seats=$3, active=$4 WHERE id=$5 AND restaurant_id=$6 RETURNING *', [reqStr(b.number, 'número', 10), reqStr(b.area ?? 'Salón', 'sector', 30), reqInt(b.seats ?? 4, 'lugares', 1, 40), b.active !== false, b.id, a.restaurantId]);
    return one(db, 'INSERT INTO tables (restaurant_id, number, area, seats, qr_token) VALUES ($1,$2,$3,$4,$5) RETURNING *', [a.restaurantId, reqStr(b.number, 'número', 10), reqStr(b.area ?? 'Salón', 'sector', 30), reqInt(b.seats ?? 4, 'lugares', 1, 40), newToken(9)]);
  });

  // ---------- Carta ----------
  app.get('/api/menu', async (req) => {
    const rid = need(req, 'waiter', 'kitchen', 'bar', 'pass', 'cashier', 'stock').restaurantId;
    const [categories, products, options] = await Promise.all([
      all(db, `SELECT * FROM categories WHERE restaurant_id=$1 AND draft->>'isNew' IS NULL ORDER BY position, id`, [rid]),
      all(db, `SELECT * FROM products WHERE restaurant_id=$1 AND draft->>'isNew' IS NULL ORDER BY position, id`, [rid]),
      all(db, 'SELECT * FROM product_options WHERE restaurant_id=$1 ORDER BY id', [rid]),
    ]);
    return { categories, products: products.map((p) => ({ ...p, options: options.filter((o) => o.product_id === p.id) })) };
  });

  app.post('/api/categories', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    if (b.id) return one(db, 'UPDATE categories SET name=$1, position=$2 WHERE id=$3 AND restaurant_id=$4 RETURNING *', [reqStr(b.name, 'nombre', 60), reqInt(b.position ?? 0, 'orden', 0, 999), b.id, a.restaurantId]);
    return one(db, 'INSERT INTO categories (restaurant_id, name, position) VALUES ($1,$2,$3) RETURNING *', [a.restaurantId, reqStr(b.name, 'nombre', 60), reqInt(b.position ?? 99, 'orden', 0, 999)]);
  });

  app.post('/api/products', async (req: any) => {
    const a = need(req);
    const p = await db.transaction((tx) => saveProduct(tx, a.restaurantId, req.body ?? {}));
    emit(ctx, a.restaurantId, 'menu');
    return p;
  });
  app.put('/api/products/:id', async (req: any) => {
    const a = need(req);
    const id = reqInt(req.params.id, 'plato', 1);
    const before = await one(db, 'SELECT price_cents FROM products WHERE id=$1 AND restaurant_id=$2', [id, a.restaurantId]);
    const p = await db.transaction((tx) => saveProduct(tx, a.restaurantId, req.body ?? {}, id));
    if (before && before.price_cents !== p.price_cents) await audit(db, a.restaurantId, a.userId, 'product.price', 'product', id, null, { from: before.price_cents, to: p.price_cents });
    emit(ctx, a.restaurantId, 'menu');
    return p;
  });

  // Disponibilidad y cupo: cocina, barra y encargados pueden marcar agotado o fijar "quedan N".
  app.post('/api/products/:id/availability', async (req: any) => {
    const a = need(req, 'kitchen', 'bar', 'pass');
    const b = req.body ?? {};
    const stock = b.stockQty === null || b.stockQty === undefined || b.stockQty === '' ? null : reqInt(b.stockQty, 'cupo', 0, 9999);
    const available = stock === 0 ? false : b.available !== false;
    const p = await one(db, 'UPDATE products SET available=$1, stock_qty=$2 WHERE id=$3 AND restaurant_id=$4 RETURNING id, name, available, stock_qty', [available, stock, reqInt(req.params.id, 'plato', 1), a.restaurantId]);
    if (!p) throw notFound();
    await audit(db, a.restaurantId, a.userId, 'product.availability', 'product', p.id, null, { available, stock });
    emit(ctx, a.restaurantId, 'menu');
    return p;
  });

  // Importación CSV: categoria,nombre,descripcion,precio,estacion,etiquetas. dryRun devuelve la vista previa con errores por fila.
  app.post('/api/menu/import', async (req: any) => {
    const a = need(req);
    const rows = parseCsv(String(req.body?.csv ?? '')).slice(0, 1000);
    if (rows.length && /categor/i.test(rows[0][0] ?? '')) rows.shift();
    const stations = await all(db, 'SELECT id, name FROM stations WHERE restaurant_id=$1', [a.restaurantId]);
    const existing = await all(db, 'SELECT p.name, c.name AS cat FROM products p JOIN categories c ON c.id=p.category_id WHERE p.restaurant_id=$1', [a.restaurantId]);
    const seen = new Set(existing.map((e) => `${e.cat.toLowerCase()}|${e.name.toLowerCase()}`));
    const preview = rows.map((r, i) => {
      const [cat = '', name = '', description = '', price = '', station = '', tags = ''] = r.map((c) => c.trim());
      const errors: string[] = [];
      if (!cat) errors.push('falta categoría');
      if (!name) errors.push('falta nombre');
      const cents = parseArs(price);
      if (Number.isNaN(cents)) errors.push(`precio inválido "${price}"`);
      const st = stations.find((s) => s.name.toLowerCase() === station.toLowerCase()) ?? (station ? null : stations[0]);
      if (!st) errors.push(`estación desconocida "${station}"`);
      const key = `${cat.toLowerCase()}|${name.toLowerCase()}`;
      if (seen.has(key)) errors.push('duplicado');
      seen.add(key);
      return { row: i + 1, cat, name, description, priceCents: cents, stationId: st?.id, station: st?.name, tags: tags ? tags.split('|').map((t) => t.trim()) : [], errors };
    });
    const ok = preview.filter((p) => !p.errors.length);
    if (req.body?.dryRun !== false) return { preview, valid: ok.length, invalid: preview.length - ok.length };
    await db.transaction(async (tx) => {
      for (const p of ok) {
        let c = await one(tx, 'SELECT id FROM categories WHERE restaurant_id=$1 AND lower(name)=lower($2)', [a.restaurantId, p.cat]);
        if (!c) c = await one(tx, 'INSERT INTO categories (restaurant_id, name, position) VALUES ($1,$2,99) RETURNING id', [a.restaurantId, p.cat]);
        await tx.query('INSERT INTO products (restaurant_id, category_id, station_id, name, description, price_cents, tags) VALUES ($1,$2,$3,$4,$5,$6,$7)', [a.restaurantId, c!.id, p.stationId, p.name, p.description, p.priceCents, p.tags]);
      }
      await audit(tx, a.restaurantId, a.userId, 'menu.import', 'menu', null, null, { rows: ok.length });
    });
    emit(ctx, a.restaurantId, 'menu');
    return { imported: ok.length, skipped: preview.length - ok.length };
  });

  // Copiar categorías y platos desde otro local del mismo dueño.
  app.post('/api/menu/copy-from', async (req: any) => {
    const a = need(req);
    const src = reqInt(req.body?.restaurantId, 'local', 1);
    if (!(await one(db, `SELECT 1 FROM memberships WHERE user_id=$1 AND restaurant_id=$2 AND active AND 'owner' = ANY(roles)`, [a.userId, src]))) throw forbidden();
    const station = await one(db, 'SELECT id FROM stations WHERE restaurant_id=$1 ORDER BY id LIMIT 1', [a.restaurantId]);
    if (!station) throw bad('Creá al menos una estación primero');
    let n = 0;
    await db.transaction(async (tx) => {
      for (const c of await all(tx, 'SELECT * FROM categories WHERE restaurant_id=$1', [src])) {
        let dst = await one(tx, 'SELECT id FROM categories WHERE restaurant_id=$1 AND name=$2', [a.restaurantId, c.name]);
        if (!dst) dst = await one(tx, 'INSERT INTO categories (restaurant_id, name, position) VALUES ($1,$2,$3) RETURNING id', [a.restaurantId, c.name, c.position]);
        for (const p of await all(tx, 'SELECT * FROM products WHERE category_id=$1', [c.id])) {
          await tx.query('INSERT INTO products (restaurant_id, category_id, station_id, name, description, price_cents, tags, course, kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [a.restaurantId, dst!.id, station.id, p.name, p.description, p.price_cents, p.tags, p.course, p.kind]);
          n++;
        }
      }
    });
    emit(ctx, a.restaurantId, 'menu');
    return { copied: n };
  });

  // ---------- Equipo ----------
  app.get('/api/team', async (req) => {
    const a = need(req);
    return all(db, 'SELECT u.id, u.name, u.email, u.active AS user_active, m.roles, m.active, (m.pin_hash IS NOT NULL) AS has_pin FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=$1 ORDER BY u.name', [a.restaurantId]);
  });

  app.post('/api/team', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    const roles = (Array.isArray(b.roles) ? b.roles : []).filter((r: string) => (ROLES as readonly string[]).includes(r));
    if (!roles.length) throw bad('Elegí al menos un rol');
    if (roles.includes('owner') && !a.roles.includes('owner')) throw forbidden();
    const pin = b.pin ? String(b.pin) : null;
    if (pin && !/^\d{4,8}$/.test(pin)) throw bad('El PIN tiene de 4 a 8 dígitos');
    const email = validEmail(b.email);
    const res = await db.transaction(async (tx) => {
      let u = await one(tx, 'SELECT id, is_platform_admin FROM users WHERE email=$1', [email]);
      // Una cuenta de plataforma nunca se vincula a un local (evita tomarla luego con el restablecimiento de clave).
      if (u?.is_platform_admin) throw forbidden();
      if (!u) u = await one(tx, 'INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [email, reqStr(b.name, 'nombre', 80), await hashSecret(validPassword(b.password))]);
      const exists = await one(tx, 'SELECT roles FROM memberships WHERE user_id=$1 AND restaurant_id=$2', [u!.id, a.restaurantId]);
      if (exists?.roles.includes('owner') && !a.roles.includes('owner')) throw forbidden();
      await tx.query(`INSERT INTO memberships (user_id, restaurant_id, roles, pin_hash, active) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (user_id, restaurant_id) DO UPDATE SET roles=EXCLUDED.roles, active=EXCLUDED.active, pin_hash=coalesce(EXCLUDED.pin_hash, memberships.pin_hash)`,
        [u!.id, a.restaurantId, roles, pin ? await hashSecret(pin) : null, b.active !== false]);
      if (b.active === false) await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND restaurant_id=$2 AND revoked_at IS NULL', [u!.id, a.restaurantId]);
      await audit(tx, a.restaurantId, a.userId, exists ? 'team.update' : 'team.add', 'user', u!.id, null, { roles, active: b.active !== false });
      return { id: u!.id };
    });
    kick(ctx, res.id); // roles o baja: sus pantallas en vivo se reconectan con los permisos nuevos
    return res;
  });

  // Recuperación administrativa local: el dueño restablece la clave de alguien que solo trabaja en sus locales.
  app.post('/api/team/:id/reset-password', async (req: any) => {
    const a = need(req, 'owner');
    if (!a.roles.includes('owner')) throw forbidden();
    const uid = reqInt(req.params.id, 'usuario', 1);
    const foreign = await one(db, `SELECT 1 FROM memberships m WHERE m.user_id=$1 AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.user_id=$2 AND o.restaurant_id=m.restaurant_id AND 'owner'=ANY(o.roles))`, [uid, a.userId]);
    const member = await one(db, 'SELECT u.is_platform_admin FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.restaurant_id=$2', [uid, a.restaurantId]);
    if (!member) throw notFound();
    if (member.is_platform_admin) throw forbidden();
    if (foreign) throw conflict('Esta persona trabaja también en otro local: pedí la recuperación a BM Dev.');
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await hashSecret(validPassword(req.body?.password)), uid]);
    await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [uid]);
    kick(ctx, uid);
    await audit(db, a.restaurantId, a.userId, 'team.password_reset', 'user', uid);
    return { ok: true };
  });

  app.post('/api/team/:id/revoke-sessions', async (req: any) => {
    const a = need(req);
    const uid = reqInt(req.params.id, 'usuario', 1);
    const target = await one(db, 'SELECT roles FROM memberships WHERE user_id=$1 AND restaurant_id=$2', [uid, a.restaurantId]);
    if (!target) throw notFound();
    if (target.roles.includes('owner') && !a.roles.includes('owner')) throw forbidden();
    await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND restaurant_id=$2 AND revoked_at IS NULL', [uid, a.restaurantId]);
    kick(ctx, uid);
    await audit(db, a.restaurantId, a.userId, 'team.revoke_sessions', 'user', uid);
    return { ok: true };
  });

  // ---------- Zonas de reparto y promociones ----------
  app.get('/api/zones', async (req) => all(db, 'SELECT * FROM delivery_zones WHERE restaurant_id=$1 ORDER BY name', [need(req, 'cashier').restaurantId]));
  app.post('/api/zones', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    if (b.delete && b.id) { await db.query('DELETE FROM delivery_zones WHERE id=$1 AND restaurant_id=$2', [b.id, a.restaurantId]); return { ok: true }; }
    if (b.id) return one(db, 'UPDATE delivery_zones SET name=$1, fee_cents=$2, min_cents=$3 WHERE id=$4 AND restaurant_id=$5 RETURNING *', [reqStr(b.name, 'barrio', 60), reqInt(b.feeCents, 'tarifa', 0, 1e10), reqInt(b.minCents ?? 0, 'mínimo', 0, 1e10), b.id, a.restaurantId]);
    return one(db, 'INSERT INTO delivery_zones (restaurant_id, name, fee_cents, min_cents) VALUES ($1,$2,$3,$4) RETURNING *', [a.restaurantId, reqStr(b.name, 'barrio', 60), reqInt(b.feeCents, 'tarifa', 0, 1e10), reqInt(b.minCents ?? 0, 'mínimo', 0, 1e10)]);
  });

  app.get('/api/promotions', async (req) => all(db, 'SELECT * FROM promotions WHERE restaurant_id=$1 ORDER BY id', [need(req).restaurantId]));
  app.post('/api/promotions', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    const time = (v: unknown, f: string) => { const s = reqStr(v, f, 5); if (!/^\d{2}:\d{2}$/.test(s)) throw bad(`${f} con formato HH:MM`); return s; };
    const days = (Array.isArray(b.days) ? b.days : []).map((d: unknown) => reqInt(d, 'día', 0, 6));
    if (!days.length) throw bad('Elegí al menos un día');
    const vals = [reqStr(b.name, 'nombre', 60), b.categoryId ? reqInt(b.categoryId, 'categoría', 1) : null, days, time(b.startTime, 'desde'), time(b.endTime, 'hasta'), reqInt(b.pct, 'porcentaje', 1, 99), b.active !== false];
    if (b.id) return one(db, 'UPDATE promotions SET name=$1, category_id=$2, days=$3, start_time=$4, end_time=$5, pct=$6, active=$7 WHERE id=$8 AND restaurant_id=$9 RETURNING *', [...vals, b.id, a.restaurantId]);
    return one(db, 'INSERT INTO promotions (name, category_id, days, start_time, end_time, pct, active, restaurant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [...vals, a.restaurantId]);
  });

  app.get('/api/audit', async (req) => {
    const a = need(req);
    return all(db, 'SELECT a.*, u.name AS user_name, z.name AS authorized_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN users z ON z.id=a.authorized_by WHERE a.restaurant_id=$1 ORDER BY a.id DESC LIMIT 300', [a.restaurantId]);
  });
};
export default plugin;
