import { describe, expect, it } from 'vitest';
import { ars, cashChange, contributionMargin, expectedCash, halvesPrice, parseArs, splitByAssignment, splitEqual, splitShares, spreadProportional } from '../shared/money';

describe('dinero', () => {
  it('interpreta importes como los escribe la caja', () => {
    expect(parseArs('8.000')).toBe(800_000);
    expect(parseArs('1.250.000')).toBe(125_000_000);
    expect(parseArs('8.000,50')).toBe(800_050);
    expect(parseArs('15.50')).toBe(1_550);
    expect(parseArs('8.00.0')).toBeNaN();
  });
  it('reparte envío y descuentos en proporción, al centavo exacto', () => {
    const r = spreadProportional([10_000, 20_000, 3_333], 1_001);
    expect(r.reduce((s, x) => s + x, 0)).toBe(33_333 + 1_001);
    expect(spreadProportional([5_000, 5_000], -1_001).reduce((s, x) => s + x, 0)).toBe(8_999);
    expect(spreadProportional([0, 0], 500)).toEqual([0, 0]);
  });
  it('A07: $10.000 entre tres suma exacto y el primero recibe el centavo', () => {
    const p = splitEqual(1_000_000, 3);
    expect(p).toEqual([333_334, 333_333, 333_333]);
    expect(p.reduce((a, b) => a + b)).toBe(1_000_000);
  });
  it('ítem compartido: una pizza entre tres más una bebida propia', () => {
    const r = splitByAssignment([{ id: 1, total: 1_000_000 }, { id: 2, total: 250_000 }], { 1: ['Ana', 'Beto', 'Caro'], 2: ['Beto'] });
    expect(r).toEqual({ Ana: 333_334, Beto: 583_333, Caro: 333_333 });
  });
  it('A08: vuelto de $2.000 al entregar $10.000 por $8.000', () => {
    expect(cashChange(800_000, 0, 1_000_000)).toBe(200_000);
    expect(() => cashChange(800_000, 0, 700_000)).toThrow();
  });
  it('A10: efectivo esperado $25.000', () => {
    expect(expectedCash({ opening: 2_000_000, cashPayments: 800_000, cashTips: 0, ingresos: 0, retiros: 300_000, gastos: 0 })).toBe(2_500_000);
  });
  it('mitades por mayor precio o promedio', () => {
    expect(halvesPrice(900_000, 1_100_000, 'max')).toBe(1_100_000);
    expect(halvesPrice(900_001, 1_100_000, 'avg')).toBe(1_000_001);
  });
  it('A15: margen $7.500 y estimación incompleta si falta un costo', () => {
    expect(contributionMargin(1_200_000, [400_000, 50_000])).toEqual({ margin: 750_000, complete: true });
    expect(contributionMargin(1_200_000, [400_000, null]).complete).toBe(false);
  });
  it('formato y parseo ARS', () => {
    expect(ars(333_334).replace(/\s/g, ' ')).toBe('$ 3.333,34');
    expect(parseArs('3.333,34')).toBe(333_334);
    expect(parseArs('8000')).toBe(800_000);
    expect(parseArs('abc')).toBeNaN();
  });
});

describe('splitShares (cobro dividido con el total del servidor)', () => {
  const nets = [{ id: 1, total: 100_000 }, { id: 2, total: 100_000 }];
  it('un ítem sin asignar no se le cobra a nadie', () => {
    expect(splitShares(nets, { 1: ['Ana'] }, 200_000)).toEqual([['Ana', 100_000]]);
  });
  it('con todo asignado las partes suman el total, incluido envío y descuento con tope', () => {
    const s = splitShares(nets, { 1: ['Ana'], 2: ['Beto'] }, 170_001); // descuento general y un centavo impar
    expect(s.reduce((x, [, v]) => x + v, 0)).toBe(170_001);
    expect(Math.abs(s[0][1] - s[1][1])).toBeLessThanOrEqual(1);
  });
  it('un ítem compartido reparte también lo general', () => {
    const s = splitShares(nets, { 1: ['Ana', 'Beto'], 2: ['Beto'] }, 220_000);
    expect(s).toEqual([['Ana', 55_000], ['Beto', 165_000]]);
  });
});
