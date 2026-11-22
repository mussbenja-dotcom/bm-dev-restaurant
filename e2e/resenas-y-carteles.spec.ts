import { expect, test, devices, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { login, watch } from './helpers.ts';

/**
 * Carteles QR dinámicos: se descargan desde el panel, se lee el QR del PNG y se sigue su destino.
 * Corre después de qr.spec.ts (la mesa 2 puede quedar abierta por esa prueba; acá se reutiliza).
 */
const OUT = 'docs/visual/carteles';
mkdirSync(OUT, { recursive: true });

/**
 * Lee el QR del cartel sin decodificador externo: ubica el código, mide el módulo con el patrón de esquina
 * (7 módulos), muestrea el centro de cada módulo y exige el margen blanco de 4 módulos. Devuelve la grilla.
 */
async function readQrGrid(file: string) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height], 'resolución de impresión (A6 a 300 ppp)').toEqual([1240, 1748]);
  const dark = (x: number, y: number) => data[y * info.width + x] < 128;
  // El QR es el bloque oscuro grande en la franja central (debajo de los títulos, arriba de la indicación).
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 560; y < 1520; y++) for (let x = 80; x < info.width - 80; x++) if (dark(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  let run = 0;
  while (dark(x0 + run, y0)) run++;
  const mod = run / 7;
  const n = Math.round((x1 - x0 + 1) / mod);
  expect(Math.abs(x1 - x0 - (y1 - y0)), 'el código es cuadrado').toBeLessThanOrEqual(1);
  const grid: boolean[][] = [];
  for (let r = 0; r < n; r++) { grid.push([]); for (let c = 0; c < n; c++) grid[r].push(dark(Math.floor(x0 + (c + 0.5) * mod), Math.floor(y0 + (r + 0.5) * mod))); }
  // Zona silenciosa: 4 módulos blancos alrededor.
  const q = Math.floor(4 * mod);
  for (let y = y0 - q; y <= y1 + q; y++) for (let x = x0 - q; x <= x1 + q; x++) if ((x < x0 || x > x1 || y < y0 || y > y1) && dark(x, y)) throw new Error(`margen blanco incompleto en ${x},${y}`);
  return { grid, n, module: mod };
}

/** El PNG codifica exactamente esta dirección: la grilla leída coincide módulo por módulo con la del texto esperado. */
async function expectQrEncodes(file: string, url: string) {
  const { grid, n, module } = await readQrGrid(file);
  const want = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
  expect(n, `tamaño del QR para ${url}`).toBe(want.size);
  expect(module, 'módulo grande (≥ 0,7 mm a 300 ppp)').toBeGreaterThanOrEqual(8);
  let diff = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (grid[r][c] !== !!want.get(r, c)) diff++;
  expect(diff, `módulos distintos de ${url}`).toBe(0);
}

async function download(page: Page, name: RegExp | string, file: string) {
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  const d = await wait;
  await d.saveAs(`${OUT}/${file}`);
  return { path: `${OUT}/${file}`, suggested: d.suggestedFilename() };
}

/** Sigue la dirección impresa en el servidor de prueba (mismo camino /q/…, sin la IP de la red). */
async function follow(page: Page, printed: string, base: string) {
  const r = await page.request.get(printed.replace(base, ''), { maxRedirects: 0 });
  expect(r.status()).toBe(302);
  expect(r.headers()['cache-control']).toBe('no-store');
  return r.headers().location;
}

async function staff(browser: Browser, email: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = watch(page, [/\/api\/visits\/\d+\/qr$/]);
  await login(page, email);
  return { page, errors };
}

test('carteles QR: mesa 2 y «Puntuanos en Google», lectura del PNG, cambio de enlace y pedido con código', async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await staff(browser, 'dueno@esquina.test');
  const qr = await (await owner.page.request.get('/api/qr')).json();
  const base: string = qr.publicUrl;
  const mesa2 = qr.tables.find((t: any) => t.number === '2');

  // 1 · Configuración → Mesas: «Descargar PNG» baja el cartel completo de la mesa 2.
  await owner.page.goto('/app/config/mesas');
  const carta = await download(owner.page, 'Descargar PNG del cartel de la mesa 2', 'carta-qr-mesa-2.png');
  expect(carta.suggested).toBe('carta-qr-mesa-2.png');
  const cartaUrl = `${base}/q/${mesa2.qr_token}`;
  await expectQrEncodes(carta.path, cartaUrl);
  expect(await follow(owner.page, cartaUrl, base)).toBe(`/mesa/${mesa2.qr_token}`);

  // 2 · Configuración → Códigos QR: cartel de reseñas, el destino actual y la marca de red local.
  await owner.page.goto('/app/config/qr');
  await expect(owner.page.getByText('Prueba en red local: esta dirección solo funciona')).toBeVisible(); // la base de prueba es la IP del Wi-Fi
  await expect(owner.page.getByRole('img', { name: 'Vista previa del cartel Puntuanos en Google' })).toBeVisible();
  await owner.page.screenshot({ path: `${OUT}/panel-codigos-qr.png`, fullPage: true });
  const resenas = await download(owner.page, 'Descargar PNG del cartel Puntuanos en Google', 'resenas-qr.png');
  expect(resenas.suggested).toBe('resenas-qr-esquina.png');
  const resenasUrl = `${base}/q/resenas/${qr.review.token}`;
  await expectQrEncodes(resenas.path, resenasUrl);
  expect(await follow(owner.page, resenasUrl, base)).toBe('https://g.page/r/ejemplo-ficticio/review');

  // 3 · Cambiar el enlace desde el panel: el MISMO PNG lleva al enlace nuevo.
  const field = owner.page.getByLabel('Enlace directo para dejar una reseña en Google');
  await field.fill('https://evil.example/resena');
  await expect(owner.page.getByText('Tiene que ser un enlace de Google')).toBeVisible();
  await expect(owner.page.getByRole('button', { name: 'Guardar' }).first()).toBeDisabled();
  await field.fill('https://g.page/r/esquina-boedo-nuevo/review');
  await owner.page.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(owner.page.getByText('Destino actual: https://g.page/r/esquina-boedo-nuevo/review')).toBeVisible();
  await expectQrEncodes(resenas.path, resenasUrl); // archivo sin cambios
  expect(await follow(owner.page, resenasUrl, base)).toBe('https://g.page/r/esquina-boedo-nuevo/review');

  // 4 · El QR de la mesa 2 sigue identificando la mesa: el cliente pide con el código del mozo y entra en su cuenta.
  const mozo = await staff(browser, 'mozo1@esquina.test');
  await mozo.page.goto('/app/salon');
  await mozo.page.getByRole('button', { name: /^Mesa 2, / }).click();
  const abrir = mozo.page.getByRole('dialog').getByRole('button', { name: 'Abrir mesa' });
  if (await abrir.waitFor({ timeout: 2000 }).then(() => true, () => false)) await abrir.click();
  await expect(mozo.page).toHaveURL(/\/app\/mesa\/\d+/);
  const mesaUrl = mozo.page.url();
  const habilitar = mozo.page.getByRole('button', { name: 'Habilitar pedidos por QR', exact: true });
  if (await habilitar.waitFor({ timeout: 2000 }).then(() => true, () => false)) await habilitar.click();
  const code = (await mozo.page.locator('.qr-code').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);

  const cel = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  const celErrors = watch(cel);
  await cel.goto(cartaUrl.replace(base, '')); // lo mismo que hace la cámara con el cartel impreso
  await expect(cel).toHaveURL(new RegExp(`/mesa/${mesa2.qr_token}$`));
  await expect(cel.getByText('Mesa 2 · Salón', { exact: true })).toBeVisible();
  await cel.getByRole('button', { name: /^Agregar Gaseosa/ }).click();
  await cel.getByRole('button', { name: 'Revisar y pedir' }).click();
  const dlg = cel.getByRole('dialog', { name: 'Tu pedido' });
  await dlg.getByLabel('Código de la mesa').fill(code);
  await dlg.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(cel.getByRole('dialog', { name: 'Pedido enviado' }).getByText(/^Comanda \d+/)).toBeVisible();

  await mozo.page.goto('/app/salon');
  await expect(mozo.page.locator('.alert-row').filter({ hasText: 'Pidió por QR' }).filter({ hasText: 'Mesa 2' })).toBeVisible();
  await mozo.page.goto(mesaUrl);
  await expect(mozo.page.getByText(/Gaseosa/).first()).toBeVisible();

  expect(owner.errors).toEqual([]);
  expect(mozo.errors).toEqual([]);
  expect(celErrors).toEqual([]);
});
