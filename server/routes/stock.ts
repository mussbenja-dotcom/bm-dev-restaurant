import type { FastifyPluginAsync } from 'fastify';
import { all, one } from '../db.ts';
import { audit, bad, conflict, need, notFound, optStr, reqInt, reqStr, TZ, type Ctx } from '../core.ts';
import { ingredientUnitCost, productCost } from '../engine.ts';

const num = (v: unknown, f: string, min = 0) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min) throw bad(`${f} inválido`);
  return n;
};

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;

  // ---------- Insumos y proveedores ----------
  app.get('/api/ingredients', async (req) => {
    const a = need(req, 'stock', 'kitchen');
    const rows = await all(db, 'SELECT i.*, s.name AS supplier FROM ingredients i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.restaurant_id=$1 ORDER BY i.kind, i.name', [a.restaurantId]);
    const out = [];
    for (const r of rows) {
      const unitCost = await ingredientUnitCost(db, a.restaurantId, r);
      const children = r.kind === 'subreceta' ? await all(db, 'SELECT ri.ingredient_id, ri.qty, i.name, i.unit FROM recipe_items ri JOIN ingredients i ON i.id=ri.ingredient_id WHERE ri.parent_ingredient_id=$1', [r.id]) : [];
      const variation = r.prev_pack_cost_cents && r.pack_cost_cents ? Math.round(((r.pack_cost_cents - r.prev_pack_cost_cents) / r.prev_pack_cost_cents) * 100) : null;
      out.push({ ...r, unit_cost: unitCost, children, variation_pct: variation });
    }
    return out;
  });

  app.post('/api/ingredients', async (req: any) => {
    const a = need(req, 'stock');
    const b = req.body ?? {};
    if (!['g', 'ml', 'u'].includes(b.unit)) throw bad('Unidad: g, ml o u');
    const unit = b.unit;
    const kind = ['insumo', 'envase', 'subreceta'].includes(b.kind) ? b.kind : 'insumo';
    const supplier = b.supplierId ? reqInt(b.supplierId, 'proveedor', 1) : null;
    if (supplier && !(await one(db, 'SELECT 1 FROM suppliers WHERE id=$1 AND restaurant_id=$2', [supplier, a.restaurantId]))) throw bad('Proveedor de otro local');
    const cost = b.packCostCents === null || b.packCostCents === '' || b.packCostCents === undefined ? null : reqInt(b.packCostCents, 'costo', 0, 1e11);
    const vals = [reqStr(b.name, 'nombre', 80), unit, kind, num(b.packQty ?? 1, 'presentación', 0.001), cost, num(b.yieldPct ?? 100, 'rendimiento', 1), num(b.batchQty ?? 1, 'rendimiento de la subreceta', 0.001), supplier];
    const i = await db.transaction(async (tx) => {
      let i;
      if (b.id) {
        const prev = await one(tx, 'SELECT pack_cost_cents FROM ingredients WHERE id=$1 AND restaurant_id=$2', [b.id, a.restaurantId]);
        if (!prev) throw notFound();
        i = await one(tx, `UPDATE ingredients SET name=$1, unit=$2, kind=$3, pack_qty=$4, pack_cost_cents=$5, yield_pct=$6, batch_qty=$7, supplier_id=$8,
          prev_pack_cost_cents = CASE WHEN pack_cost_cents IS DISTINCT FROM $5 THEN pack_cost_cents ELSE prev_pack_cost_cents END,
          cost_updated_at = CASE WHEN pack_cost_cents IS DISTINCT FROM $5 THEN now() ELSE cost_updated_at END WHERE id=$9 AND restaurant_id=$10 RETURNING *`, [...vals, b.id, a.restaurantId]);
      } else {
        i = await one(tx, `INSERT INTO ingredients (name, unit, kind, pack_qty, pack_cost_cents, yield_pct, batch_qty, supplier_id, restaurant_id, cost_updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $5::bigint IS NULL THEN NULL ELSE now() END) RETURNING *`, [...vals, a.restaurantId]);
      }
      if (kind === 'subreceta' && Array.isArray(b.items)) {
        await tx.query('DELETE FROM recipe_items WHERE parent_ingredient_id=$1', [i!.id]);
        for (const it of b.items) await addItem(tx, a.restaurantId, { parent: i!.id }, it);
      }
      return i;
    });
    return i;
  });

  async function addItem(q: any, rid: number, owner: { product?: number; parent?: number }, it: any) {
    const ing = reqInt(it.ingredientId, 'insumo', 1);
    if (ing === owner.parent) throw bad('Una subreceta no puede contenerse a sí misma');
    if (!(await one(q, 'SELECT 1 FROM ingredients WHERE id=$1 AND restaurant_id=$2', [ing, rid]))) throw bad('Insumo de otro local');
    await q.query('INSERT INTO recipe_items (restaurant_id, product_id, parent_ingredient_id, ingredient_id, qty) VALUES ($1,$2,$3,$4,$5)', [rid, owner.product ?? null, owner.parent ?? null, ing, num(it.qty, 'cantidad', 0.0001)]);
  }

  app.get('/api/suppliers', async (req) => all(db, 'SELECT * FROM suppliers WHERE restaurant_id=$1 ORDER BY name', [need(req, 'stock').restaurantId]));
  app.post('/api/suppliers', async (req: any) => {
    const a = need(req, 'stock');
    const b = req.body ?? {};
    if (b.id) return one(db, 'UPDATE suppliers SET name=$1, phone=$2 WHERE id=$3 AND restaurant_id=$4 RETURNING *', [reqStr(b.name, 'nombre', 80), optStr(b.phone, 30), b.id, a.restaurantId]);
    return one(db, 'INSERT INTO suppliers (restaurant_id, name, phone) VALUES ($1,$2,$3) RETURNING *', [a.restaurantId, reqStr(b.name, 'nombre', 80), optStr(b.phone, 30)]);
  });

  // ---------- Recetas ----------
  app.get('/api/recipes/:productId', async (req: any) => {
    const a = need(req, 'stock');
    const pid = reqInt(req.params.productId, 'plato', 1);
    const p = await one(db, 'SELECT id, name, price_cents FROM products WHERE id=$1 AND restaurant_id=$2', [pid, a.restaurantId]);
    if (!p) throw notFound();
    const c = await productCost(db, a.restaurantId, pid);
    return { product: p, cost: c.cents, complete: c.complete, detail: c.detail };
  });
  app.put('/api/recipes/:productId', async (req: any) => {
    const a = need(req, 'stock');
    const pid = reqInt(req.params.productId, 'plato', 1);
    if (!(await one(db, 'SELECT 1 FROM products WHERE id=$1 AND restaurant_id=$2', [pid, a.restaurantId]))) throw notFound();
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM recipe_items WHERE product_id=$1', [pid]);
      for (const it of (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 60)) await addItem(tx, a.restaurantId, { product: pid }, it);
      await audit(tx, a.restaurantId, a.userId, 'recipe.update', 'product', pid);
    });
    return { ok: true };
  });

  // ---------- Movimientos de inventario ----------
  // kind: ajuste | inventario (cantidad contada) | merma (con motivo).
  app.post('/api/inventory', async (req: any) => {
    const a = need(req, 'stock', 'kitchen');
    const b = req.body ?? {};
    const kind = ['ajuste', 'inventario', 'merma'].includes(b.kind) ? b.kind : null;
    if (!kind) throw bad('Tipo inválido');
    const id = reqInt(b.ingredientId, 'insumo', 1);
    return db.transaction(async (tx) => {
      const i = await one(tx, 'SELECT * FROM ingredients WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, a.restaurantId]);
      if (!i) throw notFound();
      const delta = kind === 'inventario' ? num(b.counted, 'cantidad contada') - i.stock_qty : kind === 'merma' ? -num(b.qty, 'cantidad', 0.0001) : num(b.delta, 'ajuste', -1e9);
      const reason = kind === 'inventario' ? optStr(b.reason, 200) || 'Inventario contado' : reqStr(b.reason, 'motivo', 200);
      const cost = await ingredientUnitCost(tx, a.restaurantId, i);
      await tx.query('INSERT INTO inv_moves (restaurant_id, ingredient_id, delta, kind, reason, cost_cents, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [a.restaurantId, id, delta, kind, reason, cost == null ? null : Math.round(-delta * cost), a.userId]);
      await tx.query('UPDATE ingredients SET stock_qty=stock_qty+$1 WHERE id=$2', [delta, id]);
      return { delta };
    });
  });

  app.get('/api/inventory/moves', async (req: any) => {
    const a = need(req, 'stock');
    return all(db, `SELECT m.*, i.name, i.unit, u.name AS by_name FROM inv_moves m JOIN ingredients i ON i.id=m.ingredient_id LEFT JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=$1 AND ($2::text IS NULL OR m.kind=$2) ORDER BY m.id DESC LIMIT 300`, [a.restaurantId, req.query.kind ? String(req.query.kind) : null]);
  });

  // Merma por causa: qué pérdida se repite.
  app.get('/api/reports/waste', async (req) => {
    const a = need(req, 'stock');
    return all(db, `SELECT m.reason, i.name, i.unit, count(*)::int AS veces, sum(-m.delta) AS cantidad, sum(m.cost_cents) AS costo FROM inv_moves m JOIN ingredients i ON i.id=m.ingredient_id
      WHERE m.restaurant_id=$1 AND m.kind='merma' AND m.at > now()-interval '30 days' GROUP BY m.reason, i.name, i.unit ORDER BY costo DESC NULLS LAST`, [a.restaurantId]);
  });

  // ---------- Compras ----------
  app.get('/api/purchases', async (req) => all(db, 'SELECT po.*, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.restaurant_id=$1 ORDER BY po.id DESC LIMIT 100', [need(req, 'stock').restaurantId]));
  app.post('/api/purchases', async (req: any) => {
    const a = need(req, 'stock');
    const b = req.body ?? {};
    const supplier = reqInt(b.supplierId, 'proveedor', 1);
    if (!(await one(db, 'SELECT 1 FROM suppliers WHERE id=$1 AND restaurant_id=$2', [supplier, a.restaurantId]))) throw bad('Proveedor inexistente');
    const items = (Array.isArray(b.items) ? b.items : []).map((it: any) => ({ ingredientId: reqInt(it.ingredientId, 'insumo', 1), qty: num(it.qty, 'cantidad', 0.001), costCents: it.costCents == null ? null : reqInt(it.costCents, 'costo', 0, 1e11) }));
    if (!items.length) throw bad('Agregá al menos un insumo');
    for (const it of items) if (!(await one(db, 'SELECT 1 FROM ingredients WHERE id=$1 AND restaurant_id=$2', [it.ingredientId, a.restaurantId]))) throw bad('Insumo de otro local');
    return one(db, 'INSERT INTO purchase_orders (restaurant_id, supplier_id, items) VALUES ($1,$2,$3) RETURNING *', [a.restaurantId, supplier, JSON.stringify(items)]);
  });

  // Recepción: entra al stock y actualiza el costo de compra con fecha (una sola vez).
  app.post('/api/purchases/:id/receive', async (req: any) => {
    const a = need(req, 'stock');
    const id = reqInt(req.params.id, 'compra', 1);
    await db.transaction(async (tx) => {
      const po = await one(tx, `UPDATE purchase_orders SET status='recibido', received_at=now() WHERE id=$1 AND restaurant_id=$2 AND status='pedido' RETURNING *`, [id, a.restaurantId]);
      if (!po) throw conflict('La compra ya fue recibida o cancelada');
      const received = Array.isArray(req.body?.items) ? req.body.items : po.items;
      for (const it of received) {
        const qty = num(it.qty, 'cantidad recibida', 0);
        if (!qty) continue;
        const cost = it.costCents == null ? null : reqInt(it.costCents, 'costo', 0, 1e11);
        const ing = await one(tx, 'SELECT * FROM ingredients WHERE id=$1 AND restaurant_id=$2', [reqInt(it.ingredientId, 'insumo', 1), a.restaurantId]);
        if (!ing) throw bad('Insumo de otro local');
        await tx.query(`INSERT INTO inv_moves (restaurant_id, ingredient_id, delta, kind, reason, cost_cents, user_id) VALUES ($1,$2,$3,'compra',$4,$5,$6)`, [a.restaurantId, ing.id, qty, `Compra #${id}`, cost, a.userId]);
        if (cost != null) await tx.query(`UPDATE ingredients SET stock_qty=stock_qty+$1, prev_pack_cost_cents=pack_cost_cents, pack_cost_cents=$2, pack_qty=$1, cost_updated_at=now(), supplier_id=$3 WHERE id=$4`, [qty, cost, po.supplier_id, ing.id]);
        else await tx.query('UPDATE ingredients SET stock_qty=stock_qty+$1 WHERE id=$2', [qty, ing.id]);
      }
      await audit(tx, a.restaurantId, a.userId, 'purchase.receive', 'purchase', id);
    });
    return { ok: true };
  });

  // ---------- Costos, margen y popularidad ----------
  // Compara platos de una misma categoría y período con el costo histórico aplicado al vender.
  app.get('/api/reports/menu', async (req: any) => {
    const a = need(req);
    const days = reqInt(req.query.days ?? 30, 'días', 1, 365);
    const rows = await all(db, `SELECT p.id, p.name, p.price_cents, p.category_id, c.name AS category,
        coalesce(sum(l.qty) FILTER (WHERE l.id IS NOT NULL),0)::int AS units,
        coalesce(sum(l.unit_price_cents*l.qty),0) AS revenue,
        coalesce(sum(l.unit_cost_cents*l.qty),0) AS cost,
        bool_and(l.cost_complete) AS hist_complete
      FROM products p JOIN categories c ON c.id=p.category_id
      LEFT JOIN order_lines l ON l.product_id=p.id AND l.status<>'void' AND l.created_at > now() - make_interval(days => $2)
      WHERE p.restaurant_id=$1 GROUP BY p.id, c.name ORDER BY c.name, p.name`, [a.restaurantId, days]);
    const out = [];
    for (const r of rows) {
      const cur = await productCost(db, a.restaurantId, r.id);
      out.push({ ...r, current_cost: cur.items.length ? cur.cents : null, cost_complete: cur.complete, missing: cur.detail.filter((d) => d.cost == null).map((d) => d.name), margin: r.revenue - r.cost, unit_margin: cur.items.length ? r.price_cents - cur.cents : null });
    }
    return { days, products: out };
  });

  // Preparación del próximo turno: porciones en días comparables + reservas; el cocinero define la cantidad.
  app.get('/api/prep', async (req: any) => {
    const a = need(req, 'kitchen', 'stock');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date)) ? String(req.query.date) : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + 86400_000));
    const hist = await all(db, `SELECT l.product_id, (l.created_at AT TIME ZONE '${TZ}')::date AS d, sum(l.qty)::int AS n FROM order_lines l
      WHERE l.restaurant_id=$1 AND l.status<>'void' AND extract(dow FROM l.created_at AT TIME ZONE '${TZ}') = extract(dow FROM $2::date) AND l.created_at > $2::date - interval '35 days' AND l.created_at < $2::date
      GROUP BY l.product_id, d`, [a.restaurantId, day]);
    const products = await all(db, `SELECT p.id, p.name, c.name AS category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.restaurant_id=$1 AND p.course<>'bebida' ORDER BY c.position, p.name`, [a.restaurantId]);
    const plans = await all(db, 'SELECT product_id, qty FROM prep_plans WHERE restaurant_id=$1 AND day=$2', [a.restaurantId, day]);
    const covers = (await one(db, `SELECT coalesce(sum(party),0)::int AS n, count(*)::int AS c FROM reservations WHERE restaurant_id=$1 AND (slot AT TIME ZONE '${TZ}')::date=$2::date AND status IN ('confirmada','espera')`, [a.restaurantId, day]))!;
    return {
      day, reservations: covers,
      products: products.map((p) => {
        const h = hist.filter((x) => x.product_id === p.id);
        return { ...p, history: h.map((x) => ({ date: x.d, units: x.n })), daysUsed: h.length, avg: h.length ? Math.round(h.reduce((s, x) => s + x.n, 0) / h.length) : null, plan: plans.find((x) => x.product_id === p.id)?.qty ?? null };
      }),
    };
  });
  app.put('/api/prep', async (req: any) => {
    const a = need(req, 'kitchen', 'stock');
    const day = String(req.body?.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw bad('Fecha inválida');
    const pid = reqInt(req.body?.productId, 'plato', 1);
    if (!(await one(db, 'SELECT 1 FROM products WHERE id=$1 AND restaurant_id=$2', [pid, a.restaurantId]))) throw notFound();
    await db.query('INSERT INTO prep_plans (restaurant_id, day, product_id, qty) VALUES ($1,$2,$3,$4) ON CONFLICT (restaurant_id, day, product_id) DO UPDATE SET qty=EXCLUDED.qty', [a.restaurantId, day, pid, reqInt(req.body?.qty, 'cantidad', 0, 9999)]);
    return { ok: true };
  });

  // Fidelidad: adhesiones con canal, fecha y baja.
  app.get('/api/customers', async (req) => all(db, 'SELECT * FROM customers WHERE restaurant_id=$1 ORDER BY stamps DESC, name LIMIT 500', [need(req).restaurantId]));
  app.get('/api/feedback', async (req) => all(db, 'SELECT * FROM feedback WHERE restaurant_id=$1 ORDER BY id DESC LIMIT 100', [need(req).restaurantId]));
};
export default plugin;
