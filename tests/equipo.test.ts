import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../server/db.ts';
import { buildApp } from '../server/app.ts';
import { seed, TEST_PASSWORD } from '../server/seed.ts';

// Equipo: alta, edición por id (nombre, email, contraseña opcional) y «Cerrar sesiones».
let app: FastifyInstance;
let db: Db;
let dir: string;
const jar: Record<string, string> = {};
const OWNER = 'dueno@esquina.test', OWNER_B = 'dueno@fuego.test', MOZO = 'mozo1@esquina.test', COCINA = 'cocina@esquina.test', CAJA = 'caja@esquina.test';

async function login(email: string, password = TEST_PASSWORD) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { email, password } });
  if (r.statusCode === 200) jar[email] = String(r.headers['set-cookie']).split(';')[0];
  return r.statusCode;
}
async function api(who: string | null, method: string, url: string, payload?: unknown) {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: who ? { cookie: jar[who] } : {} });
  return { status: r.statusCode, body: (() => { try { return JSON.parse(r.body); } catch { return r.body; } })() };
}
const member = async (email: string) => (await api(OWNER, 'GET', '/api/team')).body.find((u: any) => u.email === email);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bmr-eq-'));
  db = await openDb(null);
  await seed(db);
  ({ app } = await buildApp({ db, dataDir: dir, publicUrl: 'http://localhost', env: 'test' }));
  for (const u of [OWNER, OWNER_B, MOZO, COCINA, CAJA]) await login(u);
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('equipo · edición', () => {
  it('cambiar solo el nombre lo guarda y conserva la contraseña', async () => {
    const u = await member(COCINA);
    const r = await api(OWNER, 'POST', '/api/team', { id: u.id, name: 'Ramón Parrilla', email: COCINA, password: '', roles: u.roles, pin: '', active: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await member(COCINA)).name).toBe('Ramón Parrilla');
    expect(await login(COCINA)).toBe(200); // la clave anterior sigue sirviendo
  });

  it('cambiar el email cambia el usuario de ingreso; un email de otra cuenta da 409', async () => {
    const u = await member(CAJA);
    expect((await api(OWNER, 'POST', '/api/team', { id: u.id, name: u.name, email: MOZO, roles: u.roles, active: true })).status).toBe(409);
    expect((await api(OWNER, 'POST', '/api/team', { id: u.id, name: u.name, email: 'caja.nueva@esquina.test', roles: u.roles, active: true })).status).toBe(200);
    expect(await login('caja.nueva@esquina.test')).toBe(200);
    expect(await login(CAJA)).toBe(401);
  });

  it('contraseña nueva al editar: solo el dueño, y cierra las sesiones de esa persona', async () => {
    const u = await member(MOZO);
    await login(MOZO);
    expect((await api(OWNER, 'POST', '/api/team', { id: u.id, name: u.name, email: MOZO, password: 'corta', roles: u.roles, active: true })).status).toBe(400);
    expect((await api(OWNER, 'POST', '/api/team', { id: u.id, name: u.name, email: MOZO, password: 'clave-nueva-123', roles: u.roles, active: true })).status).toBe(200);
    expect((await api(MOZO, 'GET', '/api/me')).status).toBe(401);
    expect(await login(MOZO, 'clave-nueva-123')).toBe(200);
  });

  it('no se cambia la cuenta de alguien que también trabaja en el local de otro dueño (sí sus roles acá)', async () => {
    const u = await member(MOZO);
    expect((await api(OWNER_B, 'POST', '/api/team', { email: MOZO, roles: ['waiter'], active: true })).status).toBe(200); // también trabaja en Fuego
    const r = await api(OWNER, 'POST', '/api/team', { id: u.id, name: 'Otro nombre', email: MOZO, roles: u.roles, active: true });
    expect(r.status).toBe(409);
    expect((await member(MOZO)).name).toBe(u.name);
    expect((await api(OWNER, 'POST', '/api/team', { id: u.id, name: u.name, email: MOZO, roles: ['waiter', 'cashier'], active: true })).status).toBe(200);
  });

  it('editar a alguien de otro local por id da 404', async () => {
    const fuego = (await api(OWNER_B, 'GET', '/api/team')).body.find((x: any) => x.email === 'caja@fuego.test');
    expect((await api(OWNER, 'POST', '/api/team', { id: fuego.id, name: 'Robo', email: 'caja@fuego.test', roles: ['waiter'], active: true })).status).toBe(404);
  });
});

describe('equipo · permisos del encargado', () => {
  const BARRA = 'barra@esquina.test';
  it('el encargado cambia nombres, pero no el email ni la contraseña, ni toca al dueño', async () => {
    const barra = await member(BARRA);
    expect((await api(OWNER, 'POST', '/api/team', { id: barra.id, name: barra.name, email: BARRA, roles: ['manager'], active: true })).status).toBe(200);
    await login(BARRA);
    const caja = (await api(OWNER, 'GET', '/api/team')).body.find((u: any) => u.roles.includes('cashier'));
    expect((await api(BARRA, 'POST', '/api/team', { id: caja.id, name: 'Caja Renombrada', email: caja.email, roles: caja.roles, active: true })).status).toBe(200);
    expect((await api(BARRA, 'POST', '/api/team', { id: caja.id, name: caja.name, email: 'robo@esquina.test', roles: caja.roles, active: true })).status).toBe(403);
    expect((await api(BARRA, 'POST', '/api/team', { id: caja.id, name: caja.name, email: caja.email, password: 'clave-robada-1', roles: caja.roles, active: true })).status).toBe(403);
    const owner = await member(OWNER);
    expect((await api(BARRA, 'POST', '/api/team', { id: owner.id, name: 'Dueña cambiada', email: OWNER, roles: ['waiter'], active: true })).status).toBe(403);
    expect((await member(OWNER)).name).toBe(owner.name); // el UPDATE se deshizo
    expect((await api(OWNER, 'GET', '/api/team')).body.some((x: any) => x.email === 'robo@esquina.test')).toBe(false);
  });

  it('la contraseña propia no se cambia desde Equipo (va por «Mi contraseña», que pide la actual)', async () => {
    const me = await member(OWNER);
    expect((await api(OWNER, 'POST', '/api/team', { id: me.id, name: me.name, email: OWNER, password: 'clave-duena-123', roles: me.roles, active: true })).status).toBe(400);
    expect(await login(OWNER, 'clave-duena-123')).toBe(401);
  });
});

describe('equipo · cerrar sesiones', () => {
  it('desconecta a la persona y conserva su cuenta, roles y estado', async () => {
    await login(COCINA);
    const before = await member(COCINA);
    expect((await api(COCINA, 'GET', '/api/me')).status).toBe(200);
    expect((await api(OWNER, 'POST', `/api/team/${before.id}/revoke-sessions`, {})).body).toEqual({ ok: true });
    expect((await api(COCINA, 'GET', '/api/me')).status).toBe(401);
    expect(await member(COCINA)).toEqual(before);
    expect(await login(COCINA)).toBe(200);
    expect((await api(OWNER, 'POST', '/api/team/999999/revoke-sessions', {})).status).toBe(404);
  });
});
