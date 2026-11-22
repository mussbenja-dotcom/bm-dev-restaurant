import { useMemo, useState } from 'react';
import { ars } from '../lib.tsx';
import { Modal, Money, Stepper } from '../ui.tsx';
import { Icon } from '../icons.tsx';
import { halvesPrice } from '../../../shared/money.ts';

export type Sel = { productId: number; qty: number; optionIds?: number[]; note?: string; seat?: string; hold?: boolean; halves?: number; halfExtras?: [number[], number[]]; dozen?: Record<string, number> };
export type DraftItem = { key: string; sel: Sel; label: string; detail: string; unit: number };

/** Precio estimado en pantalla; el servidor recalcula al confirmar. */
export function estimate(p: any, sel: Sel, products: any[], rule: string) {
  let unit = p.price_cents;
  const opt = (id: number, list = p.options) => list.find((o: any) => o.id === id);
  for (const id of sel.optionIds ?? []) unit += opt(id)?.price_delta_cents ?? 0;
  const parts: string[] = (sel.optionIds ?? []).map((id) => opt(id)?.name).filter(Boolean);
  let label = p.name;
  if (sel.halves) {
    const o = products.find((x) => x.id === sel.halves);
    unit = unit - p.price_cents + halvesPrice(p.price_cents, o.price_cents, rule === 'avg' ? 'avg' : 'max');
    label = `Pizza ½ ${p.name} · ½ ${o.name}`;
    for (const id of sel.halfExtras?.[0] ?? []) { unit += opt(id).price_delta_cents; parts.push(`+${opt(id).name} (mitad 1)`); }
    for (const id of sel.halfExtras?.[1] ?? []) { unit += opt(id, o.options).price_delta_cents; parts.push(`+${opt(id, o.options).name} (mitad 2)`); }
  }
  for (const [id, n] of Object.entries(sel.dozen ?? {})) if (n) { unit += (opt(Number(id))?.price_delta_cents ?? 0) * n; parts.push(`${n}× ${opt(Number(id))?.name}`); }
  if (sel.seat) parts.push(sel.seat);
  if (sel.hold) parts.push('esperar para marchar');
  return { label, detail: parts.join(' · '), unit };
}

export function ItemDialog({ product, products, rule, guests, allowHold, onClose, onAdd, publicMode = false, initial }: {
  product: any | null; products: any[]; rule: string; guests?: number; allowHold?: boolean; onClose: () => void; onAdd: (sel: Sel, est: ReturnType<typeof estimate>) => void; publicMode?: boolean;
  /** Selección ya hecha (editar un ítem del carrito): precarga cantidad, opciones y aclaración. */
  initial?: Sel;
}) {
  const p = product;
  const [qty, setQty] = useState(1);
  const [chosen, setChosen] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [seat, setSeat] = useState('');
  const [hold, setHold] = useState(false);
  const [half, setHalf] = useState<number | ''>('');
  const [e1, setE1] = useState<number[]>([]);
  const [e2, setE2] = useState<number[]>([]);
  const [dozen, setDozen] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');
  const key = p ? `${p.id}|${JSON.stringify(initial ?? null)}` : null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (key !== lastKey) {
    const i = initial;
    setLastKey(key); setQty(i?.qty ?? 1); setChosen(i?.optionIds ?? []); setNote(i?.note ?? ''); setSeat(i?.seat ?? ''); setHold(!!i?.hold);
    setHalf(i?.halves ?? ''); setE1(i?.halfExtras?.[0] ?? []); setE2(i?.halfExtras?.[1] ?? []); setDozen(i?.dozen ?? {}); setErr('');
  }
  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const o of p?.options ?? []) if (o.grp !== 'Gusto') (g[o.grp] ??= []).push(o);
    return Object.entries(g);
  }, [p]);
  if (!p) return null;
  const isHalves = p.kind === 'pizza' && half !== '';
  const pizzas = products.filter((x) => x.kind === 'pizza' && x.id !== p.id && x.available);
  const flavors = (p.options ?? []).filter((o: any) => o.grp === 'Gusto');
  const dozenCount = Object.values(dozen).reduce((s, n) => s + n, 0);
  const sel: Sel = {
    productId: p.id, qty, note: note.trim() || undefined, seat: seat || undefined, hold: hold || undefined,
    optionIds: isHalves ? chosen.filter((id) => !p.options.find((o: any) => o.id === id)?.multi) : chosen,
    ...(isHalves ? { halves: Number(half), halfExtras: [e1, e2] as [number[], number[]] } : {}),
    ...(p.kind === 'dozen' ? { dozen } : {}),
  };
  const est = estimate(p, sel, products, rule);
  const toggle = (o: any) => setChosen((c) => o.multi ? (c.includes(o.id) ? c.filter((x) => x !== o.id) : [...c, o.id]) : [...c.filter((x) => p.options.find((y: any) => y.id === x)?.grp !== o.grp), o.id]);
  const add = () => {
    for (const [g, opts] of groups) if (!opts[0].multi && !chosen.some((id) => opts.some((o: any) => o.id === id))) return setErr(`Elegí ${g.toLowerCase()}`);
    if (p.kind === 'dozen' && dozenCount !== 12) return setErr(`La docena lleva 12 unidades (llevás ${dozenCount})`);
    onAdd(sel, est);
  };
  const other = products.find((x) => x.id === half);
  return (
    <Modal title={p.name} open onClose={onClose} footer={publicMode
      // Carta: una sola acción ancha al alcance del pulgar, con el total que se suma.
      ? <button className="primary big block split-btn" onClick={add}><span>{initial ? 'Guardar cambios' : 'Agregar al pedido'}</span><span className="num">{ars(est.unit * qty)}</span></button>
      : <>
        <span style={{ marginRight: 'auto', fontWeight: 800, fontSize: '1.2rem' }} className="num">{ars(est.unit * qty)}</span>
        <button onClick={onClose}>Cancelar</button><button className="primary big" onClick={add}>{initial ? 'Guardar cambios' : 'Agregar'}</button></>}>
      <div className="stack">
        {p.description && <p className="muted" style={{ margin: 0 }}>{p.description}</p>}
        {p.allergens && <p className="small" style={{ margin: 0 }}><strong>Contiene:</strong> {p.allergens}</p>}
        {groups.filter(([, opts]) => !(isHalves && opts[0].multi)).map(([g, opts]) => (
          <fieldset key={g} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="opt-legend">{g} <span className="small muted">{opts[0].multi ? 'opcional' : 'elegí una'}</span></legend>
            <div className="opt-chips">{opts.map((o: any) => (
              <button key={o.id} type="button" className="chip" aria-pressed={chosen.includes(o.id)} disabled={o.available === false || (o.item_id && products.find((x) => x.id === o.item_id)?.available === false)} onClick={() => toggle(o)}>{o.name}{o.price_delta_cents > 0 && ` +${ars(o.price_delta_cents)}`}{(o.available === false || (o.item_id && products.find((x) => x.id === o.item_id)?.available === false)) && ' · agotado'}</button>
            ))}</div>
          </fieldset>
        ))}
        {p.kind === 'pizza' && (
          <div className="field">
            <label htmlFor="half">Mitad y mitad</label>
            <select id="half" value={half} onChange={(e) => setHalf(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Entera de {p.name}</option>
              {pizzas.map((x) => <option key={x.id} value={x.id}>½ {p.name} + ½ {x.name}</option>)}
            </select>
            {isHalves && <p className="small muted" style={{ margin: 0 }}>Precio por {rule === 'avg' ? 'promedio' : 'mayor precio'} de las mitades. Extras por mitad:</p>}
            {isHalves && [[p, e1, setE1], [other, e2, setE2]].map(([pp, ex, set]: any, i) => (
              <div key={i} className="row"><strong className="small">Mitad {i + 1} · {pp.name}:</strong>
                {pp.options.filter((o: any) => o.multi).map((o: any) => <button key={o.id} type="button" className="chip" aria-pressed={ex.includes(o.id)} onClick={() => set(ex.includes(o.id) ? ex.filter((x: number) => x !== o.id) : [...ex, o.id])}>{o.name} +{ars(o.price_delta_cents)}</button>)}
              </div>
            ))}
          </div>
        )}
        {p.kind === 'dozen' && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700 }}>Gustos <span className={dozenCount === 12 ? 'pill st-ok' : 'pill st-wait'}>{dozenCount} de 12</span></legend>
            {flavors.map((o: any) => (
              <div key={o.id} className="spread" style={{ padding: '4px 0' }}>
                <span>{o.name}{o.price_delta_cents > 0 && <span className="muted small"> · adicional {ars(o.price_delta_cents)} c/u</span>}</span>
                <Stepper label={o.name} value={dozen[o.id] ?? 0} max={12 - dozenCount + (dozen[o.id] ?? 0)} onChange={(n) => setDozen({ ...dozen, [o.id]: n })} />
              </div>
            ))}
          </fieldset>
        )}
        <div className="spread"><span>Cantidad</span><Stepper label="cantidad" value={qty} onChange={setQty} min={1} /></div>
        <div className="field"><label htmlFor="note">{publicMode ? 'Aclaración (opcional)' : 'Aclaración para cocina'}</label><input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: sin cebolla" maxLength={300} /></div>
        {!publicMode && guests && guests > 1 && (
          <div className="field"><label htmlFor="seat">Para</label>
            <select id="seat" value={seat} onChange={(e) => setSeat(e.target.value)}><option value="">Toda la mesa</option>{Array.from({ length: guests }, (_, i) => <option key={i} value={`Persona ${i + 1}`}>Persona {i + 1}</option>)}</select></div>
        )}
        {allowHold && p.course === 'principal' && <label className="check"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Esperar para marchar (sale cuando digas «Marchar principales»)</label>}
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/** Lista de platos con búsqueda, favoritos y categorías; muestra "quedan N" y agotados. */
export function Picker({ menu, onPick }: { menu: { categories: any[]; products: any[] }; onPick: (p: any) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | 'fav'>('fav');
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const list = menu.products.filter((p) => (q ? norm(p.name).includes(norm(q)) : cat === 'fav' ? p.favorite : p.category_id === cat));
  return (
    <div className="stack">
      <div className="field"><label htmlFor="search" className="visually-hidden">Buscar plato</label><input id="search" type="search" placeholder="Buscar plato o bebida…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!q && <div className="row" role="group" aria-label="Categorías">
        <button className="chip" aria-pressed={cat === 'fav'} onClick={() => setCat('fav')}><Icon name="star" />Favoritos</button>
        {menu.categories.map((c) => <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
      </div>}
      <div className="products">
        {!list.length && <p className="muted">Sin resultados.</p>}
        {list.map((p) => {
          const out = !p.available;
          return (
            <button key={p.id} className="prow" disabled={out} onClick={() => onPick(p)} aria-label={`${p.name}, ${ars(p.price_cents)}${out ? ', agotado' : ''}`}>
              <span><span className="pname">{p.name}</span>
                {out ? <span className="pill st-bad" style={{ marginLeft: 8 }}>Agotado</span> : p.stock_qty != null && <span className="pill st-wait" style={{ marginLeft: 8 }}>Quedan {p.stock_qty}</span>}
              </span>
              <Money c={p.price_cents} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
