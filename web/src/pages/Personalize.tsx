import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ars, useLoad, useMe, useToast } from '../lib.tsx';
import { ErrorBox, Loading, Modal, MoneyInput } from '../ui.tsx';
import { Icon } from '../icons.tsx';
import { brandVars, PAPERS, readableOn, type Paper } from '../../../shared/color.ts';
import { parseArs } from '../../../shared/money.ts';

// Personalizar mi restaurante: marca y carta en borrador, vista previa en celular y publicación en el mismo enlace y QR.

const PRESETS = ['#1f4d3a', '#a8231b', '#24456b', '#7a3e1d', '#5b3a8c', '#0f766e', '#c2410c', '#1c1a16'];
const PAPER_LABEL: Record<Paper, string> = { marfil: 'Marfil', blanco: 'Blanco', oscuro: 'Oscuro' };
const TABS = [['marca', 'Marca'], ['carta', 'Carta'], ['vista', 'Vista previa']] as const;

/** Achica la foto en el celular antes de subirla (menos datos móviles); el servidor la valida y comprime igual. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.86));
  } catch { return file; } // formato que el navegador no decodifica: lo valida el servidor
}
async function upload(url: string, file: File) {
  const fd = new FormData();
  fd.append('file', await shrink(file), 'foto.jpg');
  const r = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? 'No se pudo subir la imagen');
  return data;
}

export default function Personalize() {
  const { tab = 'marca' } = useParams();
  const navTo = useNavigate();
  const toast = useToast();
  const { me } = useMe();
  const brand = useLoad(() => api('/api/brand'));
  const menu = useLoad(() => api('/api/editor/menu'));
  const [rev, setRev] = useState(0); // fuerza a recargar la vista previa
  const [confirm, setConfirm] = useState<'publish' | 'discard' | null>(null);
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0); // al publicar o descartar, el formulario de marca vuelve a leer los datos
  const changed = () => { brand.reload(); menu.reload(); setRev((n) => n + 1); };

  if (brand.error || menu.error) return <div className="page"><ErrorBox error={(brand.error || menu.error)!} retry={changed} /></div>;
  if (!brand.data || !menu.data) return <div className="page"><Loading /></div>;
  const pending = brand.data.pending;
  const publicUrl = `${me!.publicUrl}/m/${brand.data.slug}`;

  const run = async (what: 'publish' | 'discard') => {
    setBusy(true);
    try {
      await api(`/api/editor/${what}`, { body: {} });
      toast(what === 'publish' ? 'Carta publicada: ya se ve en tu enlace y en los QR de las mesas.' : 'Descartaste los cambios sin publicar.');
      setConfirm(null); setRev((n) => n + 1); menu.reload();
      await brand.reload(); setEpoch((n) => n + 1);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };

  const preview = (
    <aside className="pz-preview stack" aria-label="Vista previa en celular">
      <div className="spread"><h2 style={{ margin: 0 }}>Así se ve en el celular</h2><button className="ghost small" onClick={() => setRev((n) => n + 1)}>Actualizar</button></div>
      <div className="phone">{/* oxlint-disable-next-line react/iframe-missing-sandbox -- es nuestra propia app (mismo origen); sandbox con scripts+mismo origen no aísla nada */}
        <iframe key={rev} src="/vista-previa" title="Vista previa de la carta en celular" /></div>
      <p className="small muted" style={{ textAlign: 'center' }}>Incluye los cambios sin publicar. Los comensales ven la versión publicada.</p>
    </aside>
  );

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>Personalizar mi restaurante</h1><div className="sub">Marca, carta y fotos. Nada cambia para tus clientes hasta que publiques.</div></div>
        <a className="btn" href={`/m/${brand.data.slug}`} target="_blank" rel="noreferrer"><Icon name="external" />Ver carta publicada</a>
      </div>

      <div className={`pz-status ${pending ? 'dirty' : ''}`} role="status">
        <span className="state">{pending ? <><Icon name="alert" />{pending === 1 ? '1 cambio sin publicar' : `${pending} cambios sin publicar`}</> : <><Icon name="check" />Todo publicado</>}</span>
        <span className="row">
          {pending > 0 && <button className="ghost" onClick={() => setConfirm('discard')}>Descartar</button>}
          <button className="primary" disabled={!pending} onClick={() => setConfirm('publish')}>Publicar cambios</button>
        </span>
      </div>

      <div className="tabs" role="tablist" aria-label="Secciones" style={{ margin: '16px 0' }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={k === 'vista' ? 'hide-xl' : ''} onClick={() => navTo(`/app/personalizar/${k}`)}>{l}</button>)}
      </div>

      <div className="pz">
        <div>
          {tab === 'marca' && <BrandEditor key={epoch} data={brand.data} onChange={changed} />}
          {tab === 'carta' && <MenuEditor data={menu.data} onChange={changed} />}
        </div>
        {/* Un solo iframe: al costado en pantallas anchas, como pestaña en el resto. */}
        <div className={tab === 'vista' ? '' : 'show-xl'}>{preview}</div>
      </div>

      <Modal title={confirm === 'publish' ? 'Publicar cambios' : 'Descartar cambios'} open={!!confirm} onClose={() => setConfirm(null)}
        footer={<><button onClick={() => setConfirm(null)}>Volver</button>
          {confirm === 'publish' ? <button className="primary" disabled={busy} onClick={() => run('publish')}>{busy ? 'Publicando…' : 'Publicar ahora'}</button>
            : <button className="danger" disabled={busy} onClick={() => run('discard')}>Descartar todo</button>}</>}>
        {confirm === 'publish' ? <div className="stack">
          <p>La carta se actualiza en <strong>{publicUrl}</strong> y en los QR que ya tenés impresos: no hace falta reimprimir nada.</p>
          <p className="small muted">Los precios nuevos se aplican a los pedidos que entren desde ahora. Las mesas y pedidos ya cargados conservan el precio con el que se pidieron.</p>
        </div> : <p>Se pierden los cambios sin publicar (marca, platos, fotos y orden). La carta publicada no cambia.</p>}
      </Modal>
    </main>
  );
}

/* ---------------- Marca ---------------- */

function BrandEditor({ data, onChange }: { data: any; onChange: () => void }) {
  const toast = useToast();
  const cur = data.draft ?? data.published;
  const [f, setF] = useState(() => ({ ...cur }));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const dirty = Object.keys(f).some((k) => k !== 'logo' && k !== 'cover' && (f[k] ?? '') !== (cur[k] ?? ''));
  const save = async () => {
    setSaving(true);
    try { await api('/api/brand', { method: 'PUT', body: f }); toast('Guardado en borrador. Revisá la vista previa y publicá cuando quieras.'); onChange(); }
    catch (e: any) { toast(e.message, true); } finally { setSaving(false); }
  };
  const img = async (kind: 'logo' | 'cover', file: File | null) => {
    try {
      if (file) { const r = await upload(`/api/brand/image/${kind}`, file); set(kind, r[kind]); }
      else { await api(`/api/brand/image/${kind}`, { method: 'DELETE' }); set(kind, null); }
      onChange();
    } catch (e: any) { toast(e.message, true); }
  };
  const bg = PAPERS[f.paper as Paper]?.bg ?? '#fff';
  const adjusted = readableOn(f.color, bg) !== f.color.toLowerCase();
  const text = (k: string, label: string, hint?: string, type = 'text') => (
    <div className="field"><label htmlFor={`b-${k}`}>{label}</label><input id={`b-${k}`} type={type} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />{hint && <span className="hint">{hint}</span>}</div>
  );
  return (
    <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Section title="Identidad" desc="Cómo te reconocen tus clientes en la carta, el enlace y los QR.">
        {text('name', 'Nombre comercial')}
        {text('tagline', 'Frase de presentación', 'Una línea, por ejemplo «Cocina de bodegón desde 1962».')}
        <ImageSlot label="Logo" hint="Cuadrado, PNG con fondo transparente o JPG. Se ve arriba del nombre." src={f.logo} onFile={(x) => img('logo', x)} />
        <ImageSlot label="Portada" hint="Foto horizontal del local o de un plato (se recorta en 16:9)." src={f.cover} wide onFile={(x) => img('cover', x)} />
      </Section>

      <Section title="Estilo de la carta" desc="Elegí cómo se presentan tus platos. Podés cambiarlo cuando quieras.">
        <div className="opt-cards" role="group" aria-label="Estilo">
          <StyleCard active={f.style === 'clasica'} onClick={() => set('style', 'clasica')} title="Clásica" desc="Lista elegante con precios alineados. Ideal para cartas largas y bodegones." f={f} kind="clasica" />
          <StyleCard active={f.style === 'moderna'} onClick={() => set('style', 'moderna')} title="Moderna" desc="Tarjetas con la foto protagonista. Ideal si tenés buenas fotos." f={f} kind="moderna" />
        </div>
      </Section>

      <Section title="Colores" desc="El color principal tiñe títulos, botones y la barra del pedido.">
        <div className="field">
          <span id="col-l" style={{ fontWeight: 600, fontSize: '.875rem' }}>Color principal</span>
          <div className="swatches" role="group" aria-labelledby="col-l">
            {PRESETS.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-pressed={f.color === c} aria-label={`Color ${c}`} onClick={() => set('color', c)} />)}
            <label className="row" style={{ fontWeight: 500 }}><input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} aria-label="Elegir otro color" /> Otro</label>
          </div>
          {adjusted && <span className="hint">Ese tono no se lee bien sobre el fondo elegido: en la carta usamos una versión más {bg === PAPERS.oscuro.bg ? 'clara' : 'oscura'} para títulos y precios (contraste 4,5:1 o más).</span>}
        </div>
        <div className="field">
          <span id="pap-l" style={{ fontWeight: 600, fontSize: '.875rem' }}>Fondo</span>
          <div className="seg" role="group" aria-labelledby="pap-l">
            {(Object.keys(PAPERS) as Paper[]).map((p) => <button type="button" key={p} aria-pressed={f.paper === p} onClick={() => set('paper', p)}>{PAPER_LABEL[p]}</button>)}
          </div>
        </div>
      </Section>

      <Section title="Datos de contacto" desc="Aparecen en la cabecera de la carta. Dejá vacío lo que no quieras mostrar.">
        <div className="fields-2">
          {text('hours', 'Horarios', 'Ej.: Martes a domingo · 12 a 15.30 y 20 a 0.30')}
          {text('address', 'Dirección')}
          {text('phone', 'Teléfono', undefined, 'tel')}
          {text('whatsapp_phone', 'WhatsApp (con código de país)', 'Ej.: 5491122334455', 'tel')}
          {text('instagram', 'Instagram', 'Usuario, sin @')}
          {text('email', 'Email', undefined, 'email')}
        </div>
      </Section>

      <div className="save-bar">
        <button className="primary big" disabled={saving || !dirty}>{saving ? 'Guardando…' : dirty ? 'Guardar en borrador' : 'Sin cambios para guardar'}</button>
      </div>
    </form>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return <section className="card stack"><div><h2 style={{ marginBottom: 4 }}>{title}</h2>{desc && <p className="small muted" style={{ margin: 0 }}>{desc}</p>}</div>{children}</section>;
}

function ImageSlot({ label, hint, src, wide, onFile }: { label: string; hint: string; src: string | null; wide?: boolean; onFile: (f: File | null) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const id = `img-${label}`;
  const pick = async (file: File | null) => { setBusy(true); try { await onFile(file); } finally { setBusy(false); } };
  return (
    <div className="imgslot">
      {src ? <img className={`prev ${wide ? 'wide' : ''}`} src={`/uploads/${src}`} alt={`${label} actual`} /> : <span className={`prev ${wide ? 'wide' : ''}`}><Icon name="image" /></span>}
      <div className="stack" style={{ minWidth: 0 }}>
        <div><strong>{label}</strong><div className="small muted">{hint}</div></div>
        <div className="row">
          <input id={id} type="file" accept="image/*" className="visually-hidden file-in" disabled={busy} onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) pick(x); }} />
          <label htmlFor={id} className="btn" aria-disabled={busy}><Icon name="camera" />{busy ? 'Subiendo…' : src ? 'Reemplazar' : 'Subir foto'}</label>
          {src && <button type="button" className="ghost" disabled={busy} onClick={() => pick(null)}>Quitar</button>}
        </div>
      </div>
    </div>
  );
}

function StyleCard({ active, onClick, title, desc, f, kind }: { active: boolean; onClick: () => void; title: string; desc: string; f: any; kind: 'clasica' | 'moderna' }) {
  const v = brandVars(f.color, f.paper) as any;
  const line = (w: string) => <span style={{ display: 'block', height: 6, width: w, borderRadius: 3, background: v['--menu-ink'], opacity: .25 }} />;
  return (
    <button type="button" className="opt-card" aria-pressed={active} onClick={onClick}>
      <span className="mini" aria-hidden style={{ background: v['--menu-bg'], padding: 10, display: 'grid', gap: 6, alignContent: 'start' }}>
        {kind === 'clasica' ? <>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 20, lineHeight: 1, color: v['--accent'] }}>Entradas</span>
          {[0, 1].map((i) => <span key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{line('40%')}<span style={{ flex: 1, borderBottom: `1.5px dotted ${v['--menu-ink']}`, opacity: .4 }} /><span style={{ width: 22, height: 6, borderRadius: 3, background: v['--accent'] }} /></span>)}
        </> : <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[0, 1].map((i) => <span key={i} style={{ display: 'grid', gap: 4 }}><span style={{ height: 34, borderRadius: 5, background: v['--brand'], opacity: .85 }} />{line('80%')}{line('50%')}</span>)}
        </span>}
      </span>
      <strong>{title}</strong><span>{desc}</span>
    </button>
  );
}

/* ---------------- Carta ---------------- */

function MenuEditor({ data, onChange }: { data: any; onChange: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [newCat, setNewCat] = useState('');
  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok); onChange(); } catch (e: any) { toast(e.message, true); } };
  const move = (kind: 'categories' | 'products', list: any[], i: number, dir: -1 | 1) => {
    const ids = list.map((x) => x.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    act(() => api('/api/editor/order', { body: { kind, ids } }));
  };
  const rename = (c: any) => { const name = prompt('Nuevo nombre de la categoría', c.name); if (name && name !== c.name) act(() => api('/api/editor/categories', { body: { id: c.id, name, visible: c.visible } })); };
  const avail = (p: any) => act(() => api(`/api/products/${p.id}/availability`, { body: { available: !p.available, stockQty: null } }), p.available ? `${p.name}: marcado agotado (ya se ve en la carta)` : `${p.name}: disponible de nuevo`);
  return (
    <div className="stack">
      <div className="card row">
        <input aria-label="Nombre de la nueva categoría" placeholder="Nueva categoría (ej. Para compartir)" value={newCat} onChange={(e) => setNewCat(e.target.value)} style={{ flex: '1 1 220px', width: 'auto' }} />
        <button disabled={!newCat.trim()} onClick={() => act(() => api('/api/editor/categories', { body: { name: newCat } }).then(() => setNewCat('')))}><Icon name="plus" />Agregar categoría</button>
        <button onClick={() => setEdit({ kind: 'combo' })}><Icon name="plus" />Nuevo combo</button>
        <Link className="btn ghost" to="/app/config/importar">Importar planilla</Link>
      </div>
      <p className="small muted" style={{ margin: 0 }}>«Agotado» se aplica al instante (es operativo). Todo lo demás queda en borrador hasta publicar.</p>
      {data.categories.map((c: any, ci: number) => {
        const items = data.products.filter((p: any) => p.category_id === c.id);
        return (
          <section key={c.id} className="cat-block" aria-label={`Categoría ${c.name}`}>
            <header className="cat-head">
              <h3>{c.name} {!c.visible && <span className="pill st-free">Oculta</span>}{c.pending && <span className="pill st-new">{c.isNew ? 'Nueva' : 'Con cambios'}</span>}</h3>
              <span className="item-acts">
                <button className="ghost icon-btn" disabled={ci === 0} onClick={() => move('categories', data.categories, ci, -1)} aria-label={`Subir ${c.name}`}><Icon name="up" /></button>
                <button className="ghost icon-btn" disabled={ci === data.categories.length - 1} onClick={() => move('categories', data.categories, ci, 1)} aria-label={`Bajar ${c.name}`}><Icon name="down" /></button>
                <button className="ghost icon-btn" onClick={() => rename(c)} aria-label={`Renombrar ${c.name}`}><Icon name="edit" /></button>
                <button className="ghost icon-btn" onClick={() => act(() => api('/api/editor/categories', { body: { id: c.id, name: c.name, visible: !c.visible } }))} aria-label={c.visible ? `Ocultar ${c.name}` : `Mostrar ${c.name}`}><Icon name={c.visible ? 'eye' : 'eyeOff'} /></button>
                <button className="small" onClick={() => setEdit({ categoryId: c.id })}><Icon name="plus" />Plato</button>
              </span>
            </header>
            {!items.length && <p className="small muted" style={{ padding: '12px 16px', margin: 0 }}>Sin platos todavía.</p>}
            {items.map((p: any, i: number) => (
              <div key={p.id} className={`item-row ${p.published ? '' : 'hidden-item'}`}>
                {p.photo ? <img className="thumb" src={`/uploads/${p.photo}`} alt="" /> : <span className="thumb" aria-hidden>{p.name.slice(0, 1)}</span>}
                <div style={{ minWidth: 0 }}>
                  <div className="iname">{p.name}</div>
                  <div className="imeta">
                    <span className="num">{ars(p.price_cents)}</span>
                    {p.kind === 'combo' && <span className="pill st-open">Combo</span>}
                    {!p.published && <span className="pill st-free">Oculto</span>}
                    {!p.available && <span className="pill st-bad">Agotado</span>}
                    {p.pending && <span className="pill st-new">{p.isNew ? 'Nuevo' : 'Con cambios'}</span>}
                  </div>
                </div>
                <span className="item-acts">
                  <button className="ghost icon-btn" disabled={i === 0} onClick={() => move('products', items, i, -1)} aria-label={`Subir ${p.name}`}><Icon name="up" /></button>
                  <button className="ghost icon-btn" disabled={i === items.length - 1} onClick={() => move('products', items, i, 1)} aria-label={`Bajar ${p.name}`}><Icon name="down" /></button>
                  <button className="ghost icon-btn" onClick={() => act(() => api(`/api/editor/products/${p.id}/visible`, { body: { visible: !p.published } }))} aria-label={p.published ? `Ocultar ${p.name}` : `Mostrar ${p.name}`}><Icon name={p.published ? 'eye' : 'eyeOff'} /></button>
                  {!p.isNew && <button className="ghost small" onClick={() => avail(p)}>{p.available ? 'Agotar' : 'Habilitar'}</button>}
                  <button className="small" onClick={() => setEdit(p)}><Icon name="edit" />Editar</button>
                </span>
              </div>
            ))}
          </section>
        );
      })}
      {edit && <ProductEditor initial={edit} data={data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange(); }} />}
    </div>
  );
}

const priceText = (c: number) => (c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');

function ProductEditor({ initial, data, onClose, onSaved }: { initial: any; data: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isCombo = (initial.kind ?? 'normal') === 'combo';
  const firstCat = initial.category_id ?? initial.categoryId ?? data.categories[0]?.id;
  const [f, setF] = useState(() => ({
    name: initial.name ?? '', description: initial.description ?? '', price: initial.price_cents != null ? priceText(initial.price_cents) : '',
    categoryId: firstCat, stationId: initial.station_id ?? data.stations[0]?.id, kind: initial.kind ?? 'normal', course: initial.course ?? 'principal',
    tags: (initial.tags ?? []).join(', '), allergens: initial.allergens ?? '', published: initial.published ?? true,
    groups: groupOptions(initial.options ?? []),
    components: (initial.components ?? []).map((c: any) => ({ productId: c.product_id, qty: c.qty })) as { productId: number; qty: number }[],
  }));
  const [photo, setPhoto] = useState<string | null>(initial.photo ?? null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const cents = parseArs(f.price);
  const simple = data.products.filter((p: any) => p.kind === 'normal' && !p.isNew);
  const full = f.components.reduce((s, c) => s + (simple.find((p: any) => p.id === c.productId)?.price_cents ?? 0) * c.qty, 0);
  // Grupos «para elegir» de un combo: cada opción es un plato de la carta (va a su estación al pedirlo).
  const choiceIdx = f.groups.map((g, i) => (g.items.some((o) => o.itemId) ? i : -1)).filter((i) => i >= 0);
  const parts = f.components.length + choiceIdx.length;

  const save = async () => {
    setBusy(true);
    try {
      const nameOf = (o: { name: string; itemId?: number }) => (o.itemId ? simple.find((p: any) => p.id === o.itemId)?.name ?? o.name : o.name).trim();
      const options = f.groups.flatMap((g) => g.items.filter((o) => nameOf(o)).map((o) => ({ grp: g.name.trim() || 'Opciones', name: nameOf(o), priceDeltaCents: parseArs(o.price || '0'), multi: o.itemId ? false : g.multi, ...(o.itemId ? { itemId: o.itemId } : {}) })));
      if (options.some((o) => Number.isNaN(o.priceDeltaCents))) throw new Error('Revisá los precios de las opciones');
      const r = await api('/api/editor/products', { body: { id: initial.id, name: f.name, description: f.description, priceCents: cents, categoryId: Number(f.categoryId), stationId: Number(f.stationId), kind: f.kind, course: f.course, tags: String(f.tags).split(',').map((t: string) => t.trim()).filter(Boolean), allergens: f.allergens, published: f.published, options, components: f.components, suggestionId: initial.suggestion_id ?? undefined, prepMinutes: initial.prep_minutes ?? 10, favorite: initial.favorite ?? false } });
      toast('Guardado en borrador'); onSaved();
      return r;
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const doPhoto = async (file: File | null) => {
    if (!initial.id) { toast('Guardá el plato primero; después le agregás la foto.', true); return; }
    try {
      if (file) setPhoto((await upload(`/api/editor/products/${initial.id}/photo`, file)).photo);
      else { await api(`/api/editor/products/${initial.id}/photo`, { method: 'DELETE' }); setPhoto(null); }
    } catch (e: any) { toast(e.message, true); }
  };
  const groups = f.groups;
  const setGroup = (i: number, g: any) => set('groups', groups.map((x, j) => (j === i ? g : x)));

  return (
    <Modal title={initial.id ? `Editar ${initial.name}` : isCombo ? 'Nuevo combo' : 'Nuevo plato'} open onClose={onClose}
      footer={<><button onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !f.name.trim() || Number.isNaN(cents) || !f.price || (isCombo && parts < 2)} onClick={save}>{busy ? 'Guardando…' : 'Guardar en borrador'}</button></>}>
      <div className="stack">
        <div className="field"><label htmlFor="pe-n">Nombre</label><input id="pe-n" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label htmlFor="pe-d">Descripción</label><textarea id="pe-d" value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} /></div>
        <div className="fields-2">
          <MoneyInput id="pe-p" label="Precio" value={f.price} onChange={(raw) => set('price', raw)} />
          <div className="field"><label htmlFor="pe-c">Categoría</label><select id="pe-c" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>{data.categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          {!isCombo && <div className="field"><label htmlFor="pe-s">Se prepara en</label><select id="pe-s" value={f.stationId} onChange={(e) => set('stationId', e.target.value)}>{data.stations.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
          <div className="field"><label htmlFor="pe-co">Momento</label><select id="pe-co" value={f.course} onChange={(e) => set('course', e.target.value)}><option value="entrada">Entrada</option><option value="principal">Principal</option><option value="postre">Postre</option><option value="bebida">Bebida</option></select></div>
        </div>
        {initial.id && !isCombo && <ImageSlot label="Foto del plato" hint="Opcional. Si no subís foto, el plato se ve igual de completo." src={photo} onFile={doPhoto} />}

        {isCombo ? (
          <fieldset className="opt-group"><legend style={{ fontWeight: 700 }}>Platos que incluye</legend>
            {f.components.map((c, i) => (
              <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                <select aria-label="Plato" value={c.productId} onChange={(e) => set('components', f.components.map((x, j) => (j === i ? { ...x, productId: Number(e.target.value) } : x)))}>{simple.map((p: any) => <option key={p.id} value={p.id}>{p.name} · {ars(p.price_cents)}</option>)}</select>
                <input aria-label="Cantidad" type="number" min={1} max={20} value={c.qty} onChange={(e) => set('components', f.components.map((x, j) => (j === i ? { ...x, qty: Math.min(20, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) } : x)))} style={{ width: 72 }} />
                <button className="ghost icon-btn" aria-label="Quitar" onClick={() => set('components', f.components.filter((_, j) => j !== i))}><Icon name="close" /></button>
              </div>
            ))}
            <button disabled={!simple.length} onClick={() => set('components', [...f.components, { productId: simple[0].id, qty: 1 }])}><Icon name="plus" />Agregar plato</button>
            <div className="spread" style={{ marginTop: 8 }}><strong>Para elegir</strong>
              <button className="small" disabled={!simple.length} onClick={() => set('groups', [...groups, { name: '', multi: false, items: [{ name: '', price: '', itemId: simple[0].id }] }])}><Icon name="plus" />Grupo para elegir</button></div>
            {!choiceIdx.length && <p className="small muted" style={{ margin: 0 }}>Opcional. Ej.: «Bebida» (elegí una: gaseosa, agua, cerveza +$500). Cada opción es un plato de la carta y va a cocina o barra según corresponda.</p>}
            {choiceIdx.map((i) => { const g = groups[i]; return (
              <div key={i} className="opt-group stack" style={{ gap: 8 }}>
                <div className="row">
                  <input aria-label="Nombre del grupo para elegir" placeholder="Ej.: Bebida" value={g.name} onChange={(e) => setGroup(i, { ...g, name: e.target.value })} style={{ flex: '1 1 160px', width: 'auto' }} />
                  <span className="small muted">elige una</span>
                  <button className="ghost icon-btn" aria-label="Quitar grupo para elegir" onClick={() => set('groups', groups.filter((_, j) => j !== i))}><Icon name="close" /></button>
                </div>
                {g.items.map((o, k) => (
                  <div key={k} className="row" style={{ flexWrap: 'nowrap' }}>
                    <select aria-label="Plato a elegir" value={o.itemId} onChange={(e) => setGroup(i, { ...g, items: g.items.map((x, j) => (j === k ? { ...x, itemId: Number(e.target.value) } : x)) })}>{simple.map((p: any) => <option key={p.id} value={p.id}>{p.name} · {ars(p.price_cents)}</option>)}</select>
                    <input aria-label="Precio adicional" placeholder="+ $0" inputMode="decimal" className="num" value={o.price} onChange={(e) => setGroup(i, { ...g, items: g.items.map((x, j) => (j === k ? { ...x, price: e.target.value } : x)) })} style={{ width: 110 }} />
                    <button className="ghost icon-btn" aria-label="Quitar opción" disabled={g.items.length < 2} onClick={() => setGroup(i, { ...g, items: g.items.filter((_, j) => j !== k) })}><Icon name="close" /></button>
                  </div>
                ))}
                <button className="ghost small" onClick={() => setGroup(i, { ...g, items: [...g.items, { name: '', price: '', itemId: simple[0].id }] })}><Icon name="plus" />Opción</button>
              </div>
            ); })}
            {f.components.length > 0 && <p className="small" style={{ margin: 0 }}>Por separado: <strong>{ars(full)}</strong>{!Number.isNaN(cents) && f.price && (full > cents ? <> · el cliente ahorra <strong>{ars(full - cents)}</strong> (se muestra en la carta)</> : <> · sin ahorro: la carta no muestra descuento</>)}</p>}
          </fieldset>
        ) : (
          <div className="stack">
            <div className="spread"><strong>Variantes y extras</strong><button className="small" onClick={() => set('groups', [...groups, { name: '', multi: false, items: [{ name: '', price: '' }] }])}><Icon name="plus" />Grupo</button></div>
            {!groups.length && <p className="small muted" style={{ margin: 0 }}>Ej.: «Guarnición» (elige una: papas, puré) o «Extras» (puede sumar varios: huevo frito +$800).</p>}
            {groups.map((g, i) => (
              <fieldset key={i} className="opt-group">
                <legend className="visually-hidden">Grupo {i + 1}</legend>
                <div className="row">
                  <input aria-label="Nombre del grupo" placeholder="Nombre del grupo" value={g.name} onChange={(e) => setGroup(i, { ...g, name: e.target.value })} style={{ flex: '1 1 160px', width: 'auto' }} />
                  <div className="seg" role="group" aria-label="Tipo de grupo">
                    <button type="button" aria-pressed={!g.multi} onClick={() => setGroup(i, { ...g, multi: false })}>Elige una</button>
                    <button type="button" aria-pressed={g.multi} onClick={() => setGroup(i, { ...g, multi: true })}>Puede sumar varias</button>
                  </div>
                  <button className="ghost icon-btn" aria-label="Quitar grupo" onClick={() => set('groups', groups.filter((_, j) => j !== i))}><Icon name="close" /></button>
                </div>
                {g.items.map((o, k) => (
                  <div key={k} className="row" style={{ flexWrap: 'nowrap' }}>
                    <input aria-label="Opción" placeholder="Opción" value={o.name} onChange={(e) => setGroup(i, { ...g, items: g.items.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} />
                    <input aria-label={`Precio adicional de ${o.name || "la opción"}`} placeholder="+ $0" inputMode="decimal" className="num" value={o.price} onChange={(e) => setGroup(i, { ...g, items: g.items.map((x, j) => (j === k ? { ...x, price: e.target.value } : x)) })} style={{ width: 110 }} />
                    <button className="ghost icon-btn" aria-label="Quitar opción" onClick={() => setGroup(i, { ...g, items: g.items.filter((_, j) => j !== k) })}><Icon name="close" /></button>
                  </div>
                ))}
                <button className="ghost small" onClick={() => setGroup(i, { ...g, items: [...g.items, { name: '', price: '' }] })}><Icon name="plus" />Opción</button>
              </fieldset>
            ))}
          </div>
        )}
        <div className="fields-2">
          <div className="field"><label htmlFor="pe-t">Etiquetas</label><input id="pe-t" value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="vegetariano, sin TACC" /></div>
          <div className="field"><label htmlFor="pe-a">Alérgenos</label><input id="pe-a" value={f.allergens} onChange={(e) => set('allergens', e.target.value)} placeholder="gluten, lácteos" /></div>
        </div>
        <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Visible en la carta pública</label>
      </div>
    </Modal>
  );
}

function groupOptions(opts: any[]) {
  const out: { name: string; multi: boolean; items: { name: string; price: string; itemId?: number }[] }[] = [];
  for (const o of opts) {
    let g = out.find((x) => x.name === o.grp);
    if (!g) { g = { name: o.grp, multi: !!o.multi, items: [] }; out.push(g); }
    g.items.push({ name: o.name, price: o.price_delta_cents ? priceText(o.price_delta_cents) : '', ...(o.item_id ? { itemId: o.item_id } : {}) });
  }
  return out;
}
