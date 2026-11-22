import { expect, test, devices, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { login, watch } from './helpers.ts';

/** Pedido por QR autorizado por el mozo, de punta a punta en la interfaz, con capturas para la documentación. */
const OUT = 'docs/visual/qr';
mkdirSync(OUT, { recursive: true });

async function staff(browser: Browser, email: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = watch(page, [/\/api\/visits\/\d+\/qr$/]);
  await login(page, email);
  return { page, errors };
}
async function phone(browser: Browser) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  // 403/409 esperables: enviar sin código, código de otra mesa, cambios de disponibilidad.
  const errors = watch(page, [/\/api\/public\/t\/[^/]+\/(join|order)$/]);
  return { page, errors };
}

test('pedido por QR: habilitar, código, cocina y barra, aviso al mozo, deshabilitar', async ({ browser }) => {
  const mozo = await staff(browser, 'mozo1@esquina.test');
  const tables = await (await mozo.page.request.get('/api/tables')).json();
  const qr1 = tables.find((t: any) => t.number === '1').qr_token;
  const qr2 = tables.find((t: any) => t.number === '2').qr_token;

  // Mesa 1 abierta por mozo1 (queda asignado).
  await mozo.page.goto('/app/salon');
  await mozo.page.getByRole('button', { name: /^Mesa 1, / }).click();
  await mozo.page.getByRole('dialog').getByRole('button', { name: 'Abrir mesa' }).click();
  await expect(mozo.page).toHaveURL(/\/app\/mesa\/\d+/);
  const mesaUrl = mozo.page.url();

  // El cliente abre el QR, arma el carrito, pero no puede enviar hasta que el mozo habilite.
  const cel = await phone(browser);
  await cel.page.goto(`/mesa/${qr1}`);
  await expect(cel.page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(cel.page.getByText(/pedile al personal que habilite los pedidos por QR/)).toBeVisible();
  await cel.page.getByRole('button', { name: /^Agregar Gaseosa/ }).click();
  await cel.page.getByRole('button', { name: /^Elegir opciones de Milanesa/ }).click();
  const dlgItem = cel.page.getByRole('dialog');
  await dlgItem.getByRole('button', { name: 'Papas fritas' }).click();
  await dlgItem.getByRole('button', { name: 'Agregar' }).click();
  await cel.page.getByRole('button', { name: 'Revisar y pedir' }).click();
  const dlg = cel.page.getByRole('dialog', { name: 'Tu pedido' });
  await expect(dlg.getByText(/Todavía no habilitaron los pedidos por QR/)).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Enviar pedido' })).toBeDisabled();
  await cel.page.screenshot({ path: `${OUT}/1-celular-sin-habilitar.png` });

  // El mozo habilita y ve el código de 6 dígitos.
  await mozo.page.getByRole('button', { name: 'Habilitar pedidos por QR' }).click();
  const code = (await mozo.page.locator('.qr-code').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);
  await expect(mozo.page.getByRole('button', { name: 'Deshabilitar pedidos por QR' })).toBeEnabled();
  await mozo.page.screenshot({ path: `${OUT}/2-mozo-codigo.png` });

  // Un código de otra mesa no sirve.
  const otra = await (await mozo.page.request.post('/api/visits', { data: { tableId: tables.find((t: any) => t.number === '2').id } })).json();
  const otherCode = (await (await mozo.page.request.post(`/api/visits/${otra.id}/qr`, { data: { enabled: true } })).json()).code;
  expect(qr2).not.toBe(qr1);
  const codeField = dlg.getByLabel('Código de la mesa');
  await expect(codeField).toBeVisible(); // el celular se entera en vivo de que se habilitó
  await codeField.fill(otherCode);
  await dlg.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(cel.page.getByText(/Código incorrecto|código/i).first()).toBeVisible();

  // Con el código correcto: «Pedido enviado» con número de comanda.
  await codeField.fill(code);
  await cel.page.screenshot({ path: `${OUT}/3-celular-ingresa-codigo.png` });
  await dlg.getByRole('button', { name: 'Enviar pedido' }).click();
  const sent = cel.page.getByRole('dialog', { name: 'Pedido enviado' });
  await expect(sent.getByText(/^Comanda \d+/)).toBeVisible();
  await cel.page.screenshot({ path: `${OUT}/4-celular-pedido-enviado.png` });
  const comanda = (await sent.getByText(/^Comanda \d+/).innerText()).match(/\d+/)![0];

  // El mozo asignado recibe el aviso con mesa, hora y «Ver pedido».
  await mozo.page.goto('/app/salon');
  const aviso = mozo.page.locator('.notice').filter({ hasText: 'Mesa 1' });
  // El aviso en vivo pudo llegar antes de navegar; el salón también lo muestra como alerta de la mesa.
  const alerta = mozo.page.locator('.alert-row').filter({ hasText: 'Pidió por QR' }).filter({ hasText: 'Mesa 1' });
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText(`Comanda ${comanda}`);
  await mozo.page.screenshot({ path: `${OUT}/5-mozo-aviso.png` });
  if (await aviso.count()) await aviso.first().getByRole('button', { name: 'Ver pedido' }).click();
  else await alerta.getByRole('button', { name: 'Ver pedido' }).click();
  await expect(mozo.page).toHaveURL(mesaUrl);
  await expect(mozo.page.getByText('Milanesa de nalga').first()).toBeVisible();

  // Cocina recibe la milanesa, barra la gaseosa.
  const cocina = await staff(browser, 'cocina@esquina.test');
  await cocina.page.goto('/app/cocina');
  await expect(cocina.page.locator('article').filter({ hasText: 'Mesa 1' }).filter({ hasText: 'Milanesa' })).toBeVisible();
  const barra = await staff(browser, 'barra@esquina.test');
  await barra.page.goto('/app/cocina');
  await expect(barra.page.locator('article').filter({ hasText: 'Mesa 1' }).filter({ hasText: 'Gaseosa' })).toBeVisible();
  await expect(barra.page.locator('article').filter({ hasText: 'Mesa 1' }).filter({ hasText: 'Milanesa' })).toHaveCount(0);

  // Aviso en vivo: segunda ronda desde un segundo celular mientras el mozo mira el salón.
  const cel2 = await phone(browser);
  await cel2.page.goto(`/mesa/${qr1}`);
  // El carrito se arma libre; el código se pide recién al enviar (una vez por celular).
  await cel2.page.getByRole('button', { name: /^Agregar Agua mineral/ }).click();
  await cel2.page.getByRole('button', { name: 'Revisar y pedir' }).click();
  await cel2.page.getByRole('dialog', { name: 'Tu pedido' }).getByLabel('Código de la mesa').fill(code);
  await cel2.page.getByRole('dialog', { name: 'Tu pedido' }).getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(cel2.page.getByRole('dialog', { name: 'Pedido enviado' })).toBeVisible();
  await mozo.page.goto('/app/salon');
  await mozo.page.waitForTimeout(300);
  await cel2.page.getByRole('button', { name: 'Seguir mirando la carta' }).click();
  await cel2.page.getByRole('button', { name: /^Agregar Flan/ }).click();
  await cel2.page.getByRole('button', { name: 'Revisar y pedir' }).click();
  await cel2.page.getByRole('dialog', { name: 'Tu pedido' }).getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(mozo.page.locator('.notice').filter({ hasText: 'Mesa 1' })).toBeVisible();
  await mozo.page.screenshot({ path: `${OUT}/6-mozo-aviso-en-vivo.png` });

  // Plato agotado entre que armó el carrito y lo envió: se informa antes de confirmar.
  await cel2.page.getByRole('button', { name: 'Seguir mirando la carta' }).click();
  await cel2.page.getByRole('button', { name: /^Agregar Provoleta/ }).click();
  await cocina.page.request.post(`/api/products/${(await (await cocina.page.request.get('/api/menu')).json()).products.find((p: any) => p.name.startsWith('Provoleta')).id}/availability`, { data: { available: false } });
  await cel2.page.getByRole('button', { name: 'Revisar y pedir' }).click();
  await cel2.page.getByRole('dialog', { name: 'Tu pedido' }).getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(cel2.page.getByRole('alert').filter({ hasText: /se agotó/ })).toBeVisible();

  // Deshabilitar: el celular ya no puede enviar, pero sigue viendo la carta.
  await mozo.page.goto(mesaUrl);
  await mozo.page.getByRole('button', { name: 'Deshabilitar pedidos por QR' }).click();
  await expect(mozo.page.getByRole('button', { name: 'Habilitar pedidos por QR' })).toBeVisible();
  await cel.page.getByRole('button', { name: 'Seguir mirando la carta' }).click();
  await cel.page.getByRole('button', { name: /^Agregar Agua mineral/ }).click();
  await cel.page.getByRole('button', { name: 'Revisar y pedir' }).click();
  await expect(cel.page.getByRole('dialog', { name: 'Tu pedido' }).getByText(/Todavía no habilitaron los pedidos por QR/)).toBeVisible();
  await expect(cel.page.getByRole('heading', { level: 1 })).toBeVisible();

  await cocina.page.request.post(`/api/products/${(await (await cocina.page.request.get('/api/menu')).json()).products.find((p: any) => p.name.startsWith('Provoleta')).id}/availability`, { data: { available: true } });
  for (const s of [mozo, cocina, barra, cel, cel2]) expect(s.errors).toEqual([]);
});

test('carta pública: sin desbordes y nombre, precio y «Agregar» juntos en 320, 360, 768 y 1440', async ({ browser }) => {
  for (const width of [320, 360, 768, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 700, hasTouch: width < 700 });
    const page = await ctx.newPage();
    const errors = watch(page);
    await page.goto('/m/esquina');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const dishes = [...document.querySelectorAll('.dish')].map((d) => {
        const r = d.getBoundingClientRect();
        const name = d.querySelector('h3')!.getBoundingClientRect();
        const price = d.querySelector('.price')!.getBoundingClientRect();
        const add = d.querySelector('.add, .soldout-tag')?.getBoundingClientRect();
        return { w: r.width, nameW: name.width, gap: price.left - name.right, addGap: add ? add.top - name.bottom : 0, right: r.right };
      });
      return { overflow: doc.scrollWidth - doc.clientWidth, dishes };
    });
    await page.screenshot({ path: `${OUT}/carta-${width}.png` });
    expect(m.overflow, `desborde horizontal a ${width}px`).toBeLessThanOrEqual(0);
    for (const d of m.dishes) {
      expect(d.right, `plato fuera de pantalla a ${width}px`).toBeLessThanOrEqual(width);
      expect(d.nameW, `nombre comprimido a ${width}px`).toBeGreaterThan(Math.min(110, d.w * 0.3));
      expect(d.addGap, `«Agregar» lejos del nombre a ${width}px`).toBeLessThan(260);
    }
    if (width >= 1440) expect(Math.max(...m.dishes.map((d) => d.w)), 'tarjetas demasiado anchas en escritorio').toBeLessThan(600);
    expect(errors).toEqual([]);
    await ctx.close();
  }
});

test('carrito: «Cambiar» reemplaza la línea, la cantidad suma al total y «Quitar» la saca', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto('/m/esquina');
  await page.getByRole('button', { name: /^Elegir opciones de Milanesa/ }).click();
  const item = page.getByRole('dialog', { name: /Milanesa/ });
  await item.getByRole('button', { name: 'Papas fritas' }).click();
  await item.getByRole('button', { name: /^Agregar al pedido/ }).click();
  await page.getByRole('button', { name: /^Agregar Flan/ }).click();
  await page.getByRole('button', { name: /Ver pedido/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Tu pedido' });
  await expect(dlg.locator('.cart-line')).toHaveCount(2);

  await dlg.getByRole('button', { name: /^Cambiar Milanesa/ }).click();
  const edit = page.getByRole('dialog', { name: /Milanesa/ });
  await edit.getByRole('button', { name: 'Puré de papas' }).click();
  await edit.getByRole('button', { name: /^Guardar cambios/ }).click();
  await expect(edit).toBeHidden();
  await expect(dlg.locator('.cart-line')).toHaveCount(2); // reemplaza, no agrega
  await expect(dlg.locator('.cart-line').first()).toContainText('Puré de papas');
  await expect(dlg.locator('.cart-line').first()).not.toContainText('Papas fritas');

  // Los precios salen de la carta (otra prueba puede cambiarlos): total = milanesa + 2 × flan.
  const cents = async (l: any) => Math.round(Number((await l.innerText()).replace(/[^\d,]/g, '').replace(',', '.')) * 100);
  const total = dlg.locator('.checkout-total.num');
  const mila = await cents(dlg.locator('.cart-line').first().locator('.cl-price'));
  const flan = await cents(dlg.locator('.cart-line').nth(1).locator('.cl-price'));
  expect(await cents(total)).toBe(mila + flan);
  await dlg.getByRole('button', { name: 'Más cantidad de Flan casero con dulce de leche' }).click();
  await expect.poll(() => cents(total)).toBe(mila + 2 * flan);
  await dlg.getByRole('button', { name: /^Quitar Flan/ }).click();
  await expect(dlg.locator('.cart-line')).toHaveCount(1);
  await expect.poll(() => cents(total)).toBe(mila);
  expect(errors).toEqual([]);
  await ctx.close();
});
