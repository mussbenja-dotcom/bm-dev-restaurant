// Dinero siempre en centavos enteros. Compartido por servidor y cliente.

const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
export const ars = (cents: number) => fmt.format(cents / 100);

/** "3.333,34" | "8.000" | "3333.34" | "3333" -> centavos. Un punto seguido de 3 dígitos agrupa miles; de 1 o 2, es decimal. NaN si no es válido. */
export function parseArs(s: string): number {
  const t = s.replace(/[$\s]/g, '');
  if (!t) return NaN;
  const norm = t.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return NaN;
  return Math.round(Number(norm) * 100);
}

/** Partes iguales; los primeros reciben el centavo remanente: 10.000/3 -> 3.333,34 + 3.333,33 + 3.333,33. */
export function splitEqual(total: number, parts: number): number[] {
  if (!Number.isInteger(total) || parts < 1) throw new Error('división inválida');
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Reparto por ítem: cada línea se asigna a una o varias personas (ítem compartido). */
export function splitByAssignment(lines: { id: number; total: number }[], assign: Record<number, string[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    const who = assign[l.id];
    if (!who?.length) continue;
    splitEqual(l.total, who.length).forEach((c, i) => (out[who[i]] = (out[who[i]] ?? 0) + c));
  }
  return out;
}

/** Reparte un ajuste (envío, descuento general) en proporción a cada parte, al centavo (los restos van a las partes con mayor fracción). */
export function spreadProportional(parts: number[], extra: number): number[] {
  const base = parts.reduce((s, p) => s + p, 0);
  if (!base || !extra) return parts.slice();
  const raw = parts.map((p) => (extra * p) / base);
  const out = raw.map(Math.trunc);
  let rest = extra - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [Math.abs(r - out[i]), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest !== 0; k = (k + 1) % order.length) { const step = Math.sign(rest); out[order[k][1]] += step; rest -= step; }
  return parts.map((p, i) => p + out[i]);
}

/** Vuelto de un pago en efectivo. El cajón aumenta en importe + propina, no en lo entregado. */
export function cashChange(amount: number, tip: number, tendered: number): number {
  const change = tendered - amount - tip;
  if (change < 0) throw new Error('El efectivo recibido no cubre el importe y la propina');
  return change;
}

export type ShiftTotals = {
  opening: number;
  cashPayments: number; // importes aplicados en efectivo (neto de devoluciones en efectivo)
  cashTips: number;
  ingresos: number;
  retiros: number;
  gastos: number;
};
export const expectedCash = (t: ShiftTotals) => t.opening + t.cashPayments + t.cashTips + t.ingresos - t.retiros - t.gastos;

/** Precio de pizza por mitades según la regla del local. */
export const halvesPrice = (a: number, b: number, rule: 'max' | 'avg') => (rule === 'max' ? Math.max(a, b) : Math.round((a + b) / 2));

/** Margen de contribución estimado: venta neta − costos variables cargados. */
export const contributionMargin = (net: number, costs: (number | null)[]) => ({
  margin: net - costs.reduce<number>((s, c) => s + (c ?? 0), 0),
  complete: costs.every((c) => c !== null),
});

/**
 * Cobro dividido por persona o por ítem: cada parte paga el neto de sus líneas más lo general (envío y descuentos,
 * con el tope ya aplicado en `total`) en proporción. Lo general se calcula sobre todas las líneas, así una línea sin
 * asignar no se carga a nadie: la suma de las partes no llega al total hasta asignarla.
 */
export function splitShares(nets: { id: number; total: number }[], assign: Record<number, string[]>, total: number): [string, number][] {
  const r = Object.entries(splitByAssignment(nets, assign));
  const all = nets.reduce((s, x) => s + x.total, 0);
  const mine = r.reduce((s, [, v]) => s + v, 0);
  const general = all ? Math.round(((total - all) * mine) / all) : 0;
  const amounts = spreadProportional(r.map(([, v]) => v), general);
  return r.map(([label], i) => [label, amounts[i]]);
}
