import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { connectDb, openDb, openPg, redactDbError } from '../server/db.ts';
import { trustProxy } from '../server/app.ts';

// Adaptador de base: PGlite local y PostgreSQL externo (DATABASE_URL) devuelven los mismos tipos.
describe('base de datos', () => {
  it('con npm run test:pg, toda la suite corre por el driver pg (no por PGlite)', async () => {
    const db = await openDb(null);
    expect('waitReady' in db).toBe(process.env.BMR_PG_WIRE !== '1');
    await db.close();
  });

  it('mismos tipos que PGlite: int8 y numeric como número, fechas como Date en UTC, arrays y json', async () => {
    const db = await openDb(null);
    const r = (await db.query(`SELECT count(*) AS c, sum(2)::int8 AS s, 12.5::numeric AS n, '2026-11-22'::date AS d, '2026-11-22T10:00:00Z'::timestamptz AS t,
      ARRAY['owner','waiter'] AS roles, '{"a":[1,2]}'::jsonb AS j, true AS b, NULL::int AS z`)).rows[0];
    expect(r).toEqual({ c: 1, s: 2, n: 12.5, d: new Date('2026-11-22T00:00:00Z'), t: new Date('2026-11-22T10:00:00Z'), roles: ['owner', 'waiter'], j: { a: [1, 2] }, b: true, z: null });
    // Una transacción que falla no deja nada a medias
    await db.exec('CREATE TABLE t_tx (x int)');
    await expect(db.transaction(async (tx) => { await tx.query('INSERT INTO t_tx VALUES (1)'); throw new Error('falla'); })).rejects.toThrow('falla');
    expect((await db.query('SELECT count(*)::int n FROM t_tx')).rows[0]).toEqual({ n: 0 });
    await db.close();
  });

  it('si DATABASE_URL no conecta, el error no muestra la URL, el usuario, la clave ni el host', async () => {
    const url = 'postgresql://usuario_secreto:clave-super-secreta@127.0.0.1:1/basex?sslmode=disable';
    const e = await openPg(url).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toMatch(/^No se pudo conectar a la base de DATABASE_URL/);
    for (const s of ['usuario_secreto', 'clave-super-secreta', 'postgresql://']) expect(e.message).not.toContain(s);
    expect(redactDbError(new Error('getaddrinfo ENOTFOUND ep-x.neon.tech para usuario_secreto'), 'postgresql://usuario_secreto:pw12@ep-x.neon.tech/db')).toBe('getaddrinfo ENOTFOUND *** para ***');
  });

  it('TRUST_PROXY: "saltos:1" para Render, "1" para un proxy local', () => {
    expect(trustProxy(undefined)).toBe(false);
    expect(trustProxy('1')).toBe('loopback');
    expect(trustProxy('saltos:1')).toBe(1);
    expect(trustProxy('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('base de datos · arranque seguro', () => {
  const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<unknown>) => {
    const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };
  it('nunca cae en silencio a la base local: DATABASE_URL vacía, Render sin URL o pruebas con URL externa', async () => {
    await withEnv({ DATABASE_URL: '  ', RENDER: undefined, APP_ENV: 'production' }, () => expect(connectDb('./data/no-se-usa')).rejects.toThrow(/definida pero vacía/));
    await withEnv({ DATABASE_URL: undefined, RENDER: 'true', APP_ENV: 'production' }, () => expect(connectDb('./data/no-se-usa')).rejects.toThrow(/En Render hace falta DATABASE_URL/));
    await withEnv({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x', RENDER: undefined, APP_ENV: 'test' }, () => expect(connectDb('./data/no-se-usa')).rejects.toThrow(/APP_ENV=test/));
    expect(existsSync('./data/no-se-usa')).toBe(false);
  });

  it('una base remota exige TLS con verificación', async () => {
    for (const q of ['', '?sslmode=disable', '?sslmode=no-verify', '?sslmode=require&uselibpqcompat=true'])
      await expect(openPg(`postgresql://u:p@ep-x.example.invalid/db${q}`), q).rejects.toThrow(/sslmode=verify-full/);
  });

  it('el error se redacta aunque la clave tenga un % mal codificado', () => {
    expect(redactDbError(new Error('password authentication failed for user "neon_user" at ep-x.neon.tech'), 'postgresql://neon_user:ab%zz12@ep-x.neon.tech/db'))
      .toBe('password authentication failed for user "***" at ***');
  });

  it('si la conexión se corta en medio de una transacción, falla esa transacción y el servidor sigue', async () => {
    const pglite = new PGlite(); await pglite.waitReady;
    const port = 40000 + Math.floor(Math.random() * 10000);
    let server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1' });
    await server.start();
    const db = await openPg(`postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`);
    await expect(db.transaction(async (tx) => {
      await tx.query('SELECT 1');
      await server.stop(); // corte del lado del servidor, como cuando Neon se suspende
      await new Promise((r) => setTimeout(r, 200));
      await tx.query('SELECT 2');
    })).rejects.toThrow();
    server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1' });
    await server.start();
    expect((await db.query('SELECT 3 AS n')).rows).toEqual([{ n: 3 }]); // reconectó con una conexión nueva
    await db.close(); await server.stop(); await pglite.close();
  });
});
