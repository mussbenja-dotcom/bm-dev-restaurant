import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Q = Pick<Transaction, 'query'>;
export type Row = Record<string, any>;

// numeric (OID 1700) llega como texto; lo pasamos a number (sumas de centavos entran holgadas en 2^53).
const parsers = { 1700: (v: string) => Number(v) };

export async function openDb(dataDir: string | null): Promise<PGlite> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? new PGlite(join(dataDir, 'pg'), { parsers }) : new PGlite({ parsers });
  await db.waitReady;
  await migrate(db);
  return db;
}

export async function migrate(db: PGlite) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())');
  const dir = join(import.meta.dirname, 'migrations');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await db.transaction(async (tx) => {
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
