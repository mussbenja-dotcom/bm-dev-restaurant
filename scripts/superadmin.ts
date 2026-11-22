export {};
// Cuenta de Superadmin: npm run superadmin -- <email> "<nombre>"
// Con el servidor detenido (la base es de un solo proceso). La contraseña nunca va en la línea de comandos:
// - si SUPERADMIN_PASSWORD está definida en el entorno, se usa;
// - si no, se imprime un enlace de activación de un solo uso (24 h) para definirla desde el navegador.
// Si la cuenta ya existe, la pasa a Superadmin sin tocar su contraseña.

const [email, name] = process.argv.slice(2);
if (!email) { console.error('Uso: npm run superadmin -- <email> "<nombre>"'); process.exit(1); }
const { config } = await import('../server/config.ts');
// La base admite un solo proceso: si el servidor responde en este puerto, no se abre.
// shortcut: solo detecta un servidor en config.port de esta máquina; con otro PORT/host apagalo a mano.
if (await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) {
  console.error(`El servidor está corriendo en el puerto ${config.port}. Detenelo y volvé a ejecutar el comando.`);
  process.exit(1);
}
const { openDb } = await import('../server/db.ts');
const { ensureSuperadmin } = await import('../server/routes/platform.ts');
const db = await openDb(config.dataDir);
try {
  const r = await ensureSuperadmin(db, { email, name, password: process.env.SUPERADMIN_PASSWORD }, config.publicUrl);
  console.log({ created: `Cuenta de Superadmin creada: ${r.email}`, promoted: `${r.email} ahora es Superadmin (su contraseña no cambió).`, existing: `${r.email} ya era Superadmin.` }[r.state]);
  if (r.link) console.log(`Definí la contraseña en este enlace (un solo uso, vence en 24 h):\n  ${r.link.url}`);
} catch (e: any) {
  console.error(e.message); process.exitCode = 1;
} finally {
  await db.close();
}
