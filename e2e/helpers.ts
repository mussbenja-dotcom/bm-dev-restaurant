import { expect, type Page } from '@playwright/test';

export const PASS = 'prueba1234';

/** Junta errores de JS y respuestas fallidas (los 4xx esperables se filtran por URL). */
export function watch(page: Page, allow: RegExp[] = []) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|EventSource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() < 400 || (r.status() === 401 && u.endsWith('/api/me')) || allow.some((a) => a.test(u))) return;
    errors.push(`${r.status()} ${r.request().method()} ${u}`);
  });
  return errors;
}

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}
