import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, ars, dateAR, hhmm, newOp, useLive, useLoad, useLocal, useMe, useToast } from '../lib.tsx';
import { Empty, ErrorBox, Loading, Modal, Money, MoneyInput, optionsText, Stepper, usePin } from '../ui.tsx';
import { parseArs, splitEqual, splitShares } from '../../../shared/money.ts';
import { Fragment } from 'react';
import { Icon } from '../icons.tsx';

const METHOD: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };

export default function Cash() {
  const { tab = 'cuentas', shiftId } = useParams();
  const nav = useNavigate();
  return (
    <main className="page">
      <div className="page-head has-tabs"><h1>Caja</h1></div>
      <div className="tabs" role="tablist" aria-label="Secciones de caja">
        {[['cuentas', 'Cuentas'], ['turno', 'Turno y arqueo'], ['historial', 'Historial y tickets']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k && !shiftId} onClick={() => nav(k === 'cuentas' ? '/app/caja' : `/app/caja/${k}`)}>{l}</button>
        ))}
      </div>
      <div className="cash-body">
        {shiftId ? <ShiftDetail id={Number(shiftId)} /> : tab === 'turno' ? <Shift /> : tab === 'historial' ? <History /> : <Accounts />}
      </div>
    </main>
  );
}

function Accounts() {
  const [sp, setSp] = useSearchParams();
  const floor = useLoad(() => api('/api/floor'));
  const orders = useLoad(() => api('/api/orders'));
  const shift = useLoad(() => api('/api/shifts/current'));
  useLive(['floor', 'cash', 'orders'], () => { floor.reload(); orders.reload(); shift.reload(); });
  const [q, setQ] = useState('');
  const sel = sp.get('visit') ? { visitId: Number(sp.get('visit')) } : sp.get('order') ? { orderId: Number(sp.get('order')) } : null;
  if (floor.error) return <ErrorBox error={floor.error} retry={floor.reload} />;
  if (!floor.data || !orders.data) return <Loading />;
  const tablesOf = (vid: number) => floor.data.tables.filter((t: any) => t.visit_id === vid).map((t: any) => t.number).join('+');
  const all = [
    ...floor.data.visits.map((v: any) => ({ key: `v${v.id}`, label: `Mesa ${tablesOf(v.id)}`, due: v.due, paid: v.paid, sel: { visitId: v.id }, bill: floor.data.calls.some((c: any) => c.visit_id === v.id && c.reason === 'cuenta') })),
    ...orders.data.orders.filter((o: any) => !['rechazado', 'cancelado', 'recibido', 'solicitud'].includes(o.status) && o.total_cents - o.paid > 0).map((o: any) => ({ key: `o${o.id}`, label: `Pedido #${o.number} · ${o.customer_name}`, due: o.total_cents - o.paid, paid: o.paid, sel: { orderId: o.id }, bill: false, declared: o.cash_declared_cents })),
  ];
  // Primero lo que piden cobrar; después el resto por saldo.
  const accounts = all.filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(b.bill) - Number(a.bill) || b.due - a.due);
  const pick = (s: any) => setSp(s.visitId ? { visit: String(s.visitId) } : { order: String(s.orderId) });
  const closed = !shift.data && <div className="cash-alert" role="alert"><span><strong>La caja está cerrada.</strong> Abrila con el fondo inicial para registrar cobros.</span><Link className="btn primary" to="/app/caja/turno">Abrir caja</Link></div>;
  if (!all.length && !sel) return <>{closed}<Empty>No hay cuentas para cobrar. Las mesas abiertas y los pedidos con saldo aparecen acá.</Empty></>;
  return (
    <>
      {closed}
      <div className={`accounts${sel ? ' has-sel' : ''}`}>
        <section className="acc-list" aria-label="Cuentas abiertas">
          {(all.length > 5 || q) && <input type="search" placeholder="Buscar mesa o pedido…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cuenta" />}
          <div className="acc-rows">
            {accounts.map((a) => (
              <button key={a.key} className="acc-row" aria-current={sel && JSON.stringify(sel) === JSON.stringify(a.sel) ? 'true' : undefined} onClick={() => pick(a.sel)}>
                <span className="acc-name">{a.label}</span>
                <strong className="acc-due"><Money c={a.due} /></strong>
                {(a.bill || a.paid > 0 || ('declared' in a && a.declared != null) || a.due === 0) && <span className="acc-tags">
                  {a.bill && <span className="pill st-bill">Pidió la cuenta</span>}
                  {a.paid > 0 && <span className="pill st-open">Pago parcial</span>}
                  {a.due === 0 && <span className="pill st-free">Sin saldo · cerrar</span>}
                  {'declared' in a && a.declared != null && <span className="pill st-wait">Repartidor declaró {ars(a.declared)}</span>}
                </span>}
              </button>
            ))}
            {!accounts.length && <p className="empty-line">Ninguna cuenta coincide con «{q}».</p>}
          </div>
        </section>
        {sel ? <Account key={JSON.stringify(sel)} sel={sel} shiftOpen={!!shift.data} onBack={() => setSp({})} /> : <p className="acc-hint">Elegí una cuenta de la lista para ver el detalle y cobrar.</p>}
      </div>
    </>
  );
}

type Share = { label: string; amount: number; note?: string; left: number };

function Account({ sel, shiftOpen, onBack }: { sel: { visitId?: number; orderId?: number }; shiftOpen: boolean; onBack: () => void }) {
  const { me } = useMe();
  const toast = useToast();
  const pin = usePin();
  const isVisit = !!sel.visitId;
  const acc = useLoad(() => api(isVisit ? `/api/visits/${sel.visitId}` : `/api/orders/${sel.orderId}`), [sel.visitId, sel.orderId]);
  useLive(['cash', 'floor', 'lines', 'orders'], acc.reload);
  const [split, setSplit] = useState<'none' | 'equal' | 'seat' | 'item'>('none');
  const [parts, setParts] = useState(2);
  const [assign, setAssign] = useState<Record<number, string[]>>({});
  const [method, setMethod] = useState('efectivo');
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [tip, setTip] = useState('');
  const [payer, setPayer] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useLocal<any>('pending-payment', null);
  const [discount, setDiscount] = useState(false);

  const lines = (acc.data?.lines ?? []).filter((l: any) => l.status !== 'void');
  const b = acc.data?.balance;
  // Las partes se calculan sobre el total de la cuenta; lo ya cobrado a nombre de cada parte se descuenta (las devoluciones conservan el nombre).
  const shares: Share[] = useMemo(() => {
    if (!b) return [];
    const paidBy: Record<string, number> = {};
    for (const p of acc.data?.payments ?? []) if (p.payer) paidBy[p.payer] = (paidBy[p.payer] ?? 0) + p.amount_cents;
    const withLeft = (x: Omit<Share, 'left'>[]) => x.map((sh) => ({ ...sh, left: Math.max(0, Math.min(b.due, sh.amount - (paidBy[sh.label] ?? 0))) }));
    if (split === 'equal') return withLeft(splitEqual(b.total, parts).map((amount, i) => ({ label: `Parte ${i + 1}`, amount, note: i === 0 && b.total % parts ? `incluye ${b.total % parts} centavo(s) de redondeo` : undefined })));
    if (split === 'seat' || split === 'item') {
      const asg = split === 'seat' ? Object.fromEntries(lines.map((l: any) => [l.id, [l.seat || 'Mesa compartida']])) : assign;
      // Cada línea pesa por su neto (con su cortesía o descuento); envío y descuentos generales se reparten en proporción.
      const disc = (acc.data?.discounts ?? []) as any[];
      const lineDisc = (id: number) => disc.filter((d) => d.line_id === id).reduce((s, d) => s + d.amount_cents, 0);
      const nets = lines.map((l: any) => ({ id: l.id, total: l.unit_price_cents * l.qty - lineDisc(l.id) }));
      return withLeft(splitShares(nets, asg, b.total).map(([label, amount]) => ({ label, amount })));
    }
    return [];
  }, [split, parts, assign, b, lines, acc.data]);

  if (acc.error) return <ErrorBox error={acc.error} retry={acc.reload} />;
  if (!acc.data) return <Loading />;
  const methods: string[] = me?.restaurant?.settings?.payment_methods ?? ['efectivo', 'transferencia', 'tarjeta'];
  const amountC = amount ? parseArs(amount) : b.due;
  const tipC = tip ? parseArs(tip) : 0;
  const tenderedC = tendered ? parseArs(tendered) : amountC + tipC;
  const change = method === 'efectivo' ? tenderedC - amountC - tipC : 0;
  // Una propina o efectivo ilegible no se descarta en silencio: bloquea el cobro.
  const invalid = !Number.isFinite(tipC) || (method === 'efectivo' && !Number.isFinite(tenderedC)) || !Number.isFinite(amountC) || amountC <= 0 || amountC > b.due || (method === 'efectivo' && change < 0) || (method === 'transferencia' && !verified);
  const where = isVisit ? `Mesa ${acc.data.tables.map((t: any) => t.number).join('+')}` : `Pedido #${acc.data.order.number}`;
  const payments = acc.data.payments ?? [];

  const pay = async () => {
    const opId = pending?.target === JSON.stringify(sel) ? pending.opId : newOp();
    const body = { opId, ...sel, method, amountCents: amountC, tipCents: tipC, tenderedCents: method === 'efectivo' ? tenderedC : undefined, payer, transferVerified: verified };
    setPending({ opId, target: JSON.stringify(sel), body, at: new Date().toISOString() });
    setBusy(true);
    try {
      const r = await api('/api/payments', { body });
      setPending(null);
      toast(`${r.duplicate ? 'Cobro ya registrado' : 'Cobrado'} ${ars(amountC)} en ${METHOD[method] ?? method}${change > 0 ? ` · vuelto ${ars(change)}` : ''}`);
      setAmount(''); setTendered(''); setTip(''); setPayer(''); setVerified(false);
      acc.reload();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 0 || err.status >= 500) toast('Sin respuesta confirmada: el cobro quedó SIN CONFIRMAR. Verificá antes de cobrar de nuevo.', true);
      else { setPending(null); toast(err.message, true); }
    } finally { setBusy(false); }
  };
  // Un cobro sin confirmación se verifica por su identificador; nunca se reintenta como cobro nuevo.
  const checkPending = async () => {
    try {
      const r = await api(`/api/payments/by-op/${pending.opId}`);
      if (r.payment) { setPending(null); toast('El cobro pendiente sí se había registrado.'); acc.reload(); }
      else { const res = await api('/api/payments', { body: pending.body }); setPending(null); toast(`Cobro confirmado ${ars(res.payment.amount_cents)}`); acc.reload(); }
    } catch (e: any) { toast(e.message, true); }
  };
  const close = async () => {
    try {
      if (isVisit) { const r = await api(`/api/visits/${sel.visitId}/close`, { body: {} }); window.open(`/ticket/${r.ticket.id}`, '_blank'); onBack(); }
      else { const t = await api('/api/tickets/x-order', { body: { orderId: sel.orderId } }); window.open(`/ticket/${t.id}`, '_blank'); }
    } catch (e: any) { toast(e.message, true); }
  };
  const precuenta = async () => {
    try { const t = await api('/api/tickets/precuenta', { body: sel }); window.open(`/ticket/${t.id}`, '_blank'); } catch (e: any) { toast(e.message, true); }
  };
  const refund = async (p: any) => {
    const reason = prompt(`Motivo de la devolución de ${ars(p.amount_cents)} (${p.method}):`);
    if (!reason) return;
    const body = { reason, opId: newOp() };
    try {
      try { await api(`/api/payments/${p.id}/refund`, { body }); }
      catch (e: any) { if (e.status !== 403) throw e; const code = await pin.ask(); if (!code) return; await api(`/api/payments/${p.id}/refund`, { body: { ...body, supervisorPin: code } }); }
      toast('Devolución registrada'); acc.reload();
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <div className="acct-wrap">
      <div className="acct-head">
        <button className="ghost acc-back" onClick={onBack}>← Cuentas</button>
        <h2>{where}</h2>
        <div className="row"><button onClick={precuenta}><Icon name="receipt" />Precuenta</button>{isVisit && <button onClick={() => setDiscount(true)}>Descuento</button>}</div>
      </div>
      <div className="acct">
        <div className="acct-main">
          <section aria-label="Detalle de la cuenta">
            <details className="acct-detail" open={lines.length <= 8}>
              <summary className="rule-title"><span>Detalle</span><span className="muted">{lines.length} {lines.length === 1 ? 'ítem' : 'ítems'}</span></summary>
              <table><tbody>
                {lines.map((l: any) => <tr key={l.id}><td className="num">{l.qty}×</td><td>{l.name}<div className="small muted">{optionsText(l.options)}{l.seat && ` · ${l.seat}`}</div></td><td className="right"><Money c={l.unit_price_cents * l.qty} /></td></tr>)}
                {(acc.data.discounts ?? []).map((d: any) => <tr key={`d${d.id}`}><td colSpan={2}>{d.kind === 'cortesia' ? 'Cortesía' : 'Descuento'}: {d.reason} <span className="small muted">autorizó {d.by_name}</span></td><td className="right">−<Money c={d.amount_cents} /></td></tr>)}
                {b.fee > 0 && <tr><td colSpan={2}>Envío</td><td className="right"><Money c={b.fee} /></td></tr>}
              </tbody></table>
            </details>
          </section>

          {payments.length > 0 && (
            <section aria-label="Pagos registrados">
              <h3 className="rule-title">Pagos registrados</h3>
              <table><tbody>{payments.map((p: any) => (
                <tr key={p.id}><td>{hhmm(p.created_at)} · {METHOD[p.method] ?? p.method}{p.payer && ` · ${p.payer}`}{p.amount_cents < 0 && <span className="pill st-bad"> Devolución: {p.reason}</span>}
                  {p.change_cents > 0 && <div className="small muted">Recibió {ars(p.tendered_cents)} · vuelto {ars(p.change_cents)}</div>}{p.tip_cents > 0 && <div className="small muted">Propina {ars(p.tip_cents)}</div>}</td>
                  <td className="right"><Money c={p.amount_cents} />{p.amount_cents > 0 && p.status !== 'reversed' && <div><button className="small ghost" onClick={() => refund(p)}>Devolver</button></div>}</td></tr>
              ))}</tbody></table>
            </section>
          )}

          {b.due > 0 && <section aria-label="Dividir la cuenta" className="stack">
            <h3 className="rule-title">Dividir</h3>
            <div className="row" role="group" aria-label="Forma de dividir">
              {[['none', 'Sin dividir'], ['equal', 'Partes iguales'], ['seat', 'Por persona'], ['item', 'Por ítem']].map(([k, l]) => <button key={k} className="chip" aria-pressed={split === k} onClick={() => setSplit(k as any)}>{l}</button>)}
            </div>
            {split === 'equal' && <div className="spread"><span>Partes</span><Stepper label="partes" value={parts} onChange={setParts} min={2} max={30} /></div>}
            {split === 'item' && <div className="stack small">
              <p className="muted" style={{ margin: 0 }}>Asigná cada ítem a una o varias personas (ítem compartido: se reparte en partes iguales al centavo).</p>
              {lines.map((l: any) => (
                <div key={l.id} className="spread"><span>{l.qty}× {l.name} · {ars(l.unit_price_cents * l.qty)}</span>
                  <span className="row">{Array.from({ length: Math.max(2, acc.data.visit?.guests ?? 2) }, (_, i) => `Persona ${i + 1}`).map((p) => (
                    <button key={p} className="chip" aria-pressed={(assign[l.id] ?? []).includes(p)} onClick={() => setAssign((a) => ({ ...a, [l.id]: (a[l.id] ?? []).includes(p) ? a[l.id].filter((x) => x !== p) : [...(a[l.id] ?? []), p] }))}>{p.replace('Persona ', 'P')}</button>
                  ))}</span></div>
              ))}
            </div>}
            {shares.length > 0 && <div className="shares">
              {shares.map((s) => (
                <div key={s.label} className="share"><span><strong>{s.label}</strong> <Money c={s.amount} />{s.note && <span className="small muted"> · {s.note}</span>}</span>
                  {s.left === 0 ? <span className="pill st-ok">Pagada</span> : <button onClick={() => { setAmount((s.left / 100).toFixed(2).replace('.', ',')); setPayer(s.label); }}>{s.left < s.amount ? `Cobrar lo que falta (${ars(s.left)})` : 'Cobrar esta parte'}</button>}</div>
              ))}
              <p className="small muted" style={{ margin: 0 }}>Suma de las partes: <Money c={shares.reduce((t, s) => t + s.amount, 0)} />{shares.reduce((t, s) => t + s.amount, 0) !== b.total && <strong> · no coincide con el total ({ars(b.total)}): falta asignar ítems</strong>}</p>
            </div>}
          </section>}
        </div>

        <div className="acct-side">
          {/* Total, pagado, saldo y vuelto quedan fijos: visibles aunque el teclado del celular tape la parte inferior. */}
          <div className="acct-sum" aria-label="Resumen del cobro">
            <div className="pay-summary">
              <div><div className="lbl">Total</div><div className="val"><Money c={b.total} /></div></div>
              <div><div className="lbl">Pagado</div><div className="val"><Money c={b.paid} /></div></div>
              <div className="due-cell"><div className="lbl">Saldo</div><div className="val" aria-live="polite"><Money c={b.due} /></div></div>
            </div>
            {b.due > 0 && <div className={`change-big${method !== 'efectivo' || !tendered ? ' is-info' : change < 0 ? ' short' : ''}`} aria-live="polite"><span>Vuelto</span>
              <span>{method !== 'efectivo' ? 'No corresponde' : !tendered ? 'Cargá el efectivo recibido' : change >= 0 ? ars(change) : 'Falta efectivo'}</span></div>}
          </div>
          <div className="acct-form">
            {pending && <div className="cash-alert bad" role="alert">
              <span><strong>Cobro sin confirmar</strong> de {ars(pending.body.amountCents)} ({pending.at && hhmm(pending.at)}).</span> <span className="row"><button onClick={checkPending}>Verificar y completar</button> <button className="ghost" onClick={() => setPending(null)}>Descartar</button></span>
            </div>}
            {b.due > 0 ? (
              <section className="paybox stack" aria-label="Cobrar">
                <div className="methods" role="group" aria-label="Medio de pago">
                  {methods.map((m) => <button key={m} aria-pressed={method === m} onClick={() => setMethod(m)}>{METHOD[m] ?? m}</button>)}
                </div>
                <div className="fields-2">
                  <MoneyInput id="amount" label={`Importe a aplicar (saldo ${ars(b.due)})`} value={amount} onChange={setAmount} />
                  {method === 'efectivo' && <MoneyInput id="tendered" label="Efectivo recibido" value={tendered} onChange={setTendered} />}
                  <MoneyInput id="tip" label="Propina (aparte)" value={tip} onChange={setTip} />
                  <div className="field"><label htmlFor="payer">Quién paga (opcional)</label><input id="payer" value={payer} onChange={(e) => setPayer(e.target.value)} /></div>
                </div>
                {method === 'transferencia' && <label className="check"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Verifiqué la acreditación en la cuenta del local</label>}
                <button className="primary big block" disabled={invalid || busy || !shiftOpen || !!pending} onClick={pay}>
                  {!shiftOpen ? 'Abrí la caja para cobrar' : busy ? 'Registrando…' : `Cobrar ${Number.isFinite(amountC) ? ars(amountC) : ''} · ${METHOD[method] ?? method}`}
                </button>
              </section>
            ) : (
              <section className="paybox done stack" aria-label="Cerrar cuenta">
                <p style={{ margin: 0, fontWeight: 700 }}>Saldo cero. {isVisit ? 'Podés cerrar la mesa: se genera el ticket interno X.' : 'Podés imprimir el ticket interno X.'}</p>
                <button className="primary big block" onClick={close}>{isVisit ? 'Cerrar mesa e imprimir ticket X' : 'Ticket interno X'}</button>
              </section>
            )}
          </div>
        </div>
      </div>
      {isVisit && <DiscountDialog open={discount} onClose={() => setDiscount(false)} visitId={sel.visitId!} lines={lines} onDone={acc.reload} />}
      {pin.el}
    </div>
  );
}

function DiscountDialog({ open, onClose, visitId, lines, onDone }: { open: boolean; onClose: () => void; visitId: number; lines: any[]; onDone: () => void }) {
  const toast = useToast();
  const pin = usePin();
  const [kind, setKind] = useState<'descuento' | 'cortesia'>('descuento');
  const [lineId, setLineId] = useState('');
  const [pct, setPct] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const body: any = { kind, reason, lineId: lineId ? Number(lineId) : undefined };
    if (kind === 'descuento') { if (pct) body.pct = Number(pct); else body.amountCents = parseArs(amount); }
    try {
      try { await api(`/api/visits/${visitId}/discounts`, { body }); }
      catch (e: any) { if (e.status !== 403) throw e; const p = await pin.ask(); if (!p) return; await api(`/api/visits/${visitId}/discounts`, { body: { ...body, supervisorPin: p } }); }
      toast('Aplicado'); onDone(); onClose();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <>
      <Modal title="Descuento o cortesía" open={open} onClose={onClose} footer={<><button onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !reason || (kind === 'cortesia' && !lineId)} onClick={submit}>Aplicar</button></>}>
        <div className="stack">
          <div className="row"><button className="chip" aria-pressed={kind === 'descuento'} onClick={() => setKind('descuento')}>Descuento</button><button className="chip" aria-pressed={kind === 'cortesia'} onClick={() => setKind('cortesia')}>Cortesía (ítem sin cargo)</button></div>
          <div className="field"><label htmlFor="dl">Sobre</label><select id="dl" value={lineId} onChange={(e) => setLineId(e.target.value)}><option value="">{kind === 'cortesia' ? 'Elegí el ítem…' : 'Toda la cuenta'}</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.qty}× {l.name} · {ars(l.unit_price_cents * l.qty)}</option>)}</select></div>
          {kind === 'descuento' && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="pct">Porcentaje</label><input id="pct" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, ''))} /></div>
            <MoneyInput id="damt" label="o importe" value={amount} onChange={setAmount} />
          </div>}
          <div className="field"><label htmlFor="dr">Motivo (obligatorio)</label><input id="dr" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
      </Modal>
      {pin.el}
    </>
  );
}

/** Diferencia de caja: siempre con su palabra, no solo con color. */
function Diff({ c }: { c: number }) {
  return <span className={`diff ${c < 0 ? 'is-short' : c > 0 ? 'is-over' : 'is-ok'}`}><Money c={c} /> <span className="diff-lbl">{c < 0 ? 'faltante' : c > 0 ? 'sobrante' : 'cuadra'}</span></span>;
}

/** Desglose del efectivo del cajón: de dónde sale el esperado. */
function CashBreakdown({ s }: { s: any }) {
  return (
    <section aria-label="Desglose del efectivo">
      <h3 className="rule-title">Desglose del efectivo</h3>
      <div className="totals">
        <span>Fondo inicial</span><Money c={s.totals.opening} />
        <span>+ Cobros en efectivo (neto)</span><Money c={s.totals.cashPayments} />
        <span>+ Propinas en efectivo</span><Money c={s.totals.cashTips} />
        <span>+ Ingresos</span><Money c={s.totals.ingresos} />
        <span>− Retiros</span><Money c={s.totals.retiros} />
        <span>− Gastos</span><Money c={s.totals.gastos} />
        <strong className="tot">Efectivo esperado</strong><strong className="num tot"><Money c={s.expected} /></strong>
      </div>
    </section>
  );
}

/** Ventas, cobros por medio, movimientos y mesas con saldo: lo secundario del turno, agrupado. */
function ShiftNumbers({ s }: { s: any }) {
  return (
    <div className="shift-more">
      <section aria-label="Ventas del turno">
        <h3 className="rule-title">Ventas</h3>
        <div className="totals">
          <span>Fecha operativa</span><span>{s.shift.operationalDate}</span>
          <span>Apertura</span><span>{dateAR(s.shift.openedAt)}</span>
          {s.shift.closedAt && <><span>Cierre</span><span>{dateAR(s.shift.closedAt)}</span></>}
          <span>Ventas del turno</span><Money c={s.ventas} />
          {s.envios > 0 && <><span>· incluye envíos</span><Money c={s.envios} /></>}
          <span>Anulaciones ({s.anulaciones})</span><Money c={s.anulado} />
          {s.descuentos.map((d: any) => <Fragment key={d.kind}><span>{d.kind === 'cortesia' ? 'Cortesías' : d.kind === 'tope' ? 'Ajuste por tope de descuentos' : 'Descuentos'}{d.kind !== 'tope' && ` (${d.n})`}</span><Money c={d.total} /></Fragment>)}
        </div>
      </section>
      <section aria-label="Cobros por medio">
        <h3 className="rule-title">Cobros por medio</h3>
        {!s.byMethod.length ? <p className="empty-line">Todavía no hay cobros en este turno.</p> : (
          <div className="table-wrap"><table><thead><tr><th>Medio</th><th className="right">Cobrado</th><th className="right">Devuelto</th><th className="right">Propinas</th></tr></thead>
            <tbody>{s.byMethod.map((m: any) => <tr key={m.method}><td>{METHOD[m.method] ?? m.method} ({m.n})</td><td className="right"><Money c={m.cobrado ?? 0} /></td><td className="right"><Money c={m.devuelto} /></td><td className="right"><Money c={m.propinas} /></td></tr>)}</tbody></table></div>
        )}
      </section>
      {s.openVisits.length > 0 && <section aria-label="Mesas con saldo">
        <h3 className="rule-title">Mesas abiertas <span className="muted">{s.openVisits.length}</span></h3>
        <table><tbody>{s.openVisits.map((v: any) => <tr key={v.id}><td>Mesa {v.tables}</td><td className="right"><Money c={v.due} /></td></tr>)}</tbody></table>
      </section>}
    </div>
  );
}

function Moves({ s, onAdd }: { s: any; onAdd?: (kind: string) => void }) {
  return (
    <section aria-label="Movimientos de efectivo">
      <div className="rule-title"><span>Movimientos de efectivo</span>
        {onAdd && <span className="row">
          <button className="small" onClick={() => onAdd('gasto')}>Registrar gasto</button>
          <button className="small" onClick={() => onAdd('retiro')}>Retiro de efectivo</button>
          <button className="small" onClick={() => onAdd('ingreso')}>Ingreso de efectivo</button>
        </span>}
      </div>
      {!s.moves.length ? <p className="empty-line">Sin gastos, retiros ni ingresos.</p> : (
        <table><tbody>{s.moves.map((m: any) => <tr key={m.id}><td className="num">{hhmm(m.at)}</td><td>{{ gasto: 'Gasto', retiro: 'Retiro', ingreso: 'Ingreso' }[m.kind as string] ?? m.kind} · {m.reason} <span className="muted small">{m.by_name}</span></td><td className="right"><Money c={m.amount_cents} /></td></tr>)}</tbody></table>
      )}
    </section>
  );
}

/** Turno cerrado (historial o recién cerrado): arqueo arriba, desglose al lado, el resto debajo. */
function Summary({ s }: { s: any }) {
  return (
    <div className="stack-lg">
      <div className="arqueo">
        <div className="arqueo-figs">
          <div className="fig"><span className="lbl">Efectivo esperado</span><strong className="fig-val"><Money c={s.expected} /></strong></div>
          <div className="fig"><span className="lbl">Efectivo contado</span><strong className="fig-val">{s.counted != null ? <Money c={s.counted} /> : '—'}</strong></div>
          <div className="fig"><span className="lbl">Diferencia</span><strong className="fig-val">{s.counted != null ? <Diff c={s.difference} /> : '—'}</strong></div>
        </div>
        <CashBreakdown s={s} />
      </div>
      <Moves s={s} />
      <ShiftNumbers s={s} />
    </div>
  );
}

function Shift() {
  const toast = useToast();
  const pin = usePin();
  const cur = useLoad(() => api('/api/shifts/current'));
  useLive(['cash', 'floor'], cur.reload);
  const [opening, setOpening] = useState('');
  const [counted, setCounted] = useState('');
  const [move, setMove] = useState<{ kind: string; amount: string; reason: string } | null>(null);
  const [closed, setClosed] = useState<any>(null);
  if (cur.error) return <ErrorBox error={cur.error} retry={cur.reload} />;
  if (cur.loading && !cur.data) return <Loading />; // sin turno abierto data queda en null: no es «cargando»
  const s = cur.data;
  const open = async () => { try { await api('/api/shifts/open', { body: { openingCents: parseArs(opening) } }); cur.reload(); setClosed(null); } catch (e: any) { toast(e.message, true); } };
  const close = async () => {
    const c = parseArs(counted);
    if (!confirm(`¿Cerrar la caja con ${ars(c)} contados? Esperado: ${ars(s.expected)}.`)) return;
    try { const r = await api('/api/shifts/close', { body: { shiftId: s.shift.id, countedCents: c } }); setClosed(r); setCounted(''); cur.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const saveMove = async () => {
    const body: any = { kind: move!.kind, amountCents: parseArs(move!.amount), reason: move!.reason };
    try {
      try { await api('/api/cash-moves', { body }); } catch (e: any) { if (e.status !== 403) throw e; const p = await pin.ask(); if (!p) return; await api('/api/cash-moves', { body: { ...body, supervisorPin: p } }); }
      setMove(null); cur.reload(); toast('Movimiento registrado');
    } catch (e: any) { toast(e.message, true); }
  };
  const countedC = counted ? parseArs(counted) : NaN;
  return (
    <div className="stack-lg">
      {closed && <section className={`closed-note${closed.difference ? ' has-diff' : ''}`} aria-label="Caja cerrada">
        <h2>Caja cerrada</h2>
        <p>Diferencia: <strong><Money c={closed.difference} /></strong>. <a href={`/api/export/cobros?shift=${closed.shift.id}`}>Exportar cobros</a> · <a href={`/api/export/movimientos?shift=${closed.shift.id}`}>Exportar movimientos</a></p>
        <Summary s={closed} />
      </section>}
      {!s ? (
        <section className="open-shift" aria-label="Abrir caja">
          <h2>Abrir caja</h2>
          <p className="muted">Contá el efectivo con el que arranca el turno. Desde ese momento se registran cobros, gastos y retiros.</p>
          <MoneyInput id="opening" label="Fondo inicial en efectivo" value={opening} onChange={setOpening} autoFocus />
          <button className="primary big" onClick={open} disabled={!opening}>Abrir caja</button>
        </section>
      ) : (
        <>
          <div className="arqueo">
            <section className="arqueo-main" aria-label="Arqueo y cierre">
              <h2 className="rule-title">Arqueo y cierre <span className="muted">turno abierto {dateAR(s.shift.openedAt)}</span></h2>
              <div className="arqueo-figs">
                <div className="fig"><span className="lbl">Efectivo esperado</span><strong className="fig-val"><Money c={s.expected} /></strong></div>
                <div className="fig fig-input"><MoneyInput id="counted" label="Efectivo contado" value={counted} onChange={setCounted} /></div>
                <div className="fig" aria-live="polite"><span className="lbl">Diferencia</span><strong className="fig-val">{Number.isFinite(countedC) ? <Diff c={countedC - s.expected} /> : <span className="fig-wait">Cargá lo contado</span>}</strong></div>
              </div>
              <div className="arqueo-act">
                <button className="primary big" disabled={!counted} onClick={close}>Cerrar caja</button>
                <span className="small muted">Al cerrar se guarda el arqueo y queda en el historial con sus exportaciones.</span>
              </div>
            </section>
            <CashBreakdown s={s} />
          </div>
          <Moves s={s} onAdd={(kind) => setMove({ kind, amount: '', reason: '' })} />
          <details className="more-block">
            <summary>Ventas, cobros por medio y mesas abiertas</summary>
            <ShiftNumbers s={s} />
          </details>
        </>
      )}
      <Modal title={move ? { gasto: 'Gasto', retiro: 'Retiro de efectivo', ingreso: 'Ingreso de efectivo' }[move.kind]! : ''} open={!!move} onClose={() => setMove(null)} footer={<button className="primary" disabled={!move?.amount || !move?.reason} onClick={saveMove}>Registrar</button>}>
        {move && <div className="stack"><MoneyInput id="mv-amount" label="Importe" value={move.amount} onChange={(v) => setMove({ ...move, amount: v })} autoFocus />
          <div className="field"><label htmlFor="mv-reason">Motivo</label><input id="mv-reason" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} /></div>
          {move.kind === 'retiro' && <p className="small muted">Un retiro requiere autorización de encargado.</p>}</div>}
      </Modal>
      {pin.el}
    </div>
  );
}

function ShiftDetail({ id }: { id: number }) {
  const s = useLoad(() => api(`/api/shifts/${id}`), [id]);
  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return <Loading />;
  return (
    <div className="stack-lg">
      <div className="spread"><Link to="/app/caja/historial">← Historial</Link>
        <span className="row"><a className="btn" href={`/api/export/cobros?shift=${id}`}>Exportar cobros CSV</a><a className="btn" href={`/api/export/movimientos?shift=${id}`}>Exportar movimientos CSV</a></span></div>
      <Summary s={s.data} />
    </div>
  );
}

function History() {
  const tickets = useLoad(() => api('/api/tickets'));
  const shifts = useLoad(() => api('/api/shifts'));
  return (
    <div className="stack-lg">
      <section aria-label="Turnos">
        <div className="rule-title"><span>Turnos de caja</span>
          <span className="row"><a className="btn small" href="/api/export/turnos">Exportar turnos CSV</a><a className="btn small" href="/api/export/cobros">Todos los cobros CSV</a></span></div>
        {!shifts.data ? <Loading /> : !shifts.data.length ? <p className="empty-line">Todavía no hay turnos.</p> : (
          <div className="table-wrap"><table className="ledger">
            <thead><tr><th>Turno</th><th>Apertura</th><th className="hide-sm">Cierre</th><th className="right hide-sm">Esperado</th><th className="right hide-sm">Contado</th><th className="right">Diferencia</th></tr></thead>
            <tbody>{shifts.data.map((s: any) => (
              <tr key={s.id} className={s.difference ? 'has-diff' : undefined}>
                <td><Link to={`/app/caja/turno/${s.id}`}>#{s.id}</Link> {s.status === 'open' && <span className="pill st-open">Abierto</span>}</td>
                <td className="num">{dateAR(s.opened_at)}</td>
                <td className="num hide-sm">{s.closed_at ? <>{dateAR(s.closed_at)}<div className="small muted">{s.closed_by_name}</div></> : '—'}</td>
                <td className="right hide-sm">{s.expected_cents == null ? '—' : <Money c={s.expected_cents} />}</td>
                <td className="right hide-sm">{s.counted_cents == null ? '—' : <Money c={s.counted_cents} />}</td>
                <td className="right">{s.difference == null ? '—' : <Diff c={s.difference} />}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </section>
      <section aria-label="Tickets internos">
        <h2 className="rule-title">Tickets internos</h2>
        {!tickets.data ? <Loading /> : !tickets.data.length ? <p className="empty-line">Todavía no hay tickets.</p> : (
          <div className="table-wrap"><table className="ledger"><thead><tr><th>N.º</th><th>Tipo</th><th>Dónde</th><th className="hide-sm">Fecha</th><th className="right">Total</th><th><span className="visually-hidden">Acciones</span></th></tr></thead>
            <tbody>{tickets.data.map((t: any) => <tr key={t.id}><td className="num">{String(t.number).padStart(6, '0')}</td><td>{t.kind === 'x' ? 'X' : 'Precuenta'}</td><td>{t.where}</td><td className="num hide-sm">{dateAR(t.created_at)}</td><td className="right"><Money c={t.total} /></td><td className="right"><a className="btn small" href={`/ticket/${t.id}?copia=1`} target="_blank" rel="noreferrer">Reimprimir</a></td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
