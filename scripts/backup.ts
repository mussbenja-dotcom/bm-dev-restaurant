// Copia de base, fotos y configuración en backups/<fecha>/. Puede correr con el servidor detenido (recomendado al cierre del turno).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const { config } = await import('../server/config.ts');
if (process.env.DATABASE_URL) { console.error('Rechazado: este comando es para la base embebida y DATABASE_URL está definida. Con Neon, usá las copias e historial del propio Neon.'); process.exit(1); }
const { PGlite } = await import('@electric-sql/pglite');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(process.argv[2] ?? join('backups', `${config.env}-${stamp}`));
mkdirSync(out, { recursive: true });
const db = new PGlite(join(config.dataDir, 'pg'));
await db.waitReady;
// Volcado consistente del directorio de datos de PostgreSQL (PGlite) en un único archivo.
const dump = await db.dumpDataDir('gzip');
writeFileSync(join(out, 'pgdata.tar.gz'), Buffer.from(await dump.arrayBuffer()));
await db.close();
if (existsSync(join(config.dataDir, 'uploads'))) cpSync(join(config.dataDir, 'uploads'), join(out, 'uploads'), { recursive: true });
if (existsSync('.env')) cpSync('.env', join(out, 'env.txt'));
writeFileSync(join(out, 'LEEME.txt'), `Copia de BM Dev Restaurant\nEntorno: ${config.env}\nFecha: ${new Date().toISOString()}\nRestaurar: npm run restore -- "${out}"\nContiene la configuración (.env): guardala en un lugar seguro.\n`);
console.log(`Copia creada en ${out}`);
