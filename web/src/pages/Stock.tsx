import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ars, can, dateAR, todayAR, useLoad, useMe, useToast } from '../lib.tsx';
import { ErrorBox, Loading, Modal, Money, MoneyInput } from '../ui.tsx';
import { contributionMargin, parseArs } from '../../../shared/money.ts';

const TABS: [string, string][] = [['insumos', 'Insumos'], ['recetas', 'Recetas'], ['compras', 'Compras y proveedores'], ['inventario', 'Inventario y merma'], ['margenes', 'Qué platos empujar'], ['prep', 'Preparación'], ['clientes', 'Clientes y opiniones']];
const U: Record<string, string> = { g: 'g', ml: 'ml', u: 'u' };
const qty = (n: number, u: string) => `${Number(n.toFixed(2)).toLocaleString('es-AR')} ${U[u]}`;

export default function Stock() {
  const { me } = useMe();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? (can(me, 'stock') ? 'insumos' : 'prep');
  return (
    <main className="page stack">
      <div className="page-head has-tabs"><h1>Stock, recetas y costos</h1></div>
      <div className="tabs" role="tablist" aria-label="Secciones de stock">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>
      {tab === 'insumos' && <Ingredients />}{tab === 'recetas' && <Recipes />}{tab === 'compras' && <Purchases />}{tab === 'inventario' && <Inventory />}
      {tab === 'margenes' && <Margins />}{tab === 'prep' && <Prep />}{tab === 'clientes' && <Customers />}
    </main>
  );
}

function Ingredients() {
  const toast = useToast();
  const ing = useLoad(() => api('/api/ingredients'));
  const sup = useLoad(() => api('/api/suppliers'));
  const [f, setF] = useState<any>(null);
  if (ing.error) return <ErrorBox error={ing.error} />;
  if (!ing.data) return <Loading />;
  const save = async () => {
    const body = { ...f, packCostCents: f.cost === '' ? null : parseArs(f.cost), items: f.kind === 'subreceta' ? f.items.filter((i: any) => i.ingredientId && i.qty) : undefined };
    try { await api('/api/ingredients', { body }); setF(null); ing.reload(); toast('Guardado'); } catch (e: any) { toast(e.message, true); }
  };
  const edit = (i: any) => setF({ id: i.id, name: i.name, unit: i.unit, kind: i.kind, packQty: i.pack_qty, cost: i.pack_cost_cents == null ? '' : (i.pack_cost_cents / 100).toString(), yieldPct: i.yield_pct, batchQty: i.batch_qty, supplierId: i.supplier_id ?? '', items: i.children.map((c: any) => ({ ingredientId: c.ingredient_id, qty: c.qty })) });
  return (
    <div className="stack">
      <button className="primary" style={{ alignSelf: 'start' }} onClick={() => setF({ name: '', unit: 'g', kind: 'insumo', packQty: 1000, cost: '', yieldPct: 100, batchQty: 1, supplierId: '', items: [] })}>+ Insumo, envase o subreceta</button>
      <div className="card table-wrap"><table>
        <thead><tr><th>Insumo</th><th>Presentación</th><th className="right">Costo</th><th className="right">Costo por unidad útil</th><th className="right">Stock</th><th><span className="visually-hidden">Acciones</span></th></tr></thead>
        <tbody>{ing.data.map((i: any) => (
          <tr key={i.id}><td><strong>{i.name}</strong> <span className="small muted">{i.kind}</span>{i.supplier && <div className="small muted">{i.supplier}</div>}</td>
            <td>{i.kind === 'subreceta' ? `rinde ${qty(i.batch_qty, i.unit)}` : qty(i.pack_qty, i.unit)}{i.yield_pct < 100 && <div className="small muted">rendimiento {i.yield_pct}%</div>}</td>
            <td className="right">{i.kind === 'subreceta' ? '—' : i.pack_cost_cents == null ? <span className="pill st-bad">Falta costo</span> : <><Money c={i.pack_cost_cents} />{i.variation_pct != null && <div className="small" style={{ color: i.variation_pct > 0 ? 'var(--bad)' : 'var(--ok)' }}>{i.variation_pct > 0 ? '+' : ''}{i.variation_pct}% vs. anterior</div>}<div className="small muted">{i.cost_updated_at && dateAR(i.cost_updated_at)}</div></>}</td>
            <td className="right">{i.unit_cost == null ? <span className="pill st-bad">Incompleto</span> : `${ars(Math.round(i.unit_cost * (i.unit === 'u' ? 1 : 1000)))} / ${i.unit === 'u' ? 'u' : i.unit === 'g' ? 'kg' : 'l'}`}</td>
            <td className="right num" style={i.stock_qty < 0 ? { color: 'var(--bad)' } : undefined}>{qty(i.stock_qty, i.unit)}</td>
            <td><button className="small" onClick={() => edit(i)}>Editar</button></td></tr>
        ))}</tbody></table></div>
      {f && <Modal title={f.id ? 'Editar insumo' : 'Nuevo insumo'} open onClose={() => setF(null)} footer={<button className="primary" onClick={save} disabled={!f.name}>Guardar</button>}>
        <div className="stack">
          <div className="field"><label htmlFor="in">Nombre</label><input id="in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="ik">Tipo</label><select id="ik" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="insumo">Insumo</option><option value="envase">Envase</option><option value="subreceta">Subreceta</option></select></div>
            <div className="field"><label htmlFor="iu">Unidad</label><select id="iu" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="g">gramos</option><option value="ml">mililitros</option><option value="u">unidades</option></select></div>
          </div>
          {f.kind !== 'subreceta' ? <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="field"><label htmlFor="ip">Presentación ({f.unit})</label><input id="ip" inputMode="decimal" value={f.packQty} onChange={(e) => setF({ ...f, packQty: e.target.value })} /></div>
            <MoneyInput id="ic" label="Costo de compra" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
            <div className="field"><label htmlFor="iy">Rendimiento útil %</label><input id="iy" inputMode="decimal" value={f.yieldPct} onChange={(e) => setF({ ...f, yieldPct: e.target.value })} /></div>
          </div> : <>
            <div className="field"><label htmlFor="ib">La preparación rinde ({f.unit})</label><input id="ib" inputMode="decimal" value={f.batchQty} onChange={(e) => setF({ ...f, batchQty: e.target.value })} /></div>
            <ItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} ingredients={ing.data.filter((x: any) => x.id !== f.id)} />
          </>}
          <div className="field"><label htmlFor="is">Proveedor</label><select id="is" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{(sup.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        </div>
      </Modal>}
    </div>
  );
}

function ItemsEditor({ items, onChange, ingredients }: { items: any[]; onChange: (i: any[]) => void; ingredients: any[] }) {
  return (
    <div className="stack">
      {items.map((it, k) => (
        <div key={k} className="row">
          <select aria-label="Insumo" value={it.ingredientId} onChange={(e) => onChange(items.map((x, j) => (j === k ? { ...x, ingredientId: Number(e.target.value) } : x)))} style={{ flex: 1, minWidth: 160 }}><option value="">Insumo…</option>{ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select>
          <input aria-label="Cantidad" inputMode="decimal" placeholder="Cantidad" value={it.qty} onChange={(e) => onChange(items.map((x, j) => (j === k ? { ...x, qty: e.target.value.replace(',', '.') } : x)))} style={{ width: 110 }} />
          <button className="ghost" aria-label="Quitar" onClick={() => onChange(items.filter((_, j) => j !== k))}>✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, { ingredientId: '', qty: '' }])}>+ Ingrediente</button>
    </div>
  );
}

function Recipes() {
  const toast = useToast();
  const menu = useLoad(() => api('/api/menu'));
  const ing = useLoad(() => api('/api/ingredients'));
  const [pid, setPid] = useState<number | null>(null);
  const rec = useLoad(() => (pid ? api(`/api/recipes/${pid}`) : Promise.resolve(null)), [pid]);
  const [items, setItems] = useState<any[] | null>(null);
  if (!menu.data || !ing.data) return <Loading />;
  const cur = items ?? rec.data?.detail.map((d: any) => ({ ingredientId: d.ingredientId, qty: d.qty })) ?? [];
  const save = async () => { try { await api(`/api/recipes/${pid}`, { method: 'PUT', body: { items: cur.filter((i: any) => i.ingredientId && Number(i.qty) > 0) } }); setItems(null); rec.reload(); toast('Receta guardada'); } catch (e: any) { toast(e.message, true); } };
  return (
    <div className="split-2">
      <div className="card"><h2>Platos</h2>
        <div className="products">{menu.data.products.map((p: any) => <button key={p.id} className="prow" aria-pressed={pid === p.id} style={pid === p.id ? { background: 'var(--brand-soft)' } : undefined} onClick={() => { setPid(p.id); setItems(null); }}><span className="pname">{p.name}</span><Money c={p.price_cents} /></button>)}</div>
      </div>
      <div className="card stack">{!pid ? <p className="muted">Elegí un plato para cargar su receta.</p> : !rec.data ? <Loading /> : <>
        <h2 style={{ margin: 0 }}>{rec.data.product.name}</h2>
        <div className="totals">
          <span>Precio de venta</span><Money c={rec.data.product.price_cents} />
          <span>Costo por porción</span><span>{rec.data.detail.length ? <Money c={rec.data.cost} /> : '—'}</span>
          <strong>Margen estimado</strong><strong><Money c={rec.data.product.price_cents - rec.data.cost} /></strong>
        </div>
        {rec.data.detail.length > 0 && !rec.data.complete && <p className="pill st-bad">Estimación incompleta: faltan costos de {rec.data.detail.filter((d: any) => d.cost == null).map((d: any) => d.name).join(', ')}</p>}
        <table><tbody>{rec.data.detail.map((d: any) => <tr key={d.ingredientId}><td>{d.name}</td><td>{qty(d.qty, d.unit)}</td><td className="right">{d.cost == null ? 'sin costo' : <Money c={d.cost} />}</td><td className="small muted">{d.costDate ? dateAR(d.costDate) : ''}</td></tr>)}</tbody></table>
        <h3>Editar receta</h3>
        <ItemsEditor items={cur} onChange={setItems} ingredients={ing.data} />
        <button className="primary" onClick={save}>Guardar receta</button>
      </>}</div>
    </div>
  );
}

function Purchases() {
  const toast = useToast();
  const sup = useLoad(() => api('/api/suppliers'));
  const ing = useLoad(() => api('/api/ingredients'));
  const po = useLoad(() => api('/api/purchases'));
  const [s, setS] = useState({ name: '', phone: '' });
  const [order, setOrder] = useState<any>(null);
  const addSup = async () => { try { await api('/api/suppliers', { body: s }); setS({ name: '', phone: '' }); sup.reload(); } catch (e: any) { toast(e.message, true); } };
  const create = async () => { try { await api('/api/purchases', { body: { supplierId: Number(order.supplierId), items: order.items.filter((i: any) => i.ingredientId && i.qty).map((i: any) => ({ ingredientId: Number(i.ingredientId), qty: Number(i.qty), costCents: i.cost ? parseArs(i.cost) : null })) } }); setOrder(null); po.reload(); toast('Pedido de compra creado'); } catch (e: any) { toast(e.message, true); } };
  const receive = async (p: any) => { if (!confirm(`¿Recibir la compra #${p.id}? Suma stock y actualiza costos.`)) return; try { await api(`/api/purchases/${p.id}/receive`, { body: {} }); po.reload(); ing.reload(); toast('Compra recibida'); } catch (e: any) { toast(e.message, true); } };
  const name = (id: number) => ing.data?.find((i: any) => i.id === id);
  return (
    <div className="split-2">
      <div className="stack">
        <div className="card stack"><h2>Proveedores</h2>
          {(sup.data ?? []).map((x: any) => <div key={x.id}>{x.name} <span className="muted small">{x.phone}</span></div>)}
          <div className="row"><input aria-label="Proveedor" placeholder="Nombre" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} style={{ flex: 1 }} /><input aria-label="Teléfono" placeholder="Teléfono" value={s.phone} onChange={(e) => setS({ ...s, phone: e.target.value })} style={{ width: 140 }} /><button onClick={addSup} disabled={!s.name}>Agregar</button></div>
        </div>
        <button className="primary" style={{ alignSelf: 'start' }} disabled={!sup.data?.length} onClick={() => setOrder({ supplierId: sup.data[0].id, items: [{ ingredientId: '', qty: '', cost: '' }] })}>+ Pedido de compra</button>
      </div>
      <div className="card"><h2>Compras</h2>
        {(po.data ?? []).map((p: any) => <div key={p.id} className="stack" style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
          <div className="spread"><strong>#{p.id} · {p.supplier}</strong><span className={`pill ${p.status === 'recibido' ? 'st-ok' : 'st-wait'}`}>{p.status === 'recibido' ? `Recibido ${dateAR(p.received_at)}` : 'Pedido'}</span></div>
          <div className="small">{p.items.map((i: any) => `${name(i.ingredientId)?.name ?? '?'} ${qty(i.qty, name(i.ingredientId)?.unit ?? 'u')}${i.costCents != null ? ` · ${ars(i.costCents)}` : ''}`).join(' · ')}</div>
          {p.status === 'pedido' && <button style={{ alignSelf: 'start' }} onClick={() => receive(p)}>Registrar recepción</button>}
        </div>)}
      </div>
      {order && <Modal title="Pedido de compra" open onClose={() => setOrder(null)} footer={<button className="primary" onClick={create}>Crear</button>}>
        <div className="stack">
          <div className="field"><label htmlFor="ps">Proveedor</label><select id="ps" value={order.supplierId} onChange={(e) => setOrder({ ...order, supplierId: e.target.value })}>{sup.data.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          {order.items.map((it: any, k: number) => <div key={k} className="row">
            <select aria-label="Insumo" value={it.ingredientId} onChange={(e) => setOrder({ ...order, items: order.items.map((x: any, j: number) => (j === k ? { ...x, ingredientId: e.target.value } : x)) })} style={{ flex: 1, minWidth: 140 }}><option value="">Insumo…</option>{(ing.data ?? []).filter((i: any) => i.kind !== 'subreceta').map((i: any) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select>
            <input aria-label="Cantidad" placeholder="Cantidad" inputMode="decimal" value={it.qty} onChange={(e) => setOrder({ ...order, items: order.items.map((x: any, j: number) => (j === k ? { ...x, qty: e.target.value.replace(',', '.') } : x)) })} style={{ width: 100 }} />
            <input aria-label="Costo total" placeholder="Costo $" inputMode="decimal" value={it.cost} onChange={(e) => setOrder({ ...order, items: order.items.map((x: any, j: number) => (j === k ? { ...x, cost: e.target.value } : x)) })} style={{ width: 110 }} />
          </div>)}
          <button onClick={() => setOrder({ ...order, items: [...order.items, { ingredientId: '', qty: '', cost: '' }] })}>+ Ítem</button>
        </div>
      </Modal>}
    </div>
  );
}

function Inventory() {
  const toast = useToast();
  const ing = useLoad(() => api('/api/ingredients'));
  const moves = useLoad(() => api('/api/inventory/moves'));
  const waste = useLoad(() => api('/api/reports/waste'));
  const [f, setF] = useState({ ingredientId: '', kind: 'inventario', value: '', reason: '' });
  const save = async () => {
    const body: any = { ingredientId: Number(f.ingredientId), kind: f.kind, reason: f.reason };
    if (f.kind === 'inventario') body.counted = f.value; else if (f.kind === 'merma') body.qty = f.value; else body.delta = f.value;
    try { await api('/api/inventory', { body }); setF({ ...f, value: '', reason: '' }); ing.reload(); moves.reload(); waste.reload(); toast('Registrado'); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="split-2">
      <div className="stack">
        <div className="card stack"><h2>Registrar</h2>
          <div className="row" role="group">{[['inventario', 'Inventario contado'], ['merma', 'Merma'], ['ajuste', 'Ajuste']].map(([k, l]) => <button key={k} className="chip" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div>
          <div className="field"><label htmlFor="ii">Insumo</label><select id="ii" value={f.ingredientId} onChange={(e) => setF({ ...f, ingredientId: e.target.value })}><option value="">Elegí…</option>{(ing.data ?? []).map((i: any) => <option key={i.id} value={i.id}>{i.name} · hay {qty(i.stock_qty, i.unit)}</option>)}</select></div>
          <div className="field"><label htmlFor="iv">{f.kind === 'inventario' ? 'Cantidad contada' : f.kind === 'merma' ? 'Cantidad perdida' : 'Ajuste (+/−)'}</label><input id="iv" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.replace(',', '.') })} /></div>
          <div className="field"><label htmlFor="ir">{f.kind === 'merma' ? 'Causa (sobrante, devuelto, dañado, vencido…)' : 'Motivo'}</label><input id="ir" list="causas" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            <datalist id="causas"><option>Porción sobrante</option><option>Plato devuelto</option><option>Materia prima dañada</option><option>Vencido</option></datalist></div>
          <button className="primary" disabled={!f.ingredientId || !f.value || (f.kind !== 'inventario' && !f.reason)} onClick={save}>Registrar</button>
        </div>
        <div className="card"><h2>Merma por causa · 30 días</h2>
          {(waste.data ?? []).length === 0 ? <p className="muted">Sin mermas registradas.</p> : <table><tbody>{waste.data.map((w: any, i: number) => <tr key={i}><td>{w.reason}<div className="small muted">{w.name} · {w.veces} vez/veces</div></td><td>{qty(w.cantidad, w.unit)}</td><td className="right">{w.costo == null ? '—' : <Money c={w.costo} />}</td></tr>)}</tbody></table>}
        </div>
      </div>
      <div className="card table-wrap"><h2>Movimientos</h2>
        <table><tbody>{(moves.data ?? []).slice(0, 80).map((m: any) => <tr key={m.id}><td className="small">{dateAR(m.at)}</td><td>{m.name}<div className="small muted">{m.kind} · {m.reason}</div></td><td className="right num">{m.delta > 0 ? '+' : ''}{qty(m.delta, m.unit)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function Margins() {
  const [days, setDays] = useState(30);
  const r = useLoad(() => api(`/api/reports/menu?days=${days}`), [days]);
  const [sim, setSim] = useState<Record<number, { price: string; cost: string }>>({});
  if (r.error) return <ErrorBox error={r.error} />;
  if (!r.data) return <Loading />;
  const cats = [...new Set<string>(r.data.products.map((p: any) => p.category))];
  return (
    <div className="stack">
      <div className="card small">Compara platos de la misma categoría en el período: unidades vendidas y margen de contribución estimado (venta neta − costos variables cargados, con el costo histórico aplicado al vender). Si faltan costos, la estimación figura como incompleta. Podés simular otro precio o costo antes de publicarlo.
        <div className="row" style={{ marginTop: 8 }}>{[7, 30, 90].map((d) => <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>{d} días</button>)}</div></div>
      {cats.map((c) => {
        const ps = r.data.products.filter((p: any) => p.category === c);
        const avgUnits = ps.reduce((s: number, p: any) => s + p.units, 0) / ps.length;
        const avgMargin = ps.filter((p: any) => p.unit_margin != null).reduce((s: number, p: any, _: number, a: any[]) => s + p.unit_margin / a.length, 0);
        return (
          <section key={c} className="card table-wrap"><h2>{c}</h2>
            <table><thead><tr><th>Plato</th><th className="right">Unidades</th><th className="right">Venta neta</th><th className="right">Margen del período</th><th className="right">Margen por unidad</th><th>Sugerencia</th><th>Simular precio / costo</th></tr></thead>
              <tbody>{ps.map((p: any) => {
                const s = sim[p.id];
                const price = s?.price ? parseArs(s.price) : p.price_cents;
                const cost = s?.cost ? parseArs(s.cost) : p.current_cost;
                const simM = contributionMargin(price, [cost]);
                const popular = p.units >= avgUnits, rich = p.unit_margin != null && p.unit_margin >= avgMargin;
                const tip = p.unit_margin == null ? 'Cargá la receta para estimar' : popular && rich ? 'Destacar: se vende y deja margen' : popular ? 'Popular que deja poco: revisar precio o receta' : rich ? 'Deja margen: sugerirlo más' : 'Poco pedido y poco margen: evaluar';
                return (
                  <tr key={p.id}><td><strong>{p.name}</strong>{!p.cost_complete && p.current_cost != null && <div className="pill st-bad">Estimación incompleta: falta {p.missing.join(', ')}</div>}</td>
                    <td className="right num">{p.units}</td><td className="right"><Money c={p.revenue} /></td><td className="right">{p.cost ? <Money c={p.margin} /> : '—'}</td>
                    <td className="right">{p.unit_margin == null ? '—' : <Money c={p.unit_margin} />}<div className="small muted">precio {ars(p.price_cents)} − costo {p.current_cost == null ? '?' : ars(p.current_cost)}</div></td>
                    <td className="small">{tip}</td>
                    <td><div className="row" style={{ flexWrap: 'nowrap' }}><input aria-label={`Precio simulado de ${p.name}`} placeholder="Precio" inputMode="decimal" style={{ width: 90 }} value={s?.price ?? ''} onChange={(e) => setSim({ ...sim, [p.id]: { price: e.target.value, cost: s?.cost ?? '' } })} />
                      <input aria-label={`Costo simulado de ${p.name}`} placeholder="Costo" inputMode="decimal" style={{ width: 90 }} value={s?.cost ?? ''} onChange={(e) => setSim({ ...sim, [p.id]: { cost: e.target.value, price: s?.price ?? '' } })} /></div>
                      {s && (s.price || s.cost) && <div className="small">Margen simulado: <strong>{Number.isNaN(simM.margin) ? '—' : ars(simM.margin)}</strong>{!simM.complete && ' (incompleto)'}</div>}</td></tr>
                );
              })}</tbody></table>
          </section>
        );
      })}
    </div>
  );
}

function Prep() {
  const toast = useToast();
  const [day, setDay] = useState(todayAR(1));
  const r = useLoad(() => api(`/api/prep?date=${day}`), [day]);
  if (r.error) return <ErrorBox error={r.error} />;
  if (!r.data) return <Loading />;
  const save = async (p: any, v: string) => { try { await api('/api/prep', { method: 'PUT', body: { date: day, productId: p.id, qty: Number(v) } }); toast('Plan guardado'); } catch (e: any) { toast(e.message, true); } };
  const dow = new Date(`${day}T12:00:00-03:00`).toLocaleDateString('es-AR', { weekday: 'long' });
  return (
    <div className="stack">
      <div className="card spread"><span>Preparación para el <strong>{dow} {day}</strong> · reservas: <strong>{r.data.reservations.c}</strong> ({r.data.reservations.n} cubiertos)</span><input type="date" aria-label="Día" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 'auto' }} /></div>
      <div className="card table-wrap"><table>
        <thead><tr><th>Plato</th><th>Turnos comparables ({dow})</th><th className="right">Promedio</th><th className="right">A preparar</th></tr></thead>
        <tbody>{r.data.products.map((p: any) => (
          <tr key={p.id}><td><strong>{p.name}</strong><div className="small muted">{p.category}</div></td>
            <td className="small">{p.daysUsed ? p.history.map((h: any) => `${String(h.date).slice(5, 10)}: ${h.units}`).join(' · ') : <span className="muted">Sin historial: planificá a mano</span>}<div className="muted">{p.daysUsed} día(s) usados</div></td>
            <td className="right num">{p.avg ?? '—'}</td>
            <td className="right"><input aria-label={`Cantidad a preparar de ${p.name}`} type="number" min={0} defaultValue={p.plan ?? ''} placeholder={p.avg ?? ''} style={{ width: 90 }} onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== p.plan && save(p, e.target.value)} /></td></tr>
        ))}</tbody></table>
        <p className="small muted">El cocinero define la cantidad final. El promedio es una referencia, no una orden.</p></div>
    </div>
  );
}

function Customers() {
  const c = useLoad(() => api('/api/customers'));
  const f = useLoad(() => api('/api/feedback'));
  const { me } = useMe();
  const goal = me?.restaurant.settings.loyalty_goal ?? 10;
  return (
    <div className="split-2">
      <div className="card table-wrap"><h2>Fidelidad (adhesión voluntaria)</h2>
        {!c.data ? <Loading /> : !c.data.length ? <p className="muted">Nadie adhirió todavía.</p> : <table><thead><tr><th>Cliente</th><th>Sellos</th><th>Estado</th></tr></thead>
          <tbody>{c.data.map((x: any) => <tr key={x.id}><td>{x.name}<div className="small muted">{x.phone}</div></td><td className="num">{x.stamps} / {goal}</td><td>{x.opt_in ? <span className="pill st-ok">Adherido {dateAR(x.opt_in_at)}</span> : <span className="pill st-free">Baja {x.opt_out_at && dateAR(x.opt_out_at)}</span>}</td></tr>)}</tbody></table>}
        <p className="small muted">Los sellos dependen solo de compras entregadas, nunca de reseñas.</p></div>
      <div className="card"><h2>Comentarios privados</h2>{(f.data ?? []).map((x: any) => <p key={x.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>{x.text}<br /><span className="small muted">{dateAR(x.at)}</span></p>)}{f.data?.length === 0 && <p className="muted">Sin comentarios.</p>}</div>
    </div>
  );
}
