import { expect, test, devices, type Browser } from '@playwright/test';
import sharp from 'sharp';
import { login, watch } from './helpers.ts';

/**
 * Flujo del dueño en Personalizar: logo y colores desde el celular, foto de un plato, nuevo precio,
 * vista previa, publicar, ver los cambios por el QR impreso en otro navegador, y pedido → cocina → cobro.
 */
const QR = '/mesa/mesa4-esquina-demo'; // QR impreso de la mesa 4 (datos de prueba)
const png = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

async function as(browser: Browser, email: string | null, opts = {}) {
  const ctx = await browser.newContext({ locale: 'es-AR', ...opts });
  const page = await ctx.newPage();
  const errors = watch(page);
  if (email) await login(page, email);
  return { page, errors, ctx };
}

test('el dueño personaliza, publica y el cambio llega al QR, a cocina y a caja', async ({ browser }) => {
  test.setTimeout(120_000);
  const phone = devices['Pixel 7'];
  const owner = await as(browser, 'dueno@esquina.test', { viewport: phone.viewport, userAgent: phone.userAgent, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = owner.page;

  // Entrada: Panel → «Personalizar mi restaurante».
  await p.goto('/app/dueno');
  await p.getByRole('link', { name: /Logo, colores y estilo de carta/ }).click();
  await expect(p.getByRole('heading', { name: 'Personalizar mi restaurante' })).toBeVisible();

  // 1. Marca: logo, color y fondo, desde el celular.
  await p.locator('[id="img-Logo"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await png(600, 600, '#a8231b') });
  await expect(p.getByRole('img', { name: 'Logo actual' })).toBeVisible();
  await p.getByRole('button', { name: 'Color #a8231b' }).click();
  await p.getByRole('button', { name: 'Blanco' }).click();
  await p.getByRole('button', { name: 'Guardar en borrador' }).click();
  await expect(p.getByText(/Guardado en borrador/)).toBeVisible();

  // 2. Carta: foto y nuevo precio de la milanesa.
  await p.getByRole('tab', { name: 'Carta' }).click();
  const row = p.locator('.item-row').filter({ hasText: 'Milanesa de nalga' });
  await row.getByRole('button', { name: 'Editar' }).click();
  const dlg = p.getByRole('dialog');
  await dlg.locator('[id="img-Foto del plato"]').setInputFiles({ name: 'mila.jpg', mimeType: 'image/png', buffer: await png(1600, 1200, '#c0803a') });
  await expect(dlg.getByRole('img', { name: 'Foto del plato actual' })).toBeVisible();
  await dlg.getByLabel('Precio', { exact: true }).fill('15000');
  await dlg.getByRole('button', { name: 'Guardar en borrador' }).click();
  await expect(dlg).toBeHidden();
  await expect(row.getByText('Con cambios')).toBeVisible();
  await expect(p.getByRole('status').filter({ hasText: /cambios sin publicar/ })).toBeVisible();

  // Los clientes todavía ven lo publicado.
  const before = await as(browser, null);
  await before.page.goto(QR);
  await expect(before.page.locator('.dish').filter({ hasText: 'Milanesa de nalga' })).toContainText('$ 14.500,00');
  await before.ctx.close();

  // 3. Vista previa en el celular con los cambios.
  await p.getByRole('tab', { name: 'Vista previa' }).click();
  const prev = p.frameLocator('iframe[title^="Vista previa"]');
  await expect(prev.getByText(/Vista previa/).first()).toBeVisible();
  await expect(prev.locator('.dish').filter({ hasText: 'Milanesa de nalga' })).toContainText('$ 15.000,00');
  await expect(prev.getByRole('img', { name: /Logo de/ })).toBeVisible();

  // 4. Publicar: mismo enlace, mismos QR.
  await p.getByRole('button', { name: 'Publicar cambios' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Publicar ahora' }).click();
  await expect(p.getByText('Todo publicado')).toBeVisible();

  // 5. Otro navegador abre el QR impreso y ve marca, foto y precio nuevos.
  const guest = await as(browser, null, { viewport: { width: 390, height: 844 } });
  await guest.page.goto(QR);
  const menu = guest.page.locator('.menu');
  await expect(menu).toHaveAttribute('data-paper', 'blanco');
  expect(await menu.getAttribute('style')).toContain('#a8231b');
  await expect(guest.page.getByRole('img', { name: /Logo de La Esquina/ })).toBeVisible();
  const dish = guest.page.locator('.dish').filter({ hasText: 'Milanesa de nalga' });
  await expect(dish).toContainText('$ 15.000,00');
  await expect(dish.getByRole('img', { name: 'Milanesa de nalga' })).toBeVisible();
  const logo = await guest.page.getByRole('img', { name: /Logo de/ }).evaluate((i: HTMLImageElement) => i.naturalWidth);
  expect(logo).toBeGreaterThan(0);

  // 6. Pedido con el precio nuevo → cocina → cobro.
  const mozo = await as(browser, 'mozo1@esquina.test');
  await mozo.page.goto('/app/salon');
  await mozo.page.getByRole('button', { name: /^Mesa 6, / }).click();
  await mozo.page.getByRole('dialog').getByRole('button', { name: 'Abrir mesa' }).click();
  await expect(mozo.page).toHaveURL(/\/app\/mesa\/\d+/);
  const vid = mozo.page.url().split('/').pop();
  await mozo.page.getByRole('searchbox', { name: 'Buscar plato' }).fill('Milanesa');
  await mozo.page.getByRole('button', { name: /^Milanesa/ }).first().click();
  const item = mozo.page.getByRole('dialog');
  const papas = item.getByRole('button', { name: /Papas fritas/ }).or(item.getByLabel(/Papas fritas/));
  if (await papas.count()) await papas.first().click();
  await item.getByRole('button', { name: 'Agregar' }).click();
  await expect(item).toBeHidden();
  await mozo.page.getByRole('button', { name: /^Enviar ronda · 1 ítems · \$ 15\.000/ }).click();
  await expect(mozo.page.getByRole('status').filter({ hasText: /recibida en cocina/ })).toBeVisible();

  const cocina = await as(browser, 'cocina@esquina.test');
  await cocina.page.goto('/app/cocina');
  const ticket = cocina.page.locator('article').filter({ hasText: 'Mesa 6' }).filter({ hasText: 'Milanesa de nalga' });
  await expect(ticket).toBeVisible();
  await ticket.getByRole('button', { name: /^Listo/ }).click();

  const caja = await as(browser, 'caja@esquina.test');
  await caja.page.goto(`/app/caja?visit=${vid}`);
  await expect(caja.page.locator('.due-cell')).toContainText('15.000,00');
  await caja.page.getByLabel(/Importe a aplicar/).fill('15000');
  await caja.page.getByRole('button', { name: /^Cobrar \$ 15\.000,00 · Efectivo/ }).click();
  await expect(caja.page.getByRole('button', { name: 'Cerrar mesa e imprimir ticket X' })).toBeVisible();

  // 7. Quitar la foto y publicar: el plato se sigue viendo completo, sin imagen.
  await p.getByRole('tab', { name: 'Carta' }).click();
  await p.locator('.item-row').filter({ hasText: 'Milanesa de nalga' }).getByRole('button', { name: 'Editar' }).click();
  const dlg2 = p.getByRole('dialog');
  await dlg2.getByRole('button', { name: 'Quitar', exact: true }).click();
  await expect(dlg2.getByRole('img', { name: 'Foto del plato actual' })).toHaveCount(0);
  await dlg2.getByRole('button', { name: 'Guardar en borrador' }).click();
  await expect(dlg2).toBeHidden();
  await p.getByRole('button', { name: 'Publicar cambios' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Publicar ahora' }).click();
  await expect(p.getByRole('dialog')).toBeHidden();
  await guest.page.reload();
  const sinFoto = guest.page.locator('.dish').filter({ hasText: 'Milanesa de nalga' });
  await expect(sinFoto).toContainText('$ 15.000,00');
  await expect(sinFoto.getByRole('img')).toHaveCount(0);

  for (const s of [owner, guest, mozo, cocina, caja]) expect(s.errors, 'errores de consola o red').toEqual([]);
});
