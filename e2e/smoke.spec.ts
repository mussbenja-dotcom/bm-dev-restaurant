import { expect, test } from '@playwright/test';
import { login, watch } from './helpers.ts';

const PAGES: [string, string[]][] = [
  ['dueno@esquina.test', ['/app/dueno', '/app/salon', '/app/cocina', '/app/pase', '/app/caja', '/app/caja/turno', '/app/caja/historial', '/app/pedidos', '/app/reservas',
    '/app/stock?tab=insumos', '/app/stock?tab=recetas', '/app/stock?tab=compras', '/app/stock?tab=inventario', '/app/stock?tab=margenes', '/app/stock?tab=prep', '/app/stock?tab=clientes',
    '/app/config/local', '/app/config/mesas', '/app/config/qr', '/app/config/carta', '/app/config/importar', '/app/config/equipo', '/app/config/canales', '/app/config/promos', '/app/config/sucursales', '/app/config/auditoria']],
  ['mozo1@esquina.test', ['/app/salon']],
  ['cocina@esquina.test', ['/app/cocina']],
  ['reparto@esquina.test', ['/repartidor']],
  ['admin@bmdev.test', ['/superadmin', '/superadmin/historial']],
];

for (const [user, paths] of PAGES) {
  test(`pantallas sin errores: ${user}`, async ({ page }) => {
    const errors = watch(page);
    await login(page, user);
    for (const p of paths) {
      await page.goto(p);
      await expect(page.locator('main').first()).toBeVisible();
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.getByText(/Algo salió mal|Error inesperado/)).toHaveCount(0);
      expect(errors, `en ${p}`).toEqual([]);
    }
  });
}

test('públicas sin errores', async ({ page }) => {
  const errors = watch(page);
  for (const p of ['/m/esquina', '/m/fuego', '/q/mesa4-esquina-demo', '/reservar/esquina']) {
    await page.goto(p);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(errors, `en ${p}`).toEqual([]);
  }
});
