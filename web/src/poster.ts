import QRCode from 'qrcode';
import { POSTER, posterQrBox } from '../../shared/qr.ts';
import { readableOn } from '../../shared/color.ts';

export type PosterInput = { title: string; subtitle: string; url: string; foot: string; logo?: string | null; color?: string | null };

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

/** Texto centrado que se achica hasta entrar en el ancho disponible. */
function fitText(c: CanvasRenderingContext2D, text: string, y: number, weight: number, size: number, maxW: number) {
  let s = size;
  do { c.font = `${weight} ${s}px "DM Sans Variable", "DM Sans", system-ui, sans-serif`; s -= 2; } while (c.measureText(text).width > maxW && s > 20);
  c.fillText(text, POSTER.w / 2, y);
}

/**
 * Cartel imprimible (A6 a 300 ppp): logo opcional, título, subtítulo, QR grande con margen blanco y la indicación.
 * El QR se dibuja módulo por módulo en píxeles enteros (nítido al imprimir); su ubicación la fija posterQrBox.
 */
export async function drawPoster(p: PosterInput): Promise<HTMLCanvasElement> {
  await document.fonts.load('800 40px "DM Sans Variable"').catch(() => {});
  const cv = document.createElement('canvas');
  cv.width = POSTER.w; cv.height = POSTER.h;
  const c = cv.getContext('2d')!;
  const accent = readableOn(p.color || '#1f4d3a', '#ffffff');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, POSTER.w, POSTER.h);
  // Marco fino con el color de la marca (contraste ≥ 4,5:1 sobre blanco).
  c.strokeStyle = accent; c.lineWidth = 10; c.beginPath(); c.roundRect(36, 36, POSTER.w - 72, POSTER.h - 72, 36); c.stroke();

  const logo = p.logo ? await loadImage(p.logo) : null;
  if (logo) {
    const box = 190, k = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * k, h = logo.height * k;
    c.drawImage(logo, (POSTER.w - w) / 2, 96 + (box - h) / 2, w, h);
  }
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#141414';
  fitText(c, p.title, logo ? 400 : 440, 800, 96, POSTER.w - 160);
  c.fillStyle = accent;
  fitText(c, p.subtitle, logo ? 490 : 535, 700, 60, POSTER.w - 160);

  const qr = QRCode.create(p.url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const b = posterQrBox(n);
  c.fillStyle = '#ffffff'; c.fillRect(b.x, b.y, b.size, b.size);
  c.fillStyle = '#000000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.modules.get(r, col)) c.fillRect(b.x + (col + b.quiet) * b.module, b.y + (r + b.quiet) * b.module, b.module, b.module);

  c.fillStyle = '#262626';
  fitText(c, p.foot, 1590, 600, 46, POSTER.w - 180);
  return cv;
}

export async function posterBlob(p: PosterInput): Promise<Blob> {
  const cv = await drawPoster(p);
  return new Promise((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error('No se pudo generar la imagen'))), 'image/png'));
}

export async function downloadPoster(p: PosterInput, filename: string) {
  const url = URL.createObjectURL(await posterBlob(p));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
