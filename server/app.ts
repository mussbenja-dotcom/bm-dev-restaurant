import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { HttpError, loadAuth, onPinFail, type Ctx } from './core.ts';
import authRoutes, { purgeLoginAttempts } from './routes/auth.ts';
import configRoutes from './routes/config.ts';
import serviceRoutes from './routes/service.ts';
import cashRoutes from './routes/cash.ts';
import publicRoutes from './routes/public.ts';
import ordersRoutes from './routes/orders.ts';
import stockRoutes from './routes/stock.ts';
import brandRoutes from './routes/brand.ts';
import qrRoutes from './routes/qr.ts';
import platformRoutes from './routes/platform.ts';

export type AppOpts = { db: PGlite; dataDir: string; publicUrl: string; env: string; webDist?: string; https?: { key: Buffer; cert: Buffer } };

export async function buildApp(o: AppOpts): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const uploadsDir = join(o.dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  const ctx: Ctx = { db: o.db, bus, uploadsDir, publicUrl: o.publicUrl, env: o.env };

  const app = Fastify({ logger: o.env === 'test' ? false : { level: 'warn' }, bodyLimit: 2_000_000, trustProxy: !process.env.TRUST_PROXY ? false : process.env.TRUST_PROXY === '1' ? 'loopback' : process.env.TRUST_PROXY, https: o.https ?? null } as any) as unknown as FastifyInstance;
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 15_000_000, files: 1 } });

  app.addHook('onRequest', async (req) => {
    (req as any).auth = req.url.startsWith('/api/') ? await loadAuth(o.db, req.cookies.sid) : null;
  });
  // Cabeceras básicas de seguridad para todas las respuestas.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'same-origin').header('x-frame-options', 'SAMEORIGIN') // la vista previa de la carta se muestra en un iframe del mismo sitio
      .header('content-security-policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");
    if (req.protocol === 'https') reply.header('strict-transport-security', 'max-age=15552000');
  });
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, ...err.extra });
    if (err.code === '23505') return reply.status(409).send({ error: 'Ya existe un registro con esos datos' });
    if (err.code === '23514' || err.code === '23503' || err.code === '22P02') return reply.status(400).send({ error: 'Datos inválidos' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    console.error(err);
    return reply.status(500).send({ error: 'Error interno. Reintentá; si persiste avisá a soporte.' });
  });

  // Sin await: PGlite ejecuta esta escritura cuando termina (y se revierte) la transacción que pidió el PIN.
  onPinFail((rid, uid, locked) => { o.db.query(`INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, data) VALUES ($1,$2,'pin.fail','user',$3,$4)`, [rid, uid, String(uid), JSON.stringify({ locked })]).catch((e) => app.log.error(e, 'no se pudo auditar el PIN fallido')); });
  const c = { ctx };
  await app.register(authRoutes, c);
  await app.register(configRoutes, c);
  await app.register(serviceRoutes, c);
  await app.register(cashRoutes, c);
  await app.register(publicRoutes, c);
  await app.register(ordersRoutes, c);
  await app.register(stockRoutes, c);
  await app.register(brandRoutes, c);
  await app.register(qrRoutes, c);
  await app.register(platformRoutes, c);
  app.get('/api/health', async () => ({ ok: true, env: o.env }));
  // Conservación de intentos de ingreso: LOGIN_RETENTION_DAYS (30 días); limpieza al arrancar y cada 6 horas.
  await purgeLoginAttempts(o.db).catch((e) => app.log.error(e, 'limpieza de ingresos'));
  const purge = setInterval(() => purgeLoginAttempts(o.db).catch((e) => app.log.error(e, 'limpieza de ingresos')), 6 * 3600_000);
  purge.unref();
  app.addHook('onClose', async () => clearInterval(purge));

  await app.register(fstatic, { root: uploadsDir, prefix: '/uploads/', decorateReply: false, maxAge: '7d' });
  if (o.webDist && existsSync(o.webDist)) {
    await app.register(fstatic, { root: o.webDist, prefix: '/' });
    // SPA: cualquier ruta no-API devuelve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (/^\/(api|uploads|assets)\//.test(req.url)) return reply.status(404).send({ error: 'No encontrado' });
      return reply.type('text/html').sendFile('index.html', o.webDist!);
    });
  }
  return { app, ctx };
}
