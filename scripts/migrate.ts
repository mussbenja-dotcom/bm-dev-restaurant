export {};
// Aplica las migraciones pendientes (server/migrations/*.sql) y termina. Con DATABASE_URL, en ese PostgreSQL (Neon);
// si no, en la base embebida de DATA_DIR. El servidor también las aplica al arrancar; esto sirve para preparar una base vacía antes.
const { config } = await import('../server/config.ts');
const { connectDb } = await import('../server/db.ts');
// connectDb aplica las pendientes al conectar.
const db = await connectDb(config.dataDir).catch((e) => { console.error(e.message); process.exit(1); });
const done = (await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);
await db.close();
console.log(`Base ${process.env.DATABASE_URL ? 'externa (DATABASE_URL)' : `embebida (${config.dataDir})`} al día. Migraciones registradas: ${done.join(', ')}.`);
