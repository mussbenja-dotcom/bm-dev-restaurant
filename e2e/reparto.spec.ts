import { expect, test, devices } from '@playwright/test';
import { login, watch } from './helpers.ts';

/** Reparto sin datos: precarga con Wi-Fi, modo avión, cerrar y reabrir el panel, registrar la entrega y sincronizar una sola vez. */
test('repartidor sin conexión: la entrega se registra una sola vez al reconectar', async ({ browser }) => {
  // Encargado/caja arma un delivery, lo asigna al repartidor y lo despacha.
  const staffCtx = await browser.newContext();
  const caja = await staffCtx.newPage();
  await login(caja, 'caja@esquina.test');
  const cocina = await (await browser.newContext()).newPage();
  await login(cocina, 'cocina@esquina.test');
  const menu = await (await caja.request.get('/api/menu')).json();
  const flan = menu.products.find((p: any) => p.name.startsWith('Flan')).id;
  const zones = await (await caja.request.get('/api/zones')).json();
  const o = await (await caja.request.post('/api/orders', { data: { opId: `e2e-rep-${Date.now()}`, channel: 'delivery', name: 'Ana Prueba', phone: '1150000000', address: 'Calle Falsa 123', zoneId: zones.find((z: any) => z.name === 'Boedo').id, items: [{ productId: flan, qty: 3 }] } })).json();
  expect(o.id, JSON.stringify(o)).toBeTruthy();
  const riders = await (await caja.request.get('/api/riders')).json();
  expect((await caja.request.post(`/api/orders/${o.id}/assign`, { data: { riderId: riders[0].id, eta: '21:15 a 21:30' } })).ok()).toBe(true);
  const d = await (await caja.request.get(`/api/orders/${o.id}`)).json();
  for (const l of d.lines) expect((await cocina.request.post(`/api/lines/${l.id}/ready`)).ok()).toBe(true);
  expect((await caja.request.post(`/api/orders/${o.id}/status`, { data: { status: 'en_reparto' } })).ok()).toBe(true);

  // 1. Con Wi-Fi: el repartidor abre su panel y queda la copia guardada (y la app en caché).
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  let page = await ctx.newPage();
  const errors = watch(page);
  await login(page, 'reparto@esquina.test');
  await page.goto('/repartidor');
  await expect(page.getByText(`#${o.number} · Ana Prueba`)).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker?.ready);
  await page.reload(); // ya controlada por el service worker: guarda la pantalla para usarla sin datos
  await expect(page.getByText(`#${o.number} · Ana Prueba`)).toBeVisible();

  // 2. Modo avión, cerrar el panel y volver a abrirlo.
  await ctx.setOffline(true);
  await page.close();
  page = await ctx.newPage();
  await page.goto('/repartidor');
  await expect(page.getByText('Sin datos: trabajando con la copia guardada')).toBeVisible();
  const card = page.locator('article').filter({ hasText: `#${o.number} · Ana Prueba` });
  await expect(card).toBeVisible();

  // 3. Registrar la entrega sin conexión.
  await card.getByRole('button', { name: 'Entregado' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar en el teléfono' }).click();
  await expect(card.getByText(/pendiente de sincronizar/)).toBeVisible();
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('rider-queue') ?? '[]'));
  expect(queued).toHaveLength(1);
  expect((await (await caja.request.get(`/api/orders/${o.id}`)).json()).order.status).toBe('en_reparto');

  // 4. Vuelve la señal: sincroniza solo; repetir la sincronización no duplica.
  await ctx.setOffline(false);
  await expect(page.getByText(/Sincronizado 1 cambio/)).toBeVisible();
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  const again = await (await page.request.post('/api/rider/sync', { data: { changes: queued } })).json();
  expect(again.results[0].duplicate).toBe(true);
  const after = await (await caja.request.get(`/api/orders/${o.id}`)).json();
  expect(after.order.status).toBe('entregado');
  const owner = await (await browser.newContext()).newPage();
  await login(owner, 'dueno@esquina.test');
  const log = await (await owner.request.get('/api/audit')).json();
  expect(log.filter((x: any) => x.action === 'rider.entregado' && Number(x.entity_id) === o.id)).toHaveLength(1);
  expect(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|net::/.test(e))).toEqual([]);
});
