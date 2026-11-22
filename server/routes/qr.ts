import type { FastifyPluginAsync } from 'fastify';
import { all, one } from '../db.ts';
import { audit, bad, need, notFound, reqInt, type Ctx } from '../core.ts';
import { isLocalUrl, normalUrl, reviewUrlError, TABLE_TARGETS, tableTargetError } from '../../shared/qr.ts';

// QR dinámicos: el cartel impreso apunta a una dirección estable (/q/...) y el destino se decide al momento de escanear.
const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;
  // Sin caché: si el dueño cambia el destino, el mismo cartel lleva al destino nuevo en el próximo escaneo.
  const go = (reply: any, to: string) => reply.header('cache-control', 'no-store').redirect(to, 302);

  app.get('/q/:token', async (req: any, reply) => {
    const t = await one(db, `SELECT t.qr_token, t.qr_target, r.slug FROM tables t JOIN restaurants r ON r.id=t.restaurant_id AND r.status='active' WHERE t.qr_token=$1 AND t.active`, [String(req.params.token)]);
    if (!t) return go(reply, `/mesa/${encodeURIComponent(String(req.params.token))}`); // la página de la mesa explica que el QR no está activo
    if (!t.qr_target) return go(reply, `/mesa/${encodeURIComponent(t.qr_token)}`);
    // Destino interno: conserva la identificación de la mesa en el enlace.
    if (t.qr_target === 'reservar') return go(reply, `/reservar/${encodeURIComponent(t.slug)}?mesa=${encodeURIComponent(t.qr_token)}`);
    return go(reply, t.qr_target); // enlace externo: solo consulta, no identifica la mesa
  });

  app.get('/q/resenas/:token', async (req: any, reply) => {
    const r = await one(db, `SELECT slug, settings->>'google_review_url' AS url FROM restaurants WHERE review_qr_token=$1 AND status='active'`, [String(req.params.token)]);
    if (!r) return reply.code(404).header('cache-control', 'no-store').type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Código no disponible</title><p style="font:18px system-ui;margin:2em">Este código QR ya no está disponible. Pedile ayuda al personal del local.</p>');
    // Sin enlace cargado todavía: se muestra la carta del local en vez de un error.
    return go(reply, r.url && !reviewUrlError(r.url) ? r.url : `/m/${encodeURIComponent(r.slug)}`);
  });

  app.get('/api/qr', async (req) => {
    const a = need(req);
    const r = (await one(db, `SELECT slug, review_qr_token, settings->>'google_review_url' AS review_url FROM restaurants WHERE id=$1`, [a.restaurantId]))!;
    const tables = await all(db, 'SELECT id, number, area, qr_token, qr_target FROM tables WHERE restaurant_id=$1 AND active ORDER BY area, length(number), number', [a.restaurantId]);
    return { publicUrl: ctx.publicUrl, local: isLocalUrl(ctx.publicUrl), slug: r.slug, review: { token: r.review_qr_token, url: r.review_url || null }, tables };
  });

  app.put('/api/qr/tables/:id', async (req: any) => {
    const a = need(req);
    const raw = req.body?.target ? String(req.body.target).trim() : null;
    const err = tableTargetError(raw);
    if (err) throw bad(err);
    const target = !raw || Object.hasOwn(TABLE_TARGETS, raw) ? raw : normalUrl(raw);
    const t = await one(db, 'UPDATE tables SET qr_target=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING id, number, qr_target', [target === 'mesa' ? null : target, reqInt(req.params.id, 'mesa', 1), a.restaurantId]);
    if (!t) throw notFound();
    await audit(db, a.restaurantId, a.userId, 'qr.table_target', 'table', t.id, null, { target: t.qr_target });
    return t;
  });

  app.put('/api/qr/review', async (req: any) => {
    const a = need(req);
    const raw = String(req.body?.url ?? '').trim();
    const err = raw ? reviewUrlError(raw) : null;
    if (err) throw bad(err);
    const url = raw ? normalUrl(raw) : '';
    await db.query(`UPDATE restaurants SET settings = jsonb_set(settings, '{google_review_url}', to_jsonb($1::text)) WHERE id=$2`, [url, a.restaurantId]);
    await audit(db, a.restaurantId, a.userId, 'qr.review_url', 'restaurant', a.restaurantId, null, { url });
    return { url: url || null };
  });
};
export default plugin;
