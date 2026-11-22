import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, ars, can, hhmm, newOp, useLive, useLoad, useLocal, useMe, useToast } from '../lib.tsx';
import { ErrorBox, LineStatus, Loading, Modal, Money, optionsText, Stepper, usePin } from '../ui.tsx';
import { ItemDialog, Picker, type DraftItem } from './Picker.tsx';
import { Icon } from '../icons.tsx';

type Draft = { items: DraftItem[]; pending: { opId: string; at: string } | null };

export default function TablePage() {
  const { id } = useParams();
  const vid = Number(id);
  const { me } = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const pin = usePin();
  const visit = useLoad(() => api(`/api/visits/${vid}`), [vid]);
  const menu = useLoad(() => api('/api/menu'));
  const floor = useLoad(() => api('/api/floor'));
  useLive(['lines', 'floor', 'cash'], () => { visit.reload(); floor.reload(); });
  useLive(['menu'], menu.reload);
  const [draft, setDraft] = useLocal<Draft>(`draft-${vid}`, { items: [], pending: null });
  const [picking, setPicking] = useState<any>(null);
  const [tab, setTab] = useState<'cargar' | 'cuenta'>('cargar');
  const [sending, setSending] = useState(false);
  const [problems, setProblems] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [dlg, setDlg] = useState<null | 'move' | 'merge' | 'split' | 'guests' | 'waiter'>(null);
  const [target, setTarget] = useState('');
  const [splitIds, setSplitIds] = useState<number[]>([]);
  const [guests, setGuests] = useState(2);
  const checked = useRef(false);

  // Al volver: si quedó un envío sin confirmar, consultar su resultado antes de reintentar.
  useEffect(() => {
    if (checked.current || !draft.pending) return;
    checked.current = true;
    api(`/api/rounds/by-op/${draft.pending.opId}`).then((r) => {
      if (r.found) { setDraft({ items: [], pending: null }); toast('La ronda pendiente ya había llegado a cocina (recuperada).'); visit.reload(); }
    }).catch(() => {});
  }, [draft.pending]); // oxlint-disable-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- se consulta una sola vez por envío pendiente
  useEffect(() => {
    // Reintenta con el mismo botón (send se declara después de los returns tempranos).
    const retry = () => { if (draft.pending) document.querySelector<HTMLButtonElement>('[data-send-round]')?.click(); };
    addEventListener('online', retry);
    return () => removeEventListener('online', retry);
  });

  if (visit.error) return <div className="page"><ErrorBox error={visit.error} retry={visit.reload} /></div>;
  if (!visit.data || !menu.data) return <div className="page"><Loading /></div>;
  const v = visit.data;
  const closed = v.visit.status !== 'open';
  const tables = v.tables.map((t: any) => t.number).join('+');
  const rule = me?.restaurant?.settings?.pizza_rule ?? 'max';
  const allowHold = !!me?.restaurant?.settings?.features?.courses;
  const total = draft.items.reduce((s, i) => s + i.unit * i.sel.qty, 0);

  const send = async () => {
    if (!draft.items.length || sending) return;
    const opId = draft.pending?.opId ?? newOp();
    setDraft((d) => ({ ...d, pending: { opId, at: new Date().toISOString() } }));
    setSending(true); setProblems(null);
    try {
      const r = await api(`/api/visits/${vid}/rounds`, { body: { opId, items: draft.items.map((i) => i.sel) } });
      setDraft({ items: [], pending: null });
      setLastOk(`Ronda ${r.round.number} recibida en cocina y barra · ${hhmm(r.round.created_at)}${r.duplicate ? ' (confirmación recuperada)' : ''}`);
      visit.reload(); menu.reload();
    } catch (e) {
      const err = e as ApiError;
      // Sin respuesta o error del servidor/proxy: la ronda pudo haber llegado. Se conserva el mismo opId y el mismo contenido.
      if (err.status === 0 || err.status >= 500) { toast(err.status ? 'El servidor no confirmó la ronda: quedó pendiente. Reintentá; si sigue fallando, avisá al encargado.' : 'Sin señal: la ronda quedó pendiente de enviar. Se reintenta sola al volver la conexión.', true); return; }
      // El servidor rechazó la ronda completa: no quedó nada confirmado. Se quitan los agotados para elegir otra cosa.
      setDraft((d) => ({ pending: null, items: err.data?.problems ? d.items.filter((i) => !err.data.problems.some((p: any) => p.productId === i.sel.productId)) : d.items }));
      setProblems(err.data?.problems ? `${err.message}. Lo quitamos de la ronda: elegí otra opción y volvé a enviar.` : err.message);
      menu.reload();
    } finally { setSending(false); }
  };

  const act = async (path: string, body: any = {}, okMsg?: string) => {
    try { const r = await api(path, { body }); if (okMsg) toast(okMsg); visit.reload(); floor.reload(); return r; } catch (e: any) { toast(e.message, true); }
  };
  const withPin = async (path: string, body: any) => {
    try { return await api(path, { body }); } catch (e: any) {
      if (e.status !== 403 || !/PIN|autoriz/i.test(e.message)) throw e;
      const p = await pin.ask();
      if (!p) return null;
      return api(path, { body: { ...body, supervisorPin: p } });
    }
  };
  const voidLine = async (l: any) => {
    const reason = prompt(`Motivo para anular ${l.name}:`);
    if (!reason) return;
    const started = l.status !== 'pending' || l.qty_ready > 0;
    const destination = started ? (confirm('Ya se preparó. ¿Va a merma? (Aceptar = merma, Cancelar = se reutiliza)') ? 'merma' : 'reutilizar') : undefined;
    try { await withPin(`/api/lines/${l.id}/void`, { reason, destination }); toast('Anulado. Cocina recibe el aviso.'); visit.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const correct = async (l: any) => {
    const note = prompt(`Nueva aclaración para ${l.name}:`, l.note);
    if (note) act(`/api/lines/${l.id}/correct`, { note }, 'Corrección enviada; el sector debe confirmarla.');
  };
  const repeatLast = () => {
    const last = v.rounds[v.rounds.length - 1];
    if (!last) return;
    const lines = v.lines.filter((l: any) => l.round_id === last.id && l.status !== 'void');
    const items: DraftItem[] = lines.map((l: any) => ({ key: newOp(), sel: { productId: l.product_id, qty: l.qty, note: l.note || undefined, seat: l.seat || undefined, optionIds: [] }, label: l.name, detail: 'repetido · revisá las opciones', unit: menu.data.products.find((p: any) => p.id === l.product_id)?.price_cents ?? l.unit_price_cents }));
    // Opciones: se vuelven a elegir para revalidar precio vigente; los platos sin opciones se repiten directo.
    const simple = items.filter((i) => !(menu.data.products.find((p: any) => p.id === i.sel.productId)?.options ?? []).some((o: any) => !o.multi));
    setDraft((d) => ({ ...d, items: [...d.items, ...simple.map((i) => ({ ...i, detail: i.sel.note ?? '' }))] }));
    if (simple.length < items.length) toast('Los platos con opciones obligatorias no se repitieron: cargalos de nuevo.', true);
  };

  const byRound = v.rounds.map((r: any) => ({ r, lines: v.lines.filter((l: any) => l.round_id === r.id) }));
  const free = (floor.data?.tables ?? []).filter((t: any) => !t.visit_id);
  const others = (floor.data?.visits ?? []).filter((x: any) => x.id !== vid);
  const waiterName = (floor.data?.visits ?? []).find((x: any) => x.id === vid)?.waiter;
  const canTransfer = can(me, 'all_tables');
  const held = v.lines.some((l: any) => l.held && l.status === 'pending');

  const Cuenta = (
    <section className="stack" aria-label="Cuenta de la mesa">
      {byRound.length === 0 && <p className="muted">Todavía no se envió ninguna ronda.</p>}
      {byRound.map(({ r, lines }: any) => (
        <div key={r.id} className="card" style={{ padding: 12 }}>
          <div className="spread small muted"><span>Ronda {r.number} · {hhmm(r.created_at)} · {r.source === 'diner' ? 'pedido desde la mesa' : r.by_name}</span></div>
          {lines.map((l: any) => (
            <div key={l.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <div className="spread">
                <span><strong>{l.qty}× {l.name}</strong> <span className="muted small">{l.station}</span></span>
                <span className="row"><LineStatus l={l} /><Money c={l.unit_price_cents * l.qty} /></span>
              </div>
              {(l.options?.length > 0 || l.note || l.seat) && <div className="small">{optionsText(l.options)}{l.note && <strong> · «{l.note}»</strong>}{l.seat && <span className="muted"> · {l.seat}</span>}</div>}
              {!closed && l.status !== 'void' && (
                <div className="row" style={{ marginTop: 6 }}>
                  {l.qty_ready > l.qty_delivered && <button className="primary" onClick={() => act(`/api/lines/${l.id}/deliver`, {}, 'Entregado')}>Entregar {l.qty_ready - l.qty_delivered}</button>}
                  {['pending', 'preparing'].includes(l.status) && <button className="small" onClick={() => correct(l)}>Corregir</button>}
                  {l.qty_delivered === 0 && <button className="small danger" onClick={() => voidLine(l)}>Anular</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="card totals">
        <span>Total</span><Money c={v.balance.total} />
        {v.balance.discounts > 0 && <><span>Descuentos</span><span>−<Money c={v.balance.discounts} /></span></>}
        <span>Pagado</span><Money c={v.balance.paid} />
        <strong>Saldo</strong><strong className="due"><Money c={v.balance.due} /></strong>
      </div>
    </section>
  );

  return (
    <main className="page" style={{ paddingBottom: 0 }}>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={() => nav('/app/salon')} aria-label="Volver al salón">← Salón</button>
          <h1>Mesa {tables || '—'} {closed && <span className="pill st-free">Cerrada</span>}</h1>
          <div className="sub">{v.visit.guests} pers.
            {closed && v.visit.waiter_id && <> · Mozo: <strong>{waiterName ?? '…'}</strong></>}</div>
        </div>
        {!closed && <div className="row">
          <button onClick={() => { setGuests(v.visit.guests); setDlg('guests'); }}>Personas</button>
          <button onClick={() => { setTarget(''); setDlg('move'); }}>Mover</button>
          <button onClick={() => { setTarget(''); setDlg('merge'); }}>Unir</button>
          <button onClick={() => { setTarget(''); setSplitIds([]); setDlg('split'); }}>Separar</button>
          <button onClick={() => act(`/api/visits/${vid}/bill-request`, {}, 'Marcada: pidió la cuenta')}>Pidió la cuenta</button>
          <button onClick={async () => { const t = await act('/api/tickets/precuenta', { visitId: vid }); if (t) window.open(`/ticket/${t.id}`, '_blank'); }}>Precuenta</button>
          {held && <button className="primary" onClick={() => act(`/api/visits/${vid}/fire`, {}, 'Principales marchados')}>Marchar principales</button>}
          {can(me, 'cashier') && <button onClick={() => nav(`/app/caja?visit=${vid}`)}>Cobrar</button>}
        </div>}
      </div>

      {/* Atención de la mesa: quién la atiende y los pedidos por QR, a la vista y en el mismo lugar. */}
      {!closed && <div className="table-setup">
        <section className={`card setup-card${v.visit.waiter_id ? '' : ' is-pending'}`} aria-label="Mozo de la mesa">
          <div><div className="small muted">Mozo</div>
            {v.visit.waiter_id ? <strong className="setup-val">{waiterName ?? '…'}</strong> : <strong className="setup-val warn">Sin mozo asignado</strong>}</div>
          {canTransfer && <button className={v.visit.waiter_id ? '' : 'primary'} onClick={() => { setTarget(''); setDlg('waiter'); }}>{v.visit.waiter_id ? 'Cambiar mozo' : 'Asignar mozo'}</button>}
        </section>
        {me?.restaurant?.settings?.mode !== 'menu' && <QrControl visit={v.visit} calls={me?.restaurant?.settings?.mode === 'calls'} onChange={visit.reload} />}
      </div>}
      {lastOk && <p className="pill st-ok" role="status" style={{ marginBottom: 12, fontSize: '.95rem' }}><Icon name="check" /> {lastOk}</p>}
      {v.calls.length > 0 && <p className="pill st-bill" style={{ marginBottom: 12 }}>{v.calls.map((c: any) => c.reason === 'cuenta' ? 'Pidió la cuenta' : c.reason === 'alergia' ? `Alergia: ${c.detail}` : c.reason === 'pedido' ? `Pidió por QR (${c.detail})` : 'Llamó al mozo').join(' · ')}</p>}

      <div className="seg hide-lg" role="tablist" aria-label="Vista de la mesa" style={{ marginBottom: 12 }}>
        <button role="tab" aria-selected={tab === 'cargar'} onClick={() => setTab('cargar')}>Cargar ronda</button>
        <button role="tab" aria-selected={tab === 'cuenta'} onClick={() => setTab('cuenta')}>Cuenta y estados ({v.lines.length})</button>
      </div>
      <div className="split-2">
        {!closed && <div className={tab === 'cargar' ? '' : 'hide-sm'}><Picker menu={menu.data} onPick={(p) => (draft.pending ? toast('Hay una ronda sin confirmar: reintentá el envío antes de agregar platos.', true) : setPicking(p))} /></div>}
        <div className={tab === 'cuenta' || closed ? '' : 'hide-sm'}>{Cuenta}</div>
      </div>

      {!closed && (
        <div className="sendbar">
          {problems && <p className="field-error" role="alert">{problems}</p>}
          {draft.pending && <p className="pill st-wait" role="status">Pendiente de enviar · {hhmm(draft.pending.at)}</p>}
          {draft.items.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px', maxHeight: 180, overflow: 'auto' }}>
              {draft.items.map((i) => (
                <li key={i.key} className="spread" style={{ padding: '4px 0' }}>
                  <span><strong>{i.sel.qty}× {i.label}</strong>{(i.detail || i.sel.note) && <span className="small"> · {[i.detail, i.sel.note && `«${i.sel.note}»`].filter(Boolean).join(' · ')}</span>}</span>
                  <span className="row"><Money c={i.unit * i.sel.qty} /><button className="ghost" aria-label={`Quitar ${i.label}`} disabled={!!draft.pending} onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((x) => x.key !== i.key) }))}><Icon name="close" /></button></span>
                </li>
              ))}
            </ul>
          )}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {v.rounds.length > 0 && <button onClick={repeatLast} disabled={!!draft.pending}>Repetir ronda</button>}
            <button className="primary big" data-send-round style={{ flex: 1 }} disabled={!draft.items.length || sending} onClick={send}>
              {sending ? 'Enviando…' : draft.pending ? 'Reintentar envío' : draft.items.length ? `Enviar ronda · ${draft.items.reduce((s, i) => s + i.sel.qty, 0)} ítems · ${ars(total)}` : 'Elegí platos para la ronda'}
            </button>
          </div>
        </div>
      )}

      <ItemDialog product={picking} products={menu.data.products} rule={rule} guests={v.visit.guests} allowHold={allowHold} onClose={() => setPicking(null)}
        onAdd={(sel, est) => { if (draft.pending) return; setDraft((d) => ({ ...d, items: [...d.items, { key: newOp(), sel, label: est.label, detail: est.detail, unit: est.unit }] })); setPicking(null); setLastOk(null); }} />

      <Modal title="Personas en la mesa" open={dlg === 'guests'} onClose={() => setDlg(null)} footer={<button className="primary" onClick={async () => { await act(`/api/visits/${vid}/guests`, { guests }); setDlg(null); }}>Guardar</button>}>
        <Stepper label="personas" value={guests} onChange={setGuests} min={1} max={40} />
      </Modal>
      <Modal title="Mover a otra mesa" open={dlg === 'move'} onClose={() => setDlg(null)} footer={<button className="primary" disabled={!target} onClick={async () => { await act(`/api/visits/${vid}/move`, { fromTableId: v.tables[0].id, toTableId: Number(target) }, 'Mesa movida con consumos y pagos'); setDlg(null); }}>Mover</button>}>
        <div className="field"><label htmlFor="mv">Mesa libre de destino</label><select id="mv" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Elegí…</option>{free.map((t: any) => <option key={t.id} value={t.id}>{t.number} · {t.area}</option>)}</select></div>
      </Modal>
      <Modal title="Unir con otra mesa" open={dlg === 'merge'} onClose={() => setDlg(null)} footer={<button className="primary" disabled={!target} onClick={async () => { await act(`/api/visits/${vid}/merge`, { visitId: Number(target) }, 'Mesas unidas: se conservaron consumos y pagos'); setDlg(null); }}>Unir aquí</button>}>
        <p className="small">La otra mesa pasa a esta cuenta con sus consumos, pagos parciales y descuentos.</p>
        <div className="field"><label htmlFor="mg">Mesa abierta</label><select id="mg" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Elegí…</option>
          {others.map((x: any) => <option key={x.id} value={x.id}>Mesa {(floor.data.tables.filter((t: any) => t.visit_id === x.id).map((t: any) => t.number)).join('+')} · saldo {ars(x.due)}</option>)}</select></div>
      </Modal>
      <Modal title="Separar consumos a otra mesa" open={dlg === 'split'} onClose={() => setDlg(null)} footer={<button className="primary" disabled={!target || !splitIds.length} onClick={async () => { const r = await act(`/api/visits/${vid}/split`, { toTableId: Number(target), lineIds: splitIds }, 'Consumos separados'); setDlg(null); if (r) nav(`/app/mesa/${r.id}`); }}>Separar</button>}>
        <div className="stack">
          {v.lines.filter((l: any) => l.status !== 'void').map((l: any) => <label key={l.id} className="check"><input type="checkbox" checked={splitIds.includes(l.id)} onChange={(e) => setSplitIds(e.target.checked ? [...splitIds, l.id] : splitIds.filter((x) => x !== l.id))} /> {l.qty}× {l.name} · {ars(l.unit_price_cents * l.qty)}</label>)}
          <div className="field"><label htmlFor="sp">Mesa libre</label><select id="sp" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Elegí…</option>{free.map((t: any) => <option key={t.id} value={t.id}>{t.number}</option>)}</select></div>
        </div>
      </Modal>
      <WaiterDialog open={dlg === 'waiter'} current={v.visit.waiter_id} onClose={() => setDlg(null)} onPick={async (uid) => { await act(`/api/visits/${vid}/waiter`, { userId: uid }, v.visit.waiter_id ? 'Mesa traspasada' : 'Mozo asignado'); setDlg(null); }} />
      {pin.el}
    </main>
  );
}

function WaiterDialog({ open, current, onClose, onPick }: { open: boolean; current: number | null; onClose: () => void; onPick: (uid: number) => Promise<void> }) {
  const list = useLoad(() => (open ? api('/api/staff/waiters') : Promise.resolve(null)), [open]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={current ? 'Cambiar mozo' : 'Asignar mozo'} open={open} onClose={onClose}>
      <p className="small muted">La mesa pasa a la lista del mozo elegido con su cuenta y las comandas en curso; el QR, el código y lo ya pedido no cambian. Desde ahí, los avisos nuevos le llegan a él. Queda registrado en la auditoría.</p>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : (
        <div className="stack">{list.data.map((w: any) => <button key={w.id} disabled={busy || w.id === current} onClick={async () => { setBusy(true); try { await onPick(w.id); } finally { setBusy(false); } }}>{w.name}{w.id === current ? ' (atiende ahora)' : ''}</button>)}</div>
      )}
    </Modal>
  );
}

/** Pedidos por QR de esta visita: el mozo los habilita y le dicta el código a la mesa. */
function QrControl({ visit, calls, onChange }: { visit: any; calls: boolean; onChange: () => void }) {
  const what = calls ? 'llamados por QR' : 'pedidos por QR';
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const set = async (enabled: boolean) => {
    setBusy(true);
    try { await api(`/api/visits/${visit.id}/qr`, { body: { enabled } }); onChange(); toast(enabled ? `Mesa habilitada para ${what}` : 'QR deshabilitado: los celulares de la mesa ya no pueden enviar'); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <section className={`card qr-ctl setup-card${visit.qr_enabled ? '' : ' is-pending'}`} aria-label={calls ? 'Llamados por QR' : 'Pedidos por QR'}>
      {visit.qr_enabled ? <>
        <div><div className="small muted">Código para la mesa ({what})</div><strong className="num qr-code" aria-live="polite">{visit.access_code}</strong></div>
        <button disabled={busy} onClick={() => set(false)}>Deshabilitar {what}</button>
      </> : <>
        <div><div className="small muted">{calls ? 'Llamados por QR' : 'Pedidos por QR'}</div><strong className="setup-val">Sin habilitar</strong>
          <div className="small muted">La mesa ve la carta. Para que {calls ? 'llamen' : 'pidan'} desde el celular, habilitalo y dales el código.</div></div>
        <button className="primary" disabled={busy} onClick={() => set(true)}>Habilitar {what}</button>
      </>}
    </section>
  );
}
