import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, ars, dateAR, hhmm, useLoad, useMe, useToast } from '../lib.tsx';
import { ErrorBox, Loading, Modal, Money } from '../ui.tsx';
import { parseArs } from '../../../shared/money.ts';
import QrCodes, { tablePoster, tablePosterFile } from './QrCodes.tsx';
import { downloadPoster } from '../poster.ts';

const TABS: [string, string][] = [['local', 'Horarios y cobros'], ['mesas', 'Mesas y sectores'], ['qr', 'Códigos QR'], ['canales', 'Retiro y delivery'], ['equipo', 'Equipo'], ['promos', 'Promociones'], ['importar', 'Importar carta'], ['sucursales', 'Sucursales'], ['auditoria', 'Auditoría']];
const ROLE_LABEL: Record<string, string> = { owner: 'Dueño', manager: 'Encargado', waiter: 'Mozo', all_tables: 'Ve todas las mesas', kitchen: 'Cocina', bar: 'Barra', pass: 'Pase', cashier: 'Caja', rider: 'Repartidor', reservations: 'Reservas', stock: 'Stock y compras' };

export default function Config() {
  const { tab = 'local' } = useParams();
  const nav = useNavigate();
  return (
    <main className="page stack">
      <div className="page-head has-tabs"><div><h1>Configuración</h1><div className="sub">Cómo opera el local. La marca, la carta y las fotos están en <Link to="/app/personalizar">Personalizar mi restaurante</Link>.</div></div></div>
      <div className="tabs" role="tablist" aria-label="Secciones de configuración">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => nav(`/app/config/${k}`)}>{l}</button>)}</div>
      {tab === 'local' && <Local />}{tab === 'mesas' && <Tables />}{tab === 'qr' && <QrCodes />}{tab === 'importar' && <Import />}
      {tab === 'equipo' && <Team />}{tab === 'canales' && <Channels />}{tab === 'promos' && <Promos />}{tab === 'sucursales' && <Branches />}{tab === 'auditoria' && <Audit />}
    </main>
  );
}

function useSettings() {
  const { me, reload } = useMe();
  const toast = useToast();
  const [name, setName] = useState(me!.restaurant.name);
  const [theme, setTheme] = useState(me!.restaurant.theme);
  const [s, setS] = useState<any>(me!.restaurant.settings);
  const save = async (patch: any = {}) => {
    try { await api('/api/restaurant', { method: 'PUT', body: { name, theme, settings: { ...s, ...patch } } }); await reload(); toast('Guardado'); } catch (e: any) { toast(e.message, true); }
  };
  return { me: me!, name, setName, theme, setTheme, s, setS, save };
}

function Local() {
  const { me, name, s, setS, save } = useSettings();
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const f = (k: string, label: string, type = 'text') => <div className="field"><label htmlFor={k}>{label}</label><input id={k} type={type} value={s[k] ?? ''} onChange={(e) => set(k, type === 'number' ? Number(e.target.value) : e.target.value)} /></div>;
  const steps = useLoad(() => Promise.all([api('/api/tables'), api('/api/menu'), api('/api/team'), api('/api/stations')]));
  const done = steps.data ? [['Nombre y marca', !!name], ['Sectores (estaciones)', steps.data[3].length > 0], ['Mesas y QR', steps.data[0].length > 0], ['Carta con precios', steps.data[1].products.length > 0], ['Medios de cobro', (s.payment_methods ?? []).length > 0], ['Equipo con usuarios propios', steps.data[2].length > 1]] : [];
  return (
    <div className="split-2">
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <h2>Horarios y funcionamiento</h2>
        <p className="small muted" style={{ margin: 0 }}>Nombre, horarios visibles, dirección y contacto se editan en <Link to="/app/personalizar/marca">Personalizar → Marca</Link>.</p>
        {f('last_order', 'Última hora de pedidos (HH:MM)')}
        <div className="field"><label htmlFor="mode">En la mesa, el QR permite</label><select id="mode" value={s.mode} onChange={(e) => set('mode', e.target.value)}><option value="menu">Solo ver la carta</option><option value="calls">Ver la carta y llamar al mozo / pedir la cuenta</option><option value="orders">Además, pedir desde la mesa (con código del mozo)</option></select></div>
        <div className="field"><label htmlFor="pr">Pizza por mitades: precio</label><select id="pr" value={s.pizza_rule} onChange={(e) => set('pizza_rule', e.target.value)}><option value="max">Mayor precio de las mitades</option><option value="avg">Promedio de las mitades</option></select></div>
        {f('cutoff_hour', 'Hora de corte del día operativo (0–12)', 'number')}{f('bill_alert_min', 'Avisar pedido de cuenta sin atender después de (min)', 'number')}
        <fieldset className="group"><legend>Medios de cobro que acepta la caja</legend>
          {[...new Set(['efectivo', 'transferencia', 'tarjeta', ...(s.payment_methods ?? [])])].map((m: string) => (
            <label key={m} className="check"><input type="checkbox" checked={(s.payment_methods ?? []).includes(m)} onChange={(e) => set('payment_methods', e.target.checked ? [...(s.payment_methods ?? []), m] : (s.payment_methods ?? []).filter((x: string) => x !== m))} /> {m[0].toUpperCase() + m.slice(1)}</label>))}
          <input aria-label="Agregar otro medio de cobro" placeholder="Otro (ej. mercado pago) y Enter" onKeyDown={(e) => { const v = e.currentTarget.value.trim().toLowerCase(); if (e.key === 'Enter' && v) { e.preventDefault(); set('payment_methods', [...new Set([...(s.payment_methods ?? []), v])]); e.currentTarget.value = ''; } }} />
        </fieldset>
        {f('google_review_url', 'Enlace oficial de reseñas de Google (https://…)')}
        <fieldset className="group"><legend>Funciones del rubro</legend>
          {[['halves', 'Pizza mitad y mitad'], ['dozen', 'Docenas de empanadas por gusto'], ['courses', 'Tiempos: esperar y marchar principales'], ['happy_hour', 'Happy hour por franja'], ['daily_menu', 'Plato del día destacado'], ['loyalty', 'Sellos de fidelidad (con adhesión)']].map(([k, l]) => (
            <label key={k} className="check"><input type="checkbox" checked={!!s.features?.[k]} onChange={(e) => set('features', { ...s.features, [k]: e.target.checked })} /> {l}</label>))}
        </fieldset>
        <div className="save-bar"><button className="primary big">Guardar</button></div>
      </form>
      <div className="stack">
        <div className="card"><h2>Alta guiada</h2>
          {!steps.data ? <Loading /> : <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{done.map(([l, ok]) => <li key={String(l)} className="check">{ok ? '✅' : '⬜'} {l}</li>)}</ul>}
          <p className="small muted">Carta pública: <a href={`/m/${me.restaurant.slug}`} target="_blank" rel="noreferrer">{me.publicUrl}/m/{me.restaurant.slug}</a></p>
        </div>
        <Stations />
      </div>
    </div>
  );
}

function Stations() {
  const toast = useToast();
  const st = useLoad(() => api('/api/stations'));
  const [n, setN] = useState({ name: '', kind: 'kitchen', delayMinutes: 15 });
  const save = async (body: any) => { try { await api('/api/stations', { body }); st.reload(); setN({ name: '', kind: 'kitchen', delayMinutes: 15 }); } catch (e: any) { toast(e.message, true); } };
  return (
    <div className="card stack"><h2>Sectores de producción</h2>
      {(st.data ?? []).map((s: any) => <div key={s.id} className="spread"><span><strong>{s.name}</strong> · {s.kind === 'bar' ? 'barra' : 'cocina'}</span>
        <label className="row small">Demora (min) <input type="number" min={1} style={{ width: 80 }} defaultValue={s.delay_minutes} onBlur={(e) => Number(e.target.value) !== s.delay_minutes && save({ id: s.id, name: s.name, kind: s.kind, delayMinutes: Number(e.target.value) })} /></label></div>)}
      <div className="row"><input aria-label="Nombre del sector" placeholder="Nuevo sector (ej. Parrilla)" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} style={{ flex: 1 }} />
        <select aria-label="Tipo" value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value })} style={{ width: 'auto' }}><option value="kitchen">Cocina</option><option value="bar">Barra</option></select>
        <button onClick={() => save(n)} disabled={!n.name}>Agregar</button></div>
    </div>
  );
}

function Tables() {
  const { me } = useMe();
  const toast = useToast();
  const t = useLoad(() => api('/api/tables'));
  const [qrs, setQrs] = useState<Record<number, string>>({});
  const [n, setN] = useState({ number: '', area: 'Salón', seats: 4 });
  useEffect(() => {
    (async () => {
      const out: Record<number, string> = {};
      for (const x of t.data ?? []) out[x.id] = await QRCode.toDataURL(`${me!.publicUrl}/q/${x.qr_token}`, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
      setQrs(out);
    })();
  }, [t.data, me]);
  const add = async () => { try { await api('/api/tables', { body: n }); t.reload(); setN({ ...n, number: '' }); } catch (e: any) { toast(e.message, true); } };
  if (!t.data) return <Loading />;
  return (
    <div className="stack">
      <div className="card stack no-print">
        <p className="small muted" style={{ margin: 0 }}>Cada mesa tiene un QR permanente. El QR identifica la mesa; no autoriza consumos por sí solo. Dirección usada: <strong>{me!.publicUrl}</strong> (configurable con PUBLIC_URL). Si cambia el dominio, los QR se regeneran acá con la nueva dirección. «Descargar PNG» baja el cartel «Mirá nuestra carta» listo para imprimir; el destino de cada QR se cambia en <Link to="/app/config/qr">Códigos QR</Link>.</p>
        <div className="row"><input aria-label="Número" placeholder="N.º" value={n.number} onChange={(e) => setN({ ...n, number: e.target.value })} style={{ width: 90 }} />
          <input aria-label="Sector" placeholder="Sector" value={n.area} onChange={(e) => setN({ ...n, area: e.target.value })} style={{ width: 160 }} />
          <input aria-label="Lugares" type="number" min={1} value={n.seats} onChange={(e) => setN({ ...n, seats: Number(e.target.value) })} style={{ width: 90 }} />
          <button onClick={add} disabled={!n.number}>Agregar mesa</button><button onClick={() => print()}>Imprimir hoja de QR</button></div>
      </div>
      <div className="tables">
        {t.data.map((x: any) => (
          <div key={x.id} className="card" style={{ textAlign: 'center', breakInside: 'avoid' }}>
            <strong style={{ fontSize: '1.4rem' }}>Mesa {x.number}</strong><div className="small muted">{x.area}</div>
            {qrs[x.id] && <img src={qrs[x.id]} alt={`QR de la mesa ${x.number}`} style={{ margin: '8px auto', width: 160 }} />}
            <div className="small" style={{ wordBreak: 'break-all' }}>{me!.publicUrl.replace(/^https?:\/\//, '')}/q/{x.qr_token}</div>
            {qrs[x.id] && <button className="small no-print" aria-label={`Descargar PNG del cartel de la mesa ${x.number}`} onClick={() => downloadPoster(tablePoster(me!, me!.publicUrl, x), tablePosterFile(x)).catch((e) => toast(e.message, true))}>Descargar PNG</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Import() {
  const toast = useToast();
  const [csv, setCsv] = useState('categoria,nombre,descripcion,precio,estacion,etiquetas\nPrincipales,Ravioles de ricota,Con salsa a elección,9800,Cocina,vegetariano\n');
  const [prev, setPrev] = useState<any>(null);
  const run = async (dryRun: boolean) => {
    try { const r = await api('/api/menu/import', { body: { csv, dryRun } }); if (dryRun) setPrev(r); else { toast(`Importados ${r.imported} platos (${r.skipped} con errores no se importaron)`); setPrev(null); } } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="stack">
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>Columnas: categoria, nombre, descripcion, precio, estacion, etiquetas (separadas por |). Acepta coma o punto y coma. Primero se muestra la vista previa con errores por fila.</p>
        <input type="file" accept=".csv,text/csv" aria-label="Archivo CSV" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
        <textarea aria-label="Contenido CSV" value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} className="num" />
        <div className="row"><button onClick={() => run(true)}>Vista previa</button>{prev && <button className="primary" disabled={!prev.valid} onClick={() => run(false)}>Importar {prev.valid} filas válidas</button>}</div>
      </div>
      {prev && <div className="card table-wrap"><table><thead><tr><th>Fila</th><th>Categoría</th><th>Nombre</th><th className="right">Precio</th><th>Estación</th><th>Resultado</th></tr></thead>
        <tbody>{prev.preview.map((r: any) => <tr key={r.row}><td>{r.row}</td><td>{r.cat}</td><td>{r.name}</td><td className="right">{Number.isNaN(r.priceCents) || r.priceCents == null ? '—' : ars(r.priceCents)}</td><td>{r.station}</td><td>{r.errors.length ? <span className="pill st-bad">{r.errors.join(', ')}</span> : <span className="pill st-ok">OK</span>}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function Team() {
  const { me } = useMe();
  const toast = useToast();
  const t = useLoad(() => api('/api/team'));
  const [f, setF] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [closing, setClosing] = useState<number | null>(null);
  const isOwner = me!.roles.includes('owner');
  const edit = (x: any) => { setErr(''); setF(x); };
  // El formulario solo se cierra si el servidor confirmó; si falla, lo escrito queda para reintentar.
  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    setSaving(true); setErr('');
    try { await api('/api/team', { body: f }); setF(null); toast('Guardado'); t.reload(); }
    catch (x: any) { setErr(x.message); }
    finally { setSaving(false); }
  };
  const reset = async (u: any) => { const p = prompt(`Nueva contraseña para ${u.name} (8+ caracteres):`); if (!p) return; try { await api(`/api/team/${u.id}/reset-password`, { body: { password: p } }); toast('Contraseña restablecida y sesiones cerradas'); } catch (e: any) { toast(e.message, true); } };
  // Desconecta a la persona en este local; su cuenta, roles y estado no cambian.
  const revoke = async (u: any) => {
    if (closing !== null) return;
    setClosing(u.id);
    try { await api(`/api/team/${u.id}/revoke-sessions`, { body: {} }); toast('Sesiones cerradas'); }
    catch (x: any) { toast(`No se pudieron cerrar las sesiones de ${u.name}: ${x.message}. Probá de nuevo.`, true); }
    finally { setClosing(null); }
  };
  if (t.error) return <ErrorBox error={t.error} retry={t.reload} />;
  if (!t.data) return <Loading />;
  const roles = Object.keys(ROLE_LABEL).filter((r) => r !== 'owner' || isOwner);
  const isNew = f && !f.id;
  return (
    <div className="stack">
      <button className="primary" style={{ alignSelf: 'start' }} onClick={() => edit({ email: '', name: '', password: '', roles: ['waiter'], pin: '', active: true })}>+ Agregar persona</button>
      <div className="card table-wrap"><table><thead><tr><th>Persona</th><th>Roles</th><th>Estado</th><th><span className="visually-hidden">Acciones</span></th></tr></thead>
        <tbody>{t.data.map((u: any) => <tr key={u.id} aria-busy={closing === u.id || undefined}><td><strong>{u.name}</strong><div className="small muted">{u.email}</div></td><td>{u.roles.map((r: string) => ROLE_LABEL[r] ?? r).join(', ')}{u.has_pin && <span className="small muted"> · con PIN</span>}</td>
          <td>{u.active ? <span className="pill st-ok">Activo</span> : <span className="pill st-free">Baja</span>}</td>
          <td className="row"><button className="small" onClick={() => edit({ id: u.id, email: u.email, name: u.name, password: '', roles: u.roles, pin: '', active: u.active })}>Editar</button><button className="small" onClick={() => reset(u)}>Restablecer clave</button>
            <button className="small" disabled={closing !== null} onClick={() => revoke(u)}>{closing === u.id ? 'Cerrando…' : 'Cerrar sesiones'}</button></td></tr>)}</tbody></table></div>
      {f && <Modal title={isNew ? 'Agregar persona' : 'Editar persona'} open onClose={() => setF(null)} backdropClose={false} busy={saving}
        footer={<><button type="button" onClick={() => setF(null)} disabled={saving}>Cancelar</button><button type="submit" form="team-form" className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button></>}>
        {/* autoComplete: es el alta de otra persona, no el ingreso de quien administra; el navegador no debe rellenar con sus credenciales guardadas. */}
        <form id="team-form" className="stack" onSubmit={save} autoComplete="off">
          <div className="field"><label htmlFor="tn">Nombre</label><input id="tn" name="staff-name" autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div className="field"><label htmlFor="te">Email (usuario)</label><input id="te" name="staff-email" type="email" autoComplete="off" readOnly={!isNew && !isOwner} aria-describedby={!isNew && !isOwner ? 'te-h' : undefined} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />{!isNew && !isOwner && <p id="te-h" className="small muted">El usuario de ingreso solo lo cambia el dueño.</p>}</div>
          {(isNew || (isOwner && f.id !== me!.user.id)) && <div className="field"><label htmlFor="tp">{isNew ? 'Contraseña inicial (8 caracteres o más)' : 'Nueva contraseña (opcional)'}</label>
            <input id="tp" name="staff-new-password" type="password" autoComplete="new-password" minLength={8} required={isNew} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-describedby={isNew ? undefined : 'tp-h'} />
            {!isNew && <p id="tp-h" className="small muted">Dejala vacía para conservar la contraseña actual.</p>}</div>}
          <fieldset style={{ border: 0, padding: 0 }}><legend style={{ fontWeight: 700 }}>Roles (se pueden combinar)</legend>
            {roles.map((r) => <label key={r} className="check"><input type="checkbox" checked={f.roles.includes(r)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x: string) => x !== r) })} /> {ROLE_LABEL[r]}</label>)}</fieldset>
          <div className="field"><label htmlFor="tpin">PIN de autorización (encargados, 4–8 dígitos)</label><input id="tpin" name="staff-pin" autoComplete="off" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></div>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo</label>
          {err && <p className="field-error" role="alert">{err}</p>}
        </form>
      </Modal>}
    </div>
  );
}

function Channels() {
  const { s, setS, save } = useSettings();
  const toast = useToast();
  const z = useLoad(() => api('/api/zones'));
  const [nz, setNz] = useState({ name: '', fee: '', min: '' });
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const addZone = async () => { try { await api('/api/zones', { body: { name: nz.name, feeCents: parseArs(nz.fee), minCents: nz.min ? parseArs(nz.min) : 0 } }); setNz({ name: '', fee: '', min: '' }); z.reload(); } catch (e: any) { toast(e.message, true); } };
  const pause = async (minutes: number) => { try { const r = await api('/api/restaurant/pause-delivery', { body: { minutes } }); toast(r.until ? `Delivery pausado hasta ${hhmm(r.until)}` : 'Delivery reanudado'); } catch (e: any) { toast(e.message, true); } };
  return (
    <div className="split-2">
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <h2>Canales</h2>
        <label className="check"><input type="checkbox" checked={!!s.takeaway} onChange={(e) => set('takeaway', e.target.checked)} /> Pedidos para retirar</label>
        <label className="check"><input type="checkbox" checked={!!s.delivery} onChange={(e) => set('delivery', e.target.checked)} /> Delivery propio</label>
        <label className="check"><input type="checkbox" checked={!!s.whatsapp_only} onChange={(e) => set('whatsapp_only', e.target.checked)} /> El carrito llega como «solicitud» (el local la acepta antes de darla por recibida)</label>
        <div className="field"><label htmlFor="wa">WhatsApp del local (con código de país, sin +)</label><input id="wa" inputMode="tel" value={s.whatsapp_phone ?? ''} onChange={(e) => set('whatsapp_phone', e.target.value.replace(/\D/g, ''))} /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="ss">Primera franja</label><input id="ss" type="time" value={s.slot_start} onChange={(e) => set('slot_start', e.target.value)} /></div>
          <div className="field"><label htmlFor="se">Última franja</label><input id="se" type="time" value={s.slot_end} onChange={(e) => set('slot_end', e.target.value)} /></div>
          <div className="field"><label htmlFor="sm">Minutos por franja</label><input id="sm" type="number" min={10} value={s.slot_minutes} onChange={(e) => set('slot_minutes', Number(e.target.value))} /></div>
          <div className="field"><label htmlFor="sc">Pedidos por franja</label><input id="sc" type="number" min={1} value={s.slot_capacity} onChange={(e) => set('slot_capacity', Number(e.target.value))} /></div>
        </div>
        <h3>Reservas</h3>
        <label className="check"><input type="checkbox" checked={!!s.reservations?.enabled} onChange={(e) => set('reservations', { ...s.reservations, enabled: e.target.checked })} /> Recibir reservas por enlace</label>
        <div className="field"><label htmlFor="rt">Horarios (coma)</label><input id="rt" value={(s.reservations?.times ?? []).join(', ')} onChange={(e) => set('reservations', { ...s.reservations, times: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })} /></div>
        <label className="check"><input type="checkbox" checked={s.reservations?.waitlist !== false} onChange={(e) => set('reservations', { ...s.reservations, waitlist: e.target.checked })} /> Si un horario se llena, ofrecer lista de espera en el enlace</label>
        <div className="field"><label htmlFor="rc">Cubiertos por horario</label><input id="rc" type="number" min={1} value={s.reservations?.capacity ?? 24} onChange={(e) => set('reservations', { ...s.reservations, capacity: Number(e.target.value) })} /></div>
        <div className="save-bar"><button className="primary">Guardar</button></div>
      </form>
      <div className="stack">
        <div className="card stack"><h2>Pausar delivery</h2><div className="row"><button onClick={() => pause(30)}>Pausar 30 min</button><button onClick={() => pause(60)}>Pausar 1 h</button><button onClick={() => pause(0)}>Reanudar</button></div></div>
        <div className="card stack"><h2>Zonas y tarifas</h2>
          {(z.data ?? []).map((x: any) => <div key={x.id} className="spread"><span>{x.name} · envío <Money c={x.fee_cents} /> · mínimo <Money c={x.min_cents} /></span><button className="small ghost" onClick={async () => { await api('/api/zones', { body: { id: x.id, delete: true } }); z.reload(); }}>Quitar</button></div>)}
          <div className="row"><input aria-label="Barrio" placeholder="Barrio" value={nz.name} onChange={(e) => setNz({ ...nz, name: e.target.value })} style={{ flex: 1 }} /><input aria-label="Tarifa" placeholder="Tarifa $" inputMode="decimal" value={nz.fee} onChange={(e) => setNz({ ...nz, fee: e.target.value })} style={{ width: 110 }} /><input aria-label="Mínimo" placeholder="Mínimo $" inputMode="decimal" value={nz.min} onChange={(e) => setNz({ ...nz, min: e.target.value })} style={{ width: 110 }} /><button onClick={addZone} disabled={!nz.name || !nz.fee}>Agregar</button></div>
        </div>
      </div>
    </div>
  );
}

function Promos() {
  const toast = useToast();
  const p = useLoad(() => api('/api/promotions'));
  const m = useLoad(() => api('/api/menu'));
  const [f, setF] = useState({ name: 'Happy hour', categoryId: '', days: [1, 2, 3, 4, 5], startTime: '18:00', endTime: '20:00', pct: 20 });
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const save = async (body: any) => { try { await api('/api/promotions', { body }); p.reload(); toast('Guardado'); } catch (e: any) { toast(e.message, true); } };
  return (
    <div className="split-2">
      <div className="card stack"><h2>Nueva promoción por franja</h2>
        <div className="field"><label htmlFor="pn">Nombre</label><input id="pn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="pcat">Categoría</label><select id="pcat" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Toda la carta</option>{(m.data?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="row" role="group" aria-label="Días">{days.map((d, i) => <button key={i} className="chip" aria-pressed={f.days.includes(i)} onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i] })}>{d}</button>)}</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="field"><label htmlFor="ps">Desde</label><input id="ps" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></div>
          <div className="field"><label htmlFor="pe">Hasta</label><input id="pe" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></div>
          <div className="field"><label htmlFor="pp">% off</label><input id="pp" type="number" min={1} max={99} value={f.pct} onChange={(e) => setF({ ...f, pct: Number(e.target.value) })} /></div>
        </div>
        <button className="primary" onClick={() => save({ ...f, categoryId: f.categoryId ? Number(f.categoryId) : null })}>Crear</button>
      </div>
      <div className="card"><h2>Activas</h2>{(p.data ?? []).map((x: any) => <div key={x.id} className="spread"><span><strong>{x.name}</strong> · {x.days.map((d: number) => days[d]).join(' ')} · {x.start_time}–{x.end_time} · −{x.pct}%</span>
        <label className="check"><input type="checkbox" checked={x.active} onChange={(e) => save({ id: x.id, name: x.name, categoryId: x.category_id, days: x.days, startTime: x.start_time, endTime: x.end_time, pct: x.pct, active: e.target.checked })} /> Activa</label></div>)}
        {p.data?.length === 0 && <p className="muted">Sin promociones.</p>}</div>
    </div>
  );
}

function Branches() {
  const { me, reload } = useMe();
  const toast = useToast();
  const tpl = useLoad(() => api('/api/templates'));
  const [f, setF] = useState({ name: '', slug: '', template: 'bodegon' });
  const create = async () => { try { await api('/api/restaurants', { body: f }); await reload(); toast('Local creado. Elegilo arriba para configurarlo.'); } catch (e: any) { toast(e.message, true); } };
  const copy = async (rid: number) => { try { const r = await api('/api/menu/copy-from', { body: { restaurantId: rid } }); toast(`Copiados ${r.copied} platos`); } catch (e: any) { toast(e.message, true); } };
  return (
    <div className="split-2">
      <div className="card stack"><h2>Agregar otro local</h2><p className="small muted">Cada local tiene su carta, equipo, stock y caja separados.</p>
        <div className="field"><label htmlFor="bn">Nombre</label><input id="bn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) })} /></div>
        <div className="field"><label htmlFor="bs">Enlace de la carta</label><input id="bs" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></div>
        <div className="field"><label htmlFor="bt">Plantilla del rubro</label><select id="bt" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>{(tpl.data ?? []).map((t: any) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <button className="primary" onClick={create} disabled={!f.name || !f.slug}>Crear local</button></div>
      <div className="card stack"><h2>Copiar carta desde otro local</h2>
        {me!.restaurants.filter((r) => r.id !== me!.restaurant.id && r.roles.includes('owner')).map((r) => <div key={r.id} className="spread"><span>{r.name}</span><button onClick={() => copy(r.id)}>Copiar categorías y platos aquí</button></div>)}
        {me!.restaurants.length < 2 && <p className="muted">Necesitás otro local propio.</p>}</div>
    </div>
  );
}

function Audit() {
  const a = useLoad(() => api('/api/audit'));
  const logins = useLoad(() => api('/api/audit/logins'));
  if (!a.data) return <Loading />;
  return (
    <div className="stack">
    <section className="card table-wrap" aria-labelledby="h-logins"><h2 id="h-logins">Ingresos de los últimos 7 días</h2>
      <p className="small muted">Se guardan 30 días y se borran solos. Nunca se guarda la contraseña ni el PIN ingresado.</p>
      {!logins.data ? <Loading /> : !logins.data.length ? <p className="muted">Sin ingresos registrados.</p> : (
        <table><thead><tr><th>Fecha</th><th>Persona</th><th>Resultado</th><th>Desde</th></tr></thead>
          <tbody>{logins.data.map((x: any, i: number) => <tr key={i}><td className="small">{dateAR(x.at)}</td><td>{x.name}<div className="small muted">{x.email}</div></td><td>{x.ok ? <span className="pill st-ok">Ingresó</span> : <span className="pill st-bad">{x.reason ?? 'Rechazado'}</span>}</td><td className="small num">{x.ip}</td></tr>)}</tbody></table>
      )}
    </section>
    <div className="card table-wrap"><p className="small"><a href="/api/export/auditoria">Exportar CSV completo</a></p>
      <table><thead><tr><th>Fecha</th><th>Acción</th><th>Quién</th><th>Motivo</th></tr></thead>
        <tbody>{a.data.map((x: any) => <tr key={x.id}><td className="small">{dateAR(x.at)}</td><td>{x.action}<div className="small muted">{x.entity} {x.entity_id}</div></td><td>{x.user_name}{x.authorized_name && <div className="small muted">autorizó {x.authorized_name}</div>}</td><td>{x.reason}</td></tr>)}</tbody></table></div>
    </div>
  );
}
