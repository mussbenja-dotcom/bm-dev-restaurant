import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ars, dateAR, hhmm, newOp, useLocal, useMe, useOnline } from '../lib.tsx';
import { Modal, MoneyInput } from '../ui.tsx';
import { parseArs } from '../../../shared/money.ts';

type Delivery = { id: number; number: number; status: string; customer_name: string; phone: string; address: string; address_notes: string; zone: string; total_cents: number; to_collect: number; eta: string; notes: string };
type Change = { opId: string; orderId: number; result: 'entregado' | 'no_entregado'; cashDeclaredCents: number | null; note: string; at: string };

/**
 * Panel del repartidor sin datos móviles: se precarga con el Wi-Fi del local, se guarda en el dispositivo
 * y los resultados quedan "pendientes de sincronizar" hasta volver a tener conexión.
 */
export default function Rider() {
  const { me } = useMe();
  const online = useOnline();
  const [list, setList] = useLocal<Delivery[]>('rider-deliveries', []);
  const [queue, setQueue] = useLocal<Change[]>('rider-queue', []);
  const [savedAt, setSavedAt] = useLocal<string | null>('rider-saved-at', null);
  const [msg, setMsg] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ d: Delivery; result: Change['result'] } | null>(null);
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');

  const syncing = useRef(false);
  const again = useRef(false); // algo se registró durante una sincronización: se vuelve a correr al terminar
  const sync = async () => {
    if (syncing.current) { again.current = true; return; }
    if (!navigator.onLine) return;
    syncing.current = true;
    try {
      const pending = JSON.parse(localStorage.getItem('rider-queue') ?? '[]') as Change[];
      if (pending.length) {
        const r = await api('/api/rider/sync', { body: { changes: pending } });
        const conflicts = r.results.filter((x: any) => x.conflict);
        const done = new Set(r.results.filter((x: any) => x.ok || x.conflict).map((x: any) => x.opId));
        // Filtra sobre la cola actual: lo registrado mientras se esperaba la respuesta no se pierde.
        setQueue((q) => q.filter((c) => !done.has(c.opId)));
        const invalid = r.results.filter((x: any) => !x.ok && !x.conflict);
        if (invalid.length) { setMsg(`Revisá y volvé a registrar: ${invalid.map((c: any) => `pedido ${c.orderId}: ${c.error}`).join('; ')}`); return; }
        setMsg(conflicts.length ? `Atención: ${conflicts.map((c: any) => `pedido ${c.orderId}: ${c.error}`).join('; ')}. Avisamos al encargado.` : `Sincronizado ${done.size} cambio(s).`);
      }
      const fresh = await api<Delivery[]>('/api/rider/deliveries');
      // Solo datos necesarios; lo entregado y sincronizado se borra del dispositivo.
      setList(fresh);
      setSavedAt(new Date().toISOString());
    } catch (e: any) { setMsg(e.status === 401 ? 'Iniciá sesión con el Wi-Fi del local para precargar tus entregas.' : `No se pudo sincronizar: ${e.message}`); } finally { syncing.current = false; if (again.current) { again.current = false; setTimeout(sync, 0); } }
  };
  useEffect(() => { sync(); addEventListener('online', sync); return () => removeEventListener('online', sync); }, []); // oxlint-disable-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- solo al montar; sync lee refs

  const pendingFor = (id: number) => queue.find((c) => c.orderId === id);
  const record = () => {
    if (!closing) return;
    const c: Change = { opId: newOp(), orderId: closing.d.id, result: closing.result, cashDeclaredCents: closing.result === 'entregado' && cash && !Number.isNaN(parseArs(cash)) ? parseArs(cash) : null, note, at: new Date().toISOString() };
    setQueue((q) => [...q.filter((x) => x.orderId !== c.orderId), c]);
    setClosing(null); setCash(''); setNote('');
    if (navigator.onLine) setTimeout(sync, 50);
  };

  return (
    <main className="page stack" style={{ maxWidth: 640 }}>
      <div className="spread no-print"><h1 style={{ margin: 0 }}>Mis entregas</h1>{me && <Link to="/login">{me.user.name}</Link>}</div>
      <div className={`card no-print ${online ? '' : ''}`} role="status" style={{ borderColor: online ? 'var(--ok)' : 'var(--warn)' }}>
        <strong>{online ? 'Con conexión' : 'Sin datos: trabajando con la copia guardada'}</strong>
        <div className="small">Copia guardada: {savedAt ? dateAR(savedAt) : 'todavía no'} · {queue.length} cambio(s) pendiente(s) de sincronizar</div>
        <div className="row" style={{ marginTop: 8 }}><button onClick={sync} disabled={!online}>Sincronizar ahora</button><button onClick={() => print()}>Imprimir hoja de reparto</button></div>
        {msg && <p className="small" style={{ margin: '8px 0 0' }}>{msg}</p>}
      </div>
      {!list.length && <p className="card muted">No tenés entregas asignadas. Antes de salir, abrí esta pantalla con el Wi-Fi del local.</p>}
      {list.map((d) => {
        const p = pendingFor(d.id);
        return (
          <article key={d.id} className="card stack" style={{ padding: 12 }}>
            <div className="spread"><strong style={{ fontSize: '1.3rem' }}>#{d.number} · {d.customer_name}</strong>
              {p ? <span className="pill st-wait">{p.result === 'entregado' ? 'Entregado' : 'No entregado'} · pendiente de sincronizar</span> : <span className="pill st-open">{d.status === 'en_reparto' ? 'En camino' : 'Listo para salir'}</span>}</div>
            <div style={{ fontSize: '1.1rem' }}><strong>{d.address}</strong>{d.zone && ` · ${d.zone}`}</div>
            {d.address_notes && <div>Indicaciones: {d.address_notes}</div>}
            {d.notes && <div className="note" style={{ fontSize: '.95rem' }}>{d.notes}</div>}
            <div className="spread"><span>Cobrar: <strong className="num" style={{ fontSize: '1.2rem' }}>{ars(d.to_collect)}</strong></span>{d.phone && <a className="btn" href={`tel:${d.phone}`}>Llamar</a>}</div>
            {d.eta && <div className="small muted">Ventana prometida: {d.eta}</div>}
            {p && <div className="small">Registrado {hhmm(p.at)}{p.cashDeclaredCents != null && ` · efectivo declarado ${ars(p.cashDeclaredCents)}`}</div>}
            <div className="row no-print">
              <button className="primary big" onClick={() => { setCash((d.to_collect / 100).toString()); setClosing({ d, result: 'entregado' }); }}>Entregado</button>
              <button onClick={() => setClosing({ d, result: 'no_entregado' })}>No pude entregar</button>
            </div>
          </article>
        );
      })}
      <Modal title={closing?.result === 'entregado' ? `Entregar #${closing?.d.number}` : `No entregado #${closing?.d.number}`} open={!!closing} onClose={() => setClosing(null)} footer={<button className="primary big" onClick={record}>Guardar en el teléfono</button>}>
        <div className="stack">
          {closing?.result === 'entregado' && <MoneyInput id="cash" label="Efectivo que recibiste" value={cash} onChange={setCash} />}
          <div className="field"><label htmlFor="rn">Nota (opcional)</label><input id="rn" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <p className="small muted">Se guarda en este dispositivo con la hora. Se envía una sola vez al volver al Wi-Fi.</p>
        </div>
      </Modal>
    </main>
  );
}
