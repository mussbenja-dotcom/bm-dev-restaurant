import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import type { PGlite } from '@electric-sql/pglite';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { all, one, type Q, type Row } from './db.ts';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, len: number) => Promise<Buffer>;

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export const bad = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);
export const conflict = (msg: string, extra?: Record<string, unknown>) => new HttpError(409, msg, extra);
export const forbidden = () => new HttpError(403, 'No tenés permiso para esta acción');
export const notFound = () => new HttpError(404, 'No encontrado');

export type Ctx = { db: PGlite; bus: EventEmitter; uploadsDir: string; publicUrl: string; env: string };

export const ROLES = ['owner', 'manager', 'waiter', 'all_tables', 'kitchen', 'bar', 'pass', 'cashier', 'rider', 'reservations', 'stock'] as const;
export type Role = (typeof ROLES)[number];

export type Auth = { userId: number; name: string; email: string; isPlatformAdmin: boolean; restaurantId: number | null; roles: string[]; tokenHash: string };

export async function hashSecret(s: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scrypt(s, salt, 32)).toString('hex')}`;
}
export async function verifySecret(s: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const got = await scrypt(s, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

const SESSION_DAYS = 14;
export async function createSession(q: Q, userId: number, restaurantId: number | null) {
  const token = newToken();
  await q.query(`INSERT INTO sessions (token_hash, user_id, restaurant_id, expires_at) VALUES ($1,$2,$3, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId, restaurantId]);
  return token;
}

export async function loadAuth(q: Q, token: string | undefined): Promise<Auth | null> {
  if (!token) return null;
  const s = await one(q, `SELECT s.token_hash, s.restaurant_id, u.id, u.name, u.email, u.is_platform_admin, m.roles, r.status AS rstatus
    FROM sessions s JOIN users u ON u.id = s.user_id
    LEFT JOIN memberships m ON m.user_id = u.id AND m.restaurant_id = s.restaurant_id AND m.active
    LEFT JOIN restaurants r ON r.id = s.restaurant_id
    WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active`, [sha256(token)]);
  if (!s) return null;
  // Un local suspendido o una membresía dada de baja dejan la sesión sin local.
  const valid = s.restaurant_id && s.rstatus === 'active' && (s.roles || s.is_platform_admin);
  return {
    userId: s.id, name: s.name, email: s.email, isPlatformAdmin: s.is_platform_admin, tokenHash: s.token_hash,
    restaurantId: valid ? s.restaurant_id : null,
    roles: valid ? (s.roles ?? ['owner']) : [], // asistencia de plataforma entra como dueño, registrada en auditoría
  };
}

export function auth(req: FastifyRequest): Auth {
  const a = (req as any).auth as Auth | null;
  if (!a) throw new HttpError(401, 'Iniciá sesión');
  return a;
}
/** Exige local activo y alguno de los roles (dueño y encargado pasan siempre). */
export function need(req: FastifyRequest, ...roles: string[]): Auth & { restaurantId: number } {
  const a = auth(req);
  if (!a.restaurantId) throw new HttpError(403, 'Elegí un local');
  const ok = a.roles.includes('owner') || a.roles.includes('manager') || roles.some((r) => a.roles.includes(r));
  if (!ok) throw forbidden();
  return a as Auth & { restaurantId: number };
}
export const isBoss = (a: Auth) => a.roles.includes('owner') || a.roles.includes('manager');

/** Operaciones sensibles: dueño/encargado autorizan solos; el resto necesita el PIN de un encargado del local. */
/** Contador de fallos en memoria con bloqueo temporal (PIN de supervisor, código de mesa). */
export function failLimiter(max: number, lockMs: number) {
  const m = new Map<string, { n: number; until: number; at: number }>();
  // Vencido = bloqueo terminado, o contador sin fallos nuevos durante lockMs.
  const stale = (v: { until: number; at: number }, now: number) => (v.until ? v.until <= now : v.at + lockMs <= now);
  const sweep = () => { const now = Date.now(); for (const [key, v] of m) if (stale(v, now)) m.delete(key); };
  return {
    check(k: string, msg: string) { const x = m.get(k); if (x && x.until > Date.now()) throw new HttpError(429, msg); },
    fail(k: string) {
      const now = Date.now();
      if (m.size > 50_000) { sweep(); for (const key of m.keys()) { if (m.size <= 40_000) break; m.delete(key); } }
      const x = m.get(k); const n = (x && !stale(x, now) ? x.n : 0) + 1;
      m.set(k, { n: n >= max ? 0 : n, until: n >= max ? now + lockMs : 0, at: now });
      return n >= max; // true = quedó bloqueado
    },
    ok(k: string) { m.delete(k); },
    sweep,
    size: () => m.size,
  };
}
const pinFails = failLimiter(5, 15 * 60_000);
// authorize() corre dentro de transacciones que se revierten al fallar: el registro del PIN errado va por fuera (lo conecta buildApp).
let pinFailSink: ((rid: number, userId: number, locked: boolean) => void) | null = null;
export const onPinFail = (fn: typeof pinFailSink) => { pinFailSink = fn; };

/** Conexiones en vivo (SSE) abiertas por clave; devuelve la función que libera el lugar al cerrar. */
const sseOpen = new Map<string, number>();
export function sseSlot(k: string, max: number) {
  const n = sseOpen.get(k) ?? 0;
  if (n >= max) throw new HttpError(429, 'Demasiadas pantallas abiertas en vivo. Cerrá alguna pestaña.');
  sseOpen.set(k, n + 1);
  let done = false;
  return () => { if (done) return; done = true; const m = (sseOpen.get(k) ?? 1) - 1; if (m > 0) sseOpen.set(k, m); else sseOpen.delete(k); };
}

/** Límite por ventana fija (ej. pedidos públicos por IP). */
export function windowLimiter(max: number, windowMs: number) {
  const m = new Map<string, { n: number; reset: number }>();
  return (k: string, msg: string) => {
    const now = Date.now();
    if (m.size > 50_000) for (const [key, v] of m) if (v.reset <= now) m.delete(key); // shortcut: memoria del proceso; con varios procesos habría que llevarlo a la base
    const x = m.get(k);
    if (!x || x.reset <= now) { m.set(k, { n: 1, reset: now + windowMs }); return; }
    if (++x.n > max) throw new HttpError(429, msg);
  };
}

export async function authorize(q: Q, a: Auth & { restaurantId: number }, pin: unknown): Promise<number> {
  if (isBoss(a)) return a.userId;
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) throw new HttpError(403, 'Requiere autorización de un encargado (PIN)');
  const key = `${a.restaurantId}:${a.userId}`;
  pinFails.check(key, 'Demasiados PIN incorrectos. Esperá 15 minutos o pedile al encargado que lo haga.');
  const bosses = await all(q, `SELECT user_id, pin_hash FROM memberships WHERE restaurant_id=$1 AND active AND pin_hash IS NOT NULL AND (roles && ARRAY['owner','manager'])`, [a.restaurantId]);
  for (const b of bosses) if (await verifySecret(pin, b.pin_hash)) { pinFails.ok(key); return b.user_id; }
  pinFailSink?.(a.restaurantId, a.userId, pinFails.fail(key)); // nunca se guarda el PIN ingresado
  throw new HttpError(403, 'PIN de autorización incorrecto');
}

export async function audit(q: Q, rid: number | null, userId: number | null, action: string, entity: string, entityId: unknown, reason: string | null = null, data: unknown = null, authorizedBy: number | null = null) {
  await q.query('INSERT INTO audit_log (restaurant_id, user_id, authorized_by, action, entity, entity_id, reason, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [rid, userId, authorizedBy, action, entity, entityId == null ? null : String(entityId), reason, data == null ? null : JSON.stringify(data)]);
}

/** Evento en vivo para las pantallas del local (cocina, salón, caja, carta pública). */
export const emit = (ctx: Ctx, rid: number, type: string, data: Record<string, unknown> = {}) => ctx.bus.emit('ev', { rid, type, ...data });
/** Pide a las pantallas en vivo de esa persona (o de todas, con null) que revisen su sesión ya: si la revocaron o cambiaron sus permisos, se cortan. Nunca sale al navegador. */
export const kick = (ctx: Ctx, userId: number | null, rid: number | null = null) => ctx.bus.emit('ev', { type: '__session', userId, sessionRid: rid });

// Quién recibe cada tipo de evento en vivo (dueño y encargado reciben todo salvo avisos personales).
const EVENT_ROLES: Record<string, string[]> = {
  floor: ['waiter', 'all_tables', 'cashier', 'reservations', 'pass'],
  lines: ['waiter', 'cashier', 'pass', 'kitchen', 'bar'],
  cash: ['waiter', 'cashier'],
  orders: ['cashier', 'pass', 'kitchen', 'bar', 'rider'],
  reservations: ['waiter', 'all_tables', 'reservations'],
  menu: ROLES as unknown as string[],
};
/**
 * Filtro del servidor: el evento es del local de la sesión y del rol de la persona.
 * Cocina y barra (sin otro rol de salón) solo reciben las comandas de sus estaciones (`stations` del evento).
 * Los avisos personales (`notice`) llegan solo a su destinatario.
 */
export function eventFor(a: { restaurantId: number | null; userId: number; roles: string[] }, ev: Row, myStations: Set<number> | null) {
  if (ev.rid !== a.restaurantId) return false;
  // Mesa sin mozo asignado (toUser null): el aviso le llega al dueño y a los encargados.
  if (ev.type === 'notice') return ev.toUser == null ? a.roles.includes('owner') || a.roles.includes('manager') : ev.toUser === a.userId;
  if (!(a.roles.includes('owner') || a.roles.includes('manager') || (EVENT_ROLES[ev.type] ?? []).some((r) => a.roles.includes(r)))) return false;
  if (ev.type === 'lines' && myStations && Array.isArray(ev.stations)) return ev.stations.some((s: number) => myStations.has(s));
  return true;
}
/** Estaciones de una persona que solo trabaja en cocina o barra; null = ve todas (salón, pase, caja, encargados). */
export async function stationScope(q: Q, a: { restaurantId: number | null; roles: string[] }) {
  if (['owner', 'manager', 'waiter', 'pass', 'cashier'].some((r) => a.roles.includes(r))) return null;
  const kinds = a.roles.filter((r) => r === 'kitchen' || r === 'bar');
  return new Set((await all(q, 'SELECT id FROM stations WHERE restaurant_id=$1 AND kind = ANY($2::text[])', [a.restaurantId, kinds])).map((s) => s.id as number));
}

export const reqStr = (v: unknown, field: string, max = 200) => {
  if (typeof v !== 'string' || !v.trim()) throw bad(`Falta ${field}`);
  if (v.length > max) throw bad(`${field} es demasiado largo`);
  return v.trim();
};
export const optStr = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const reqInt = (v: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw bad(`${field} inválido`);
  return n;
};
export const reqOp = (v: unknown) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) throw bad('Identificador de operación inválido');
  return v;
};
export const opHash = (o: unknown) => sha256(JSON.stringify(o));

/** Bloquea la fila del local para numerar y repartir cupos en serie (pedidos, tickets, franjas, reservas). */
export const lockRestaurant = (q: Q, rid: number) => q.query('SELECT id FROM restaurants WHERE id=$1 FOR UPDATE', [rid]);

export const send = (reply: FastifyReply, csv: string, name: string) =>
  reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send('﻿' + csv);

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Evita inyección de fórmulas al abrir el CSV en una planilla.
    // Solo se exime un número completo (ej. -1500.5); "-1+HYPERLINK(...)" o un tab inicial se neutralizan.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
    return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export const TZ = 'America/Argentina/Buenos_Aires';
/** Fecha operativa: un turno que termina pasada la medianoche cuenta para el día anterior hasta la hora de corte. */
export function operationalDate(d: Date, cutoffHour = 6): string {
  const shifted = new Date(d.getTime() - cutoffHour * 3600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
}
/** Día de semana (0=domingo) y "HH:MM" en Argentina. */
export function localClock(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hhmm: `${p.hour}:${p.minute}` };
}
