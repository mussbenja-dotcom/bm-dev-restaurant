import type { FastifyPluginAsync } from 'fastify';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { all, one, type Db, type Q } from '../db.ts';
import { audit, auth, bad, conflict, createSession, forbidden, hashSecret, HttpError, kick, newToken, notFound, reqInt, reqStr, sha256, windowLimiter, type Ctx } from '../core.ts';
import { createRestaurant, setSid, validEmail, validPassword } from './auth.ts';

const LINK_DAYS = 7;
const linkPerIp = windowLimiter(20, 10 * 60_000);

/** Superadmin: se valida en el servidor en cada acción (el menú del navegador no autoriza nada). */
export const platform = (req: any) => { const a = auth(req); if (!a.isPlatformAdmin) throw forbidden(); return a; };

/** Enlace de acceso de un solo uso. Hace vencer los anteriores sin usar de esa persona para ese local; se guarda solo el hash. */
export async function issueLink(q: Q, kind: 'activate' | 'invite', userId: number, rid: number | null, by: number | null, publicUrl: string, days = LINK_DAYS) {
  await q.query('UPDATE account_links SET expires_at=now() WHERE user_id=$1 AND restaurant_id IS NOT DISTINCT FROM $2 AND used_at IS NULL AND expires_at > now()', [userId, rid]);
  const token = newToken(24);
  const x = (await one(q, `INSERT INTO account_links (token_hash, kind, user_id, restaurant_id, created_by, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $6)) RETURNING expires_at`,
    [sha256(token), kind, userId, rid, by, days]))!;
  return { url: `${publicUrl}/activar/${token}`, kind, expiresAt: x.expires_at as string };
}

/**
 * Crea o promueve la cuenta de Superadmin. Nunca cambia una contraseña existente.
 * Al arrancar con SUPERADMIN_EMAIL (fromBoot) solo crea: promover o emitir otro enlace queda para el comando, así un reinicio no deshace una degradación.
 */
export async function ensureSuperadmin(db: Db, o: { email: string; name?: string; password?: string; fromBoot?: boolean }, publicUrl: string) {
  const email = validEmail(o.email);
  const hash = o.password ? await hashSecret(validPassword(o.password)) : '';
  return db.transaction(async (tx) => {
    let u = await one(tx, 'SELECT id, password_hash, is_platform_admin, active FROM users WHERE email=$1', [email]);
    let state: 'created' | 'promoted' | 'existing' = 'existing';
    if (!u) {
      u = (await one(tx, 'INSERT INTO users (email, name, password_hash, is_platform_admin) VALUES ($1,$2,$3,true) RETURNING id, password_hash', [email, reqStr(o.name || email.split('@')[0], 'nombre', 80), hash]))!;
      state = 'created';
      await audit(tx, null, u.id, 'setup.superadmin_create', 'user', u.id, 'Cuenta inicial de Superadmin');
    } else if (!u.active) {
      // Una baja deliberada no se deshace sola (SUPERADMIN_EMAIL corre en cada arranque).
      throw bad(`La cuenta ${email} está dada de baja; no se reactiva automáticamente.`);
    } else if (o.fromBoot) {
      if (!u.is_platform_admin) throw bad(`${email} ya existe y no es Superadmin. Para promoverla usá: npm run superadmin -- ${email}`);
      return { state, email, link: null };
    } else if (!u.is_platform_admin) {
      await tx.query('UPDATE users SET is_platform_admin=true WHERE id=$1', [u.id]);
      state = 'promoted';
      await audit(tx, null, u.id, 'setup.superadmin_promote', 'user', u.id, 'Cuenta existente pasa a Superadmin');
    }
    // Una cuenta de plataforma nunca se vincula a un local: los enlaces de local pendientes dejan de servir.
    await tx.query('UPDATE account_links SET expires_at=now() WHERE user_id=$1 AND restaurant_id IS NOT NULL AND used_at IS NULL AND expires_at > now()', [u.id]);
    // Sin contraseña todavía: enlace de activación de 24 h para que la defina la propia persona.
    const link = u.password_hash ? null : await issueLink(tx, 'activate', u.id, null, null, publicUrl, 1);
    return { state, email, link };
  });
}

/** Tablas con restaurant_id en orden de borrado (hijas antes que madres), leído del catálogo: sigue valiendo con migraciones nuevas. */
async function purgeOrder(q: Q) {
  const tables = (await all(q, `SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE' WHERE c.table_schema='public' AND c.column_name='restaurant_id' AND c.table_name <> 'restaurants'`)).map((r) => r.t as string);
  const edges = await all(q, `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f' AND conrelid <> confrelid`);
  const out: string[] = []; const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => !edges.some((e) => e.parent === t && left.has(e.child)));
    if (!ready.length) throw new Error(`Ciclo de claves foráneas entre ${[...left].join(', ')}`);
    for (const t of ready.sort()) { out.push(t); left.delete(t); }
  }
  if (out.some((t) => !/^[a-z_][a-z0-9_]*$/.test(t))) throw new Error('Nombre de tabla inesperado');
  return out;
}

const LABELS: Record<string, string> = {
  products: 'platos y productos', categories: 'categorías', orders: 'pedidos', visits: 'mesas atendidas', order_lines: 'líneas de comanda', payments: 'cobros',
  reservations: 'reservas', customers: 'clientes', memberships: 'personas del equipo', tables: 'mesas', cash_shifts: 'turnos de caja', ingredients: 'insumos', tickets: 'tickets',
};

/** Fotos del local: todo vive bajo uploads/<id>/. */
function uploadsOf(ctx: Ctx, rid: number) {
  const root = resolve(ctx.uploadsDir);
  const dir = resolve(root, String(rid));
  if (!Number.isInteger(rid) || rid < 1 || !dir.startsWith(root + sep)) throw new Error('Carpeta de fotos inválida');
  if (!existsSync(dir)) return { dir, files: 0, bytes: 0 };
  const names = readdirSync(dir);
  return { dir, files: names.length, bytes: names.reduce((s, n) => s + statSync(join(dir, n)).size, 0) };
}

async function purgePreview(ctx: Ctx, q: Q, rid: number) {
  const counts: Record<string, number> = {};
  for (const t of await purgeOrder(q)) {
    const n = (await one(q, `SELECT count(*)::int n FROM "${t}" WHERE restaurant_id=$1`, [rid]))!.n;
    if (n) counts[t] = n;
  }
  const { files, bytes } = uploadsOf(ctx, rid);
  const highlights = Object.entries(LABELS).filter(([t]) => counts[t]).map(([t, label]) => ({ label, n: counts[t] }));
  return { counts, highlights, total: Object.values(counts).reduce((s, n) => s + n, 0), files, bytes };
}

const OWNERS = `(SELECT coalesce(json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'pending', u.password_hash = '') ORDER BY u.id), '[]')
  FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=r.id AND m.active AND 'owner' = ANY(m.roles)) AS owners,
  (SELECT coalesce(json_agg(json_build_object('email', u.email, 'name', u.name, 'kind', l.kind, 'expires_at', l.expires_at)), '[]')
  FROM account_links l JOIN users u ON u.id=l.user_id WHERE l.restaurant_id=r.id AND l.used_at IS NULL AND l.expires_at > now()) AS pending`;

const TRANSITIONS: Record<string, { from: string[]; label: string }> = {
  suspend: { from: ['active'], label: 'suspended' },
  reactivate: { from: ['suspended'], label: 'active' },
  trash: { from: ['active', 'suspended'], label: 'trashed' },
  restore: { from: ['trashed'], label: 'restored' },
};

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;
  const urls = (slug: string) => ({ panelUrl: `${ctx.publicUrl}/app`, menuUrl: `${ctx.publicUrl}/m/${slug}` });

  app.get('/api/admin/restaurants', async (req) => {
    platform(req);
    return all(db, `SELECT r.id, r.name, r.slug, r.status, r.theme, r.created_at, r.trashed_at, ${OWNERS},
      (SELECT count(*)::int FROM memberships m WHERE m.restaurant_id=r.id AND m.active) AS members,
      (SELECT max(created_at) FROM rounds WHERE restaurant_id=r.id) AS last_activity
      FROM restaurants r ORDER BY r.created_at DESC, r.id DESC`);
  });

  app.get('/api/admin/restaurants/:id', async (req: any) => {
    platform(req);
    const r = await one(db, `SELECT r.id, r.name, r.slug, r.status, r.theme, r.created_at, r.trashed_at, r.trashed_from, ${OWNERS} FROM restaurants r WHERE r.id=$1`, [reqInt(req.params.id, 'local', 1)]);
    if (!r) throw notFound();
    const [preview, history] = await Promise.all([
      purgePreview(ctx, db, r.id),
      all(db, `SELECT a.id, a.at, a.action, a.reason, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.restaurant_id=$1 AND a.action LIKE 'platform.%' ORDER BY a.id DESC LIMIT 50`, [r.id]),
    ]);
    return { ...r, ...urls(r.slug), preview, history };
  });

  app.post('/api/admin/restaurants', async (req: any) => {
    const a = platform(req);
    const b = req.body ?? {};
    const email = validEmail(b.ownerEmail);
    const ownerName = reqStr(b.ownerName, 'nombre del dueño', 80);
    const out = await db.transaction(async (tx) => {
      if (await one(tx, 'SELECT 1 FROM restaurants WHERE slug=$1', [String(b.slug ?? '').trim().toLowerCase()])) throw conflict('Ese identificador ya está en uso. Elegí otro.');
      let u = await one(tx, 'SELECT id, password_hash, active, is_platform_admin FROM users WHERE email=$1', [email]);
      if (u && !u.active) throw conflict('Esa cuenta está dada de baja. Usá otro email para el dueño.');
      if (u?.is_platform_admin) throw conflict('Una cuenta de Superadmin no puede ser dueña de un local. Usá otro email.');
      const r = await createRestaurant(tx, b);
      // Cuenta nueva (o nunca activada): la persona define su contraseña. Cuenta existente: invitación, su contraseña no se toca.
      if (!u) u = await one(tx, `INSERT INTO users (email, name, password_hash) VALUES ($1,$2,'') RETURNING id, password_hash`, [email, ownerName]);
      const kind = u!.password_hash ? 'invite' : 'activate';
      if (kind === 'activate') await tx.query(`INSERT INTO memberships (user_id, restaurant_id, roles) VALUES ($1,$2,'{owner}')`, [u!.id, r.id]);
      const link = await issueLink(tx, kind, u!.id, r.id, a.userId, ctx.publicUrl);
      await audit(tx, r.id, a.userId, 'platform.restaurant_create', 'restaurant', r.id, null, { slug: r.slug, ownerEmail: email, access: kind });
      return { restaurant: r, link };
    });
    return { ...out, ...urls(out.restaurant.slug) };
  });

  // Enlace nuevo para el dueño (venció o se perdió): anula el anterior.
  app.post('/api/admin/restaurants/:id/link', async (req: any) => {
    const a = platform(req);
    const rid = reqInt(req.params.id, 'local', 1);
    const email = validEmail(req.body?.email);
    return db.transaction(async (tx) => {
      if (!(await one(tx, 'SELECT 1 FROM restaurants WHERE id=$1', [rid]))) throw notFound();
      const u = await one(tx, 'SELECT id, password_hash, is_platform_admin FROM users WHERE email=$1 AND active', [email]);
      if (!u) throw bad('No hay una cuenta con ese email');
      if (u.is_platform_admin) throw conflict('Una cuenta de Superadmin no puede ser dueña de un local. Usá otro email.');
      // Solo dueños o invitados como dueños: aceptar el enlace da rol de dueño, nunca se lo da a otro integrante.
      const owner = await one(tx, `SELECT 1 FROM memberships WHERE user_id=$1 AND restaurant_id=$2 AND active AND 'owner' = ANY(roles)`, [u.id, rid]);
      const invited = await one(tx, `SELECT 1 FROM account_links WHERE user_id=$1 AND restaurant_id=$2 AND kind='invite' AND used_at IS NULL`, [u.id, rid]);
      if (!owner && !invited) throw bad('Esa persona no es dueña ni está invitada a este local');
      const link = await issueLink(tx, u.password_hash ? 'invite' : 'activate', u.id, rid, a.userId, ctx.publicUrl);
      await audit(tx, rid, a.userId, 'platform.link_reissue', 'user', u.id, null, { email, kind: link.kind });
      return link;
    });
  });

  app.post('/api/admin/restaurants/:id/status', async (req: any) => {
    const a = platform(req);
    const rid = reqInt(req.params.id, 'local', 1);
    const action = String(req.body?.action ?? '');
    const tr = Object.hasOwn(TRANSITIONS, action) ? TRANSITIONS[action] : null;
    if (!tr) throw bad('Acción inválida');
    const reason = reqStr(req.body?.reason, 'motivo', 300);
    await db.transaction(async (tx) => {
      const r = await one(tx, 'SELECT id, status, trashed_from FROM restaurants WHERE id=$1 FOR UPDATE', [rid]);
      if (!r) throw notFound();
      if (!tr.from.includes(r.status)) throw conflict('El local no está en un estado que permita esa acción');
      if (action === 'trash') await tx.query(`UPDATE restaurants SET status='trashed', trashed_at=now(), trashed_from=$2 WHERE id=$1`, [rid, r.status]);
      else if (action === 'restore') await tx.query('UPDATE restaurants SET status=$2, trashed_at=NULL, trashed_from=NULL WHERE id=$1', [rid, r.trashed_from ?? 'active']);
      else await tx.query('UPDATE restaurants SET status=$2 WHERE id=$1', [rid, tr.label]);
      await audit(tx, rid, a.userId, `platform.restaurant_${tr.label}`, 'restaurant', rid, reason);
    });
    kick(ctx, null, rid);
    return { ok: true };
  });

  // Eliminación definitiva: solo desde la papelera y escribiendo el identificador. El registro administrativo se conserva.
  app.post('/api/admin/restaurants/:id/purge', async (req: any) => {
    const a = platform(req);
    const rid = reqInt(req.params.id, 'local', 1);
    const reason = reqStr(req.body?.reason, 'motivo', 300);
    const { dir } = uploadsOf(ctx, rid);
    const done = await db.transaction(async (tx) => {
      const r = await one(tx, 'SELECT id, slug, name, status FROM restaurants WHERE id=$1 FOR UPDATE', [rid]);
      if (!r) throw notFound();
      if (r.status !== 'trashed') throw conflict('Solo se puede eliminar un local que está en la papelera');
      if (String(req.body?.confirm ?? '').trim() !== r.slug) throw bad(`Para confirmar escribí el identificador exacto: ${r.slug}`);
      const preview = await purgePreview(ctx, tx, rid);
      // Cuentas que solo trabajaban en este local: se anonimizan (los registros de otros lados que las nombran siguen siendo válidos).
      const orphans = (await all(tx, `SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=$1 AND NOT u.is_platform_admin
        AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.user_id=m.user_id AND o.restaurant_id<>$1)
        AND NOT EXISTS (SELECT 1 FROM account_links l WHERE l.user_id=m.user_id AND l.restaurant_id IS DISTINCT FROM $1 AND l.used_at IS NULL)`, [rid])).map((x) => x.user_id as number);
      await tx.query(`UPDATE audit_log SET restaurant_id=NULL, data = (coalesce(data, '{}'::jsonb) - 'ownerEmail' - 'email') || jsonb_build_object('restaurant_slug', $2::text, 'restaurant_name', $3::text)
        WHERE restaurant_id=$1 AND action LIKE 'platform.%'`, [rid, r.slug, r.name]);
      await tx.query('UPDATE sessions SET restaurant_id=NULL WHERE restaurant_id=$1', [rid]);
      for (const t of await purgeOrder(tx)) if (t !== 'sessions') await tx.query(`DELETE FROM "${t}" WHERE restaurant_id=$1`, [rid]);
      if (orphans.length) {
        await tx.query(`UPDATE users SET active=false, password_hash='', name='Cuenta eliminada', email='eliminada-' || id || '@cuenta.invalid' WHERE id = ANY($1::int[])`, [orphans]);
        await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id = ANY($1::int[]) AND revoked_at IS NULL', [orphans]);
        await tx.query('DELETE FROM login_attempts WHERE user_id = ANY($1::int[])', [orphans]);
      }
      await tx.query('DELETE FROM restaurants WHERE id=$1', [rid]);
      await audit(tx, null, a.userId, 'platform.restaurant_purge', 'restaurant', rid, reason,
        { restaurant_slug: r.slug, restaurant_name: r.name, rows: preview.total, files: preview.files, accounts_closed: orphans.length });
      return { slug: r.slug, ...preview, accountsClosed: orphans.length };
    });
    kick(ctx, null, rid);
    // Fotos después del commit: si la base falló, no se tocan. Si el disco falla, el local ya no existe: se avisa sin error.
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) {
      req.log.error({ err: e, dir }, 'No se pudieron borrar las fotos del local eliminado');
      return { ...done, filesPending: dir };
    }
    return done;
  });

  // Asistencia: el Superadmin entra al local con motivo registrado; queda en la auditoría del local.
  app.post('/api/admin/restaurants/:id/assist', async (req: any) => {
    const a = platform(req);
    const rid = reqInt(req.params.id, 'local', 1);
    const reason = reqStr(req.body?.reason, 'motivo de la asistencia', 300);
    const r = await one(db, `SELECT id FROM restaurants WHERE id=$1 AND status='active'`, [rid]);
    if (!r) throw conflict('Local inexistente o fuera de servicio');
    await db.query('UPDATE sessions SET restaurant_id=$1 WHERE token_hash=$2', [rid, a.tokenHash]); kick(ctx, a.userId);
    await audit(db, rid, a.userId, 'platform.assist', 'restaurant', rid, reason);
    return { ok: true };
  });

  app.post('/api/admin/leave', async (req: any) => {
    const a = platform(req);
    await db.query('UPDATE sessions SET restaurant_id=NULL WHERE token_hash=$1', [a.tokenHash]); kick(ctx, a.userId);
    return { ok: true };
  });

  app.get('/api/admin/audit', async (req) => {
    platform(req);
    return all(db, `SELECT a.id, a.at, a.action, a.reason, a.data, u.name AS user_name, coalesce(r.name, a.data->>'restaurant_name') AS restaurant
      FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN restaurants r ON r.id=a.restaurant_id
      WHERE a.action LIKE 'platform.%' OR a.action LIKE 'setup.%' ORDER BY a.id DESC LIMIT 300`);
  });

  // ---------- Enlaces de acceso (públicos: el token es el permiso) ----------
  const findLink = async (q: Q, token: string) => {
    const x = await one(q, `SELECT l.*, u.email, u.name, u.password_hash, u.active AS user_active, u.is_platform_admin, r.name AS restaurant, r.status AS rstatus
      FROM account_links l JOIN users u ON u.id=l.user_id LEFT JOIN restaurants r ON r.id=l.restaurant_id WHERE l.token_hash=$1`, [sha256(token)]);
    if (!x) throw new HttpError(404, 'El enlace no es válido. Pedí uno nuevo a BM Dev.');
    if (x.used_at) throw new HttpError(410, 'Este enlace ya se usó. Si ya definiste tu contraseña, iniciá sesión.');
    if (new Date(x.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'El enlace venció. Pedí uno nuevo a BM Dev.');
    if (!x.user_active) throw new HttpError(410, 'La cuenta está dada de baja.');
    // Un enlace de local nunca da acceso a una cuenta de plataforma (aunque se haya promovido después de emitirlo).
    if (x.restaurant_id && x.is_platform_admin) throw new HttpError(410, 'El enlace no es válido. Pedí uno nuevo a BM Dev.');
    if (x.restaurant_id && x.rstatus !== 'active') throw new HttpError(409, 'El local no está activo en este momento. Comunicate con BM Dev.');
    return x;
  };

  app.get('/api/account-links/:token', async (req: any) => {
    linkPerIp(String(req.ip), 'Demasiados intentos. Esperá unos minutos.');
    const x = await findLink(db, String(req.params.token));
    return { kind: x.kind, email: x.email, name: x.name, restaurant: x.restaurant ?? null, expiresAt: x.expires_at };
  });

  app.post('/api/account-links/:token', async (req: any, reply) => {
    linkPerIp(String(req.ip), 'Demasiados intentos. Esperá unos minutos.');
    const token = String(req.params.token);
    // El hash (scrypt, lento) se calcula fuera de la transacción.
    const hash = (await findLink(db, token)).kind === 'activate' ? await hashSecret(validPassword(req.body?.password)) : null;
    const out = await db.transaction(async (tx) => {
      const x = await findLink(tx, token);
      // Un solo uso, aun con dos envíos simultáneos: gana el primero que lo marca.
      if (!(await one(tx, 'UPDATE account_links SET used_at=now() WHERE id=$1 AND used_at IS NULL RETURNING id', [x.id]))) throw new HttpError(410, 'Este enlace ya se usó.');
      if (x.kind === 'activate') {
        if (x.password_hash) throw new HttpError(410, 'Esta cuenta ya tiene contraseña. Iniciá sesión.');
        await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, x.user_id]);
        await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [x.user_id]);
      }
      if (x.restaurant_id) {
        await tx.query(`INSERT INTO memberships (user_id, restaurant_id, roles) VALUES ($1,$2,'{owner}')
          ON CONFLICT (user_id, restaurant_id) DO UPDATE SET active=true, roles = (SELECT array_agg(DISTINCT r) FROM unnest(memberships.roles || '{owner}'::text[]) r)`, [x.user_id, x.restaurant_id]);
      }
      await audit(tx, x.restaurant_id, x.user_id, x.kind === 'activate' ? 'platform.account_activate' : 'platform.invite_accept', 'user', x.user_id);
      return x;
    });
    // Activación: queda con la sesión iniciada. Invitación: entra con su contraseña de siempre.
    if (out.kind === 'activate') setSid(reply, await createSession(db, out.user_id, out.restaurant_id), req.protocol === 'https');
    return { ok: true, kind: out.kind, loggedIn: out.kind === 'activate' };
  });
};
export default plugin;
