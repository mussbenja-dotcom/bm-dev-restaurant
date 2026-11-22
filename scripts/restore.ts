// Restaura una copia en el DATA_DIR configurado. Detené el servidor antes. Si el destino tiene datos, se mueven a <dir>.antes-<fecha>.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
const src = process.argv[2];
if (!src || !existsSync(join(src, 'pgdata.tar.gz'))) { console.error('Uso: npm run restore -- <carpeta de copia con pgdata.tar.gz>'); process.exit(1); }
const { config } = await import('../server/config.ts');
const { PGlite } = await import('@electric-sql/pglite');
let moved: string | null = null;
if (existsSync(config.dataDir)) {
  moved = `${config.dataDir}.antes-${Date.now()}`;
  renameSync(config.dataDir, moved);
  console.log(`Datos anteriores movidos a ${moved}`);
}
try {
  mkdirSync(config.dataDir, { recursive: true });
  const blob = new Blob([readFileSync(join(src, 'pgdata.tar.gz'))]);
  const db = new PGlite(join(config.dataDir, 'pg'), { loadDataDir: blob });
  await db.waitReady;
  const n = (await db.query<{ n: number }>('SELECT count(*)::int n FROM restaurants')).rows[0].n;
  await db.close();
  if (existsSync(join(src, 'uploads'))) cpSync(join(src, 'uploads'), join(config.dataDir, 'uploads'), { recursive: true });
  console.log(`Restaurado en ${resolve(config.dataDir)} (${n} locales). Iniciá el servidor.`);
} catch (e) {
  // Si la restauración falla, se vuelven a poner los datos anteriores para no dejar el sistema vacío.
  rmSync(config.dataDir, { recursive: true, force: true });
  if (moved) renameSync(moved, config.dataDir);
  console.error(`No se pudo restaurar; los datos anteriores quedaron como estaban. ${e}`);
  process.exit(1);
}
