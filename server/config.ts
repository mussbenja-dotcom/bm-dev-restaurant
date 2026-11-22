import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

// Carga .env sin dependencias: KEY=valor por línea; las variables del sistema tienen prioridad.
const envFile = resolve(process.env.ENV_FILE ?? '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const lanIp = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? 'localhost';

const env = process.env.APP_ENV ?? 'production';
const port = Number(process.env.PORT ?? (env === 'test' ? 4100 : 4000));
const httpsOn = !!(process.env.HTTPS_KEY && process.env.HTTPS_CERT);

export const config = {
  env, // 'production' (operación real) | 'test' (base descartable con datos ficticios)
  port,
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: resolve(process.env.DATA_DIR ?? (env === 'test' ? './data/test' : './data/prod')),
  // Render define RENDER_EXTERNAL_URL (https://<servicio>.onrender.com); PUBLIC_URL tiene prioridad (dominio propio).
  publicUrl: (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? `${httpsOn ? 'https' : 'http'}://${lanIp()}:${port}`).replace(/\/$/, ''),
  webDist: resolve('dist/web'),
  https: httpsOn ? { key: readFileSync(process.env.HTTPS_KEY!), cert: readFileSync(process.env.HTTPS_CERT!) } : undefined,
};
