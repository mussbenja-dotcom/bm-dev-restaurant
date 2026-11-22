import { PGlite } from '@electric-sql/pglite';
import { Pool, types as pgTypes, type PoolClient } from 'pg';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Row = Record<string, any>;
/** Lo único que el sistema le pide a la base: consultas parametrizadas que devuelven filas. */
export type Q = { query<T = Row>(sql: string, params?: any[]): Promise<{ rows: T[] }> };
export type Tx = Q & { exec(sql: string): Promise<unknown> };
/** Base embebida (PGlite) o PostgreSQL externo (DATABASE_URL): misma interfaz. */
export type Db = Tx & { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>; close(): Promise<void> };

// numeric (OID 1700) llega como texto; lo pasamos a number (sumas de centavos entran holgadas en 2^53).
const parsers = { 1700: (v: string) => Number(v) };

export async function openDb(dataDir: string | null): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? new PGlite(join(dataDir, 'pg'), { parsers }) : new PGlite({ parsers });
  await db.waitReady;
  await migrate(db);
  return db;
}

// Mismas conversiones que PGlite, para que el resto del código no note la diferencia.
const sameAsPglite = new Map<number, (v: string) => unknown>([
  [1700, Number], // numeric
  [20, (v) => { const n = BigInt(v); return n < Number.MIN_SAFE_INTEGER || n > Number.MAX_SAFE_INTEGER ? n : Number(n); }], // int8 (count, sum)
  ...[1082, 1114, 1184].map((oid) => [oid, (v: string) => (v === 'infinity' ? Infinity : v === '-infinity' ? -Infinity : new Date(v))] as const), // date, timestamp, timestamptz
]);
const types = { getTypeParser: (oid: number, format?: any) => sameAsPglite.get(oid) ?? pgTypes.getTypeParser(oid, format) };

/** Quita usuario, clave y host de un mensaje de error: la URL de la base nunca se muestra. */
export function redactDbError(e: unknown, url: string) {
  let msg = e instanceof Error ? e.message : String(e);
  try {
    const u = new URL(url);
    const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
    for (const s of [url, u.password, u.username, u.hostname, dec(u.password), dec(u.username)]) if (s && s.length > 2) msg = msg.split(s).join('***');
  } catch { /* URL inválida: no se puede extraer nada más */ }
  const code = (e as any)?.code ? ` (${(e as any).code})` : '';
  return `${msg}${code}`;
}

/**
 * PostgreSQL externo (Neon, etc.). Una sola conexión: las consultas esperan en fila mientras corre una transacción,
 * igual que en PGlite, así las reglas que dependen de esa exclusión (última porción, caja) se comportan igual.
 * shortcut: una conexión limita el caudal; ampliar el pool recién después de revisar la concurrencia de cada transacción.
 */
export async function openPg(url: string): Promise<Db> {
  // Fuera de esta máquina, la conexión va cifrada y verificando el certificado (Neon: sslmode=require o verify-full).
  const u = (() => { try { return new URL(url); } catch { throw new Error('DATABASE_URL no es una URL válida (postgresql://usuario:clave@host/base).'); } })();
  const mode = u.searchParams.get('sslmode');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) && (!mode || ['disable', 'allow', 'no-verify'].includes(mode) || u.searchParams.get('uselibpqcompat') === 'true'))
    throw new Error('DATABASE_URL debe usar sslmode=verify-full (o require) para una base remota: sin eso la conexión no se cifra o no verifica el certificado.');
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 60_000, // también es la espera máxima en la fila; PGlite esperaba sin límite
    idleTimeoutMillis: 60_000, allowExitOnIdle: true, types });
  // Neon cierra conexiones inactivas: el pool descarta esa conexión y abre otra en la próxima consulta.
  pool.on('error', (e) => console.error(`Base de datos: conexión cerrada por el servidor (${redactDbError(e, url)}). Se reconecta sola.`));
  const wrap = (c: PoolClient | Pool): Tx => ({
    query: async (sql, params) => c.query(sql, params) as any,
    exec: (sql) => c.query(sql), // sin parámetros: admite varias sentencias (migraciones)
  });
  const db: Db = {
    ...wrap(pool),
    async transaction(fn) {
      const c = await pool.connect();
      // Mientras la conexión está tomada, el pool no escucha sus errores: si Neon la corta a mitad de la transacción,
      // sin este manejador el proceso entero se caería. La transacción falla (y Postgres la revierte); el servidor sigue.
      let broken: Error | undefined;
      const onError = (e: Error) => { broken = e; console.error(`Base de datos: conexión cortada durante una transacción (${redactDbError(e, url)}).`); };
      c.on('error', onError);
      try {
        await c.query('BEGIN');
        const out = await fn(wrap(c));
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        broken ??= e instanceof Error && /terminat|ECONNRESET|connection/i.test(e.message) ? e : undefined;
        throw e;
      } finally {
        c.off('error', onError);
        c.release(broken); // conexión rota: el pool la descarta y abre otra
      }
    },
    close: () => pool.end(),
  };
  try {
    await db.query('SELECT 1');
  } catch (e) {
    await pool.end().catch(() => {});
    // oxlint-disable-next-line preserve-caught-error -- el error original puede traer host y usuario: se descarta a propósito
    throw new Error(`No se pudo conectar a la base de DATABASE_URL: ${redactDbError(e, url)}`);
  }
  await migrate(db);
  const tz = (await db.query<{ TimeZone: string }>('SHOW TimeZone')).rows[0]?.TimeZone;
  if (!/^(UTC|GMT|Etc\/UTC|Etc\/GMT)$/i.test(tz ?? '')) console.warn(`Aviso: la base usa la zona horaria ${tz}; el sistema espera UTC (como Neon por defecto).`);
  return db;
}

/**
 * DATABASE_URL definida → PostgreSQL externo, sin volver nunca a la base local si falla. Si no, la base embebida en DATA_DIR.
 * En Render (variable RENDER) el disco se borra al reiniciar: sin DATABASE_URL se corta, en vez de operar con una base que desaparece.
 */
export async function connectDb(dataDir: string) {
  const url = process.env.DATABASE_URL;
  if (url !== undefined && !url.trim()) throw new Error('DATABASE_URL está definida pero vacía. Cargá la connection string de Neon o quitá la variable.');
  if (!url && process.env.RENDER) throw new Error('En Render hace falta DATABASE_URL (Neon): la base embebida se borraría en cada reinicio.');
  if (url && process.env.APP_ENV === 'test') throw new Error('APP_ENV=test no usa DATABASE_URL: las pruebas nunca se conectan a la base externa.');
  return url ? openPg(url) : openDb(dataDir);
}

export async function migrate(db: Db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())');
  const dir = join(import.meta.dirname, 'migrations');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await db.transaction(async (tx) => {
      // Dos procesos migrando a la vez (npm run migrate y un arranque en Render): el segundo espera y no repite.
      await tx.query('SELECT pg_advisory_xact_lock(724001)');
      if ((await tx.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f])).rows.length) return;
      await tx.exec(readFileSync(join(dir, f), 'utf8'));
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    });
  }
}

export async function one<T = Row>(q: Q, sql: string, params: any[] = []): Promise<T | undefined> {
  return (await q.query<T>(sql, params)).rows[0];
}
export async function all<T = Row>(q: Q, sql: string, params: any[] = []): Promise<T[]> {
  return (await q.query<T>(sql, params)).rows;
}
