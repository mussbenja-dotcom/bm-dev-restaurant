import { vi } from 'vitest';

// Modo DATABASE_URL sin Neon: cada base de prueba en memoria se sirve por el protocolo de PostgreSQL (pglite-socket)
// y la app se conecta con el driver pg, exactamente como en Render. Se usa con: npm run test:pg
process.env.BMR_PG_WIRE = '1';
vi.mock(import('../server/db.ts'), async (orig) => {
  const real = await orig();
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  return {
    ...real,
    openDb: async (dataDir: string | null) => {
      if (dataDir) return real.openDb(dataDir);
      const pglite = new PGlite();
      await pglite.waitReady;
      const port = 20000 + Math.floor(Math.random() * 20000);
      const server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 4 });
      await server.start();
      const db = await real.openPg(`postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`);
      return { ...db, close: async () => { await db.close(); await server.stop(); await pglite.close(); } };
    },
  };
});
