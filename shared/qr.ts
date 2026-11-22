// Códigos QR dinámicos: validación de destinos y diagramación del cartel imprimible (la comparten el panel y las pruebas).

/** Hosts aceptados para el enlace de reseñas (enlace directo de Google Business o Maps). */
const GOOGLE_HOST = /^((www|search|maps)\.)?google\.(com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})$|^g\.page$|^goo\.gl$|^maps\.app\.goo\.gl$/i;

/** null si el enlace de reseñas sirve; si no, el motivo para mostrarle al dueño. */
export function reviewUrlError(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return 'No parece un enlace. Copialo completo desde Google (empieza con https://).'; }
  if (u.protocol !== 'https:') return 'El enlace de reseñas tiene que empezar con https://';
  if (u.username || u.password) return 'El enlace no puede llevar usuario ni contraseña';
  if (!GOOGLE_HOST.test(u.hostname)) return 'Tiene que ser un enlace de Google (g.page, google.com o maps.app.goo.gl)';
  if (raw.length > 500) return 'El enlace es demasiado largo';
  return null;
}

/** Destinos internos que puede elegir el dueño para el QR de una mesa (siempre llevan la mesa en el enlace). */
export const TABLE_TARGETS: Record<string, string> = { mesa: 'Carta de la mesa', reservar: 'Reservas del local' };

/** Valida el destino de un QR de mesa: null = carta de la mesa; 'reservar'; o un enlace externo http(s). */
export function tableTargetError(raw: string | null): string | null {
  if (!raw || Object.hasOwn(TABLE_TARGETS, raw)) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return 'Elegí un destino de la lista o pegá un enlace completo (https://…)'; }
  if (u.protocol !== 'https:') return 'El enlace tiene que empezar con https://';
  if (u.username || u.password) return 'El enlace no puede llevar usuario ni contraseña';
  if (raw.length > 500) return 'El enlace es demasiado largo';
  return null;
}

/** Forma canónica para guardar (sin saltos de línea, con punycode y %-codificación): sirve tal cual en el encabezado Location. */
export const normalUrl = (raw: string) => new URL(raw.trim()).href;

/** La dirección base es de prueba si apunta a esta computadora o a la red local (no sirve fuera del Wi-Fi del local). */
export function isLocalUrl(base: string): boolean {
  let h: string;
  try { h = new URL(base).hostname; } catch { return true; }
  return h === 'localhost' || h.endsWith('.local') || h === '[::1]' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h);
}

/** Cartel A6 a 300 ppp (10,5 × 14,8 cm). */
export const POSTER = { w: 1240, h: 1748 } as const;

/** Ubicación del QR en el cartel: módulos enteros de píxeles y 4 módulos de margen blanco (zona silenciosa). */
export function posterQrBox(modules: number) {
  const area = 860;
  const module = Math.floor(area / (modules + 8));
  const size = module * (modules + 8);
  return { x: Math.round((POSTER.w - size) / 2), y: 600 + Math.round((area - size) / 2), module, size, quiet: 4 };
}
