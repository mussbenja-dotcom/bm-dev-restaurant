import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PASS } from './helpers.ts';

/** Capturas de diseño: VISUAL_OUT=antes|despues npx playwright test e2e/visual.spec.ts */
// Solo corre si se pide explícitamente: evita pisar las capturas guardadas en una corrida general.
test.skip(!process.env.VISUAL_OUT, 'Capturas: definir VISUAL_OUT=antes|despues');
const OUT = `docs/visual/${process.env.VISUAL_OUT}`; // ej. rediseno/antes
const WIDTHS: [string, number, number][] = [['360', 360, 780], ['768', 768, 1024], ['1440', 1440, 900]];
if (process.env.VISUAL_OUT) mkdirSync(OUT, { recursive: true });

async function apiLogin(request: APIRequestContext, email: string) {
  const r = await request.post('/api/login', { data: { email, password: PASS } });
  expect(r.ok()).toBe(true);
}

async function uiLogin(page: Page, email: string) {
  await apiLogin(page.request, email);
}

test.beforeAll(async ({ browser }) => {
  // Estado realista: una mesa con ronda en cocina/barra y otra con pago parcial.
  const ctx = await browser.newContext();
  const rq = ctx.request;
  await apiLogin(rq, 'mozo1@esquina.test');
  const menu = await (await rq.get('/api/menu')).json();
  const tables = await (await rq.get('/api/tables')).json();
  const pid = (n: string) => menu.products.find((p: any) => p.name.startsWith(n)).id;
  const optId = (n: string, o: string) => menu.products.find((p: any) => p.name.startsWith(n)).options.find((x: any) => x.name === o).id;
  for (const [num, items] of [['5', [{ productId: pid('Milanesa'), qty: 2, optionIds: [optId('Milanesa', 'Papas fritas')], note: 'una sin sal' }, { productId: pid('Copa de Malbec'), qty: 2 }]],
    ['7', [{ productId: pid('Provoleta'), qty: 1 }, { productId: pid('Sorrentinos'), qty: 1 }, { productId: pid('Agua'), qty: 3 }]]] as const) {
    const v = await (await rq.post('/api/visits', { data: { tableId: tables.find((t: any) => t.number === num).id, guests: 3 } })).json();
    const r = await rq.post(`/api/visits/${v.id}/rounds`, { data: { opId: `visual-${num}-${Date.now()}`, items } });
    expect(r.ok(), await r.text()).toBe(true);
  }
  await ctx.close();
});

const SCREENS: [string, string | null, string][] = [
  ['carta', null, '/m/esquina'],
  ['carta-pizzeria', null, '/m/fuego'],
  ['carta-mesa', null, '/q/mesa4-esquina-demo'], // entrada por el QR impreso de la mesa 4
  ['salon', 'mozo1@esquina.test', '/app/salon'],
  ['comanda', 'mozo1@esquina.test', 'MESA5'],
  ['cocina', 'cocina@esquina.test', '/app/cocina'],
  ['caja', 'caja@esquina.test', '/app/caja'],
  ['dueno', 'dueno@esquina.test', '/app/dueno'],
  ['config', 'dueno@esquina.test', '/app/config'],
  ['barra', 'barra@esquina.test', '/app/cocina'],
  ['personalizar', 'dueno@esquina.test', '/app/personalizar/marca'], // pantalla nueva: no tiene «antes»
  ['personalizar-carta', 'dueno@esquina.test', '/app/personalizar/carta'],
];

for (const [name, user, path] of SCREENS) {
  test(`captura ${name}`, async ({ page }) => {
    if (user) await uiLogin(page, user);
    let url = path;
    if (path === 'MESA5') {
      const floor = await (await page.request.get('/api/floor')).json();
      url = `/app/mesa/${floor.tables.find((t: any) => t.number === '5').visit_id}`;
    }
    if (name === 'caja') {
      const floor = await (await page.request.get('/api/floor')).json();
      url = `/app/caja?visit=${floor.tables.find((t: any) => t.number === '5').visit_id}`;
    }
    for (const [w, width, height] of WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto(url);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true });
    }
    // Reflow a 320 px (equivale a zoom 400% en 1280): no debe haber scroll horizontal.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: `${OUT}/${name}-320.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    test.info().annotations.push({ type: 'overflow-320', description: `${name}: ${overflow}px` });
    console.log(`overflow-320 ${name}: ${overflow}px`);
  });
}

test('captura carrito con teclado (360)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/m/fuego');
  await page.getByRole('button', { name: /^Agregar/ }).first().click();
  const dlg = page.getByRole('dialog');
  if (await dlg.isVisible()) await dlg.getByRole('button', { name: 'Agregar' }).click();
  await page.getByRole('button', { name: 'Ver pedido' }).click();
  await page.getByLabel('Nombre').focus();
  await page.screenshot({ path: `${OUT}/carrito-360.png`, fullPage: false });
});
