import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { all, one, type Q, type Row } from '../db.ts';
import { audit, bad, emit, HttpError, need, notFound, optStr, reqInt, reqStr, type Ctx } from '../core.ts';
import { isHex, PAPERS, STYLES } from '../../shared/color.ts';
import { productFields, writeOptions } from './config.ts';

// Personalizar mi restaurante: marca y carta se editan en borrador; «Publicar» las aplica de una vez
// en el mismo enlace y QR. La disponibilidad (agotado) sigue siendo inmediata porque es operativa.

const TEXT_KEYS = ['tagline', 'hours', 'address', 'whatsapp_phone'] as const; // viven en settings (las usan otras pantallas)
const LOOK_KEYS = ['style', 'color', 'paper', 'logo', 'cover', 'phone', 'instagram', 'email'] as const; // viven en settings.brand

/** Marca publicada con valores por defecto según el rubro (locales creados antes de esta función). */
export function brandOf(r: Row) {
  const b = r.settings?.brand ?? {};
  const pizza = r.theme === 'pizzeria';
  return {
    name: r.name as string,
    style: STYLES.includes(b.style) ? b.style : pizza ? 'moderna' : 'clasica',
    color: isHex(b.color) ? b.color : pizza ? '#a8231b' : '#1f4d3a',
    paper: Object.hasOwn(PAPERS, b.paper ?? '') ? b.paper : pizza ? 'blanco' : 'marfil',
    logo: b.logo ?? null, cover: b.cover ?? null,
    phone: b.phone ?? '', instagram: b.instagram ?? '', email: b.email ?? '',
    ...Object.fromEntries(TEXT_KEYS.map((k) => [k, r.settings?.[k] ?? ''])),
  } as Record<string, any>;
}

/** Guarda el borrador de marca; vacío = sin cambios pendientes. */
async function writeDraft(q: Q, rid: number, draft: Record<string, any>) {
  if (Object.keys(draft).length) await q.query(`UPDATE restaurants SET settings = jsonb_set(settings, '{brand_draft}', $1::jsonb) WHERE id=$2`, [JSON.stringify(draft), rid]);
  else await q.query(`UPDATE restaurants SET settings = settings - 'brand_draft' WHERE id=$1`, [rid]);
}

function validBrand(b: any, cur: Record<string, any>) {
  const out: Record<string, any> = {
    name: reqStr(b.name, 'nombre comercial', 80),
    style: STYLES.includes(b.style) ? b.style : cur.style,
    color: isHex(b.color) ? b.color.toLowerCase() : cur.color,
    paper: Object.hasOwn(PAPERS, b.paper) ? b.paper : cur.paper,
    logo: cur.logo, cover: cur.cover, // las imágenes cambian solo por su propia ruta (validación y compresión)
    tagline: optStr(b.tagline, 160), hours: optStr(b.hours, 120), address: optStr(b.address, 160),
    phone: optStr(b.phone, 30), whatsapp_phone: optStr(b.whatsapp_phone, 20).replace(/\D/g, ''),
    instagram: optStr(b.instagram, 40).replace(/^@/, '').replace(/[^\w.]/g, ''),
    email: optStr(b.email, 120),
  };
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw bad('El email de contacto no es válido');
  return out;
}

/** Vista del editor: cada fila con su borrador aplicado encima. */
async function merged(q: Q, rid: number) {
  const [cats, prods, opts, combos] = await Promise.all([
    all(q, 'SELECT * FROM categories WHERE restaurant_id=$1 ORDER BY position, id', [rid]),
    all(q, 'SELECT * FROM products WHERE restaurant_id=$1 ORDER BY position, id', [rid]),
    all(q, 'SELECT * FROM product_options WHERE restaurant_id=$1 ORDER BY id', [rid]),
    all(q, 'SELECT c.combo_id, c.product_id, c.qty, p.name, p.price_cents FROM combo_items c JOIN products p ON p.id=c.product_id WHERE c.restaurant_id=$1 ORDER BY c.id', [rid]),
  ]);
  const categories = cats.map(({ draft, ...c }) => ({ ...c, ...(draft ?? {}), pending: !!draft, isNew: !!draft?.isNew }))
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const byId = new Map(prods.map((p) => [p.id, p]));
  const products = prods.map(({ draft, ...p }) => {
    const d = draft ?? {};
    const { options, components, ...fields } = d;
    return {
      ...p, ...fields, pending: !!draft, isNew: !!d.isNew,
      options: options ?? opts.filter((o) => o.product_id === p.id),
      components: (components ?? combos.filter((c) => c.combo_id === p.id))
        .map((c: Row) => ({ product_id: c.product_id, qty: c.qty, name: byId.get(c.product_id)?.name ?? '?', price_cents: byId.get(c.product_id)?.price_cents ?? 0 })),
    };
  }).sort((a, b) => a.position - b.position || a.id - b.id);
  return { categories, products };
}

/** Lo que vería el comensal: misma forma que la carta pública, con borradores o con lo publicado. */
export function publicShape(categories: Row[], products: Row[]) {
  const shown = products.filter((p) => p.published && categories.some((c) => c.id === p.category_id && c.visible));
  const avail = new Map(products.map((p) => [p.id, p.available]));
  const price = new Map(products.map((p) => [p.id, p.price_cents as number]));
  return {
    categories: categories.filter((c) => c.visible && shown.some((p) => p.category_id === c.id)).map(({ id, name, position }) => ({ id, name, position })),
    products: shown.map((p) => {
      const parts = p.kind === 'combo' ? p.components ?? [] : [];
      // Grupos para elegir: el ahorro se calcula con la opción más barata de cada grupo (ahorro mínimo garantizado).
      const pick = new Map<string, number>();
      for (const o of p.options ?? []) if (o.item_id) { const v = (price.get(o.item_id) ?? 0) - o.price_delta_cents; pick.set(o.grp, Math.min(pick.get(o.grp) ?? Infinity, v)); }
      const full = parts.reduce((s: number, c: Row) => s + c.price_cents * c.qty, 0) + [...pick.values()].reduce((s, v) => s + v, 0);
      return {
        id: p.id, category_id: p.category_id, name: p.name, description: p.description, price_cents: p.price_cents, photo: p.photo, tags: p.tags, allergens: p.allergens,
        available: p.available && parts.every((c: Row) => avail.get(c.product_id)), kind: p.kind, course: p.course, suggestion_id: p.suggestion_id,
        options: (p.options ?? []).map((o: Row) => ({ id: o.id, product_id: p.id, grp: o.grp, name: o.name, price_delta_cents: o.price_delta_cents, multi: o.multi, ...(o.item_id ? { item_id: o.item_id, available: !!avail.get(o.item_id) } : {}) })),
        ...(p.kind === 'combo' ? { choice: pick.size > 0, components: parts.map((c: Row) => ({ name: c.name, qty: c.qty })), savings_cents: Math.max(0, full - p.price_cents) } : {}),
      };
    }),
  };
}

/** Carta publicada (la usa la ruta pública). */
export async function publishedMenu(q: Q, rid: number) {
  const [cats, prods, opts, combos] = await Promise.all([
    all(q, `SELECT id, name, position, visible FROM categories WHERE restaurant_id=$1 AND visible ORDER BY position, id`, [rid]),
    all(q, `SELECT id, category_id, name, description, price_cents, photo, tags, allergens, available, kind, course, suggestion_id, published FROM products WHERE restaurant_id=$1 AND (published OR id IN (SELECT product_id FROM combo_items WHERE restaurant_id=$1) OR id IN (SELECT item_id FROM product_options WHERE restaurant_id=$1)) ORDER BY position, id`, [rid]),
    all(q, `SELECT o.id, o.product_id, o.grp, o.name, o.price_delta_cents, o.multi, o.item_id FROM product_options o JOIN products p ON p.id=o.product_id WHERE o.restaurant_id=$1 AND p.published ORDER BY o.id`, [rid]),
    all(q, 'SELECT c.combo_id, c.product_id, c.qty, p.name, p.price_cents FROM combo_items c JOIN products p ON p.id=c.product_id WHERE c.restaurant_id=$1 ORDER BY c.id', [rid]),
  ]);
  return publicShape(cats, prods.map((p) => ({ ...p, options: opts.filter((o) => o.product_id === p.id), components: combos.filter((c) => c.combo_id === p.id) })));
}

const pendingCount = async (q: Q, rid: number, settings: Row) => {
  const n = (await one(q, `SELECT (SELECT count(*) FROM products WHERE restaurant_id=$1 AND draft IS NOT NULL) + (SELECT count(*) FROM categories WHERE restaurant_id=$1 AND draft IS NOT NULL) AS n`, [rid]))!.n;
  return Number(n) + (settings.brand_draft ? 1 : 0);
};

const unlinkQuiet = (dir: string, rel: string | null | undefined) => { if (rel) try { unlinkSync(join(dir, rel)); } catch { /* ya no existía */ } };

const MAX_PIXELS = 40_000_000;

/** Valida que sea una imagen real (no solo la extensión) y la guarda comprimida en WebP. */
async function saveImage(ctx: Ctx, rid: number, req: any, box: { width: number; height: number; fit: 'inside' | 'cover' }) {
  const file = await req.file();
  if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) throw bad('Subí una imagen JPG, PNG o WebP');
  const buf = await file.toBuffer().catch(() => { throw bad('La imagen pesa más de 15 MB'); });
  // El formato se decide por el contenido (no por lo que declara el navegador) y con tope de píxeles antes de decodificar.
  const meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata().catch(() => null);
  if (!meta?.width || !meta.height || !['jpeg', 'png', 'webp', 'heif'].includes(meta.format ?? '')) throw bad('El archivo no es una imagen JPG, PNG o WebP válida');
  if (meta.width * meta.height > MAX_PIXELS) throw bad('La imagen tiene demasiados píxeles: usá una de hasta 40 megapíxeles');
  if (meta.width < 200 || meta.height < 120) throw bad('La imagen es muy chica: usá una de al menos 200 × 120 px');
  const dir = join(ctx.uploadsDir, String(rid));
  mkdirSync(dir, { recursive: true });
  const name = `${randomUUID()}.webp`;
  // rotate() respeta la orientación de la foto del celular; sin metadatos (EXIF con ubicación) en el resultado.
  await sharp(buf, { limitInputPixels: MAX_PIXELS }).rotate().resize({ ...box, withoutEnlargement: true }).webp({ quality: 74 }).toFile(join(dir, name));
  return `${rid}/${name}`;
}

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;
  const rest = async (rid: number) => (await one(db, 'SELECT * FROM restaurants WHERE id=$1', [rid]))!;

  app.get('/api/brand', async (req) => {
    const a = need(req);
    const r = await rest(a.restaurantId);
    const published = brandOf(r);
    return { slug: r.slug, published, draft: r.settings.brand_draft ? { ...published, ...r.settings.brand_draft } : null, pending: await pendingCount(db, r.id, r.settings) };
  });

  app.put('/api/brand', async (req: any) => {
    const a = need(req);
    await db.transaction(async (tx) => {
      const r = (await one(tx, 'SELECT * FROM restaurants WHERE id=$1 FOR UPDATE', [a.restaurantId]))!;
      const pub = brandOf(r);
      const bd = r.settings.brand_draft ?? {};
      const next = validBrand(req.body ?? {}, { ...pub, ...bd });
      // El borrador guarda solo lo que difiere de lo publicado: publicar no pisa cambios hechos después en Configuración.
      const draft: Record<string, any> = Object.fromEntries(Object.entries(next).filter(([k, v]) => k !== 'logo' && k !== 'cover' && v !== pub[k]));
      for (const k of ['logo', 'cover']) if (k in bd) draft[k] = bd[k];
      await writeDraft(tx, r.id, draft);
    });
    return { ok: true };
  });

  // Logo (cuadrado, conserva transparencia) y portada (apaisada). Quedan en borrador hasta publicar.
  app.post('/api/brand/image/:kind', async (req: any) => {
    const a = need(req);
    const kind = req.params.kind === 'logo' ? 'logo' : req.params.kind === 'cover' ? 'cover' : null;
    if (!kind) throw notFound();
    const rel = await saveImage(ctx, a.restaurantId, req, kind === 'logo' ? { width: 512, height: 512, fit: 'inside' } : { width: 1600, height: 900, fit: 'cover' });
    const old = await setDraftImage(a.restaurantId, kind, rel);
    if (old) unlinkQuiet(ctx.uploadsDir, old); // reemplaza una imagen que solo estaba en borrador (después del commit)
    return { [kind]: rel };
  });
  app.delete('/api/brand/image/:kind', async (req: any) => {
    const a = need(req);
    const kind = req.params.kind === 'logo' ? 'logo' : req.params.kind === 'cover' ? 'cover' : null;
    if (!kind) throw notFound();
    const old = await setDraftImage(a.restaurantId, kind, null);
    if (old) unlinkQuiet(ctx.uploadsDir, old);
    return { ok: true };
  });

  /** Cambia logo o portada del borrador; devuelve el archivo anterior si solo existía en el borrador. */
  async function setDraftImage(rid: number, kind: 'logo' | 'cover', rel: string | null) {
    return db.transaction(async (tx) => {
      const r = (await one(tx, 'SELECT * FROM restaurants WHERE id=$1 FOR UPDATE', [rid]))!;
      const bd = r.settings.brand_draft ?? {};
      const prev = kind in bd ? bd[kind] : null;
      const draft = { ...bd, [kind]: rel };
      if (rel === brandOf(r)[kind]) delete draft[kind];
      await writeDraft(tx, rid, draft);
      return prev && prev !== brandOf(r)[kind] && prev !== rel ? prev as string : null;
    });
  }

  // ---------- Carta en borrador ----------
  app.get('/api/editor/menu', async (req) => {
    const a = need(req);
    const [m, stations] = await Promise.all([merged(db, a.restaurantId), all(db, 'SELECT id, name, kind FROM stations WHERE restaurant_id=$1 ORDER BY id', [a.restaurantId])]);
    return { ...m, stations };
  });

  app.post('/api/editor/categories', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    const name = reqStr(b.name, 'nombre de la categoría', 60);
    if (!b.id) {
      const pos = (await one(db, 'SELECT coalesce(max(position),0)+1 AS n FROM categories WHERE restaurant_id=$1', [a.restaurantId]))!.n;
      return one(db, `INSERT INTO categories (restaurant_id, name, position, visible, draft) VALUES ($1,$2,$3,false,$4) RETURNING id`, [a.restaurantId, name, pos, JSON.stringify({ name, position: pos, visible: true, isNew: true })]);
    }
    const c = await one(db, 'SELECT * FROM categories WHERE id=$1 AND restaurant_id=$2', [reqInt(b.id, 'categoría', 1), a.restaurantId]);
    if (!c) throw notFound();
    const d = { name: c.name, position: c.position, visible: c.visible, ...(c.draft ?? {}) };
    await db.query('UPDATE categories SET draft=$1 WHERE id=$2', [JSON.stringify({ ...d, name, visible: b.visible ?? d.visible }), c.id]);
    return { id: c.id };
  });

  // Orden: el editor manda la lista completa de ids en el orden deseado (categorías o platos de una categoría).
  app.post('/api/editor/order', async (req: any) => {
    const a = need(req);
    const table = req.body?.kind === 'products' ? 'products' : 'categories';
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 500).map((x: unknown) => reqInt(x, 'orden', 1));
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        const row = await one(tx, `SELECT * FROM ${table} WHERE id=$1 AND restaurant_id=$2`, [id, a.restaurantId]);
        if (!row) throw notFound();
        if ((row.draft?.position ?? row.position) === i + 1) continue;
        const base = row.draft ?? (table === 'categories' ? { name: row.name, position: row.position, visible: row.visible } : null);
        await tx.query(`UPDATE ${table} SET draft = $1 WHERE id=$2`, [JSON.stringify(base ? { ...base, position: i + 1 } : await productDraftBase(tx, a.restaurantId, row, { position: i + 1 })), id]);
      }
    });
    return { ok: true };
  });

  app.post('/api/editor/products', async (req: any) => {
    const a = need(req);
    const b = req.body ?? {};
    const id = b.id ? reqInt(b.id, 'plato', 1) : undefined;
    const row = id ? await one(db, 'SELECT * FROM products WHERE id=$1 AND restaurant_id=$2', [id, a.restaurantId]) : null;
    if (id && !row) throw notFound();
    const { fields, options, components } = await productFields(db, a.restaurantId, b, id);
    if (row?.kind === 'combo' && fields.kind !== 'combo') throw bad('Un combo no puede pasar a ser otro tipo de plato: creá uno nuevo');
    const keep = row ? await productDraftBase(db, a.restaurantId, row, {}) : {};
    const draft = { ...keep, ...fields, position: keep.position ?? 999, options: options ?? keep.options ?? [], components: components ?? keep.components ?? null, ...(row ? {} : { isNew: true, photo: null }) };
    if (row) { await db.query('UPDATE products SET draft=$1 WHERE id=$2', [JSON.stringify(draft), row.id]); return { id: row.id }; }
    // Nuevo: la fila existe oculta (published=false) y nadie del local la ve hasta publicar.
    const cols = Object.keys(fields);
    return one(db, `INSERT INTO products (restaurant_id, ${cols.join(', ')}, draft) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2}) RETURNING id`,
      [a.restaurantId, ...Object.values(fields).map((v, i) => (cols[i] === 'published' ? false : v)), JSON.stringify(draft)]);
  });

  app.post('/api/editor/products/:id/visible', async (req: any) => {
    const a = need(req);
    const row = await one(db, 'SELECT * FROM products WHERE id=$1 AND restaurant_id=$2', [reqInt(req.params.id, 'plato', 1), a.restaurantId]);
    if (!row) throw notFound();
    await db.query('UPDATE products SET draft=$1 WHERE id=$2', [JSON.stringify(await productDraftBase(db, a.restaurantId, row, { published: req.body?.visible !== false })), row.id]);
    return { ok: true };
  });

  /** Cambia la foto en el borrador del plato con la fila bloqueada; borra después del commit la foto que solo estaba en borrador. */
  async function setDraftPhoto(rid: number, id: number, rel: string | null) {
    const old = await db.transaction(async (tx) => {
      const row = await one(tx, 'SELECT * FROM products WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, rid]);
      if (!row) throw notFound();
      await tx.query('UPDATE products SET draft=$1 WHERE id=$2', [JSON.stringify(await productDraftBase(tx, rid, row, { photo: rel })), row.id]);
      return row.draft && 'photo' in row.draft && row.draft.photo !== row.photo ? row.draft.photo as string | null : null;
    });
    unlinkQuiet(ctx.uploadsDir, old);
  }
  app.post('/api/editor/products/:id/photo', async (req: any) => {
    const a = need(req);
    const id = reqInt(req.params.id, 'plato', 1);
    if (!(await one(db, 'SELECT 1 FROM products WHERE id=$1 AND restaurant_id=$2', [id, a.restaurantId]))) throw notFound();
    const rel = await saveImage(ctx, a.restaurantId, req, { width: 1200, height: 900, fit: 'inside' });
    try { await setDraftPhoto(a.restaurantId, id, rel); } catch (e) { unlinkQuiet(ctx.uploadsDir, rel); throw e; }
    return { photo: rel };
  });
  app.delete('/api/editor/products/:id/photo', async (req: any) => {
    const a = need(req);
    await setDraftPhoto(a.restaurantId, reqInt(req.params.id, 'plato', 1), null);
    return { ok: true };
  });
  // Vista previa: carta + marca con borradores, solo para el dueño o encargado.
  app.get('/api/editor/preview', async (req) => {
    const a = need(req);
    const r = await rest(a.restaurantId);
    const brand = { ...brandOf(r), ...(r.settings.brand_draft ?? {}) };
    const m = await merged(db, a.restaurantId);
    const settings = { ...r.settings, ...Object.fromEntries(TEXT_KEYS.map((k) => [k, brand[k]])) };
    delete settings.brand_draft;
    return { restaurant: { name: brand.name, slug: r.slug, theme: r.theme, settings: { ...settings, brand }, brand }, ...publicShape(m.categories, m.products), zones: [], slots: [], reservations: null, preview: true };
  });

  app.post('/api/editor/publish', async (req: any) => {
    const a = need(req);
    const oldFiles: string[] = [];
    const res = await db.transaction(async (tx) => {
      const r = (await one(tx, 'SELECT * FROM restaurants WHERE id=$1 FOR UPDATE', [a.restaurantId]))!;
      let nc = 0, np = 0;
      for (const c of await all(tx, 'SELECT * FROM categories WHERE restaurant_id=$1 AND draft IS NOT NULL', [r.id])) {
        await tx.query('UPDATE categories SET name=$1, position=$2, visible=$3, draft=NULL WHERE id=$4', [c.draft.name, c.draft.position, c.draft.visible !== false, c.id]);
        nc++;
      }
      for (const p of await all(tx, 'SELECT * FROM products WHERE restaurant_id=$1 AND draft IS NOT NULL', [r.id])) {
        const { options, components, isNew, photo, ...fields } = p.draft;
        // Se vuelve a validar contra la carta actual (una categoría o un plato del combo pudo cambiar).
        const v = await productFields(tx, r.id, { ...camel(fields), options: options?.map(camel), components: components?.map(camel) }, p.id)
          .catch((e) => { throw e instanceof HttpError ? new HttpError(e.status, `No se pudo publicar «${fields.name ?? p.name}»: ${e.message}. Corregilo en la carta y volvé a publicar.`, e.extra) : e; });
        const cols = { ...v.fields, position: reqInt(fields.position ?? p.position, 'orden', 0, 99999), ...('photo' in p.draft ? { photo } : {}) };
        const keys = Object.keys(cols);
        await tx.query(`UPDATE products SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, draft=NULL WHERE id=$1`, [p.id, ...Object.values(cols)]);
        await writeOptions(tx, r.id, p.id, v.options, v.components);
        if ('photo' in p.draft && p.photo && p.photo !== photo) oldFiles.push(p.photo);
        if (!isNew && p.price_cents !== v.fields.price_cents) await audit(tx, r.id, a.userId, 'product.price', 'product', p.id, null, { from: p.price_cents, to: v.fields.price_cents });
        np++;
      }
      const bd = r.settings.brand_draft;
      if (bd) {
        const cur = brandOf(r);
        // Solo se aplican las claves que el borrador cambió.
        const next = { ...r.settings, brand: Object.fromEntries(LOOK_KEYS.map((k) => [k, k in bd ? bd[k] : cur[k]])), ...Object.fromEntries(TEXT_KEYS.filter((k) => k in bd).map((k) => [k, bd[k] ?? ''])) };
        delete next.brand_draft;
        await tx.query('UPDATE restaurants SET name=$1, settings=$2 WHERE id=$3', ['name' in bd ? bd.name : r.name, JSON.stringify(next), r.id]);
        for (const k of ['logo', 'cover']) if (k in bd && cur[k] && cur[k] !== bd[k]) oldFiles.push(cur[k]);
      }
      await audit(tx, r.id, a.userId, 'menu.publish', 'restaurant', r.id, null, { categories: nc, products: np, brand: !!bd });
      return { categories: nc, products: np, brand: !!bd };
    });
    for (const f of oldFiles) unlinkQuiet(ctx.uploadsDir, f);
    emit(ctx, a.restaurantId, 'menu');
    return res;
  });

  app.post('/api/editor/discard', async (req: any) => {
    const a = need(req);
    const files: string[] = [];
    await db.transaction(async (tx) => {
      const r = (await one(tx, 'SELECT * FROM restaurants WHERE id=$1 FOR UPDATE', [a.restaurantId]))!;
      for (const p of await all(tx, 'SELECT id, photo, draft FROM products WHERE restaurant_id=$1 AND draft IS NOT NULL', [r.id])) {
        if ('photo' in p.draft && p.draft.photo !== p.photo && p.draft.photo) files.push(p.draft.photo);
      }
      const bd = r.settings.brand_draft;
      if (bd) for (const k of ['logo', 'cover']) if (bd[k] && bd[k] !== brandOf(r)[k]) files.push(bd[k]);
      await tx.query(`DELETE FROM products WHERE restaurant_id=$1 AND draft->>'isNew' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.product_id=products.id) AND NOT EXISTS (SELECT 1 FROM combo_items c WHERE c.product_id=products.id)`, [r.id]);
      await tx.query('UPDATE products SET draft=NULL WHERE restaurant_id=$1', [r.id]);
      await tx.query(`DELETE FROM categories WHERE restaurant_id=$1 AND draft->>'isNew' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id=categories.id)`, [r.id]);
      await tx.query('UPDATE categories SET draft=NULL WHERE restaurant_id=$1', [r.id]);
      await tx.query(`UPDATE restaurants SET settings = settings - 'brand_draft' WHERE id=$1`, [r.id]);
      await audit(tx, r.id, a.userId, 'menu.discard', 'restaurant', r.id);
    });
    for (const f of files) unlinkQuiet(ctx.uploadsDir, f);
    return { ok: true };
  });
};

/** Borrador completo de un plato a partir de lo publicado (o del borrador existente), con cambios encima. */
async function productDraftBase(q: Q, rid: number, row: Row, patch: Row) {
  if (row.draft) return { ...row.draft, ...patch };
  const [opts, comps] = await Promise.all([
    all(q, 'SELECT grp, name, price_delta_cents, multi, item_id FROM product_options WHERE product_id=$1 AND restaurant_id=$2 ORDER BY id', [row.id, rid]),
    all(q, 'SELECT product_id, qty FROM combo_items WHERE combo_id=$1 AND restaurant_id=$2 ORDER BY id', [row.id, rid]),
  ]);
  const keys = ['category_id', 'station_id', 'name', 'description', 'price_cents', 'tags', 'allergens', 'published', 'kind', 'course', 'prep_minutes', 'favorite', 'suggestion_id', 'position', 'photo'];
  return { ...Object.fromEntries(keys.map((k) => [k, row[k]])), options: opts, components: row.kind === 'combo' ? comps : null, ...patch };
}

/** productFields recibe el formato de la API (camelCase); el borrador se guarda como columnas. */
const camel = (o: Row) => Object.fromEntries(Object.entries(o).map(([k, v]) => [({ category_id: 'categoryId', station_id: 'stationId', price_cents: 'priceCents', prep_minutes: 'prepMinutes', suggestion_id: 'suggestionId', price_delta_cents: 'priceDeltaCents', product_id: 'productId', item_id: 'itemId' } as Record<string, string>)[k] ?? k, v]));

export default plugin;
