import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, can, hhmm, mins, useLive, useLoad, useLocal, useMe, useNow, useToast } from '../lib.tsx';
import { Empty, ErrorBox, Loading, Modal, Money, Stepper } from '../ui.tsx';
import { Icon } from '../icons.tsx';

const REASON: Record<string, string> = { mozo: 'Llama al mozo', cuenta: 'Pide la cuenta', alergia: 'Aviso de alergia', pedido: 'Pidió por QR' };

export default function Floor() {
  const { me } = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const now = useNow();
  const { data, error, loading, reload } = useLoad(() => api('/api/floor'));
  useLive(['floor', 'lines', 'cash', 'reservations'], reload);
  const [view, setView] = useLocal<'plano' | 'lista'>('floor-view', 'plano');
  const [only, setOnly] = useState<string | null>(null); // filtro por estado desde la leyenda
  const [opening, setOpening] = useState<any>(null);
  const [guests, setGuests] = useState(2);
  const [busyOpen, setBusyOpen] = useState(false);
  const [waiterId, setWaiterId] = useState('');
  // Dueño o encargado: pueden abrir sin mozo asignado (los avisos de la mesa les llegan a ellos).
  const boss = can(me);
  const waiters = useLoad(() => (boss && opening ? api('/api/staff/waiters') : Promise.resolve(null)), [boss, !!opening]);
  const showMoney = can(me, 'cashier', 'all_tables');

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox error={error} retry={reload} /></div>;
  const visitOf = (t: any) => data.visits.find((v: any) => v.id === t.visit_id);
  const callsOf = (vid: number) => data.calls.filter((c: any) => c.visit_id === vid);
  const resOf = (t: any) => data.reservations.find((r: any) => r.table_id === t.id);
  const state = (t: any) => {
    const v = visitOf(t);
    if (v) return callsOf(v.id).some((c: any) => c.reason === 'cuenta') ? ['bill', 'Pide la cuenta'] : ['open', 'Abierta'];
    if (t.needs_cleaning) return ['clean', 'Para limpiar'];
    const r = resOf(t);
    if (r) return ['free', `Reservada ${hhmm(r.slot)}`];
    return ['free', 'Libre'];
  };
  const tables = data.tables.filter((t: any) => !data.onlyMine || !t.visit_id || visitOf(t));
  // La mesa que más espera: la de la comanda más antigua todavía en preparación.
  const waiting = data.visits.filter((v: any) => v.cooking_count > 0).sort((a: any, b: any) => +new Date(a.last_round_at) - +new Date(b.last_round_at))[0];

  const open = async () => {
    if (busyOpen) return; // doble toque: una sola mesa
    setBusyOpen(true);
    try {
      const v = await api('/api/visits', { body: { tableId: opening.id, guests, ...(boss && waiterId ? { waiterId: Number(waiterId) } : {}) } });
      setOpening(null);
      nav(`/app/mesa/${v.id}`);
    } catch (e: any) { toast(e.message, true); reload(); } finally { setBusyOpen(false); }
  };
  const ack = async (c: any, status: 'ack' | 'closed') => {
    try { await api(`/api/calls/${c.id}`, { body: { status } }); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const clean = async (t: any) => { try { await api(`/api/tables/${t.id}/clean`, { body: {} }); reload(); } catch (e: any) { toast(e.message, true); } };

  const counts: Record<string, number> = { free: 0, open: 0, bill: 0, clean: 0 };
  for (const t of tables) counts[state(t)[0]]++;
  const shown = only ? tables.filter((t: any) => state(t)[0] === only) : tables;
  // Sectores: el más grande primero; dentro, el orden configurado.
  const sectors = [...tables.reduce((m: Map<string, any[]>, t: any) => m.set(t.area, [...(m.get(t.area) ?? []), t]), new Map<string, any[]>())].sort((x, y) => y[1].length - x[1].length);
  const LEGEND: [string, string][] = [['open', 'Abiertas'], ['bill', 'Piden cuenta'], ['clean', 'Para limpiar'], ['free', 'Libres']];

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>Salón</h1><div className="sub">{data.onlyMine ? 'Tus mesas' : 'Todas las mesas'} · {counts.open + counts.bill} de {tables.length} ocupadas</div></div>
        <div className="row">
          {waiting && <button onClick={() => nav(`/app/mesa/${waiting.id}`)}><Icon name="clock" />Más espera: mesa {data.tables.filter((t: any) => t.visit_id === waiting.id).map((t: any) => t.number).join('+')}</button>}
          <div className="seg" role="group" aria-label="Vista">
            <button aria-pressed={view === 'plano'} onClick={() => setView('plano')}>Plano</button>
            <button aria-pressed={view === 'lista'} onClick={() => setView('lista')}>Lista</button>
          </div>
        </div>
      </div>

      {data.calls.length > 0 && (
        <section className="alerts" aria-label="Avisos de mesas" style={{ marginBottom: 16 }}>
          {data.calls.map((c: any) => (
            <div key={c.id} className="alert-row">
              <div><strong>Mesa {c.tables ?? '—'}</strong> · {REASON[c.reason]}{c.taps > 1 && ` (${c.taps} toques)`} · {hhmm(c.created_at)}{c.detail && <> · <em>{c.detail}</em></>}
                {c.status === 'ack' && <span className="pill st-ok" style={{ marginLeft: 8 }}>Atendiendo</span>}</div>
              <div className="row">
                {c.reason === 'pedido' && <button className="primary" onClick={() => { ack(c, 'closed'); nav(`/app/mesa/${c.visit_id}`); }}>Ver pedido</button>}
                {c.status === 'pending' && c.reason !== 'pedido' && <button className="primary" onClick={() => ack(c, 'ack')}>Voy</button>}
                <button onClick={() => ack(c, 'closed')}>Resuelto</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="floor-legend" role="group" aria-label="Filtrar por estado">
        {LEGEND.map(([k, l]) => <button key={k} className={`chip fl-${k}`} aria-pressed={only === k} onClick={() => setOnly(only === k ? null : k)}><span className="dot" aria-hidden />{l} <span className="num">{counts[k]}</span></button>)}
      </div>

      {!shown.length && <Empty>No hay mesas con este filtro. Las mesas se configuran en Configuración → Mesas y sectores.</Empty>}
      {view === 'plano' ? (
        <div className="floor">
          {sectors.map(([name, all]) => {
            const list = all.filter((t: any) => shown.includes(t));
            if (!list.length) return null;
            const c: Record<string, number> = { open: 0, bill: 0, clean: 0, free: 0 };
            for (const t of all) c[state(t)[0]]++;
            const busy = c.open + c.bill;
            return (
              <section key={name} className="fsec" aria-label={name}>
                <header className="fsec-head">
                  <h2>{name}</h2>
                  <p className="fsec-sum">{busy} de {all.length} {all.length === 1 ? 'ocupada' : 'ocupadas'}{c.bill > 0 && <> · <strong className="fl-bill-text">{c.bill} {c.bill === 1 ? 'pide' : 'piden'} la cuenta</strong></>}{c.clean > 0 && ` · ${c.clean} para limpiar`}</p>
                  <span className="fsec-bar" aria-hidden><span style={{ transform: `scaleX(${busy / all.length})` }} /></span>
                </header>
                <div className="ftables">
                  {list.map((t: any) => {
                    const v = visitOf(t);
                    const [cls, label] = state(t);
                    return (
                      <button key={t.id} className={`tcard ${cls}`} onClick={() => (v ? nav(`/app/mesa/${v.id}`) : t.needs_cleaning ? clean(t) : (setGuests(Math.min(t.seats, 2)), setWaiterId(''), setOpening(t)))}
                        aria-label={`Mesa ${t.number}, ${label}${v ? `, ${v.waiter ?? 'sin mozo asignado'}` : ''}${v?.ready_count ? `, ${v.ready_count} platos listos para llevar` : ''}`}>
                        <span className="tc-top"><span className="tnum">{t.number}</span><span className="tstate">{label}</span></span>
                        {v ? <>
                          <span className={`twaiter${v.waiter ? '' : ' none'}`}>{v.waiter ? v.waiter.split(' ')[0] : 'Sin mozo asignado'}</span>
                          <span className="tmeta">{v.guests} pers. · {mins(v.opened_at, now)} min{v.cooking_count > 0 ? ` · ${v.cooking_count} en cocina` : ''}</span>
                          {(showMoney || v.ready_count > 0) && <span className="tfoot">
                            {v.ready_count > 0 && <span className="tready">{v.ready_count} para llevar</span>}
                            {showMoney && <span className="tdue"><Money c={v.due} /></span>}
                          </span>}
                        </> : <span className="tmeta">{t.needs_cleaning ? 'Tocá cuando esté lista' : `${t.seats} lugares`}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>Mesa</th><th>Estado</th><th>Personas</th><th>Tiempo</th>{showMoney && <th className="right">Saldo</th>}<th><span className="visually-hidden">Acción</span></th></tr></thead>
            <tbody>
              {shown.map((t: any) => {
                const v = visitOf(t);
                const [cls, label] = state(t);
                return (
                  <tr key={t.id}>
                    <td><strong>{t.number}</strong> <span className="muted small">{t.area}</span></td>
                    <td><span className={`pill st-${cls}`}>{label}</span>{v?.ready_count > 0 && <span className="pill st-ok"> {v.ready_count} listos</span>}</td>
                    <td>{v?.guests ?? '—'}</td>
                    <td>{v ? `${mins(v.opened_at, now)} min` : '—'}</td>
                    {showMoney && <td className="right">{v ? <Money c={v.due} /> : '—'}</td>}
                    <td className="right">{v ? <button onClick={() => nav(`/app/mesa/${v.id}`)}>Abrir</button> : t.needs_cleaning ? <button onClick={() => clean(t)}>Limpia</button> : <button className="primary" onClick={() => (setGuests(Math.min(t.seats, 2)), setWaiterId(''), setOpening(t))}>Abrir mesa</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal title={`Abrir mesa ${opening?.number ?? ''}`} open={!!opening} onClose={() => setOpening(null)}
        footer={<button className="primary big block" disabled={busyOpen} onClick={open}>{busyOpen ? 'Abriendo…' : `Abrir mesa ${opening?.number ?? ''}`}</button>}>
        {opening && <p className="small muted" style={{ marginTop: 0 }}>{opening.area} · {opening.seats} lugares. Después de abrirla podés habilitar los pedidos por QR{boss ? ' y asignar mozo' : ''} desde la mesa.</p>}
        <div className="spread"><span>Personas</span><Stepper label="personas" value={guests} onChange={setGuests} min={1} max={40} /></div>
        {boss && <div className="field" style={{ marginTop: 12 }}><label htmlFor="ow">Mozo asignado (opcional)</label>
          <select id="ow" value={waiterId} onChange={(e) => setWaiterId(e.target.value)}><option value="">Sin mozo asignado</option>{(waiters.data ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <span className="hint">Podés asignarlo después desde la mesa. Mientras no tenga mozo, los avisos de la mesa te llegan a vos.</span></div>}
        {opening && resOf(opening) && <p className="small" style={{ marginTop: 12 }}>Hay una reserva a las {hhmm(resOf(opening).slot)} ({resOf(opening).name}, {resOf(opening).party} pers.). Sentala desde Reservas.</p>}
      </Modal>
    </main>
  );
}
