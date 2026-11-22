import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ars, can, hhmm, newOp, useLive, useLoad, useMe, useToast } from '../lib.tsx';
import { Empty, ErrorBox, Loading, Modal, Money, usePin } from '../ui.tsx';
import { Icon } from '../icons.tsx';
import { ItemDialog, Picker, type DraftItem } from './Picker.tsx';

const ST: Record<string, [string, string]> = {
  solicitud: ['Solicitud', 'st-wait'], recibido: ['Recibido', 'st-wait'], aceptado: ['Aceptado', 'st-open'], en_preparacion: ['En preparación', 'st-open'], listo: ['Listo', 'st-ok'],
  en_reparto: ['En reparto', 'st-open'], entregado: ['Entregado', 'st-free'], no_entregado: ['No entregado', 'st-bad'], rechazado: ['Rechazado', 'st-bad'], cancelado: ['Cancelado', 'st-bad'],
};
const COLS: [string, string[]][] = [['Nuevos', ['solicitud', 'recibido']], ['En cocina', ['aceptado', 'en_preparacion']], ['Listos', ['listo']], ['En reparto', ['en_reparto', 'no_entregado']]];
const DONE = ['entregado', 'rechazado', 'cancelado'];
const MODE: Record<string, string> = { retiro: 'Retiro', delivery: 'Delivery', mostrador: 'Mostrador' };

export default function Orders() {
  const { me } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const pin = usePin();
  const o = useLoad(() => api('/api/orders'));
  const riders = useLoad(() => api('/api/riders').catch(() => []));
  useLive(['orders', 'lines'], o.reload);
  const [counter, setCounter] = useState(false);
  const [only, setOnly] = useState<string | null>(null); // filtro por estado (celular)
  if (o.error) return <div className="page"><ErrorBox error={o.error} retry={o.reload} /></div>;
  if (!o.data) return <div className="page"><Loading /></div>;
  const paused = o.data.pausedUntil && new Date(o.data.pausedUntil) > new Date();
  const act = async (path: string, body: any = {}) => {
    try { await api(path, { body }); o.reload(); } catch (e: any) {
      if (e.status === 403 && /PIN|autoriz/i.test(e.message)) { const p = await pin.ask(); if (p) { try { await api(path, { body: { ...body, supervisorPin: p } }); o.reload(); } catch (x: any) { toast(x.message, true); } } }
      else toast(e.message, true);
    }
  };
  const wa = (x: any) => {
    const link = `${me!.publicUrl}${x.trackPath}`;
    const text = `Hola ${x.customer_name}, te escribimos de ${me!.restaurant.name}. Tu pedido #${x.number} está ${ST[x.status][0].toLowerCase()}${x.eta ? ` (estimado ${x.eta})` : ''}. Seguilo acá: ${link}`;
    return `https://wa.me/${x.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  };
  const orders: any[] = o.data.orders;
  const done = orders.filter((x) => DONE.includes(x.status));
  const promised = (x: any) => x.eta ? `Prometido ${x.eta}` : x.slot ? `Para las ${x.slot.slice(11, 16)}` : 'Lo antes posible';

  // Una sola acción principal por pedido: la que lo hace avanzar.
  const next = (x: any) => {
    if (['recibido', 'solicitud'].includes(x.status)) return <button className="primary" onClick={() => { const eta = prompt('Plazo confirmado para el cliente (ej. 30 min o 21:15):', x.slot?.slice(11, 16) ?? '30 min'); if (eta !== null) act(`/api/orders/${x.id}/accept`, { eta }); }}>Aceptar</button>;
    if (x.status === 'listo' && x.channel === 'delivery') return <button className="primary" onClick={() => act(`/api/orders/${x.id}/status`, { status: 'en_reparto' })}>En camino</button>;
    if (x.status === 'listo' || ['en_reparto', 'no_entregado'].includes(x.status)) return <button className="primary" onClick={() => act(`/api/orders/${x.id}/status`, { status: 'entregado' })}>Entregado</button>;
    return <span className="o-wait">En cocina</span>;
  };

  const card = (x: any) => (
    <article key={x.id} className={`order is-${x.status}`} aria-label={`Pedido ${x.number}, ${MODE[x.channel] ?? x.channel}, ${ST[x.status][0]}`}>
      <div className="o-top">
        <span className="o-num">#{x.number}</span>
        <span className={`o-mode is-${x.channel}`}><Icon name={x.channel === 'delivery' ? 'bike' : 'bag'} />{MODE[x.channel] ?? x.channel}</span>
        <span className="o-time"><Icon name="clock" />{promised(x)}</span>
        <span className={`pill ${ST[x.status][1]}`}>{ST[x.status][0]}</span>
      </div>
      <div className="o-who"><strong>{x.customer_name}</strong>{x.zone && <span className="muted"> · {x.zone}</span>}{x.rider && <span className="muted"> · Repartidor: {x.rider}</span>}</div>
      {x.channel === 'delivery' && x.address && <div className="o-addr">{x.address}{x.address_notes && ` (${x.address_notes})`}</div>}
      <ul className="o-items">{x.items.map((i: any, k: number) => <li key={k}><span className="num">{i.qty}×</span> {i.label ?? 'Plato'}{i.note && <span className="muted"> «{i.note}»</span>}</li>)}</ul>
      {x.notes && <div className="o-note">{x.notes}</div>}
      {x.reject_reason && <div className="small">Motivo: {x.reject_reason}</div>}
      {x.cash_declared_cents != null && <div className="small">Efectivo declarado por el repartidor: <Money c={x.cash_declared_cents} /></div>}
      <div className="o-foot">
        <span className="o-total"><Money c={x.total_cents} />{x.paid > 0 ? <span className={`pill ${x.paid >= x.total_cents ? 'st-ok' : 'st-wait'}`}>{x.paid >= x.total_cents ? 'Pagado' : `Pagó ${ars(x.paid)}`}</span> : <span className="pill st-free">Sin cobrar</span>}</span>
        {!DONE.includes(x.status) && next(x)}
      </div>
      <div className="o-more">
        {['recibido', 'solicitud'].includes(x.status) && <button className="small danger" onClick={() => { const r = prompt('Motivo del rechazo (lo ve el cliente):'); if (r) act(`/api/orders/${x.id}/reject`, { reason: r }); }}>Rechazar</button>}
        {x.channel === 'delivery' && !DONE.includes(x.status) && (
          <select aria-label="Asignar repartidor" className="o-rider" value={x.rider_id ?? ''} onChange={(e) => e.target.value && act(`/api/orders/${x.id}/assign`, { riderId: Number(e.target.value) })}>
            <option value="">Repartidor…</option>{(riders.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>)}
        {!['recibido', 'solicitud', 'rechazado', 'cancelado'].includes(x.status) && x.total_cents > x.paid && <button className="small" onClick={() => nav(`/app/caja?order=${x.id}`)}>Cobrar</button>}
        {x.phone && <a className="btn small ghost" href={wa(x)} target="_blank" rel="noreferrer">WhatsApp</a>}
        <a className="btn small ghost" href={x.trackPath} target="_blank" rel="noreferrer">Ver seguimiento</a>
        {['aceptado', 'no_entregado'].includes(x.status) && <button className="ghost small" onClick={() => { const r = prompt('Motivo de la cancelación:'); if (r) act(`/api/orders/${x.id}/status`, { status: 'cancelado', reason: r }); }}>Cancelar</button>}
      </div>
    </article>
  );

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>Retiro y delivery</h1>
          <div className="sub">{o.data.settings.delivery ? (paused ? <span className="pill st-wait">Delivery pausado hasta {hhmm(o.data.pausedUntil)}</span> : 'Recibiendo pedidos de retiro y delivery') : 'Recibiendo pedidos de retiro'}</div></div>
        <div className="row">
          {o.data.settings.delivery && (paused ? <button onClick={() => act('/api/restaurant/pause-delivery', { minutes: 0 })}>Reanudar delivery</button> : <button onClick={() => act('/api/restaurant/pause-delivery', { minutes: 30 })}>Pausar delivery 30 min</button>)}
          {can(me, 'cashier') && <button className="primary" onClick={() => setCounter(true)}><Icon name="plus" />Pedido de mostrador o teléfono</button>}
        </div>
      </div>
      {!orders.length ? <Empty>No hay pedidos de retiro ni delivery por ahora. Los que lleguen por la carta o cargues por teléfono aparecen acá, ordenados por estado.</Empty> : <>
        <div className="ob-filter" role="group" aria-label="Filtrar por estado">
          <button className="chip" aria-pressed={only === null} onClick={() => setOnly(null)}>Todos <span className="num">{orders.length - done.length}</span></button>
          {COLS.map(([t, sts]) => { const n = orders.filter((x) => sts.includes(x.status)).length; return <button key={t} className="chip" aria-pressed={only === t} onClick={() => setOnly(only === t ? null : t)}>{t} <span className="num">{n}</span></button>; })}
        </div>
        <div className="oboard" data-only={only || undefined}>
          {COLS.map(([title, sts]) => {
            const list = orders.filter((x) => sts.includes(x.status));
            return (
              <section key={title} className="ob-col" data-hidden={only && only !== title ? '' : undefined} aria-label={title}>
                <h2 className="ob-head">{title}<span className="num">{list.length}</span></h2>
                {!list.length ? <p className="ob-none">Sin pedidos</p> : list.map(card)}
              </section>
            );
          })}
        </div>
        {done.length > 0 && <details className="more-block ob-done">
          <summary>Finalizados en las últimas 3 horas <span className="muted">{done.length}</span></summary>
          <div className="table-wrap"><table className="ledger"><tbody>{done.map((x) => (
            <tr key={x.id}><td className="num"><strong>#{x.number}</strong></td><td>{MODE[x.channel] ?? x.channel} · {x.customer_name}{x.reject_reason && <div className="small muted">Motivo: {x.reject_reason}</div>}</td><td><span className={`pill ${ST[x.status][1]}`}>{ST[x.status][0]}</span></td><td className="right"><Money c={x.total_cents} /></td><td className="right"><a className="btn small ghost" href={x.trackPath} target="_blank" rel="noreferrer">Ver seguimiento</a></td></tr>
          ))}</tbody></table></div>
        </details>}
      </>}
      {counter && <CounterOrder onClose={() => setCounter(false)} onDone={() => { setCounter(false); o.reload(); }} />}
      {pin.el}
    </main>
  );
}

function CounterOrder({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me } = useMe();
  const toast = useToast();
  const menu = useLoad(() => api('/api/menu'));
  const zones = useLoad(() => api('/api/zones'));
  const [items, setItems] = useState<DraftItem[]>([]);
  const [picking, setPicking] = useState<any>(null);
  const [f, setF] = useState({ channel: 'mostrador', name: '', phone: '', address: '', zoneId: '', notes: '' });
  const [opId] = useState(newOp());
  const total = items.reduce((s, i) => s + i.unit * i.sel.qty, 0);
  const submit = async () => {
    try {
      const r = await api('/api/orders', { body: { opId, ...f, zoneId: f.zoneId ? Number(f.zoneId) : undefined, items: items.map((i) => i.sel) } });
      toast(`Pedido #${r.number} enviado a cocina · ${ars(r.total)}`); onDone();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title="Pedido de mostrador o teléfono" open onClose={onClose} footer={<><span className="num" style={{ marginRight: 'auto', fontWeight: 800 }}>{ars(total)}</span><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!items.length || !f.name || (f.channel === 'delivery' && (!f.address || !f.zoneId))} onClick={submit}>Confirmar y enviar a cocina</button></>}>
      {!menu.data ? <Loading /> : <div className="stack">
        <div className="row" role="group" aria-label="Canal">{[['mostrador', 'Mostrador'], ['retiro', 'Retiro (teléfono)'], ['delivery', 'Delivery (teléfono)']].map(([k, l]) => <button key={k} className="chip" aria-pressed={f.channel === k} onClick={() => setF({ ...f, channel: k })}>{l}</button>)}</div>
        <div className="field"><label htmlFor="cn">Nombre o número de retiro</label><input id="cn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        {f.channel !== 'mostrador' && <div className="field"><label htmlFor="cp">Teléfono</label><input id="cp" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>}
        {f.channel === 'delivery' && <><div className="field"><label htmlFor="ca">Domicilio</label><input id="ca" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          <div className="field"><label htmlFor="cz">Barrio</label><select id="cz" value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })}><option value="">Elegí…</option>{(zones.data ?? []).map((z: any) => <option key={z.id} value={z.id}>{z.name} · envío {ars(z.fee_cents)}</option>)}</select></div></>}
        {items.map((i) => <div key={i.key} className="spread small"><span>{i.sel.qty}× {i.label} {i.detail && <span className="muted">· {i.detail}</span>}</span><span className="row"><Money c={i.unit * i.sel.qty} /><button className="ghost" aria-label="Quitar" onClick={() => setItems(items.filter((x) => x.key !== i.key))}>✕</button></span></div>)}
        <Picker menu={menu.data} onPick={setPicking} />
        <div className="field"><label htmlFor="cno">Aclaraciones</label><input id="cno" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>}
      {menu.data && <ItemDialog product={picking} products={menu.data.products} rule={me?.restaurant.settings.pizza_rule} onClose={() => setPicking(null)} onAdd={(sel, est) => { setItems([...items, { key: newOp(), sel, label: est.label, detail: est.detail, unit: est.unit }]); setPicking(null); }} />}
    </Modal>
  );
}
