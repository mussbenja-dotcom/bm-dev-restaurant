// Colores de marca con contraste garantizado (WCAG 2.2: 4,5:1 para texto normal).

export const PAPERS = {
  marfil: { bg: '#f7f2e7', ink: '#1e1b16', line: '#ddd3bf' },
  blanco: { bg: '#ffffff', ink: '#1a1a1a', line: '#e2e0dc' },
  oscuro: { bg: '#17140f', ink: '#f4efe4', line: '#3a342a' },
} as const;
export type Paper = keyof typeof PAPERS;
export const STYLES = ['clasica', 'moderna'] as const;
export type MenuStyle = (typeof STYLES)[number];

export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const mix = (a: string, b: string, t: number) => { const [p, q] = [rgb(a), rgb(b)]; return toHex(p.map((v, i) => v + (q[i] - v) * t)); };

/** Texto sobre un botón del color de marca: blanco o casi negro, el que más contraste tenga. */
export const inkOn = (bg: string) => (contrast(bg, '#ffffff') >= contrast(bg, '#14120f') ? '#ffffff' : '#14120f');

/** El color de marca más parecido al elegido que se lee sobre el fondo (oscurece o aclara de a poco). */
export function readableOn(color: string, bg: string, min = 4.5) {
  const toward = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0; t <= 1; t += 0.05) { const c = mix(color, toward, t); if (contrast(c, bg) >= min) return c; }
  return toward;
}

/** Variables CSS de la carta para un color y un fondo. El botón también cumple 4,5:1 con su texto. */
export function brandVars(color: string, paper: Paper) {
  const p = PAPERS[paper] ?? PAPERS.marfil;
  const c = isHex(color) ? color : '#1f4d3a';
  const accent = readableOn(c, p.bg);
  const btn = contrast(c, inkOn(c)) >= 4.5 ? c : accent;
  return { '--menu-bg': p.bg, '--menu-ink': p.ink, '--menu-line': p.line, '--accent': accent, '--brand': btn, '--brand-ink': inkOn(btn), '--menu-soft': mix(p.bg, c, 0.08) };
}
