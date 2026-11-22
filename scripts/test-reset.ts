// Reinicia SOLO la base de pruebas y carga datos ficticios. Se niega a correr fuera de APP_ENV=test.
import { rmSync } from 'node:fs';
import { basename } from 'node:path';
process.env.APP_ENV ??= 'test';
const { config } = await import('../server/config.ts');
if (config.env !== 'test' || !/test/i.test(basename(config.dataDir))) {
  console.error(`Rechazado: este comando solo reinicia la base de pruebas (APP_ENV=test, DATA_DIR con "test"). Actual: ${config.env} ${config.dataDir}`);
  process.exit(1);
}
const { openDb } = await import('../server/db.ts');
const { seed, TEST_PASSWORD, TEST_PIN } = await import('../server/seed.ts');
rmSync(config.dataDir, { recursive: true, force: true });
const db = await openDb(config.dataDir);
await seed(db);
await db.close();
console.log(`Base de pruebas reiniciada en ${config.dataDir}. Usuarios *@esquina.test / *@fuego.test, clave "${TEST_PASSWORD}", PIN de encargado ${TEST_PIN}.`);
