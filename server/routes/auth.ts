import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { all, one } from '../db.ts';
import { audit, auth, kick, bad, createSession, failLimiter, forbidden, windowLimiter, hashSecret, HttpError, need, newToken, reqStr, verifySecret, type Ctx } from '../core.ts';
import { applyTemplate, TEMPLATES } from '../templates.ts';

const COOKIE = { path: '/', httpOnly: true, sameSite: 'strict' as const, maxAge: 14 * 86400 };
export const setSid = (reply: FastifyReply, token: string, secure: boolean) => reply.setCookie('sid', token, { ...COOKIE, secure });

// Intentos de login por IP+email: 5 fallos bloquean un minuto. En memoria con limpieza periódica; el registro durable va a login_attempts.
export const loginFails = failLimiter(5, 60_000);
// Tope por IP sin importar el email (frena probar muchas cuentas desde un mismo lugar).
const loginPerIp = windowLimiter(30, 10 * 60_000);
export const LOGIN_RETENTION_DAYS = 30;
/** Borra intentos de ingreso viejos y contadores vencidos (se llama al arrancar y cada 6 horas). */
export async function purgeLoginAttempts(q: { query: (sql: string, p?: any[]) => Promise<any> }) {
  loginFails.sweep();
  await q.query(`DELETE FROM login_attempts WHERE at < now() - make_interval(days => $1)`, [LOGIN_RETENTION_DAYS]);
}

/** Código de un solo uso para crear el primer administrador; se imprime en la consola del servidor. */
export let setupCode: string | null = null;
export const initSetupCode = async (ctx: Ctx) => {
  const n = (await one(ctx.db, 'SELECT count(*)::int n FROM users'))!.n;
  setupCode = n === 0 ? newToken(6) : null;
  return setupCode;
};

export const validPassword = (p: unknown) => {
  if (typeof p !== 'string' || p.length < 8 || p.length > 128) throw bad('La contraseña necesita al menos 8 caracteres');
  return p;
};
export const validEmail = (e: unknown) => {
  const s = reqStr(e, 'email', 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw bad('Email inválido');
  return s;
};

export async function createRestaurant(q: any, body: any) {
  const name = reqStr(body.name, 'nombre del local', 80);
  const slug = reqStr(body.slug, 'enlace', 40).toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw bad('El enlace usa solo minúsculas, números y guiones (3 a 40)');
  const template = TEMPLATES[body.template as keyof typeof TEMPLATES] ? body.template : 'bodegon';
  const r = (await one(q, `INSERT INTO restaurants (slug, name, theme, settings, review_qr_token) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [slug, name, template === 'pizzeria' ? 'pizzeria' : 'bodegon', JSON.stringify(TEMPLATES[template as keyof typeof TEMPLATES].settings), newToken(12)]))!;
  await applyTemplate(q, r.id, template);
  return r;
}

const plugin: FastifyPluginAsync<{ ctx: Ctx }> = async (app, { ctx }) => {
  const db = ctx.db;
  const secure = (req: any) => req.protocol === 'https';

  app.get('/api/setup/status', async () => ({ needsSetup: setupCode !== null }));

  app.post('/api/setup', async (req: any, reply) => {
    if (!setupCode) throw forbidden();
    if (req.body?.code !== setupCode) throw new HttpError(403, 'Código de instalación incorrecto. Lo ves en la consola del servidor.');
    const email = validEmail(req.body.email);
    const user = await db.transaction(async (tx) => {
      if ((await one(tx, 'SELECT count(*)::int n FROM users'))!.n) throw forbidden();
      const u = (await one(tx, 'INSERT INTO users (email, name, password_hash, is_platform_admin) VALUES ($1,$2,$3,true) RETURNING id', [email, reqStr(req.body.name, 'nombre', 80), await hashSecret(validPassword(req.body.password))]))!;
      await audit(tx, null, u.id, 'setup.first_admin', 'user', u.id);
      return u;
    });
    setupCode = null;
    setSid(reply, await createSession(db, user.id, null), secure(req));
    return { ok: true };
  });

  app.post('/api/login', async (req: any, reply) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim();
    const key = `${req.ip}|${email}`;
    // Se registra quién, desde dónde y el resultado; nunca la contraseña ingresada.
    const log = (ok: boolean, userId: number | null, reason: string | null) =>
      db.query('INSERT INTO login_attempts (email, user_id, ip, ok, reason) VALUES ($1,$2,$3,$4,$5)', [email.slice(0, 120), userId, String(req.ip).slice(0, 64), ok, reason]);
    loginPerIp(String(req.ip), 'Demasiados intentos desde esta conexión. Esperá unos minutos.'); // sin registrar: no llena la tabla
    const u = await one(db, 'SELECT * FROM users WHERE email=$1 AND active', [email]);
    try { loginFails.check(key, 'Demasiados intentos. Esperá un minuto.'); } catch (e) { await log(false, u?.id ?? null, 'bloqueado'); throw e; }
    if (!u || !(await verifySecret(String(req.body?.password ?? ''), u.password_hash))) {
      const locked = loginFails.fail(key);
      await log(false, u?.id ?? null, locked ? 'clave incorrecta · bloqueo 1 min' : u ? 'clave incorrecta' : 'usuario inexistente');
      throw new HttpError(401, 'Email o contraseña incorrectos');
    }
    loginFails.ok(key);
    await log(true, u.id, null);
    const ms = await all(db, `SELECT m.restaurant_id FROM memberships m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.user_id=$1 AND m.active AND r.status='active' ORDER BY r.id`, [u.id]);
    const wanted = Number(req.body?.restaurantId);
    const rid = ms.find((m) => m.restaurant_id === wanted)?.restaurant_id ?? ms[0]?.restaurant_id ?? null;
    // Solo tiene locales suspendidos o en papelera: se avisa en vez de dejarlo en una pantalla vacía.
    if (!rid && !u.is_platform_admin && (await one(db, 'SELECT 1 FROM memberships WHERE user_id=$1 AND active', [u.id]))) throw new HttpError(403, 'Tu local está suspendido o fuera de servicio. Comunicate con BM Dev.');
    setSid(reply, await createSession(db, u.id, rid), secure(req));
    return { ok: true };
  });

  // Ingresos recientes de las personas del local (dueño o encargado). Intentos con emails ajenos al local no se muestran.
  app.get('/api/audit/logins', async (req) => {
    const a = need(req);
    return all(db, `SELECT l.at, l.email, l.ip, l.ok, l.reason, u.name FROM login_attempts l JOIN users u ON u.id=l.user_id
      JOIN memberships m ON m.user_id=l.user_id AND m.restaurant_id=$1 AND m.active WHERE l.at > now() - interval '7 days' ORDER BY l.id DESC LIMIT 300`, [a.restaurantId]);
  });

  app.post('/api/logout', async (req: any, reply) => {
    const a = (req as any).auth;
    if (a) { await db.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1', [a.tokenHash]); kick(ctx, a.userId); }
    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const a = auth(req);
    const restaurants = a.isPlatformAdmin && !(await one(db, 'SELECT 1 FROM memberships WHERE user_id=$1', [a.userId]))
      ? []
      : await all(db, `SELECT r.id, r.name, r.slug, m.roles FROM memberships m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.user_id=$1 AND m.active AND r.status='active' ORDER BY r.name`, [a.userId]);
    const current = a.restaurantId ? await one(db, 'SELECT id, name, slug, theme, settings FROM restaurants WHERE id=$1', [a.restaurantId]) : null;
    return { user: { id: a.userId, name: a.name, email: a.email, isPlatformAdmin: a.isPlatformAdmin }, roles: a.roles, restaurant: current, restaurants, publicUrl: ctx.publicUrl };
  });

  // Cambiar de local dentro de la misma sesión (usuario con varios locales).
  app.post('/api/me/restaurant', async (req: any) => {
    const a = auth(req);
    const rid = Number(req.body?.restaurantId);
    const m = await one(db, `SELECT 1 FROM memberships m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.user_id=$1 AND m.restaurant_id=$2 AND m.active AND r.status='active'`, [a.userId, rid]);
    if (!m) throw forbidden();
    await db.query('UPDATE sessions SET restaurant_id=$1 WHERE token_hash=$2', [rid, a.tokenHash]); kick(ctx, a.userId);
    return { ok: true };
  });

  app.post('/api/me/password', async (req: any) => {
    const a = auth(req);
    const u = (await one(db, 'SELECT password_hash FROM users WHERE id=$1', [a.userId]))!;
    if (!(await verifySecret(String(req.body?.current ?? ''), u.password_hash))) throw new HttpError(403, 'La contraseña actual no coincide');
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await hashSecret(validPassword(req.body.next)), a.userId]);
    await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL', [a.userId, a.tokenHash]);
    kick(ctx, a.userId);
    return { ok: true };
  });

};
export default plugin;
