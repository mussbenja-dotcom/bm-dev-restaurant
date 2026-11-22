import { expect, test, type Browser, type Page } from '@playwright/test';
import { login, watch } from './helpers.ts';

/** Turno completo por la interfaz: mesa → comanda a cocina y barra → precuenta → cobro dividido → ticket X → cierre de caja. */
async function as(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = watch(page);
  await login(page, email);
  return { page, errors };
}

async function addItem(page: Page, search: string) {
  await page.getByRole('searchbox', { name: 'Buscar plato' }).fill(search);
  await page.getByRole('button', { name: new RegExp('^' + search) }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Agregar' }).click();
  await expect(dlg).toBeHidden();
}

test('turno completo con dos sesiones', async ({ browser }) => {
  // 1. Mozo abre la mesa 3 y carga una ronda con plato de cocina y bebida de barra.
  const mozo = await as(browser, 'mozo1@esquina.test');
  await mozo.page.goto('/app/salon');
  await mozo.page.getByRole('button', { name: /^Mesa 3, / }).click();
  await mozo.page.getByRole('dialog').getByRole('button', { name: 'Abrir mesa' }).click();
  await expect(mozo.page).toHaveURL(/\/app\/mesa\/\d+/);
  const vid = mozo.page.url().split('/').pop();
  await addItem(mozo.page, 'Flan');
  await addItem(mozo.page, 'Gaseosa');
  await mozo.page.getByRole('button', { name: /^Enviar ronda · 2 ítems/ }).click();
  await expect(mozo.page.getByRole('status').filter({ hasText: /recibida en cocina/ })).toBeVisible();

  // 2. Cocina y barra ven su parte en vivo y la marcan lista.
  const cocina = await as(browser, 'cocina@esquina.test');
  await cocina.page.goto('/app/cocina');
  const flan = cocina.page.locator('article').filter({ hasText: 'Mesa 3' }).filter({ hasText: 'Flan' });
  await expect(flan).toBeVisible();
  await expect(cocina.page.locator('article').filter({ hasText: 'Mesa 3' }).filter({ hasText: 'Gaseosa' })).toHaveCount(0);
  await flan.getByRole('button', { name: /^Listo/ }).click();

  const barra = await as(browser, 'barra@esquina.test');
  await barra.page.goto('/app/cocina');
  const gas = barra.page.locator('article').filter({ hasText: 'Mesa 3' }).filter({ hasText: 'Gaseosa' });
  await gas.getByRole('button', { name: /^Listo/ }).click();
  await expect(gas.getByRole('button', { name: /^Listo/ })).toHaveCount(0);

  // 3. Precuenta desde la mesa: se abre la vista imprimible con la leyenda.
  const [pre] = await Promise.all([mozo.page.waitForEvent('popup'), mozo.page.getByRole('button', { name: 'Precuenta' }).click()]);
  await expect(pre.getByText('DOCUMENTO NO VALIDO COMO FACTURA')).toBeVisible();
  await expect(pre.getByText('Precuenta')).toBeVisible();

  // 4. Caja divide en dos partes iguales: efectivo con vuelto y transferencia verificada.
  const caja = await as(browser, 'caja@esquina.test');
  await caja.page.goto(`/app/caja?visit=${vid}`);
  await caja.page.getByRole('button', { name: 'Partes iguales' }).click();
  await caja.page.getByRole('button', { name: 'Cobrar esta parte' }).first().click();
  await caja.page.getByLabel('Efectivo recibido').fill('20000');
  await expect(caja.page.locator('.change-big')).toContainText(/Vuelto\s*\$/);
  await caja.page.getByRole('button', { name: /^Cobrar \$.* · Efectivo/ }).click();
  await expect(caja.page.getByRole('cell', { name: /Efectivo · Parte 1/ })).toBeVisible();
  await caja.page.getByRole('button', { name: 'Partes iguales' }).click();
  await expect(caja.page.getByText('Pagada')).toBeVisible();
  await expect(caja.page.getByRole('button', { name: 'Cobrar esta parte' })).toHaveCount(1);
  await caja.page.getByRole('button', { name: 'Cobrar esta parte' }).click();
  await caja.page.getByRole('group', { name: 'Medio de pago' }).getByRole('button', { name: 'Transferencia' }).click();
  await caja.page.getByLabel(/Verifiqué la acreditación/).check();
  await caja.page.getByRole('button', { name: /^Cobrar \$.* · Transferencia/ }).click();

  // 5. Saldo cero → cerrar mesa → ticket interno X.
  const [tx] = await Promise.all([caja.page.waitForEvent('popup'), caja.page.getByRole('button', { name: 'Cerrar mesa e imprimir ticket X' }).click()]);
  await expect(tx.getByText('DOCUMENTO NO VALIDO COMO FACTURA')).toBeVisible();
  await expect(tx.getByText('Ticket interno')).toBeVisible();
  await expect(tx.getByText(/Transferencia/)).toBeVisible();
  // Reimprimir el ticket (copia) no genera un cobro nuevo.
  const pays = async () => (await (await caja.page.request.get(`/api/visits/${vid}`)).json()).payments.length;
  const before = await pays();
  await tx.goto(tx.url() + (tx.url().includes('?') ? '&' : '?') + 'copia=1');
  await expect(tx.getByText(/COPIA · reimpreso/)).toBeVisible();
  await tx.reload();
  await expect(tx.getByText(/COPIA · reimpreso/)).toBeVisible();
  expect(await pays()).toBe(before);

  // 6. Arqueo con el esperado exacto y cierre de caja.
  await caja.page.goto('/app/caja/turno');
  const expected = await caja.page.locator('.totals strong.num').first().innerText();
  await caja.page.getByLabel('Efectivo contado').fill(expected.replace(/[^\d,]/g, ''));
  caja.page.once('dialog', (d) => d.accept());
  await caja.page.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(caja.page.getByRole('heading', { name: 'Caja cerrada' })).toBeVisible();
  await expect(caja.page.getByText('Diferencia: $ 0')).toBeVisible();

  // La mesa queda para limpiar en el salón del mozo.
  await mozo.page.goto('/app/salon');
  await expect(mozo.page.getByRole('button', { name: /^Mesa 3, / })).toContainText(/limpi/i);

  for (const s of [mozo, cocina, barra, caja]) expect(s.errors).toEqual([]);
});
