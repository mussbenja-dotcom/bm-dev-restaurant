import { useEffect, useState } from 'react';
import { api, useLoad, useMe, useToast, type Me } from '../lib.tsx';
import { Loading } from '../ui.tsx';
import { downloadPoster, posterBlob, type PosterInput } from '../poster.ts';
import { reviewUrlError, TABLE_TARGETS, tableTargetError } from '../../../shared/qr.ts';

const brandOf = (me: Me) => me.restaurant?.settings?.brand ?? {};
const logoOf = (me: Me) => (brandOf(me).logo ? `/uploads/${brandOf(me).logo}` : null);
const safe = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/** Cartel «Mirá nuestra carta» de una mesa: apunta a la dirección estable /q/<token>. */
export function tablePoster(me: Me, base: string, t: { number: string; area: string; qr_token: string }): PosterInput {
  return { title: 'Mirá nuestra carta', subtitle: `Mesa ${t.number} · ${t.area}`, url: `${base}/q/${t.qr_token}`, foot: 'Escaneá el QR con la cámara de tu celular', logo: logoOf(me), color: brandOf(me).color };
}
export const tablePosterFile = (t: { number: string }) => `carta-qr-mesa-${safe(t.number)}.png`;

function reviewPoster(me: Me, base: string, token: string): PosterInput {
  return { title: 'Puntuanos en Google', subtitle: me.restaurant.name, url: `${base}/q/resenas/${token}`, foot: 'Escaneá el QR y compartí tu opinión', logo: logoOf(me), color: brandOf(me).color };
}

/** Vista previa del cartel tal como se descarga. */
function PosterPreview({ input, label }: { input: PosterInput; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    let url: string | null = null, live = true;
    posterBlob(JSON.parse(key)).then((b) => { if (live) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [key]);
  return src ? <img className="poster-prev" src={src} alt={label} /> : <div className="poster-prev" aria-busy="true" />;
}

export default function QrCodes() {
  const { me, reload } = useMe();
  const d = useLoad(() => api('/api/qr'));
  const saved = () => { d.reload(); reload(); }; // el formulario de Horarios y cobros también guarda el enlace de reseñas
  if (!d.data || !me) return <Loading />;
  const base: string = d.data.publicUrl;
  return (
    <div className="stack">
      <div className="card stack">
        <p style={{ margin: 0 }}>Cada cartel impreso apunta a una dirección fija de este sistema. Si cambiás el destino acá, <strong>el mismo cartel</strong> lleva al destino nuevo: no hace falta reimprimir.</p>
        <p className="small muted" style={{ margin: 0 }}>Dirección base de los carteles: <strong>{base}</strong></p>
        {d.data.local && <p className="qr-warn" role="status">Prueba en red local: esta dirección solo funciona dentro del Wi-Fi del local. Cuando tengas la dirección pública, configurala (PUBLIC_URL) y volvé a descargar los carteles definitivos.</p>}
      </div>
      <ReviewQr me={me} base={base} data={d.data.review} onSaved={saved} />
      <section className="card stack" aria-labelledby="h-qr-mesas">
        <h2 id="h-qr-mesas" style={{ margin: 0 }}>QR de las mesas</h2>
        <div className="qr-grid">{d.data.tables.map((t: any) => <TableQr key={t.id} me={me} base={base} t={t} onSaved={d.reload} />)}</div>
      </section>
    </div>
  );
}

function ReviewQr({ me, base, data, onSaved }: { me: Me; base: string; data: { token: string; url: string | null }; onSaved: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState(data.url ?? '');
  const [busy, setBusy] = useState(false);
  const err = url.trim() ? reviewUrlError(url) : null;
  const save = async () => {
    setBusy(true);
    try { await api('/api/qr/review', { method: 'PUT', body: { url: url.trim() } }); toast('Enlace de reseñas guardado: el cartel ya lleva ahí'); onSaved(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const poster = reviewPoster(me, base, data.token);
  return (
    <section className="card qr-card" aria-labelledby="h-qr-resenas">
      <div className="stack">
        <h2 id="h-qr-resenas" style={{ margin: 0 }}>Puntuanos en Google</h2>
        <p className="small muted" style={{ margin: 0 }}>Un solo cartel para todas las mesas. Todos los clientes ven la misma invitación.</p>
        {!data.url && <p className="qr-warn bad" role="status">Falta cargar el enlace de reseñas</p>}
        <div className="field"><label htmlFor="qr-review">Enlace directo para dejar una reseña en Google</label>
          <input id="qr-review" type="url" inputMode="url" placeholder="https://g.page/r/…/review" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!err} aria-describedby="qr-review-h" />
          <span id="qr-review-h" className={err ? 'field-error' : 'hint'}>{err ?? 'En tu Perfil de Empresa de Google: «Pedir reseñas» → copiar enlace.'}</span></div>
        <p className="small" style={{ margin: 0 }}>Destino actual: <strong style={{ wordBreak: 'break-all' }}>{data.url ?? 'sin enlace (el QR abre la carta)'}</strong></p>
        <div className="row">
          <button className="primary" disabled={busy || !!err || url.trim() === (data.url ?? '')} onClick={save}>Guardar</button>
          {url.trim() && !err && <a className="btn" href={url.trim()} target="_blank" rel="noreferrer">Probar enlace</a>}
          <a className="btn" href={`${base}/q/resenas/${data.token}`} target="_blank" rel="noreferrer">Probar el QR</a>
          <button aria-label="Descargar PNG del cartel Puntuanos en Google" onClick={() => downloadPoster(poster, `resenas-qr-${safe(me.restaurant.slug ?? 'local')}.png`).catch((e) => toast(e.message, true))}>Descargar PNG</button>
        </div>
      </div>
      <PosterPreview input={poster} label="Vista previa del cartel Puntuanos en Google" />
    </section>
  );
}

function TableQr({ me, base, t, onSaved }: { me: Me; base: string; t: any; onSaved: () => void }) {
  const toast = useToast();
  const current = t.qr_target ?? 'mesa';
  const [kind, setKind] = useState(Object.hasOwn(TABLE_TARGETS, current) ? current : 'externo');
  const [ext, setExt] = useState(Object.hasOwn(TABLE_TARGETS, current) ? '' : current);
  const [busy, setBusy] = useState(false);
  const target = kind === 'externo' ? ext.trim() : kind;
  const err = kind === 'externo' ? (ext.trim() ? tableTargetError(ext.trim()) : 'Pegá el enlace (https://…)') : null;
  const save = async () => {
    setBusy(true);
    try { await api(`/api/qr/tables/${t.id}`, { method: 'PUT', body: { target } }); toast(`Destino del QR de la mesa ${t.number} guardado`); onSaved(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const id = `qr-t-${t.id}`;
  return (
    <article className="qr-row" aria-labelledby={`${id}-h`}>
      <div className="spread"><strong id={`${id}-h`}>Mesa {t.number} <span className="muted small">· {t.area}</span></strong></div>
      <p className="small" style={{ margin: 0 }}>Destino actual: <strong style={{ wordBreak: 'break-all' }}>{current === 'mesa' ? 'carta de la mesa' : current === 'reservar' ? 'reservas (con la mesa en el enlace)' : current}</strong></p>
      <div className="field"><label htmlFor={`${id}-k`}>Destino</label>
        <select id={`${id}-k`} value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(TABLE_TARGETS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          <option value="externo">Otro enlace (externo)</option>
        </select></div>
      {kind === 'externo' && <div className="field"><label htmlFor={`${id}-u`}>Enlace externo</label>
        <input id={`${id}-u`} type="url" inputMode="url" placeholder="https://…" value={ext} onChange={(e) => setExt(e.target.value)} aria-invalid={!!err && !!ext} />
        <span className={err && ext ? 'field-error' : 'hint'}>{err && ext ? err : 'Funciona como enlace de consulta: no identifica la mesa ni permite pedir.'}</span></div>}
      <div className="row">
        <button className="primary small" disabled={busy || !!err || target === current} onClick={save}>Guardar</button>
        <a className="btn small" href={`${base}/q/${t.qr_token}`} target="_blank" rel="noreferrer">Probar</a>
        <button className="small" aria-label={`Descargar PNG del cartel de la mesa ${t.number}`} onClick={() => downloadPoster(tablePoster(me, base, t), tablePosterFile(t)).catch((e) => toast(e.message, true))}>Descargar PNG</button>
      </div>
    </article>
  );
}
