import { describe, expect, it } from 'vitest';
import { PAPERS, brandVars, contrast, inkOn, readableOn } from '../shared/color';

describe('colores de marca', () => {
  it('calcula contraste como WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
  it('elige el texto del botón con más contraste', () => {
    expect(inkOn('#1f4d3a')).toBe('#ffffff');
    expect(inkOn('#ffd60a')).toBe('#14120f');
  });
  it('ajusta colores claros para que el texto se lea sobre cualquier fondo', () => {
    for (const color of ['#ffd60a', '#7dd3fc', '#f9a8d4', '#1f4d3a', '#a8231b', '#000000', '#ffffff']) {
      for (const p of Object.values(PAPERS)) {
        expect(contrast(readableOn(color, p.bg), p.bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('las variables de la carta siempre cumplen 4,5:1 en texto y botones', () => {
    for (const color of ['#ffd60a', '#a8231b', '#2563eb', '#f5f5f4']) {
      for (const paper of ['marfil', 'blanco', 'oscuro'] as const) {
        const v = brandVars(color, paper);
        expect(contrast(v['--accent'], v['--menu-bg'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v['--brand'], v['--brand-ink'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v['--menu-ink'], v['--menu-bg'])).toBeGreaterThanOrEqual(7);
      }
    }
  });
});
