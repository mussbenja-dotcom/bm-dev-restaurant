import { expect, test, devices, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { login, watch } from './helpers.ts';

/** El dueño maneja una mesa sin mozo: abre, habilita el QR, recibe el aviso; después asigna mozo y la mesa sigue igual. */
const OUT = 'docs/visual/sin-mozo';
mkdirSync(OUT, { recursive: true });

async function staff(browser: Browser, email: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = watch(page);
  await login(page, email);
  return { page, errors };
}

test('mesa sin mozo: el dueño abre, habilita el QR y recibe el aviso; al asignar mozo, él ve lo anterior y recibe la segunda ronda', async ({ browser }) => {
  const dueno = await staff(browser, 'dueno@esquina.test');
  const req = dueno.page.request;
  // Mesa 2 libre y limpia (otra prueba pudo dejarla abierta sin consumos).
  const floor0 = await (await req.get('/api/floor')).json();
  const t2 = floor0.tables.find((t: any) => t.number === '2');
  const qr2 = (await (await req.get('/api/tables')).json()).find((t: any) => t.id === t2.id).qr_token;
  // Cobrar lo que falte y cerrar: con caja abierta (la usa también el cierre del final).
  if (!(await (await req.get('/api/shifts/current')).json())) await req.post('/api/shifts/open', { data: { openingCents: 0 } });
  const payAndClose = async (id: number) => {
    const due = (await (await req.get(`/api/visits/${id}`)).json()).balance.due;
    if (due > 0) expect((await req.post('/api/payments', { data: { opId: `sin-mozo-${id}`, visitId: id, method: 'efectivo', amountCents: due } })).ok()).toBeTruthy();
    expect((await req.post(`/api/visits/${id}/close`, { data: {} })).ok()).toBeTruthy();
  };
  if (t2.visit_id) await payAndClose(t2.visit_id);
  await req.post(`/api/tables/${t2.id}/clean`, { data: {} });

  // 1. El dueño abre la Mesa 2 sin mozo.
  await dueno.page.goto('/app/salon');
  await dueno.page.getByRole('button', { name: /^Mesa 2, / }).click();
  const abrir = dueno.page.getByRole('dialog', { name: /Abrir mesa 2/ });
  await expect(abrir.getByLabel('Mozo asignado (opcional)')).toHaveValue('');
  await abrir.getByRole('button', { name: 'Abrir mesa' }).click();
  await expect(dueno.page).toHaveURL(/\/app\/mesa\/\d+/);
  const mesaUrl = dueno.page.url();
  const vid = Number(mesaUrl.split('/').pop());
  await expect(dueno.page.getByText('Sin mozo asignado')).toBeVisible();
  // Abrir la mesa no habilita el QR: son dos pasos separados.
  await expect(dueno.page.getByRole('button', { name: 'Habilitar pedidos por QR' })).toBeVisible();

  // Con la mesa abierta pero el QR sin habilitar, el cliente no puede enviar; antes de abrir, el mensaje es para el personal.
  // 2. Habilita los pedidos por QR y ve el código de esta visita.
  await dueno.page.getByRole('button', { name: 'Habilitar pedidos por QR' }).click();
  const code = (await dueno.page.locator('.qr-code').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);
  await dueno.page.screenshot({ path: `${OUT}/1-dueno-mesa-sin-mozo.png` });

  // El dueño queda en su panel, conectado a los avisos en vivo, mientras el cliente pide.
  await dueno.page.goto('/app');

  // 3. El cliente ingresa el código y pide comida y bebida.
  const cctx = await browser.newContext({ ...devices['Pixel 7'] });
  const cel = await cctx.newPage();
  const celErrors = watch(cel);
  await cel.goto(`/mesa/${qr2}`);
  await expect(cel.getByText('Mesa 2 · Salón', { exact: true })).toBeVisible();
  await cel.getByRole('button', { name: /^Agregar Provoleta/ }).click();
  await cel.getByRole('button', { name: /^Agregar Gaseosa/ }).click();
  await cel.getByRole('button', { name: 'Revisar y pedir' }).click();
  const dlg = cel.getByRole('dialog', { name: 'Tu pedido' });
  await dlg.getByLabel('Código de la mesa').fill(code);
  await dlg.getByRole('button', { name: 'Enviar pedido' }).click();
  const sent = cel.getByRole('dialog', { name: 'Pedido enviado' });
  await expect(sent.getByText(/^Comanda \d+/)).toBeVisible();
  const comanda1 = (await sent.getByText(/^Comanda \d+/).innerText()).match(/\d+/)![0];

  // Cocina recibe la provoleta y barra la gaseosa, desde el primer pedido.
  const cocina = await staff(browser, 'cocina@esquina.test');
  await cocina.page.goto('/app/cocina');
  // .last(): las comandas van por hora; una visita anterior de la Mesa 2 (cerrada en otra prueba) también figura con su número.
  await expect(cocina.page.locator('article').filter({ hasText: 'Mesa 2' }).filter({ hasText: 'Provoleta' }).last()).toBeVisible();
  const barra = await staff(browser, 'barra@esquina.test');
  await barra.page.goto('/app/cocina');
  await expect(barra.page.locator('article').filter({ hasText: 'Mesa 2' }).filter({ hasText: 'Gaseosa' }).last()).toBeVisible();

  // El dueño recibe el aviso en su panel (la mesa no tiene mozo) y lo descarta con «Cerrar aviso».
  const avisoDueno = dueno.page.locator('.notice').filter({ hasText: 'Mesa 2' }).filter({ hasText: `comanda ${comanda1}` });
  await expect(avisoDueno).toBeVisible();
  await dueno.page.screenshot({ path: `${OUT}/2-dueno-aviso-panel.png` });
  await avisoDueno.getByRole('button', { name: 'Cerrar aviso' }).click();
  await expect(avisoDueno).toHaveCount(0);

  // 4. El dueño asigna a Lucas desde la mesa abierta: mismo QR, misma visita, mismos pedidos.
  await dueno.page.goto(mesaUrl);
  await dueno.page.getByRole('button', { name: 'Asignar mozo' }).click();
  await dueno.page.getByRole('dialog', { name: 'Asignar mozo' }).getByRole('button', { name: /^Lucas/ }).click();
  await expect(dueno.page.getByRole('region', { name: 'Mozo de la mesa' })).toContainText('Lucas');
  await expect(dueno.page.getByRole('button', { name: 'Cambiar mozo' })).toBeVisible();
  await expect(dueno.page.locator('.qr-code')).toHaveText(code);

  // 5. El mozo ve la mesa, su cuenta y la comanda anterior; el aviso de la segunda ronda le llega a él, no al dueño.
  const mozo = await staff(browser, 'mozo1@esquina.test');
  await mozo.page.goto('/app/salon');
  await mozo.page.getByRole('button', { name: /^Mesa 2, / }).click();
  await expect(mozo.page).toHaveURL(mesaUrl);
  await expect(mozo.page.getByText('Provoleta a la plancha').first()).toBeVisible();
  await expect(mozo.page.getByText(new RegExp(`^Ronda ${comanda1} · .*pedido desde la mesa`)).first()).toBeVisible(); // la comanda enviada antes de asignarlo
  await mozo.page.goto('/app/salon');
  await dueno.page.goto('/app');

  await cel.getByRole('button', { name: 'Seguir mirando la carta' }).click();
  await cel.getByRole('button', { name: /^Agregar Flan/ }).click();
  await cel.getByRole('button', { name: 'Revisar y pedir' }).click();
  await cel.getByRole('dialog', { name: 'Tu pedido' }).getByRole('button', { name: 'Enviar pedido' }).click();
  const sent2 = cel.getByRole('dialog', { name: 'Pedido enviado' });
  await expect(sent2.getByText(/^Comanda \d+/)).toBeVisible();
  const comanda2 = (await sent2.getByText(/^Comanda \d+/).innerText()).match(/\d+/)![0];
  await expect(mozo.page.locator('.notice').filter({ hasText: 'Mesa 2' }).filter({ hasText: `comanda ${comanda2}` })).toBeVisible();
  await mozo.page.screenshot({ path: `${OUT}/3-mozo-aviso-segunda-ronda.png` });
  await dueno.page.waitForTimeout(800);
  await expect(dueno.page.locator('.notice').filter({ hasText: `comanda ${comanda2}` })).toHaveCount(0);

  // 6. Al cerrar la mesa (cobrada), la autorización del celular queda revocada.
  await payAndClose(vid);
  const after = await cel.request.post(`/api/public/t/${qr2}/order`, { data: { opId: `post-${vid}`, items: [{ productId: (await (await req.get('/api/menu')).json()).products[0].id, qty: 1 }] } });
  expect(after.status()).toBe(403);
  await cel.goto(`/mesa/${qr2}`);
  await cel.getByRole('button', { name: /^Agregar Gaseosa/ }).click();
  await cel.getByRole('button', { name: 'Revisar y pedir' }).click();
  await expect(cel.getByRole('dialog', { name: 'Tu pedido' }).getByText('La mesa todavía no está abierta. Avisale al personal del local.')).toBeVisible();

  for (const s of [dueno, cocina, barra, mozo]) expect(s.errors).toEqual([]);
  expect(celErrors.filter((e) => !/\/api\/public\/t\/[^/]+\/order$/.test(e))).toEqual([]);
});
