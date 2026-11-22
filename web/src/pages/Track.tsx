import { useNavigate, useParams } from 'react-router-dom';
import { api, ars, dateAR, newOp, useLoad } from '../lib.tsx';
import { ErrorBox, Loading, Money, optionsText } from '../ui.tsx';
import { useEffect, useState } from 'react';
import { ReviewCard } from './PublicMenu.tsx';

const STEPS: Record<string, string[]> = {
  retiro: ['recibido', 'aceptado', 'en_preparacion', 'listo', 'entregado'],
  mostrador: ['aceptado', 'en_preparacion', 'listo', 'entregado'],
  delivery: ['recibido', 'aceptado', 'en_preparacion', 'listo', 'en_reparto', 'entregado'],
};
const LABEL: Record<string, string> = { solicitud: 'Solicitud enviada (el local la tiene que aceptar)', recibido: 'Recibido', aceptado: 'Aceptado', en_preparacion: 'En preparación', listo: 'Listo', en_reparto: 'En reparto', entregado: 'Entregado', no_entregado: 'No se pudo entregar', rechazado: 'Rechazado', cancelado: 'Cancelado' };

/** Enlace privado del pedido: último estado confirmado por el local, hora de actualización y estimado. */
export default function Track() {
  const { token } = useParams();
  const nav = useNavigate();
  const o = useLoad(() => api(`/api/public/orders/${token}`), [token]);
  const [optedOut, setOptedOut] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  useEffect(() => { const i = setInterval(o.reload, 15_000); return () => clearInterval(i); }, [o.reload]);
  if (o.error) return <main className="page"><ErrorBox error={o.error === 'No encontrado' ? 'Este enlace de pedido no existe o venció.' : o.error} retry={o.reload} /></main>;
  if (!o.data) return <main className="page"><Loading /></main>;
  const x = o.data;
  const steps = STEPS[x.channel] ?? STEPS.retiro;
  const idx = steps.indexOf(x.status);
  const repeat = () => {
    // Se rearma el carrito; precios y disponibilidad se revalidan al confirmar.
    localStorage.setItem(`cart-${x.slug}`, JSON.stringify(x.items.map((i: any) => ({ key: newOp(), sel: { productId: i.productId, qty: i.qty, optionIds: i.optionIds, note: i.note, halves: i.halves, halfExtras: i.halfExtras, dozen: i.dozen }, label: i.label ?? 'Plato', detail: '', unit: Math.round((i.total ?? 0) / (i.qty || 1)) }))));
    nav(`/m/${x.slug}`);
  };
  return (
    <main className="page narrow stack">
      <h1>Pedido #{x.number}</h1>
      <p className="muted" style={{ margin: 0 }}>{x.restaurant} · {x.channel === 'delivery' ? 'Delivery' : 'Retiro'}{x.slot && ` · franja ${x.slot.slice(11)}`}</p>
      <div className="card stack" role="status" aria-live="polite">
        <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{LABEL[x.status]}</div>
        {x.eta && <div>Estimado confirmado por el local: <strong>{x.eta}</strong></div>}
        {x.reject_reason && <div>Motivo: {x.reject_reason}</div>}
        <div className="small muted">Actualizado {dateAR(x.updated_at)}. Esta página muestra el último estado confirmado por el local.</div>
        {idx >= 0 && <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          {steps.map((s, i) => <li key={s} className="row"><span className={`pill ${i < idx ? 'st-ok' : i === idx ? 'st-open' : 'st-free'}`}>{i < idx ? '✓' : i === idx ? '●' : '○'} {LABEL[s]}</span></li>)}
        </ol>}
      </div>
      <div className="card">
        {(x.lines.length ? x.lines.map((l: any) => ({ name: l.name, qty: l.qty, total: l.unit_price_cents * l.qty, options: l.options })) : x.items.map((i: any) => ({ name: i.label, qty: i.qty, total: i.total, options: [] }))).map((l: any, i: number) => (
          <div key={i} className="spread"><span>{l.qty}× {l.name}<div className="small muted">{optionsText(l.options)}</div></span><Money c={l.total ?? 0} /></div>
        ))}
        <div className="totals" style={{ marginTop: 8 }}>{x.fee_cents > 0 && <><span>Envío</span><Money c={x.fee_cents} /></>}<strong>Total</strong><strong><Money c={x.total_cents} /></strong></div>
      </div>
      <div className="row">
        {x.whatsapp && <a className="btn" href={`https://wa.me/${String(x.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, consulto por mi pedido #${x.number} (${location.href})`)}`} target="_blank" rel="noreferrer">Consultar por WhatsApp</a>}
        <button onClick={repeat}>Repetir este pedido</button>
      </div>
      {x.loyalty_opt_in && (optedOut === 'done' ? <p className="small" role="status">Listo: el local ya no te va a contar beneficios ni promociones.</p> : (
        <p className="small muted">Sumás beneficios en este local. <button className="ghost small" disabled={optedOut === 'busy'} onClick={async () => {
          setOptedOut('busy');
          try { await api(`/api/public/orders/${token}/loyalty-optout`, { body: {} }); setOptedOut('done'); } catch { setOptedOut('error'); }
        }}>No quiero recibir beneficios</button>{optedOut === 'error' && <span role="alert"> No se pudo guardar; probá de nuevo.</span>}</p>
      ))}
      {x.status === 'entregado' && <ReviewCard slug={x.slug} url={x.review_url} />}
      <p className="small muted">Total en pesos: {ars(x.total_cents)}. El pago se registra en el local.</p>
    </main>
  );
}
