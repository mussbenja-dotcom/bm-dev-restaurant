import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../icons.tsx';
import { api, dateAR, useLoad, useMe, useToast } from '../lib.tsx';
import { Empty, ErrorBox, Loading, Modal } from '../ui.tsx';

const STATUS: Record<string, [string, string]> = { active: ['Activo', 'st-ok'], suspended: ['Suspendido', 'st-wait'], trashed: ['En papelera', 'st-bad'] };
const FILTERS: [string, string][] = [['vigentes', 'Activos y suspendidos'], ['active', 'Activos'], ['suspended', 'Suspendidos'], ['trashed', 'Papelera']];
const ACTION_LABEL: Record<string, string> = {
  'platform.restaurant_create': 'Alta del local', 'platform.restaurant_suspended': 'Suspensión', 'platform.restaurant_active': 'Reactivación',
  'platform.restaurant_trashed': 'Envío a papelera', 'platform.restaurant_restored': 'Restauración', 'platform.restaurant_purge': 'Eliminación definitiva',
  'platform.assist': 'Asistencia', 'platform.link_reissue': 'Enlace nuevo', 'platform.account_activate': 'Cuenta activada', 'platform.invite_accept': 'Invitación aceptada',
  'platform.password_reset': 'Contraseña restablecida', 'setup.first_admin': 'Primer administrador', 'setup.superadmin_create': 'Alta de Superadmin', 'setup.superadmin_promote': 'Cuenta promovida a Superadmin',
};
const kb = (b: number) => (b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.ceil(b / 1000)} KB`);

/** Superadmin (plataforma BM Dev): alta, suspensión, papelera y eliminación de locales. El servidor valida el rol en cada acción. */
export default function Superadmin() {
  const { me, reload } = useMe();
  const { tab = 'restaurantes' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  if (!me) return <Navigate to="/login" replace />;
  if (!me.user.isPlatformAdmin) return <Navigate to="/" replace />;
  const logout = async () => { await api('/api/logout', { body: {} }).catch(() => {}); await reload(); nav('/login'); };
  const leave = async () => { try { await api('/api/admin/leave', { body: {} }); await reload(); } catch (e: any) { toast(e.message, true); } };
  return (
    <main className="page stack sa">
      <div className="page-head has-tabs">
        <div><h1>Superadmin</h1><div className="sub">{me.user.name} · {me.user.email}</div></div>
        <div className="row">
          {me.restaurant && <button onClick={leave}>Salir de la asistencia a {me.restaurant.name}</button>}
          <button className="ghost" onClick={logout}><Icon name="logout" />Salir</button>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Secciones de Superadmin">
        {[['restaurantes', 'Restaurantes'], ['historial', 'Historial']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => nav(`/superadmin/${k}`)}>{l}</button>)}
      </div>
      {tab === 'historial' ? <History /> : <Restaurants />}
    </main>
  );
}

function Restaurants() {
  const r = useLoad(() => api('/api/admin/restaurants'));
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('vigentes');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  if (r.error) return <ErrorBox error={r.error} retry={r.reload} />;
  if (!r.data) return <Loading />;
  const n = (s: string) => r.data.filter((x: any) => x.status === s).length;
  const needle = q.trim().toLowerCase();
  const rows = r.data.filter((x: any) => (filter === 'vigentes' ? x.status !== 'trashed' : x.status === filter)
    && (!needle || [x.name, x.slug, ...x.owners.map((o: any) => `${o.name} ${o.email}`), ...x.pending.map((p: any) => p.email)].join(' ').toLowerCase().includes(needle)));
  return (
    <section className="stack" aria-label="Restaurantes">
      <div className="sa-bar">
        <input type="search" placeholder="Buscar por local, identificador o dueño…" aria-label="Buscar restaurante" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Filtrar por estado">
          {FILTERS.map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <span className="num">{k === 'vigentes' ? n('active') + n('suspended') : n(k)}</span></button>)}
        </div>
        <button className="primary" onClick={() => setCreating(true)}><Icon name="plus" />Crear restaurante</button>
      </div>
      {!rows.length ? <Empty>{!r.data.length ? 'Todavía no hay restaurantes. Creá el primero.' : needle ? 'Ningún restaurante coincide con la búsqueda.' : filter === 'trashed' ? 'La papelera está vacía.' : 'No hay restaurantes en este estado.'}</Empty> : (
        <div className="table-wrap"><table className="ledger sa-table">
          <thead><tr><th>Local</th><th>Dueño</th><th className="hide-sm">Alta</th><th>Estado</th><th><span className="visually-hidden">Acciones</span></th></tr></thead>
          <tbody>{rows.map((x: any) => (
            <tr key={x.id}>
              <td><strong>{x.name}</strong><div className="small muted">{x.slug}</div></td>
              <td><Owners x={x} /></td>
              <td className="hide-sm small">{dateAR(x.created_at).split(',')[0]}</td>
              <td><span className={`pill ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span></td>
              <td className="right"><button className="small" onClick={() => setOpen(x.id)} aria-label={`Ver detalle de ${x.name}`}>Ver detalle</button></td>
            </tr>))}
          </tbody></table></div>
      )}
      {creating && <CreateDialog onClose={() => setCreating(false)} onDone={(x) => { setCreating(false); setCreated(x); r.reload(); }} />}
      {created && <CreatedDialog x={created} onClose={() => setCreated(null)} />}
      {open && <Detail id={open} onClose={() => setOpen(null)} onChange={r.reload} />}
    </section>
  );
}

function Owners({ x }: { x: any }) {
  if (!x.owners.length && !x.pending.length) return <span className="muted">Sin dueño</span>;
  return <>
    {x.owners.map((o: any) => <div key={o.id}>{o.name}<div className="small muted">{o.email}{o.pending && ' · sin activar'}</div></div>)}
    {x.pending.filter((p: any) => p.kind === 'invite').map((p: any) => <div key={`i-${p.email}`}>{p.name}<div className="small muted">{p.email} · invitación pendiente</div></div>)}
  </>;
}

function CopyLink({ url, label }: { url: string; label: string }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { toast('No se pudo copiar: seleccioná el texto y copialo', true); } };
  return (
    <div className="sa-link">
      <label className="small" htmlFor={`l-${label}`}>{label}</label>
      <div className="row"><input id={`l-${label}`} readOnly value={url} onFocus={(e) => e.target.select()} /><button type="button" onClick={copy}>Copiar</button></div>
    </div>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: (x: any) => void }) {
  const [f, setF] = useState({ name: '', slug: '', ownerName: '', ownerEmail: '', template: 'bodegon' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [touchedSlug, setTouchedSlug] = useState(false);
  const tpl = useLoad(() => api('/api/templates').catch(() => []));
  const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const save = async () => {
    setBusy(true); setErr('');
    try { onDone(await api('/api/admin/restaurants', { body: f })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Crear restaurante" open onClose={onClose} footer={<><button onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !f.name || !f.slug || !f.ownerName || !f.ownerEmail} onClick={save}>{busy ? 'Creando…' : 'Crear restaurante'}</button></>}>
      <div className="stack">
        <div className="field"><label htmlFor="sa-n">Nombre del local</label><input id="sa-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: touchedSlug ? f.slug : slugify(e.target.value) })} /></div>
        <div className="field"><label htmlFor="sa-s">Identificador para su enlace</label><input id="sa-s" value={f.slug} onChange={(e) => { setTouchedSlug(true); setF({ ...f, slug: e.target.value.toLowerCase() }); }} aria-describedby="sa-s-h" />
          <p id="sa-s-h" className="small muted">Minúsculas, números y guiones. La carta queda en /m/{f.slug || 'identificador'}.</p></div>
        <div className="field"><label htmlFor="sa-on">Nombre del dueño</label><input id="sa-on" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></div>
        <div className="field"><label htmlFor="sa-oe">Correo del dueño</label><input id="sa-oe" type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} aria-describedby="sa-oe-h" />
          <p id="sa-oe-h" className="small muted">Si ya tiene cuenta, se la invita al local y conserva su contraseña.</p></div>
        <div className="field"><label htmlFor="sa-t">Plantilla del rubro</label><select id="sa-t" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>{(tpl.data ?? []).map((t: any) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function LinkNote({ link }: { link: any }) {
  return <p className="small muted">{link.kind === 'activate' ? 'Con este enlace el dueño define su contraseña y entra a su panel.' : 'El dueño ya tenía cuenta: con este enlace acepta la invitación y entra con su contraseña de siempre.'} Sirve una sola vez y vence el {dateAR(link.expiresAt)}.</p>;
}

function CreatedDialog({ x, onClose }: { x: any; onClose: () => void }) {
  return (
    <Modal title={`${x.restaurant.name} está creado`} open onClose={onClose} footer={<button className="primary" onClick={onClose}>Listo</button>}>
      <div className="stack">
        <CopyLink label={x.link.kind === 'activate' ? 'Enlace de activación para el dueño' : 'Invitación para el dueño'} url={x.link.url} />
        <LinkNote link={x.link} />
        <CopyLink label="Panel del local" url={x.panelUrl} />
        <CopyLink label="Carta pública" url={x.menuUrl} />
      </div>
    </Modal>
  );
}

function Detail({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const { reload: reloadMe } = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const d = useLoad(() => api(`/api/admin/restaurants/${id}`), [id]);
  const [ask, setAsk] = useState<null | { action: string; title: string; verb: string; danger?: boolean; help: string }>(null);
  const [purging, setPurging] = useState(false);
  const [link, setLink] = useState<any>(null);
  const done = () => { d.reload(); onChange(); };
  if (d.error) return <Modal title="Restaurante" open onClose={onClose}><ErrorBox error={d.error} retry={d.reload} /></Modal>;
  if (!d.data) return <Modal title="Restaurante" open onClose={onClose}><Loading /></Modal>;
  const x = d.data;
  const assist = async () => {
    const reason = prompt(`Motivo de la asistencia a ${x.name} (queda registrado):`); if (!reason) return;
    try { await api(`/api/admin/restaurants/${x.id}/assist`, { body: { reason } }); await reloadMe(); nav('/app'); } catch (e: any) { toast(e.message, true); }
  };
  const reissue = async (email: string) => { try { setLink(await api(`/api/admin/restaurants/${x.id}/link`, { body: { email } })); done(); } catch (e: any) { toast(e.message, true); } };
  const people = [...x.owners.map((o: any) => ({ ...o, state: o.pending ? 'Sin activar' : 'Activo' })), ...x.pending.filter((p: any) => p.kind === 'invite').map((p: any) => ({ ...p, state: 'Invitación pendiente' }))];
  return (
    <Modal title={x.name} open onClose={onClose}>
      <div className="stack sa-detail">
        <div className="row"><span className={`pill ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span><span className="small muted">{x.slug} · alta {dateAR(x.created_at)}{x.trashed_at && ` · en papelera desde ${dateAR(x.trashed_at)}`}</span></div>

        <section><h3 className="rule-title">Dueño</h3>
          {!people.length ? <p className="muted">Sin dueño asignado.</p> : people.map((p: any) => (
            <div key={`${p.email}-${p.state}`} className="sa-person"><div><strong>{p.name}</strong><div className="small muted">{p.email} · {p.state}</div></div>
              {p.state !== 'Activo' && x.status !== 'trashed' && <button className="small" onClick={() => reissue(p.email)}>Generar enlace nuevo</button>}</div>))}
          {link && <><CopyLink label="Enlace nuevo para el dueño" url={link.url} /><LinkNote link={link} /></>}
        </section>

        <section><h3 className="rule-title">Enlaces</h3>
          <CopyLink label="Panel del local" url={x.panelUrl} />
          <CopyLink label="Carta pública" url={x.menuUrl} />
        </section>

        <section><h3 className="rule-title">Contenido</h3>
          <p className="small">{x.preview.highlights.map((h: any) => `${h.label}: ${h.n}`).join(' · ') || 'Sin datos cargados'} · {x.preview.files} {x.preview.files === 1 ? 'foto' : 'fotos'}</p>
        </section>

        <section><h3 className="rule-title">Acciones</h3>
          <div className="row">
            {x.status === 'active' && <button onClick={assist}>Entrar como asistencia</button>}
            {x.status === 'active' && <button onClick={() => setAsk({ action: 'suspend', title: `Suspender ${x.name}`, verb: 'Suspender', help: 'El personal no podrá entrar y la carta dejará de tomar pedidos y reservas. No se pierde ningún dato; podés reactivarlo cuando quieras.' })}>Suspender</button>}
            {x.status === 'suspended' && <button className="primary" onClick={() => setAsk({ action: 'reactivate', title: `Reactivar ${x.name}`, verb: 'Reactivar', help: 'El personal vuelve a entrar y la carta vuelve a tomar pedidos.' })}>Reactivar</button>}
            {x.status !== 'trashed' && <button className="danger" onClick={() => setAsk({ action: 'trash', title: `Enviar ${x.name} a la papelera`, verb: 'Enviar a papelera', danger: true, help: 'Sale de la lista de activos y queda fuera de servicio. Se conserva todo (carta, pedidos, fotos y enlaces) y se puede restaurar.' })}>Enviar a papelera</button>}
            {x.status === 'trashed' && <button className="primary" onClick={() => setAsk({ action: 'restore', title: `Restaurar ${x.name}`, verb: 'Restaurar', help: `Vuelve como estaba antes de la papelera (${x.trashed_from === 'suspended' ? 'suspendido' : 'activo'}), con su carta, pedidos, fotos y enlaces.` })}>Restaurar</button>}
            {x.status === 'trashed' && <button className="danger" onClick={() => setPurging(true)}>Eliminar definitivamente</button>}
          </div>
        </section>

        {x.history.length > 0 && <section><h3 className="rule-title">Historial del local</h3>
          <ul className="sa-history">{x.history.map((h: any) => <li key={h.id}><span className="small muted">{dateAR(h.at)}</span> {ACTION_LABEL[h.action] ?? h.action} · {h.user_name ?? '—'}{h.reason && <span className="muted"> · {h.reason}</span>}</li>)}</ul></section>}
      </div>
      {ask && <ReasonDialog {...ask} onClose={() => setAsk(null)} onConfirm={async (reason) => { await api(`/api/admin/restaurants/${x.id}/status`, { body: { action: ask.action, reason } }); setAsk(null); toast('Listo'); done(); }} />}
      {purging && <PurgeDialog x={x} onClose={() => setPurging(false)} onDone={() => { setPurging(false); onChange(); onClose(); toast(`${x.name} se eliminó definitivamente`); }} />}
    </Modal>
  );
}

function ReasonDialog({ title, verb, help, danger, onClose, onConfirm }: { title: string; verb: string; help: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(''); try { await onConfirm(reason); } catch (e: any) { setErr(e.message); setBusy(false); } };
  return (
    <Modal title={title} open onClose={onClose} footer={<><button onClick={onClose}>Cancelar</button><button className={danger ? 'danger' : 'primary'} disabled={busy || !reason.trim()} onClick={go}>{verb}</button></>}>
      <div className="stack">
        <p>{help}</p>
        <div className="field"><label htmlFor="sa-r">Motivo (queda en el historial)</label><input id="sa-r" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function PurgeDialog({ x, onClose, onDone }: { x: any; onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p = x.preview;
  const go = async () => { setBusy(true); setErr(''); try { await api(`/api/admin/restaurants/${x.id}/purge`, { body: { confirm, reason } }); onDone(); } catch (e: any) { setErr(e.message); setBusy(false); } };
  return (
    <Modal title={`Eliminar ${x.name} definitivamente`} open onClose={onClose} footer={<><button onClick={onClose}>Cancelar</button><button className="danger" disabled={busy || confirm.trim() !== x.slug || !reason.trim()} onClick={go}>{busy ? 'Eliminando…' : 'Eliminar definitivamente'}</button></>}>
      <div className="stack">
        <p className="cash-alert bad" role="note">Esto no se puede deshacer. Se borran solo los datos y archivos de este local; los demás restaurantes no se tocan.</p>
        <div><strong>Se va a borrar:</strong>
          <ul className="sa-purge">
            {p.highlights.map((h: any) => <li key={h.label}>{h.label}: <span className="num">{h.n}</span></li>)}
            <li><span className="num">{p.files}</span> {p.files === 1 ? 'foto' : 'fotos'}{p.files ? ` (${kb(p.bytes)})` : ''}</li>
            <li><span className="num">{p.total}</span> registros en total, incluidos turnos, mesas, auditoría interna y enlaces de acceso</li>
            <li>Las cuentas que solo trabajaban en este local quedan dadas de baja y sin datos personales</li>
          </ul>
          <p className="small muted">Queda un registro administrativo de quién lo eliminó, cuándo y por qué.</p>
        </div>
        <div className="field"><label htmlFor="sa-pr">Motivo</label><input id="sa-pr" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="field"><label htmlFor="sa-pc">Para confirmar, escribí el identificador <strong>{x.slug}</strong></label><input id="sa-pc" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} /></div>
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function History() {
  const a = useLoad(() => api('/api/admin/audit'));
  if (a.error) return <ErrorBox error={a.error} retry={a.reload} />;
  if (!a.data) return <Loading />;
  if (!a.data.length) return <Empty>Todavía no hay movimientos de plataforma.</Empty>;
  return (
    <div className="table-wrap"><table className="ledger">
      <thead><tr><th>Cuándo</th><th>Acción</th><th>Local</th><th>Quién</th><th className="hide-sm">Motivo</th></tr></thead>
      <tbody>{a.data.map((x: any) => <tr key={x.id}><td className="small">{dateAR(x.at)}</td><td>{ACTION_LABEL[x.action] ?? x.action}</td><td>{x.restaurant ?? '—'}{x.data?.restaurant_slug && <div className="small muted">{x.data.restaurant_slug}</div>}</td><td>{x.user_name ?? 'Consola'}</td><td className="hide-sm small">{x.reason}</td></tr>)}</tbody>
    </table></div>
  );
}
