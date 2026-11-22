import { all, one, type Q, type Row } from './db.ts';
import { bad, conflict, localClock, notFound, opHash, optStr, reqInt, type Ctx, emit } from './core.ts';
import { halvesPrice, spreadProportional } from '../shared/money.ts';

export type Selection = {
  productId: number; qty: number; optionIds?: number[]; note?: string; seat?: string; hold?: boolean;
  halves?: number; halfExtras?: [number[], number[]]; // pizza: segundo gusto y extras por mitad
  dozen?: Record<string, number>; // optionId -> unidades
};
type Priced = { product: Row; name: string; unit: number; options: { grp: string; name: string; price: number; qty?: number }[] };

const byId = (opts: Row[], ids: number[]) => ids.map((id) => {
  const o = opts.find((x) => x.id === id);
  if (!o) throw bad('Opción inexistente para este plato');
  return o;
});

/** Precio decidido por el servidor con la carta vigente. Nunca se confía en importes del cliente. */
export async function priceSelection(q: Q, rid: number, sel: Selection, settings: Row, now = new Date()): Promise<Priced> {
  const product = await one(q, `SELECT * FROM products WHERE id=$1 AND restaurant_id=$2 AND draft->>'isNew' IS NULL`, [sel.productId, rid]);
  if (!product) throw bad('Plato inexistente');
  const opts = await all(q, 'SELECT * FROM product_options WHERE product_id=$1 AND restaurant_id=$2 ORDER BY id', [product.id, rid]);
  const chosen = byId(opts, (sel.optionIds ?? []).map(Number));
  const options: Priced['options'] = [];
  let unit = product.price_cents;
  let name = product.name;

  // Grupos de opción única (punto, guarnición, tamaño): exactamente una elegida.
  const singleGroups = [...new Set(opts.filter((o) => !o.multi && o.grp !== 'Gusto').map((o) => o.grp))];
  for (const g of singleGroups) {
    const n = chosen.filter((o) => o.grp === g).length;
    if (n !== 1) throw bad(`Elegí ${g.toLowerCase()} para ${product.name}`);
  }
  for (const o of chosen) { unit += o.price_delta_cents; options.push({ grp: o.grp, name: o.name, price: o.price_delta_cents }); }
  // Combo con elección: el plato elegido tiene que existir, no ser un borrador nuevo y estar disponible.
  // Puede estar oculto de la carta a propósito (ej. una bebida que solo se ofrece dentro del combo), igual que un componente fijo.
  const items = chosen.filter((o) => o.item_id);
  if (items.length) {
    const rows = await all(q, `SELECT id, name, available, stock_qty, draft FROM products WHERE restaurant_id=$1 AND id = ANY($2::int[])`, [rid, items.map((o) => o.item_id)]);
    for (const o of items) {
      const it = rows.find((r) => r.id === o.item_id);
      if (!it || it.draft?.isNew) throw bad(`${o.name} no está en la carta`);
      if (!it.available || it.stock_qty === 0) throw conflict(`${product.name}: ${it.name} se agotó. Elegí otra opción.`, { problems: [{ productId: product.id, name: product.name, left: null, message: `${product.name}: ${it.name} se agotó` }] });
    }
  }

  if (product.kind === 'pizza' && sel.halves != null) {
    const other = await one(q, `SELECT p.* FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=$1 AND p.restaurant_id=$2 AND p.kind='pizza' AND p.published AND c.visible AND p.draft->>'isNew' IS NULL`, [sel.halves, rid]);
    if (!other) throw bad('La otra mitad tiene que ser una pizza de la carta');
    if (!other.available) throw conflict(`${other.name} está agotada`, { productId: other.id });
    const base = halvesPrice(product.price_cents, other.price_cents, settings.pizza_rule === 'avg' ? 'avg' : 'max');
    unit = unit - product.price_cents + base;
    name = `Pizza ½ ${product.name} · ½ ${other.name}`;
    options.unshift({ grp: 'Mitad 1', name: product.name, price: 0 }, { grp: 'Mitad 2', name: other.name, price: 0 });
    const [e1 = [], e2 = []] = sel.halfExtras ?? [];
    const otherOpts = await all(q, 'SELECT * FROM product_options WHERE product_id=$1 AND multi', [other.id]);
    for (const o of byId(opts.filter((x) => x.multi), e1.map(Number))) { unit += o.price_delta_cents; options.push({ grp: 'Extra mitad 1', name: o.name, price: o.price_delta_cents }); }
    for (const o of byId(otherOpts, e2.map(Number))) { unit += o.price_delta_cents; options.push({ grp: 'Extra mitad 2', name: o.name, price: o.price_delta_cents }); }
  }

  if (product.kind === 'dozen') {
    const flavors = opts.filter((o) => o.grp === 'Gusto');
    const entries = Object.entries(sel.dozen ?? {}).map(([id, n]) => [byId(flavors, [Number(id)])[0], reqInt(n, 'cantidad', 0, 12)] as const).filter(([, n]) => n > 0);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    if (total !== 12) throw bad(`La docena lleva 12 unidades y elegiste ${total}`);
    for (const [o, n] of entries) { unit += o.price_delta_cents * n; options.push({ grp: 'Gusto', name: o.name, price: o.price_delta_cents, qty: n }); }
  }

  // Happy hour / promoción por franja y día en hora argentina.
  const { dow, hhmm } = localClock(now);
  const promo = await one(q, `SELECT * FROM promotions WHERE restaurant_id=$1 AND active AND $2 = ANY(days) AND start_time <= $3 AND end_time > $3 AND (category_id IS NULL OR category_id=$4) ORDER BY pct DESC LIMIT 1`, [rid, dow, hhmm, product.category_id]);
  if (promo) {
    const off = Math.round((unit * promo.pct) / 100);
    unit -= off;
    options.push({ grp: 'Promo', name: `${promo.name} −${promo.pct}%`, price: -off });
  }
  return { product, name, unit, options };
}

/** Costo por unidad de insumo (incluye rendimiento) o de subreceta; null si falta algún costo. */
export async function ingredientUnitCost(q: Q, rid: number, ing: Row, depth = 0): Promise<number | null> {
  if (ing.kind !== 'subreceta') return ing.pack_cost_cents == null ? null : ing.pack_cost_cents / ing.pack_qty / (ing.yield_pct / 100);
  if (depth > 4) return null;
  const items = await all(q, 'SELECT ri.qty, i.* FROM recipe_items ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.parent_ingredient_id=$1 AND ri.restaurant_id=$2', [ing.id, rid]);
  if (!items.length) return null;
  let total = 0;
  for (const it of items) {
    const c = await ingredientUnitCost(q, rid, it, depth + 1);
    if (c == null) return null;
    total += c * it.qty;
  }
  return total / ing.batch_qty;
}

export async function productCost(q: Q, rid: number, productId: number) {
  const items = await all(q, 'SELECT ri.qty, i.* FROM recipe_items ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.product_id=$1 AND ri.restaurant_id=$2', [productId, rid]);
  let cents = 0, complete = items.length > 0;
  const detail = [];
  for (const it of items) {
    const unitCost = await ingredientUnitCost(q, rid, it);
    if (unitCost == null) complete = false; else cents += unitCost * it.qty;
    detail.push({ ingredientId: it.id, name: it.name, kind: it.kind, unit: it.unit, qty: it.qty, cost: unitCost == null ? null : Math.round(unitCost * it.qty), costDate: it.cost_updated_at });
  }
  return { cents: Math.round(cents), complete, detail, items };
}

export type RoundTarget = { visitId: number } | { orderId: number };

/**
 * Confirma una ronda de forma indivisible: valida precio y disponibilidad, descuenta cupos e insumos y crea las líneas.
 * El mismo op_id con el mismo contenido devuelve la confirmación original (reintento sin duplicar).
 */
export async function createRound(q: Q, ctx: Ctx, rid: number, target: RoundTarget, opId: string, items: Selection[], source: string, userId: number | null) {
  if (!Array.isArray(items) || !items.length || items.length > 60) throw bad('La ronda está vacía');
  const hash = opHash({ target, items });
  const prev = await one(q, 'SELECT * FROM rounds WHERE restaurant_id=$1 AND op_id=$2', [rid, opId]);
  if (prev) {
    if (prev.op_hash !== hash) throw conflict('Este envío ya se usó con otro contenido. Volvé a armar la ronda.');
    return { round: prev, lines: await all(q, 'SELECT * FROM order_lines WHERE round_id=$1 ORDER BY id', [prev.id]), duplicate: true };
  }
  if ('visitId' in target) {
    const v = await one(q, `SELECT id FROM visits WHERE id=$1 AND restaurant_id=$2 AND status='open' FOR UPDATE`, [target.visitId, rid]);
    if (!v) throw conflict('La mesa ya no está abierta');
  }
  const settings = (await one(q, 'SELECT settings FROM restaurants WHERE id=$1', [rid]))!.settings;
  const visitId = 'visitId' in target ? target.visitId : null;
  const orderId = 'orderId' in target ? target.orderId : null;
  const num = (await one(q, `SELECT count(*)::int + 1 AS n FROM rounds WHERE restaurant_id=$1 AND ${visitId ? 'visit_id' : 'order_id'}=$2`, [rid, visitId ?? orderId]))!.n;
  const round = (await one(q, 'INSERT INTO rounds (restaurant_id, visit_id, order_id, number, source, op_id, op_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [rid, visitId, orderId, num, source, opId, hash, userId]))!;

  const lines: Row[] = [];
  const problems: { productId: number; name: string; message: string; left: number | null }[] = [];
  // Una línea por plato; consume = unidades reales del plato (en un combo, cantidad × unidades del componente).
  const addLine = async (product: Row, name: string, unit: number, options: Priced['options'], qty: number, consume: number, sel: Selection) => {
    if (!product.available || (product.stock_qty !== null && product.stock_qty < consume)) {
      problems.push({ productId: product.id, name: product.name, left: product.stock_qty, message: product.available && product.stock_qty ? `Quedan ${product.stock_qty} de ${product.name}` : `${product.name} se agotó` });
      return;
    }
    if (product.stock_qty !== null) {
      // Descuento condicional: si otro mozo confirmó antes, no hay fila y se informa.
      const upd = await one(q, 'UPDATE products SET stock_qty = stock_qty - $1, available = (stock_qty - $1) > 0 WHERE id=$2 AND stock_qty >= $1 RETURNING stock_qty', [consume, product.id]);
      if (!upd) { problems.push({ productId: product.id, name: product.name, left: 0, message: `${product.name} se agotó` }); return; }
    }
    const cost = await productCost(q, rid, product.id);
    const per = consume / qty; // unidades del plato por línea (1 salvo componentes ×N de un combo)
    const line = (await one(q, `INSERT INTO order_lines (restaurant_id, round_id, visit_id, order_id, product_id, station_id, name, unit_price_cents, unit_cost_cents, cost_complete, qty, options, note, seat, course, held)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [rid, round.id, visitId, orderId, product.id, product.station_id, name, unit, cost.items.length ? cost.cents * per : null, cost.complete, qty, JSON.stringify(options), optStr(sel.note, 300), optStr(sel.seat, 40), product.course, !!sel.hold]))!;
    if (product.stock_qty !== null) await q.query('INSERT INTO stock_moves (restaurant_id, product_id, delta, reason, line_id, user_id) VALUES ($1,$2,$3,$4,$5,$6)', [rid, product.id, -consume, 'venta', line.id, userId]);
    // Consumo de insumos al confirmar; el índice único evita descontar dos veces la misma línea.
    for (const it of cost.items) {
      await q.query(`INSERT INTO inv_moves (restaurant_id, ingredient_id, delta, kind, reason, line_id, user_id) VALUES ($1,$2,$3,'consumo','venta',$4,$5) ON CONFLICT DO NOTHING`, [rid, it.id, -it.qty * consume, line.id, userId]);
      await q.query('UPDATE ingredients SET stock_qty = stock_qty - $1 WHERE id=$2', [it.qty * consume, it.id]);
    }
    lines.push(line);
  };
  for (const sel of items) {
    const qty = reqInt(sel.qty, 'cantidad', 1, 99);
    const p = await priceSelection(q, rid, sel, settings);
    if (p.product.kind !== 'combo') { await addLine(p.product, p.name, p.unit, p.options, qty, qty, sel); continue; }
    if (!p.product.available) { problems.push({ productId: p.product.id, name: p.product.name, left: null, message: `${p.product.name} se agotó` }); continue; }
    // Combo: cada componente va a su estación; el precio del combo se reparte según el precio de lista de cada parte.
    // Partes: platos fijos + el plato elegido en cada grupo («elegí una bebida»).
    const parts = await all(q, `SELECT * FROM (SELECT c.id AS ord, 0 AS k, c.qty AS n, p.* FROM combo_items c JOIN products p ON p.id=c.product_id WHERE c.combo_id=$1 AND c.restaurant_id=$2
      UNION ALL SELECT o.id AS ord, 1 AS k, 1 AS n, p.* FROM product_options o JOIN products p ON p.id=o.item_id WHERE o.product_id=$1 AND o.restaurant_id=$2 AND o.id = ANY($3::int[])) x ORDER BY k, ord`,
      [p.product.id, rid, (sel.optionIds ?? []).map(Number).filter(Number.isInteger)]);
    const choiceGrps = new Set((await all(q, 'SELECT DISTINCT grp FROM product_options WHERE product_id=$1 AND restaurant_id=$2 AND item_id IS NOT NULL', [p.product.id, rid])).map((o) => o.grp));
    const extra = p.options.filter((o) => !choiceGrps.has(o.grp)); // opciones que no son platos (ej. «sin sal») van en la primera línea
    if (!parts.length) throw bad(`El combo ${p.product.name} no tiene platos`);
    if (parts.some((c) => c.draft?.isNew)) throw bad(`El combo ${p.product.name} incluye un plato sin publicar`);
    const list = parts.map((c) => c.price_cents * c.n);
    const sum = list.reduce((s, x) => s + x, 0);
    const alloc = sum ? spreadProportional(list, p.unit - sum) : list.map((_, i) => (i ? 0 : p.unit));
    const before = problems.length;
    for (const [i, c] of parts.entries()) {
      // Las opciones elegidas del combo viajan en la primera línea para que cocina las vea.
      await addLine(c, c.n > 1 ? `${c.n}× ${c.name}` : c.name, alloc[i], [{ grp: 'Combo', name: p.product.name, price: 0 }, ...(i ? [] : extra)], qty, qty * c.n, sel);
    }
    // Un componente agotado se informa como el combo: es lo que la persona tiene en la ronda y debe quitar.
    for (const x of problems.slice(before)) { x.productId = p.product.id; x.message = `${p.product.name}: ${x.message}`; }
  }
  // Si algo se agotó, no se confirma nada: la persona revisa la ronda con el aviso (se revierte toda la transacción).
  if (problems.length) throw conflict(problems.map((p) => p.message).join('. '), { problems });
  emit(ctx, rid, 'lines', { visitId, orderId, stations: [...new Set(lines.map((l) => l.station_id))] });
  emit(ctx, rid, 'menu');
  return { round, lines, duplicate: false };
}

/** Total, descuentos, pagos y saldo de una visita o pedido. */
export async function balance(q: Q, rid: number, target: RoundTarget) {
  const [col, id] = 'visitId' in target ? ['visit_id', target.visitId] : ['order_id', target.orderId];
  const t = (await one(q, `SELECT
      coalesce((SELECT sum(unit_price_cents * qty) FROM order_lines WHERE restaurant_id=$1 AND ${col}=$2 AND status <> 'void'), 0) AS subtotal,
      coalesce((SELECT sum(amount_cents) FROM discounts WHERE restaurant_id=$1 AND ${col === 'visit_id' ? 'visit_id' : 'NULL'}=$2), 0) AS discounts,
      coalesce((SELECT sum(amount_cents) FROM payments WHERE restaurant_id=$1 AND ${col}=$2), 0) AS paid,
      coalesce((SELECT sum(tip_cents) FROM payments WHERE restaurant_id=$1 AND ${col}=$2), 0) AS tips`, [rid, id]))!;
  let extra = 0;
  if ('orderId' in target) {
    const o = await one(q, 'SELECT fee_cents, total_cents, subtotal_cents FROM orders WHERE id=$1', [id]);
    extra = o?.fee_cents ?? 0;
    if (!t.subtotal && o) t.subtotal = o.subtotal_cents; // aún sin comanda: total del pedido
  }
  // Un descuento fijo nunca deja el total en negativo (ej. se anularon platos después de aplicarlo).
  const discounts = Math.min(t.discounts, t.subtotal + extra);
  const total = t.subtotal + extra - discounts;
  return { subtotal: t.subtotal, fee: extra, discounts, total, paid: t.paid, tips: t.tips, due: total - t.paid };
}

export async function requireVisit(q: Q, rid: number, id: unknown) {
  const v = await one(q, 'SELECT * FROM visits WHERE id=$1 AND restaurant_id=$2', [reqInt(id, 'visita', 1), rid]);
  if (!v) throw notFound();
  return v;
}
