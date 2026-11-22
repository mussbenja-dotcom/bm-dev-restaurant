import { config } from './config.ts';
import { connectDb } from './db.ts';
import { buildApp } from './app.ts';
import { initSetupCode } from './routes/auth.ts';
import { ensureSuperadmin } from './routes/platform.ts';
import { isLocalUrl } from '../shared/qr.ts';

// Con DATABASE_URL, si la conexión falla se corta acá: nunca se arranca en silencio con una base local vacía.
const db = await connectDb(config.dataDir).catch((e) => { console.error(process.env.DATABASE_URL ? `\n  ${e.message}\n` : e); process.exit(1); });
const { app, ctx } = await buildApp({ db, dataDir: config.dataDir, publicUrl: config.publicUrl, env: config.env, webDist: config.webDist, https: config.https });
await app.listen({ port: config.port, host: config.host });

console.log(`\nBM Dev Restaurant · entorno ${config.env}`);
console.log(`  Base:       ${process.env.DATABASE_URL ? 'PostgreSQL externo (DATABASE_URL)' : `embebida en ${config.dataDir}`}`);
console.log(`  Fotos:      ${config.dataDir}`);
console.log(`  Local:      ${config.https ? 'https' : 'http'}://localhost:${config.port}`);
console.log(`  En la red:  ${config.publicUrl}`);
// Una dirección https sin certificado propio implica un proxy delante: sin TRUST_PROXY, los límites por IP ven a todos como el proxy.
if (config.publicUrl.startsWith('https://') && !config.https && !process.env.TRUST_PROXY) console.warn('\n  Aviso: PUBLIC_URL es https pero TRUST_PROXY no está definido. Si hay un proxy o túnel delante, definí TRUST_PROXY=1 (ver docs/INSTALACION.md).');
if (isLocalUrl(config.publicUrl)) console.log('  Carteles QR: dirección de red local (prueba). Con la dirección pública definitiva, configurá PUBLIC_URL y volvé a descargar los carteles.');
// Cuenta inicial por variables privadas del entorno (SUPERADMIN_EMAIL, SUPERADMIN_NAME y, opcional, SUPERADMIN_PASSWORD). Nada fijo en el código.
if (process.env.SUPERADMIN_EMAIL) {
  try {
    const r = await ensureSuperadmin(db, { email: process.env.SUPERADMIN_EMAIL, name: process.env.SUPERADMIN_NAME, password: process.env.SUPERADMIN_PASSWORD, fromBoot: true }, config.publicUrl);
    if (r.state !== 'existing') console.log(`\n  Superadmin: ${r.email} (${r.state === 'created' ? 'cuenta creada' : 'cuenta existente promovida'}).`);
    if (r.link) console.log(`  Definí la contraseña en este enlace (un solo uso, 24 h): ${r.link.url}\n`);
  } catch (e: any) { console.error(`\n  SUPERADMIN_EMAIL: ${e.message}`); }
}
const code = await initSetupCode(ctx);
if (code) console.log(`\n  Instalación nueva. Abrí ${config.publicUrl}/alta y usá este código de un solo uso: ${code}\n`);

// Cierre ordenado: PGlite debe cerrar para dejar la base consistente en disco (con DATABASE_URL, cierra la conexión).
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await app.close(); await db.close(); process.exit(0); });
