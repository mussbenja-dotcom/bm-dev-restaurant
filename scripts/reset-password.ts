export {};
// Recuperación administrativa local: npm run reset-password -- <email> <nueva-clave>. Revoca las sesiones de esa persona.

const [email, pass] = process.argv.slice(2);
if (!email || !pass || pass.length < 8) { console.error('Uso: npm run reset-password -- <email> <clave de 8+ caracteres>'); process.exit(1); }
const { config } = await import('../server/config.ts');
const { openDb } = await import('../server/db.ts');
const { hashSecret, audit } = await import('../server/core.ts');
const db = await openDb(config.dataDir);
const u = (await db.query<{ id: number }>('UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id', [await hashSecret(pass), email.toLowerCase()])).rows[0];
if (!u) { console.error('No existe ese email'); process.exit(1); }
await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
await audit(db, null, null, 'platform.password_reset_cli', 'user', u.id, 'Recuperación local por consola');
await db.close();
console.log(`Clave actualizada para ${email}. Sesiones anteriores revocadas.`);
