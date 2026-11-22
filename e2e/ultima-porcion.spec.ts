import { expect, test, type Browser } from '@playwright/test';
import { login, watch } from './helpers.ts';

/** A02 en dos navegadores: queda 1 vacío y dos mozos lo piden; uno lo obtiene y el otro recibe la explicación. */
async function mozo(browser: Browser, email: string, mesa: string) {
  const page = await (await browser.newContext()).newPage();
  const errors = watch(page, [/\/rounds$/]); // el 409 de la ronda es el comportamiento esperado
  await login(page, email);
  await page.goto('/app/salon');
  await page.getByRole('button', { name: new RegExp(`^Mesa ${mesa}, `) }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir mesa' }).click();
  await page.getByRole('searchbox', { name: 'Buscar plato' }).fill('Vacío');
  await page.getByRole('button', { name: /^Vacío/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Agregar' }).click();
  await page.getByRole('searchbox', { name: 'Buscar plato' }).fill('Agua');
  await page.getByRole('button', { name: /^Agua/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Agregar' }).click();
  return { page, errors };
}

test('última porción: un solo mozo la obtiene', async ({ browser }) => {
  const a = await mozo(browser, 'mozo1@esquina.test', '7');
  const b = await mozo(browser, 'mozo2@esquina.test', '8');
  await a.page.getByRole('button', { name: /^Enviar ronda · 2 ítems/ }).click();
  await expect(a.page.getByRole('status').filter({ hasText: /recibida en cocina/ })).toBeVisible();

  await b.page.getByRole('button', { name: /^Enviar ronda · 2 ítems/ }).click();
  await expect(b.page.getByRole('alert')).toContainText(/Vacío/);
  await expect(b.page.getByRole('alert')).toContainText('Lo quitamos de la ronda');
  // Lo demás de la ronda se conserva para reenviar.
  await b.page.getByRole('button', { name: /^Enviar ronda · 1 ítems/ }).click();
  await expect(b.page.getByRole('status').filter({ hasText: /recibida en cocina/ })).toBeVisible();
  // En la carta y en el selector ya figura agotado.
  await b.page.getByRole('searchbox', { name: 'Buscar plato' }).fill('Vacío');
  await expect(b.page.getByRole('button', { name: /^Vacío.*agotado/ })).toBeDisabled();
  for (const s of [a, b]) expect(s.errors).toEqual([]);
});
