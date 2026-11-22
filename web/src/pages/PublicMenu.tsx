import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ars, hhmm, newOp, useLive, useLoad, useLocal, useToast } from '../lib.tsx';
import { ErrorBox, LineStatus, Loading, Modal, Money, Stepper } from '../ui.tsx';
import { ItemDialog, type DraftItem, type Sel } from './Picker.tsx';
import { Icon } from '../icons.tsx';
import { brandVars } from '../../../shared/color.ts';

const REVIEW_TEXT = '¿Cómo comiste hoy? Dejanos tu opinión en Google';
/** Un plato se agrega directo solo si no tiene nada para elegir. */
const isSimple = (p: any) => !p.options?.length && (p.kind === 'normal' || p.kind === 'combo');

export default function PublicMenu({ preview = false }: { preview?: boolean }) {
  const { slug, qr } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const isTable = !!qr;
  const d = useLoad(() => api(preview ? '/api/editor/preview' : isTable ? `/api/public/t/${qr}` : `/api/public/r/${slug}`), [slug, qr, preview]);
  const rslug = d.data?.restaurant.slug;
  useLive(['menu', 'diner'], d.reload, rslug && !preview ? `/api/public/r/${rslug}/events` : null);
  const [q, setQ] = useState('');
  const [cart, setCart] = useLocal<DraftItem[]>(`cart-${slug ?? qr ?? 'preview'}`, []);
  const [picking, setPicking] = useState<{ product: any; editKey?: string; initial?: Sel } | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [code, setCode] = useState('');
  const [joined, setJoined] = useLocal<boolean>(`joined-${qr}`, false);
  const [allergy, setAllergy] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [added, setAdded] = useState('');
  const navRef = useRef<HTMLDivElement>(null);

  // Categoría visible: se marca en la barra al desplazarse; arranca en la primera.
  const catIds = (d.data?.categories ?? []).map((c: any) => c.id).join(',');
  useEffect(() => {
    if (!catIds) return;
    const io = new IntersectionObserver((es) => { const e = es.find((x) => x.isIntersecting); if (e) setCurrent(Number(e.target.id.slice(4))); }, { rootMargin: '-80px 0px -65% 0px' });
    for (const id of catIds.split(',')) { const el = document.getElementById(`cat-${id}`); if (el) io.observe(el); }
    return () => io.disconnect();
  }, [catIds, q]); // oxlint-disable-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- q cambia qué secciones hay en pantalla
  const active = current ?? (catIds ? Number(catIds.split(',')[0]) : null);
  // La categoría activa queda a la vista dentro de la barra (solo se desplaza la barra, nunca la página).
  useEffect(() => {
    const bar = navRef.current, a = bar?.querySelector<HTMLElement>(`[href="#cat-${active}"]`);
    if (!bar || !a) return;
    // El buscador queda fijo a la izquierda: la categoría no debe quedar tapada por él.
    const br = bar.getBoundingClientRect(), ar = a.getBoundingClientRect(), edge = bar.firstElementChild!.getBoundingClientRect().right + 8;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (ar.left < edge) bar.scrollBy({ left: ar.left - edge, behavior });
    else if (ar.right > br.right - 16) bar.scrollBy({ left: ar.right - br.right + 16, behavior });
  }, [active]);

  // Terminó la visita = la mesa se cerró. Si solo cortaron los pedidos por QR, se vuelve a pedir el código.
  const visitEnded = isTable && joined && d.data && !d.data.visit && !d.data.tableOpen;
  if (d.error) return <main className="page"><ErrorBox error={d.error === 'No encontrado' ? 'No encontramos esta carta. Revisá el enlace.' : d.error} retry={d.reload} /></main>;
  if (!d.data) return <main className="page"><Loading /></main>;
  const r = d.data.restaurant;
  const s = r.settings;
  const b = r.brand ?? {};
  const table = d.data.table;
  // En la mesa se puede armar el carrito siempre; para enviarlo hace falta el código del mozo (se pide al confirmar).
  const canCart = !preview && (isTable ? s.mode === 'orders' : (s.takeaway || s.delivery));
  const norm = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const products = d.data.products.filter((p: any) => !q || norm(p.name + ' ' + p.description).includes(norm(q)));
  const dish = s.features?.daily_menu && s.dish_of_day ? d.data.products.find((p: any) => p.id === s.dish_of_day) : null;
  const total = cart.reduce((t, i) => t + i.unit * i.sel.qty, 0);
  const count = cart.reduce((t, i) => t + i.sel.qty, 0);
  const paused = s.delivery_paused_until && new Date(s.delivery_paused_until) > new Date();
  const wa = String(s.whatsapp_phone ?? '').replace(/\D/g, '');
  const tableLabel = table ? `Mesa ${table.number}${table.area ? ` · ${table.area}` : ''}` : '';
  const hasContact = s.address || s.last_order || b.phone || wa || b.instagram || (isTable && s.hours);

  const join = async (c = code) => {
    try { await api(`/api/public/t/${qr}/join`, { body: { code: c } }); setJoined(true); await d.reload(); return true; } catch (e: any) { toast(e.message, true); return false; }
  };
  const call = async (reason: string, detail = '') => {
    try { const c = await api(`/api/public/t/${qr}/call`, { body: { reason, detail } }); toast(c.taps > 1 ? 'Ya avisamos: ya vienen a la mesa.' : 'Listo, avisamos al equipo.'); d.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const put = (item: DraftItem, editKey?: string) => {
    setCart(editKey ? cart.map((x) => (x.key === editKey ? { ...item, key: editKey } : x)) : [...cart, item]);
    if (!editKey) setAdded(`Agregaste ${item.label}. Tenés ${count + item.sel.qty} en el pedido.`);
  };
  const add = (p: any) => {
    if (isSimple(p)) put({ key: newOp(), sel: { productId: p.id, qty: 1 }, label: p.name, detail: '', unit: p.price_cents });
    else setPicking({ product: p });
  };
  const edit = (i: DraftItem) => {
    const p = d.data.products.find((x: any) => x.id === i.sel.productId);
    if (p) setPicking({ product: p, editKey: i.key, initial: i.sel });
  };
  const addBtn = (p: any) => !p.available ? <span className="soldout-tag">Agotado</span>
    : !canCart ? null
    : isSimple(p) ? <button className="add" onClick={() => add(p)} aria-label={`Agregar ${p.name}`}><Icon name="plus" />Agregar</button>
    : <button className="add" onClick={() => add(p)} aria-label={`Elegir opciones de ${p.name}`}>Elegir opciones</button>;

  return (
    <div className={`menu${preview ? ' is-preview' : ''}`} data-theme={r.theme} data-style={b.style ?? 'clasica'} data-paper={b.paper ?? 'marfil'} style={brandVars(b.color ?? '#1f4d3a', b.paper ?? 'marfil') as React.CSSProperties}>
      {preview && <div className="preview-flag">Vista previa · todavía no está publicada</div>}
      {b.cover && <div className="m-cover"><img src={`/uploads/${b.cover}`} alt="" fetchPriority="high" /></div>}
      <div className="m-wrap">
        <header className="m-head">
          <div className="m-id">
            {b.logo && <img className="m-logo" src={`/uploads/${b.logo}`} alt={`Logo de ${r.name}`} />}
            <div className="m-id-text">
              <h1 className="m-name">{r.name}</h1>
              {s.tagline && <p className="m-tag">{s.tagline}</p>}
            </div>
          </div>

          {/* Contexto: en la mesa, cuál es; en la carta general, cómo se puede pedir. */}
          <div className="m-context">
            {isTable ? <p className="m-chip is-table"><Icon name="salon" />{tableLabel}</p> : <>
              {s.hours && <p className="m-chip"><Icon name="clock" />{s.hours}</p>}
              {s.takeaway && <p className="m-chip"><Icon name="bag" />Retiro en el local</p>}
              {s.delivery && <p className={`m-chip${paused ? ' is-off' : ''}`}><Icon name="bike" />{paused ? `Delivery pausado hasta las ${hhmm(s.delivery_paused_until)}` : 'Delivery propio'}</p>}
              {d.data.reservations && <Link className="m-chip is-link" to={`/reservar/${r.slug}`}><Icon name="reservas" />Reservar mesa</Link>}
            </>}
          </div>

          {hasContact && (
            <details className="m-about">
              <summary><span>Horarios, dirección y contacto</span><Icon name="down" /></summary>
              <ul className="m-info">
                {isTable && s.hours && <li><Icon name="clock" />{s.hours}</li>}
                {s.address && <li><Icon name="pin" />{s.address}</li>}
                {s.last_order && <li><Icon name="clock" />Última hora de pedidos {s.last_order}</li>}
                {b.phone && <li><Icon name="phone" /><a href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}>{b.phone}</a></li>}
                {wa && <li><Icon name="chat" /><a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a></li>}
                {b.instagram && <li><Icon name="insta" /><a href={`https://instagram.com/${encodeURIComponent(b.instagram)}`} target="_blank" rel="noreferrer">@{b.instagram}</a></li>}
              </ul>
            </details>
          )}
        </header>

        {isTable && !preview && <TableBox s={s} data={d.data} visitEnded={!!visitEnded} slug={r.slug} code={code} setCode={setCode} join={join} call={call} onAllergy={() => setAllergy('')} />}
      </div>

      <nav className="m-nav" aria-label="Categorías">
        <div className="m-nav-in" ref={navRef}>
          <label className={`m-find${q ? ' has-q' : ''}`}><Icon name="search" /><span className="visually-hidden">Buscar en la carta</span>
            <input type="search" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {d.data.categories.filter((c: any) => !q || products.some((p: any) => p.category_id === c.id)).map((c: any) => <a key={c.id} className="m-cat" href={`#cat-${c.id}`} aria-current={active === c.id ? 'true' : undefined} onClick={() => setCurrent(c.id)}>{c.name}</a>)}
        </div>
      </nav>

      <main className="m-wrap m-body">
        {dish && !q && <div className="m-feature"><div><div className="lbl">Plato del día</div><strong>{dish.name}</strong></div><span className="price num"><Money c={dish.price_cents} /></span></div>}
        <div className="m-sections">
          {d.data.categories.map((c: any) => {
            const list = products.filter((p: any) => p.category_id === c.id);
            if (!list.length) return null;
            return (
              <section key={c.id} id={`cat-${c.id}`} className="m-section" aria-labelledby={`h-${c.id}`}>
                <h2 id={`h-${c.id}`}>{c.name}</h2>
                <div className="m-list">
                  {list.map((p: any) => {
                    const sug = p.suggestion_id && d.data.products.find((x: any) => x.id === p.suggestion_id && x.available);
                    const extras = p.options?.filter((o: any) => o.price_delta_cents > 0) ?? [];
                    const hasMeta = p.tags?.length > 0 || p.allergens || extras.length > 0 || sug;
                    return (
                      <article key={p.id} className={`dish${p.photo ? ' has-photo' : ''}${p.available ? '' : ' soldout'}`}>
                        {p.photo && <img className="photo" src={`/uploads/${p.photo}`} alt={p.name} loading="lazy" decoding="async" width={400} height={300} />}
                        <div className="dish-top"><h3>{p.name}</h3><span className="lead" aria-hidden /><span className="price">{ars(p.price_cents)}</span></div>
                        {(p.description || p.kind === 'combo' || hasMeta) && <div className="dish-body">
                          {p.description && <p className="desc">{p.description}</p>}
                          {p.kind === 'combo' && <p className="desc">Incluye {[...p.components.map((x: any) => `${x.qty > 1 ? `${x.qty} ` : ''}${x.name}`), ...[...new Set(p.options.filter((o: any) => o.item_id).map((o: any) => o.grp))].map((g) => `${String(g).toLowerCase()} a elección`)].join(' + ')}{p.savings_cents > 0 && <> · <span className="save">Ahorrás {ars(p.savings_cents)}</span></>}</p>}
                          {hasMeta && <div className="meta">
                            {p.tags.map((t: string) => <span key={t} className="tag">{t}</span>)}
                            {p.allergens && <span>Contiene: {p.allergens}</span>}
                            {extras.length > 0 && <span className="muted">Extras desde {ars(Math.min(...extras.map((o: any) => o.price_delta_cents)))}</span>}
                            {sug && <span>Va bien con: {sug.name}</span>}
                          </div>}
                        </div>}
                        {(canCart || !p.available) && <div className="dish-act">{addBtn(p)}</div>}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        {!products.length && <p className="m-empty">No encontramos platos con «{q}». <button className="link-btn" onClick={() => setQ('')}>Ver toda la carta</button></p>}
        <footer className="m-foot">
          {!isTable && <p>Los precios son finales en pesos. La información de ingredientes la carga el local; ante cualquier duda consultá al personal.</p>}
          {b.email && <p className="row"><Icon name="mail" /><a href={`mailto:${encodeURIComponent(b.email)}`}>{b.email}</a></p>}
        </footer>
      </main>

      <p className="visually-hidden" aria-live="polite">{added}</p>
      {canCart && count > 0 && (
        <div className="cartbar" role="region" aria-label="Carrito">
          <button className="cartbar-btn" onClick={() => setCheckout(true)}>
            <span className="cart-count num" key={count} aria-label={`${count} ${count === 1 ? 'ítem' : 'ítems'}`}>{count}</span>
            <span className="cart-cta">{isTable ? 'Revisar y pedir' : 'Ver pedido'}</span>
            <span className="num cart-total">{ars(total)}</span>
          </button>
        </div>
      )}

      <ItemDialog product={picking?.product ?? null} initial={picking?.initial} products={d.data.products} rule={s.pizza_rule} publicMode onClose={() => setPicking(null)}
        onAdd={(sel, est) => { put({ key: newOp(), sel, label: est.label, detail: est.detail, unit: est.unit }, picking?.editKey); setPicking(null); }} />
      {checkout && <Checkout isTable={isTable} qr={qr} tableLabel={tableLabel} data={d.data} cart={cart} setCart={setCart} onEdit={edit} join={join} onClose={() => setCheckout(false)} onDone={(token: string | null) => { setCart([]); if (token) { setCheckout(false); nav(`/pedido/${token}`); } else d.reload(); }} />}
      <Modal title="Aviso de alergia" open={allergy !== null} onClose={() => setAllergy(null)} footer={<button className="primary" disabled={!allergy} onClick={() => { call('alergia', allergy!); setAllergy(null); }}>Avisar al mozo</button>}>
        <div className="field"><label htmlFor="al">¿Qué alergia o intolerancia tenés?</label><input id="al" value={allergy ?? ''} onChange={(e) => setAllergy(e.target.value)} /></div>
        <p className="small muted">El mozo lo confirma con vos y lo destaca en cocina.</p>
      </Modal>
    </div>
  );
}

/** Lo que pasa en la mesa: cómo pedir, el código del mozo, llamados y lo ya pedido. */
function TableBox({ s, data, visitEnded, slug, code, setCode, join, call, onAllergy }: any) {
  if (visitEnded) return <section className="m-table-box" aria-label="Opinión"><ReviewCard slug={slug} url={s.google_review_url} /></section>;
  if (s.mode === 'menu') return null;
  if (!data.visit) {
    // Modo pedidos: se arma el carrito y el código se pide al enviar. Modo llamados: el código habilita llamar al mozo.
    if (s.mode === 'orders') return (
      <p className="m-note" role="status">{data.tableOpen
        ? <>Armá tu pedido y envialo desde acá. Al enviarlo te pedimos el código de la mesa{data.qrEnabled ? '.' : <>: pedile al personal que habilite los pedidos por QR.</>}</>
        : <>La mesa todavía no está abierta. Avisale al personal del local. Mientras tanto podés mirar la carta y armar tu pedido.</>}</p>
    );
    return data.tableOpen && data.qrEnabled ? (
      <section className="m-table-box" aria-label="Código de la mesa">
        <label htmlFor="code">Para llamar al mozo desde acá, ingresá el código de 6 números que te dio</label>
        <div className="row"><input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="num code-input" /><button className="primary" disabled={code.length !== 6} onClick={() => join()}>Confirmar</button></div>
      </section>
    ) : <p className="m-note" role="status">Podés mirar la carta. Cuando el mozo habilite la mesa vas a poder llamarlo desde acá.</p>;
  }
  return (
    <section className="m-table-box" aria-label="Acciones de la mesa">
      <div className="m-table-acts">
        <button className="primary" onClick={() => call('mozo')}>Llamar al mozo</button>
        <button onClick={() => call('cuenta')}>Pedir la cuenta</button>
        <button onClick={onAllergy}>Aviso de alergia</button>
      </div>
      {data.visit.calls.map((c: any) => <output key={c.reason} className="small" style={{ display: 'block' }}>{c.reason === 'cuenta' ? 'Pediste la cuenta' : c.reason === 'alergia' ? 'Avisaste una alergia' : 'Llamaste al mozo'} a las {hhmm(c.created_at)} · {c.status === 'ack' ? <strong>el mozo ya está en camino</strong> : 'esperando al mozo'}</output>)}
      {data.visit.lines.length > 0 && <details className="m-ordered"><summary>Lo que pidieron · <Money c={data.visit.total} /></summary>
        {data.visit.lines.map((l: any) => <div key={l.id} className="spread small" style={{ padding: '4px 0' }}><span>{l.qty}× {l.name}</span><LineStatus l={l} /></div>)}</details>}
    </section>
  );
}

function Checkout({ isTable, qr, tableLabel, data, cart, setCart, onEdit, join, onClose, onDone }: any) {
  const s = data.restaurant.settings;
  const deliveryPaused = s.delivery_paused_until && new Date(s.delivery_paused_until) > new Date();
  const [f, setF] = useLocal('checkout-contact', { channel: s.takeaway ? 'retiro' : 'delivery', name: '', phone: '', address: '', addressNotes: '', zoneId: '', notes: '', loyaltyOptIn: false });
  const [slot, setSlot] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [opId, setOpId] = useState(newOp());
  const [sent, setSent] = useState<{ number: number; at: string; lines: { name: string; qty: number }[] } | null>(null);
  const [tcode, setTcode] = useState('');
  const authorized = !!data.visit;
  const [busy, setBusy] = useState(false);
  // Tras un corte el servidor pudo haber recibido el pedido: se reenvía igual (mismo opId) antes de tocar el carrito, así no se pierde ni se duplica nada.
  const [netFail, setNetFail] = useState(false);
  const locked = busy || netFail;
  const [err, setErr] = useState('');
  // Ítems que cambiaron al intentar enviar (precio nuevo o agotado), para marcarlos en su línea.
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const slots = (data.slots ?? []).filter((x: any) => !x.past);
  const channel = deliveryPaused && f.channel === 'delivery' ? 'retiro' : f.channel;
  const items = cart.map((i: DraftItem) => i.sel);
  const key = JSON.stringify({ items, channel, zone: f.zoneId });
  const slugQ = data.restaurant.slug;
  // Depende de la clave serializada (contenido real del carrito), no de la identidad del array.
  useEffect(() => {
    const k = JSON.parse(key);
    if (isTable || !k.items.length) return;
    api(`/api/public/r/${slugQ}/quote`, { body: { items: k.items, channel: k.channel, zoneId: k.zone ? Number(k.zone) : undefined } }).then((q) => { setQuote(q); setErr(''); }).catch((e) => { setQuote(null); setErr(e.message); });
  }, [key, isTable, slugQ]);
  // Precios cambiados desde que se armó el carrito: se avisa antes de confirmar.
  const changed = useMemo(() => quote?.lines.filter((l: any, i: number) => cart[i] && l.unit !== cart[i].unit) ?? [], [quote, cart]);
  const setQty = (k: string, qty: number) => setCart(cart.map((i: DraftItem) => (i.key === k ? { ...i, sel: { ...i.sel, qty } } : i)));
  const submit = async () => {
    setBusy(true); setFlags({}); setRemoved([]); setNetFail(false);
    try {
      if (isTable) {
        if (!authorized && !(await join(tcode))) return;
        // expected: el precio que vio el cliente; si cambió o se agotó algo, el servidor lo devuelve antes de confirmar.
        const r = await api(`/api/public/t/${qr}/order`, { body: { opId, items, expected: cart.map((i: DraftItem) => i.unit) } });
        setSent({ number: r.round.number, at: r.round.at, lines: r.lines }); setOpId(newOp()); onDone(null);
      }
      else { const r = await api(`/api/public/r/${data.restaurant.slug}/orders`, { body: { opId, slot, items, ...f, channel, zoneId: f.zoneId ? Number(f.zoneId) : undefined } }); onDone(r.token); }
    } catch (e: any) {
      // El carrito queda intacto ante código incorrecto o corte de conexión: se corrige y se vuelve a enviar.
      setNetFail(e.status === 0);
      setErr(e.status === 0 ? 'Se cortó la conexión. Tu pedido sigue acá: envialo de nuevo antes de cambiarlo.' : e.message);
      if (e.data?.nextSlot) setSlot(e.data.nextSlot);
      if (e.data?.changes) {
        // Se actualiza el carrito con los precios nuevos y se quita lo agotado; el cliente revisa y vuelve a confirmar.
        const ch = e.data.changes as any[];
        const next: Record<string, string> = {};
        for (const c of ch) if (cart[c.index]) {
          if (!c.unavailable) next[cart[c.index].key] = `Precio nuevo: ${ars(c.after)} (antes ${ars(c.before)})`;
          else if (c.left > 0) next[cart[c.index].key] = `Quedan ${c.left}: ajustamos la cantidad`;
        }
        setFlags(next);
        setRemoved(ch.filter((c) => c.unavailable && !(c.left > 0)).map((c) => c.name));
        setErr('Algo cambió en la carta mientras armabas el pedido. Revisá y volvé a enviarlo.');
        // Precio nuevo: se actualiza. Stock parcial: se baja a lo que queda. Agotado: se quita.
        setCart(cart.map((i: DraftItem, idx: number) => { const c = ch.find((x) => x.index === idx); return !c ? i : !c.unavailable ? { ...i, unit: c.after } : c.left > 0 ? { ...i, sel: { ...i.sel, qty: c.left } } : null; }).filter(Boolean));
      }
    } finally { setBusy(false); }
  };
  const missing = isTable
    ? [!cart.length && 'algún plato', !authorized && data.tableOpen && data.qrEnabled && tcode.length !== 6 && 'el código de la mesa'].filter(Boolean)
    : [!cart.length && 'algún plato', !slot && 'el horario', !f.name && 'tu nombre', channel === 'delivery' && !f.phone && 'el teléfono', channel === 'delivery' && !f.zoneId && 'el barrio', channel === 'delivery' && !f.address && 'el domicilio'].filter(Boolean);
  const blocked = isTable ? !authorized && !(data.tableOpen && data.qrEnabled) : !quote || quote.unavailable.length > 0;
  const valid = !missing.length && !blocked;
  const shown = quote?.total ?? cart.reduce((t: number, i: DraftItem) => t + i.unit * i.sel.qty, 0);

  if (sent) return (
    <Modal title="Pedido enviado" open onClose={onClose} footer={<button className="primary big block" onClick={onClose}>Seguir mirando la carta</button>}>
      <div className="sent" role="status">
        <span className="sent-mark" aria-hidden><Icon name="check" /></span>
        <p className="sent-num">Comanda {sent.number}</p>
        <p className="sent-where">{tableLabel} · {hhmm(sent.at)}</p>
        <p style={{ margin: 0 }}>Ya llegó a cocina y barra, y el personal recibió el aviso.</p>
        <ul className="sent-lines">{sent.lines.map((l, i) => <li key={i}><span className="num">{l.qty}×</span> {l.name}</li>)}</ul>
        <p className="small muted" style={{ margin: 0 }}>Podés pedir otra ronda desde la carta cuando quieras.</p>
      </div>
    </Modal>
  );
  return (
    <Modal title="Tu pedido" open onClose={onClose} footer={<div className="checkout-foot">
      <div className="spread"><span className="checkout-total">Total</span><span className="checkout-total num">{ars(shown)}</span></div>
      {!valid && missing.length > 0 && <p className="small muted" style={{ margin: 0 }}>Para {isTable ? 'enviarlo' : 'confirmarlo'} falta {(missing as string[]).join(', ').replace(/, ([^,]*)$/, ' y $1')}.</p>}
      <button className="primary big block" disabled={!valid || busy} onClick={submit}>{busy ? 'Enviando…' : isTable ? 'Enviar pedido' : 'Confirmar pedido'}</button>
    </div>}>
      <div className="stack">
        {isTable && <p className="m-chip is-table"><Icon name="salon" />{tableLabel}</p>}
        {cart.length === 0 && <p className="muted">Tu carrito está vacío.</p>}
        {cart.length > 0 && <ul className="cart-lines">
          {cart.map((i: DraftItem) => (
            <li key={i.key} className={`cart-line${flags[i.key] ? ' is-changed' : ''}`}>
              <div className="cl-main">
                <strong>{i.label}</strong>
                {i.detail && <span className="small muted">{i.detail}</span>}
                {i.sel.note && <span className="small">«{i.sel.note}»</span>}
                {flags[i.key] && <span className="pill st-wait">{flags[i.key]}</span>}
              </div>
              <Money c={i.unit * i.sel.qty} className="cl-price" />
              <div className="cl-acts">
                <Stepper label={`cantidad de ${i.label}`} value={i.sel.qty} min={1} max={99} disabled={locked} onChange={(n) => setQty(i.key, n)} />
                <button className="ghost small" disabled={locked} onClick={() => onEdit(i)} aria-label={`Cambiar ${i.label}`}>Cambiar</button>
                <button className="ghost icon-btn" disabled={locked} aria-label={`Quitar ${i.label}`} onClick={() => setCart(cart.filter((x: DraftItem) => x.key !== i.key))}><Icon name="close" /></button>
              </div>
            </li>
          ))}
        </ul>}
        {removed.length > 0 && <p className="field-error" role="alert">Lo quitamos porque se agotó: {removed.join(', ')}.</p>}
        {changed.length > 0 && <p className="pill st-wait">Cambió el precio de {changed.map((l: any) => l.name).join(', ')}. El total ya está actualizado.</p>}
        {quote?.unavailable?.length > 0 && <p className="field-error" role="alert">Ya no hay: {quote.unavailable.join(', ')}. Quitalo para continuar.</p>}
        {!isTable && <>
          {s.takeaway && s.delivery && <div className="seg seg-fill" role="group" aria-label="Retiro o delivery">
            <button aria-pressed={channel === 'retiro'} onClick={() => setF({ ...f, channel: 'retiro' })}>Retiro en el local</button>
            <button aria-pressed={channel === 'delivery'} disabled={!!deliveryPaused} onClick={() => setF({ ...f, channel: 'delivery' })}>Delivery{deliveryPaused ? ' (pausado)' : ''}</button>
          </div>}
          <div className="field"><label htmlFor="slot">Horario</label><select id="slot" value={slot} onChange={(e) => setSlot(e.target.value)}><option value="">Elegí una franja…</option>{slots.map((x: any) => <option key={x.slot} value={x.slot} disabled={x.left <= 0}>{x.time}{x.left <= 0 ? ' · completa' : x.left <= 2 ? ` · quedan ${x.left}` : ''}</option>)}</select>
            {!slots.length && <span className="field-error">No quedan franjas para hoy.</span>}</div>
          <div className="field"><label htmlFor="cn">Nombre</label><input id="cn" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="cp">Teléfono {channel === 'retiro' && '(opcional)'}</label><input id="cp" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          {channel === 'delivery' && <>
            <div className="field"><label htmlFor="cz">Barrio</label><select id="cz" value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })}><option value="">Elegí…</option>{data.zones.map((z: any) => <option key={z.id} value={z.id}>{z.name} · envío {ars(z.fee_cents)}{z.min_cents ? ` · mínimo ${ars(z.min_cents)}` : ''}</option>)}</select></div>
            <div className="field"><label htmlFor="ca">Domicilio</label><input id="ca" autoComplete="street-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
            <div className="field"><label htmlFor="cai">Indicaciones (piso, timbre)</label><input id="cai" value={f.addressNotes} onChange={(e) => setF({ ...f, addressNotes: e.target.value })} /></div>
          </>}
          <div className="field"><label htmlFor="cno">Aclaraciones para el local</label><input id="cno" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          {s.features?.loyalty && f.phone && <label className="check small"><input type="checkbox" checked={f.loyaltyOptIn} onChange={(e) => setF({ ...f, loyaltyOptIn: e.target.checked })} /> Quiero sumar sellos por mis compras y recibir novedades del local (podés darte de baja cuando quieras).</label>}
          {quote?.fee > 0 && <div className="totals"><span>Subtotal</span><Money c={quote.subtotal} /><span>Envío</span><Money c={quote.fee} /></div>}
        </>}
        {isTable && !authorized && (data.tableOpen && data.qrEnabled ? (
          <div className="field code-field"><label htmlFor="tcode">Código de la mesa</label>
            <input id="tcode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="num code-input" value={tcode} onChange={(e) => setTcode(e.target.value.replace(/\D/g, ''))} />
            <span className="hint">Son 6 números. Se pide una sola vez por celular durante esta visita.</span></div>
        ) : <p className="pill st-wait" role="status">{data.tableOpen ? 'Todavía no habilitaron los pedidos por QR en esta mesa. Pedíselo al personal: te dan un código de 6 números.' : 'La mesa todavía no está abierta. Avisale al personal del local.'}</p>)}
        {isTable && <p className="small muted" style={{ margin: 0 }}>La comida va a cocina, las bebidas a barra y el personal recibe el aviso. Precios y disponibilidad se confirman al enviar.</p>}
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

export function ReviewCard({ slug, url }: { slug: string; url?: string }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <div className="card stack" aria-label="Opinión">
      <h2 style={{ margin: 0 }}>¡Gracias por venir!</h2>
      {url && <a className="btn primary big" href={url} target="_blank" rel="noreferrer">{REVIEW_TEXT}</a>}
      {!sent ? <>
        <label htmlFor="fb">¿Querés contarle algo al dueño en privado?</label>
        <textarea id="fb" value={text} onChange={(e) => setText(e.target.value)} />
        <button disabled={!text.trim()} onClick={async () => { try { await api(`/api/public/r/${slug}/feedback`, { body: { text } }); setSent(true); } catch (e: any) { toast(e.message, true); } }}>Enviar comentario privado</button>
      </> : <p style={{ margin: 0 }}>Recibimos tu comentario. {url && 'Si querés, también podés dejar tu opinión en Google con el botón de arriba.'}</p>}
    </div>
  );
}
