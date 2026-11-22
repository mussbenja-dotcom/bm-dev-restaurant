import { StrictMode, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './styles.css';
import { api, can, closeLive, hhmm, MeCtx, ToastProvider, useMe, useNotices, useOnline, type Me } from './lib.tsx';
import { Loading } from './ui.tsx';
import { Icon, type IconName } from './icons.tsx';
import { inkOn, readableOn } from '../../shared/color.ts';

const Floor = lazy(() => import('./pages/Floor.tsx'));
const TablePage = lazy(() => import('./pages/Table.tsx'));
const Kds = lazy(() => import('./pages/Kds.tsx'));
const Cash = lazy(() => import('./pages/Cash.tsx'));
const Ticket = lazy(() => import('./pages/Ticket.tsx'));
const Owner = lazy(() => import('./pages/Owner.tsx'));
const Config = lazy(() => import('./pages/Config.tsx'));
const Orders = lazy(() => import('./pages/Orders.tsx'));
const Rider = lazy(() => import('./pages/Rider.tsx'));
const Reservations = lazy(() => import('./pages/Reservations.tsx'));
const Stock = lazy(() => import('./pages/Stock.tsx'));
const Superadmin = lazy(() => import('./pages/Superadmin.tsx'));
const Activate = lazy(() => import('./pages/Activate.tsx'));
const PublicMenu = lazy(() => import('./pages/PublicMenu.tsx'));
const Track = lazy(() => import('./pages/Track.tsx'));
const ReservePublic = lazy(() => import('./pages/ReservePublic.tsx'));
const Personalize = lazy(() => import('./pages/Personalize.tsx'));

/** Cada rol abre directamente en la pantalla que usa durante el turno. */
export function homeFor(me: Me): string {
  if (!me.restaurant) return me.user.isPlatformAdmin ? '/superadmin' : '/login';
  const r = me.roles;
  if (r.includes('owner') || r.includes('manager')) return '/app/dueno';
  if (r.includes('waiter')) return '/app/salon';
  if (r.includes('cashier')) return '/app/caja';
  if (r.includes('kitchen') || r.includes('bar')) return '/app/cocina';
  if (r.includes('pass')) return '/app/pase';
  if (r.includes('rider')) return '/repartidor';
  if (r.includes('reservations')) return '/app/reservas';
  if (r.includes('stock')) return '/app/stock';
  return '/login';
}

function Login() {
  const { me, reload } = useMe();
  const nav = useNavigate();
  const [email, setEmail] = useState(localStorage.getItem('last-email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  useEffect(() => { api('/api/setup/status').then((s) => setSetup(s.needsSetup)).catch(() => {}); }, []);
  useEffect(() => { if (me) nav(homeFor(me), { replace: true }); }, [me, nav]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/login', { body: { email, password } });
      localStorage.setItem('last-email', email);
      await reload();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <main className="page narrow" style={{ paddingTop: '10vh' }}>
      <h1>BM Dev Restaurant</h1>
      <p className="muted">Ingresá con tu usuario personal.</p>
      {setup && <div className="card" style={{ marginBottom: 16 }}>Instalación nueva: <NavLink to="/alta">crear el primer administrador</NavLink>.</div>}
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pw">Contraseña</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="primary big block" disabled={busy || !email || !password}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="small muted" style={{ margin: 0 }}>¿Olvidaste tu clave? Pedile al dueño del local que la restablezca.</p>
      </form>
    </main>
  );
}

function Setup() {
  const { reload } = useMe();
  const [f, setF] = useState({ code: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const nav = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/api/setup', { body: f }); await reload(); nav('/superadmin'); } catch (err: any) { setError(err.message); }
  };
  return (
    <main className="page narrow" style={{ paddingTop: '6vh' }}>
      <h1>Alta del primer administrador</h1>
      <p className="muted">El código de instalación aparece en la consola donde iniciaste el servidor. Se usa una sola vez.</p>
      <form className="card stack" onSubmit={submit}>
        {(['code', 'name', 'email', 'password'] as const).map((k) => (
          <div className="field" key={k}><label htmlFor={k}>{{ code: 'Código de instalación', name: 'Tu nombre', email: 'Email', password: 'Contraseña (8+ caracteres)' }[k]}</label>
            <input id={k} type={k === 'password' ? 'password' : k === 'email' ? 'email' : 'text'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required /></div>
        ))}
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="primary big block">Crear administrador</button>
      </form>
    </main>
  );
}

type NavItem = { to: string; label: string; icon: IconName; roles: string[]; group: 'Servicio' | 'Gestión' };
const NAV: NavItem[] = [
  { to: '/app/dueno', label: 'Panel', icon: 'panel', roles: ['owner', 'manager'], group: 'Gestión' },
  { to: '/app/salon', label: 'Salón', icon: 'salon', roles: ['waiter'], group: 'Servicio' },
  { to: '/app/cocina', label: 'Cocina y barra', icon: 'cocina', roles: ['kitchen', 'bar'], group: 'Servicio' },
  { to: '/app/pase', label: 'Pase', icon: 'pase', roles: ['pass'], group: 'Servicio' },
  { to: '/app/caja', label: 'Caja', icon: 'caja', roles: ['cashier'], group: 'Servicio' },
  { to: '/app/pedidos', label: 'Retiro y delivery', icon: 'pedidos', roles: ['cashier', 'pass'], group: 'Servicio' },
  { to: '/app/reservas', label: 'Reservas', icon: 'reservas', roles: ['reservations'], group: 'Servicio' },
  { to: '/app/personalizar', label: 'Personalizar mi restaurante', icon: 'brush', roles: ['owner', 'manager'], group: 'Gestión' },
  { to: '/app/stock', label: 'Stock y costos', icon: 'stock', roles: ['stock'], group: 'Gestión' },
  { to: '/app/config', label: 'Configuración', icon: 'config', roles: ['owner', 'manager'], group: 'Gestión' },
];
const SHORT: Record<string, string> = { 'Cocina y barra': 'Cocina', 'Retiro y delivery': 'Pedidos', 'Personalizar mi restaurante': 'Personalizar', 'Stock y costos': 'Stock', Configuración: 'Ajustes' };

/** Color del local: solo en su marca del costado. Las acciones del personal usan el verde del sistema (la carta pública sí lleva la marca completa). */
function staffVars(r: any): React.CSSProperties {
  const c = r?.settings?.brand?.color;
  if (!c) return {};
  const brand = readableOn(c, '#ffffff');
  return { '--local': brand, '--local-ink': inkOn(brand) } as React.CSSProperties;
}

function BrandMark({ r }: { r: any }) {
  const logo = r.settings?.brand?.logo;
  return <span className="brandmark">{logo ? <img src={`/uploads/${logo}`} alt="" /> : <span className="mono" aria-hidden>{r.name.slice(0, 1)}</span>}<span>{r.name}</span></span>;
}

/** Aviso al mozo: pedido enviado desde el QR de una de sus mesas. */
function Notices() {
  const { list, dismiss } = useNotices();
  const nav = useNavigate();
  if (!list.length) return null;
  return (
    <div className="notices" role="status" aria-live="polite">
      {list.map((n) => (
        <div key={`${n.visitId}-${n.round}`} className="notice">
          <span><strong>Mesa {String(n.tables ?? '')}</strong> pidió por QR · comanda {String(n.round)} · {hhmm(String(n.at))}</span>
          <span className="row">
            <button className="primary" onClick={() => { dismiss(n); nav(`/app/mesa/${n.visitId}`); }}>Ver pedido</button>
            <button className="ghost icon-btn" aria-label="Cerrar aviso" onClick={() => dismiss(n)}><Icon name="close" /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { me, reload } = useMe();
  const online = useOnline();
  const nav = useNavigate();
  const loc = useLocation();
  // El menú «Más» queda abierto solo en la ruta donde se abrió: al navegar se cierra solo.
  const [moreAt, setMoreAt] = useState<string | null>(null);
  const more = moreAt === loc.pathname;
  const setMore = (v: boolean) => setMoreAt(v ? loc.pathname : null);
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!me.restaurant) return <Navigate to={me.user.isPlatformAdmin ? '/superadmin' : '/login'} replace />;
  const links = NAV.filter((l) => can(me, ...l.roles));
  const logout = async () => { await api('/api/logout', { body: {} }).catch(() => {}); closeLive(); await reload(); nav('/login'); };
  const switcher = me.restaurants.length > 1 && (
    <select aria-label="Cambiar de local" value={me.restaurant.id} onChange={async (e) => { await api('/api/me/restaurant', { body: { restaurantId: Number(e.target.value) } }); closeLive(); await reload(); nav('/app'); }}>
      {me.restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
  const list = (
    <nav className="navlist" aria-label="Secciones">
      {(['Servicio', 'Gestión'] as const).map((g) => links.some((l) => l.group === g) && (
        <div key={g} style={{ display: 'contents' }}>
          <div className="group">{g}</div>
          {links.filter((l) => l.group === g).map((l) => <NavLink key={l.to} to={l.to}><Icon name={l.icon} />{l.label}</NavLink>)}
        </div>
      ))}
    </nav>
  );
  // Barra inferior: hasta 4 accesos del rol + «Más» con el resto.
  const tabs = links.length > 5 ? links.slice(0, 4) : links;
  const first = me.user.name.split(' ')[0];
  return (
    <div className="app" data-theme={me.restaurant.theme} style={staffVars(me.restaurant)}>
      <aside className="side" aria-label="Navegación">
        <BrandMark r={me.restaurant} />
        {list}
        <div className="side-foot">
          {switcher}
          <button className="ghost" onClick={logout} style={{ justifyContent: 'flex-start' }}><Icon name="logout" />{first} · Cambiar persona</button>
        </div>
      </aside>
      <div className="main-area">
        {!online && <div className="banner offline" role="alert">Sin conexión. Lo que cargues queda pendiente de enviar.</div>}
        {me.user.isPlatformAdmin && <div className="banner assist" role="status">Asistencia de BM Dev en {me.restaurant.name} · <NavLink to="/superadmin">Volver a Superadmin</NavLink></div>}
        <Notices />
        <header className="topbar">
          <div className="topbar-in">
            <BrandMark r={me.restaurant} />
            <div className="who"><button className="ghost small" onClick={logout} aria-label={`Cambiar persona (sesión de ${me.user.name})`}><Icon name="user" />{first}</button></div>
          </div>
        </header>
        <Suspense fallback={<div className="page"><Loading /></div>}><Outlet /></Suspense>
      </div>
      {links.length > 1 && (
        <nav className="tabbar" aria-label="Accesos rápidos">
          {tabs.map((l) => <NavLink key={l.to} to={l.to}><Icon name={l.icon} />{SHORT[l.label] ?? l.label}</NavLink>)}
          {links.length > tabs.length && <button onClick={() => setMore(true)} aria-expanded={more}><Icon name="more" />Más</button>}
        </nav>
      )}
      {more && <>
        <button className="sheet-backdrop" aria-label="Cerrar menú" onClick={() => setMore(false)} />
        <div className="sheet" role="dialog" aria-label="Todas las secciones">{list}{switcher && <div style={{ marginTop: 12 }}>{switcher}</div>}</div>
      </>}
    </div>
  );
}

function AppHome() {
  const { me } = useMe();
  return me ? <Navigate to={homeFor(me)} replace /> : <Navigate to="/login" replace />;
}

function Root() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    try { setMe(await api<Me>('/api/me')); } catch { setMe(null); } finally { setReady(true); }
  }, []);
  useEffect(() => { reload(); }, [reload]); // oxlint-disable-line react/set-state-in-effect -- carga inicial; el setState ocurre después del await
  if (!ready) return <div className="page"><Loading /></div>;
  return (
    <MeCtx.Provider value={{ me, reload }}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<div className="page"><Loading /></div>}>
            <Routes>
              <Route path="/" element={<AppHome />} />
              <Route path="/login" element={<Login />} />
              <Route path="/alta" element={<Setup />} />
              <Route path="/admin" element={<Navigate to="/superadmin" replace />} />
              <Route path="/superadmin" element={<Superadmin />} />
              <Route path="/superadmin/:tab" element={<Superadmin />} />
              <Route path="/activar/:token" element={<Activate />} />
              <Route path="/m/:slug" element={<PublicMenu />} />
              <Route path="/vista-previa" element={<PublicMenu preview />} />
              <Route path="/mesa/:qr" element={<PublicMenu />} />
              <Route path="/pedido/:token" element={<Track />} />
              <Route path="/reservar/:slug" element={<ReservePublic />} />
              <Route path="/reserva/:token" element={<ReservePublic />} />
              <Route path="/repartidor" element={<Rider />} />
              <Route path="/ticket/:id" element={<Ticket />} />
              <Route path="/app" element={<Shell />}>
                <Route index element={<AppHome />} />
                <Route path="dueno" element={<Owner />} />
                <Route path="salon" element={<Floor />} />
                <Route path="mesa/:id" element={<TablePage />} />
                <Route path="cocina" element={<Kds mode="station" />} />
                <Route path="pase" element={<Kds mode="pass" />} />
                <Route path="caja" element={<Cash />} />
                <Route path="caja/:tab" element={<Cash />} />
                <Route path="caja/turno/:shiftId" element={<Cash />} />
                <Route path="pedidos" element={<Orders />} />
                <Route path="reservas" element={<Reservations />} />
                <Route path="stock" element={<Stock />} />
                <Route path="personalizar" element={<Personalize />} />
                <Route path="personalizar/:tab" element={<Personalize />} />
                <Route path="config" element={<Config />} />
                <Route path="config/:tab" element={<Config />} />
              </Route>
              <Route path="*" element={<main className="page"><h1>No encontrado</h1><NavLink to="/">Volver al inicio</NavLink></main>} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </MeCtx.Provider>
  );
}

// El service worker requiere origen seguro (localhost o HTTPS); en desarrollo no se registra.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
