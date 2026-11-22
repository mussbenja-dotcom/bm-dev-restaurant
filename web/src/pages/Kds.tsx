import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, can, hhmm, mins, useLive, useLoad, useLocal, useMe, useNow, useToast } from '../lib.tsx';
import { Empty, ErrorBox, Loading, Modal, optionsText } from '../ui.tsx';
import { Icon } from '../icons.tsx';

type Group = { key: string; where: string; sub: string; created: string; lines: any[]; delay: number; station: string; stationId: number; kind: string; order: boolean };

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 880; o.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.18);
  } catch { /* sin audio */ }
}

const CHANNEL: Record<string, string> = { retiro: 'Retiro', delivery: 'Delivery', mostrador: 'Mostrador' };

/** Espera de la comanda en tres estados, siempre con texto: en término, casi demorada (70 %) y demorada. */
function Timer({ wait, delay }: { wait: number; delay: number }) {
  const late = wait >= delay;
  const warn = !late && wait >= delay * 0.7;
  return <span className={`timer ${late ? 'late' : warn ? 'warn' : ''}`}><span className="tmin">{wait}</span> min{late ? <span className="tlbl">Demorada</span> : warn ? <span className="tlbl">Casi demorada</span> : null}</span>;
}

export default function Kds({ mode }: { mode: 'station' | 'pass' }) {
  const { me } = useMe();
  const toast = useToast();
  const now = useNow(10_000);
  const stations = useLoad(() => api('/api/stations'));
  const [station, setStation] = useLocal<number | 0>('kds-station', 0);
  const { data, error, loading, reload } = useLoad(() => api(`/api/kds?view=${mode}${station ? `&station=${station}` : ''}`), [station, mode]);
  useLive(['lines'], reload);
  const [peak, setPeak] = useLocal('kds-peak', false);
  const [light, setLight] = useLocal('kds-light', false); // oscuro por defecto: no encandila y se lee a distancia
  const [sound, setSound] = useLocal('kds-sound', false);
  const [soldout, setSoldout] = useState(false);
  const seen = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!data) return;
    const ids = new Set<number>(data.lines.map((l: any) => l.id));
    if (seen.current && sound && [...ids].some((i) => !seen.current!.has(i))) beep();
    seen.current = ids;
  }, [data, sound]);

  if (error) return <div className="page"><ErrorBox error={error} retry={reload} /></div>;
  if (loading && !data) return <div className="page"><Loading /></div>;
  const mine = (me?.roles.includes('kitchen') ? ['kitchen'] : []).concat(me?.roles.includes('bar') ? ['bar'] : []);
  const visibleStations = (stations.data ?? []).filter((s: any) => (mode === 'station' && mine.length ? mine.includes(s.kind) : can(me, 'pass') || mine.includes(s.kind)));

  const lines = data.lines.filter((l: any) => mode === 'pass' || l.status !== 'ready' || !l.change_ack);
  // Estación: una comanda por ronda y estación (cada sector ve solo lo suyo). Pase: una tarjeta por mesa o pedido.
  const groups: Group[] = [];
  for (const l of lines) {
    const key = mode === 'pass' ? (l.visit_id ? `v${l.visit_id}` : `o${l.order_id}`) : `r${l.round_id}-s${l.station_id}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = {
        key, where: l.visit_id ? `Mesa ${l.tables ?? '?'}` : `#${l.order_number}`, order: !l.visit_id,
        sub: l.visit_id ? `${l.visit_status === 'closed' ? 'Mesa ya cerrada · ' : ''}Ronda ${l.round_number} · ${l.source === 'diner' ? 'pedido desde la mesa' : l.by_name ?? ''}` : `${CHANNEL[l.channel] ?? l.channel} · ${l.customer_name}`,
        created: l.created_at, lines: [], delay: l.delay_minutes, station: l.station, stationId: l.station_id, kind: l.station_kind,
      };
      groups.push(g);
    }
    g.lines.push(l);
    if (l.created_at < g.created) g.created = l.created_at;
  }
  groups.sort((a, b) => a.created.localeCompare(b.created));
  const late = groups.filter((g) => mins(g.created, now) >= g.delay).length;

  const act = async (l: any, action: string, qty?: number) => {
    try { await api(`/api/lines/${l.id}/${action}`, { body: qty ? { qty } : {} }); reload(); } catch (e: any) { toast(e.message, true); reload(); }
  };
  // Hora sugerida para marchar un principal en espera: cuando terminan las entradas de esa mesa.
  const fireAt = (l: any, g: Group) => {
    const others = g.lines.filter((x) => !x.held && x.course !== 'bebida');
    const longest = Math.max(0, ...others.map((x) => x.prep_minutes ?? 0));
    return hhmm(new Date(new Date(l.created_at).getTime() + Math.max(0, longest - (l.prep_minutes ?? 0)) * 60_000));
  };

  // Carriles por estación (cocina primero): cada sector se distingue de un vistazo aunque se vean todos juntos.
  const lanes = [...new Set(groups.map((g) => g.stationId))].map((id) => { const list = groups.filter((g) => g.stationId === id); return { id, name: list[0].station, kind: list[0].kind, list }; })
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'kitchen' ? -1 : 1));

  const tools = (
    <div className="kds-tools">
      {mode === 'station' && visibleStations.length > 1 && <div className="seg" role="group" aria-label="Estación">
        <button aria-pressed={station === 0} onClick={() => setStation(0)}>Todas</button>
        {visibleStations.map((s: any) => <button key={s.id} aria-pressed={station === s.id} onClick={() => setStation(s.id)}>{s.name}</button>)}
      </div>}
      <div className="seg" role="group" aria-label="Pantalla">
        <button aria-pressed={peak} onClick={() => setPeak(!peak)}>Letra grande</button>
        <button aria-pressed={light} onClick={() => setLight(!light)}>Fondo claro</button>
        <button aria-pressed={sound} onClick={() => { setSound(!sound); if (!sound) beep(); }}>Sonido</button>
      </div>
      {mode === 'station' && <button onClick={() => setSoldout(true)}>Agotados</button>}
    </div>
  );

  return (
    <main className={`kds-page ${peak ? 'peak' : ''}`} data-contrast={light ? undefined : 'high'}>
      <div className="kds-wrap">
        <header className="kds-bar">
          <div className="kds-title">
            <h1>{mode === 'pass' ? 'Pase' : 'Cocina y barra'}</h1>
            <p className="kds-count" aria-live="polite">
              {mode === 'pass' ? `${groups.length} ${groups.length === 1 ? 'mesa o pedido' : 'mesas y pedidos'} en curso` : `${groups.length} ${groups.length === 1 ? 'comanda' : 'comandas'}`}
              {late > 0 && <strong className="kds-late"> · {late} {late === 1 ? 'demorada' : 'demoradas'}</strong>}
            </p>
          </div>
          {tools}
        </header>

        {!groups.length && <Empty>{mode === 'pass' ? 'No hay platos en preparación ni para llevar. Las mesas aparecen acá apenas la cocina recibe la comanda.' : 'No hay comandas pendientes. Las nuevas aparecen solas.'}</Empty>}
        {mode === 'pass' ? <PassBoard groups={groups} now={now} act={act} fireAt={fireAt} /> : (
          <div className={`kds-lanes${lanes.length > 1 ? ' multi' : ''}`}>
            {lanes.map((lane) => (
              <section key={lane.id} className={`kds-lane is-${lane.kind}`} aria-label={lane.name}>
                <h2 className="lane-head">{lane.name}<span className="num">{lane.list.length}</span></h2>
                <div className="kds">
                  {lane.list.map((g) => {
                    const wait = mins(g.created, now);
                    const isNew = now - new Date(g.created).getTime() < 60_000;
                    return (
                      <article key={g.key} className={`ticket${wait >= g.delay ? ' late' : wait >= g.delay * 0.7 ? ' warn' : ''}${isNew ? ' is-new' : ''}`} aria-label={`${g.where}, ${g.station}, espera ${wait} minutos`}>
                        <header className="ticket-head">
                          <div className="where">{g.where}</div>
                          <Timer wait={wait} delay={g.delay} />
                          <div className="sub">{g.sub}</div>
                        </header>
                        {g.lines.map((l) => {
                          const opts = optionsText(l.options);
                          return (
                            <div key={l.id} className={`kline is-${l.held && l.status === 'pending' ? 'held' : l.status}`}>
                              {!l.change_ack && <div className="change" role="alert"><span>{l.change_note}</span><button className="small" onClick={() => act(l, 'ack')}>Entendido</button></div>}
                              <div className="kmain">
                                <span className="qty">{l.qty}</span>
                                <div>
                                  <div className="kname" style={l.status === 'void' ? { textDecoration: 'line-through' } : undefined}>{l.name}</div>
                                  {opts && <div className="kopts">{opts}</div>}
                                  {l.seat && <div className="kseat">{l.seat}</div>}
                                </div>
                              </div>
                              {l.note && <div className="note"><Icon name="alert" />{l.note}</div>}
                              {l.held && l.status === 'pending' ? <div className="kstate">En espera · marchar ~{fireAt(l, g)}</div>
                                : l.status === 'void' ? null
                                : <div className="kacts">
                                  {l.status === 'preparing' && <span className="kstate">En preparación{l.qty_ready ? ` · ${l.qty_ready} de ${l.qty} listos` : ''}</span>}
                                  {l.status === 'pending' && <button onClick={() => act(l, 'start')}>Empezar</button>}
                                  {l.qty - l.qty_ready > 1 && <button onClick={() => act(l, 'ready', 1)}>1 listo</button>}
                                  {l.status !== 'ready' && <button className="primary" onClick={() => act(l, 'ready')}>Listo{l.qty_ready ? ` (${l.qty - l.qty_ready})` : ''}</button>}
                                </div>}
                            </div>
                          );
                        })}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      {soldout && <SoldOut onClose={() => setSoldout(false)} kinds={can(me, 'pass') ? ['kitchen', 'bar'] : mine} stations={stations.data ?? []} />}
    </main>
  );
}

/** Pase: cada tarjeta es una mesa completa. Arriba, cuánto está listo; después, qué puede llevar el mozo y qué falta. */
function PassBoard({ groups, now, act, fireAt }: { groups: Group[]; now: number; act: (l: any, a: string) => Promise<void>; fireAt: (l: any, g: Group) => string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = [...groups].sort((a, b) => Number(b.lines.some((l) => l.status === 'ready')) - Number(a.lines.some((l) => l.status === 'ready')) || a.created.localeCompare(b.created));
  const takeAll = async (g: Group, ready: any[]) => {
    if (busy) return;
    setBusy(g.key);
    try { for (const l of ready) await act(l, 'deliver'); } finally { setBusy(null); }
  };
  return (
    <div className="pass">
      {sorted.map((g) => {
        const wait = mins(g.created, now);
        const live = g.lines.filter((l) => l.status !== 'void');
        const voided = g.lines.filter((l) => l.status === 'void' && !l.change_ack);
        if (!live.length && !voided.length) return null;
        const ready = live.filter((l) => l.status === 'ready');
        const missing = live.filter((l) => l.status !== 'ready');
        const all = live.length > 0 && !missing.length;
        return (
          <article key={g.key} className={`pass-card${all ? ' is-complete' : ready.length ? ' has-ready' : ''}${wait >= g.delay ? ' late' : ''}`} aria-label={`${g.where} · ${ready.length} de ${live.length} listos`}>
            <header className="pass-head">
              <div>
                <h2 className="where">{g.where}</h2>
                <div className="sub">{g.sub}</div>
              </div>
              <Timer wait={wait} delay={g.delay} />
              <div className="pass-count"><strong>{ready.length} de {live.length}</strong> {live.length === 1 ? 'listo' : 'listos'}{all && <span className="pill st-ok">{g.order ? 'Pedido completo' : 'Mesa completa'}</span>}</div>
              <div className="pass-meter" aria-hidden>{live.map((l) => <span key={l.id} className={l.status === 'ready' ? 'on' : l.status === 'preparing' ? 'mid' : ''} />)}</div>
            </header>
            {ready.length > 0 && (
              <section className="pass-sec is-ready" aria-label="Para llevar">
                <div className="pass-sec-head"><h3>Para llevar</h3>
                  {!g.order && ready.length > 1 && <button className="primary" disabled={busy === g.key} onClick={() => takeAll(g, ready)}>Retirar todo ({ready.length})</button>}
                </div>
                {ready.map((l) => (
                  <div key={l.id} className="pline is-ready">
                    <span className="qty">{l.qty_ready - l.qty_delivered}</span>
                    <span className="pname">{l.name}{optionsText(l.options) && <span className="popts"> · {optionsText(l.options)}</span>}{l.note && <span className="pnote"> · {l.note}</span>}<span className="pwhere">{l.station}{l.seat ? ` · ${l.seat}` : ''}</span></span>
                    {l.visit_id ? <button className={ready.length === 1 ? 'primary' : ''} aria-label={`Marcar retirado: ${l.name}`} disabled={busy === g.key} onClick={() => act(l, 'deliver')}>Retirado</button> : <span className="pill st-ok">Listo para retirar</span>}
                    {!l.change_ack && l.change_note && <ChangeNote l={l} act={act} />}
                  </div>
                ))}
                {g.order && <Link className="pass-link" to="/app/pedidos">Entregar o despachar en Retiro y delivery</Link>}
              </section>
            )}
            {(missing.length > 0 || voided.length > 0) && (
              <section className="pass-sec" aria-label="Falta">
                <h3>Falta</h3>
                {missing.map((l) => (
                  <div key={l.id} className="pline is-missing">
                    <span className="qty">{l.qty}</span>
                    <span className="pname">{l.name}{l.note && <span className="pnote"> · {l.note}</span>}<span className="pwhere">{l.station}{l.seat ? ` · ${l.seat}` : ''}</span></span>
                    <span className={`pill ${l.held && l.status === 'pending' ? 'st-clean' : 'st-wait'}`}>
                      {l.held && l.status === 'pending' ? `En espera · ~${fireAt(l, g)}` : l.status === 'preparing' ? (l.qty_ready ? `${l.qty_ready} de ${l.qty} listos` : 'Preparando') : 'Sin empezar'}
                    </span>
                    {!l.change_ack && l.change_note && <ChangeNote l={l} act={act} />}
                  </div>
                ))}
                {voided.map((l) => (
                  <div key={l.id} className="pline is-void">
                    <span className="qty">{l.qty}</span>
                    <span className="pname">{l.name}<span className="pwhere">{l.station}</span></span>
                    <span className="pill st-bad">Anulado</span>
                    <ChangeNote l={l} act={act} />
                  </div>
                ))}
              </section>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ChangeNote({ l, act }: { l: any; act: (l: any, a: string) => Promise<void> }) {
  return <div className="change" role="alert"><span>{l.change_note ?? 'Anulado'}</span><button className="small" onClick={() => act(l, 'ack')}>Entendido</button></div>;
}

function SoldOut({ onClose, kinds, stations }: { onClose: () => void; kinds: string[]; stations: any[] }) {
  const toast = useToast();
  const menu = useLoad(() => api('/api/menu'));
  useLive(['menu'], menu.reload);
  const ids = stations.filter((s) => kinds.includes(s.kind)).map((s) => s.id);
  const set = async (p: any, available: boolean, stockQty: number | null) => {
    try { await api(`/api/products/${p.id}/availability`, { body: { available, stockQty } }); menu.reload(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title="Disponibilidad" open onClose={onClose}>
      {!menu.data ? <Loading /> : (
        <div className="stack">
          <p className="small muted">El cambio se publica al instante en la carta y en las pantallas de los mozos.</p>
          {menu.data.products.filter((p: any) => ids.includes(p.station_id)).map((p: any) => (
            <div key={p.id} className="spread">
              <span>{p.name} {!p.available ? <span className="pill st-bad">Agotado</span> : p.stock_qty != null && <span className="pill st-wait">Quedan {p.stock_qty}</span>}</span>
              <span className="row">
                <input aria-label={`Cupo de ${p.name}`} type="number" min={0} style={{ width: 80 }} defaultValue={p.stock_qty ?? ''} placeholder="∞" onBlur={(e) => { const v = e.target.value; if (String(p.stock_qty ?? '') !== v) set(p, true, v === '' ? null : Number(v)); }} />
                {p.available ? <button className="danger" onClick={() => set(p, false, p.stock_qty)}>Agotar</button> : <button onClick={() => set(p, true, null)}>Habilitar</button>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
