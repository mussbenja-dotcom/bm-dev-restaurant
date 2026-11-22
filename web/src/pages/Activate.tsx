import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useLoad, useMe } from '../lib.tsx';
import { Loading } from '../ui.tsx';

/** Enlace de un solo uso: activar la cuenta (definir contraseña) o aceptar la invitación a un local. */
export default function Activate() {
  const { token } = useParams();
  const { reload } = useMe();
  const nav = useNavigate();
  const x = useLoad(() => api(`/api/account-links/${encodeURIComponent(token ?? '')}`), [token]);
  const [pw, setPw] = useState({ a: '', b: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (x.data.kind === 'activate' && pw.a !== pw.b) { setErr('Las dos contraseñas no coinciden'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api(`/api/account-links/${encodeURIComponent(token ?? '')}`, { body: { password: pw.a } });
      if (r.loggedIn) { await reload(); nav('/', { replace: true }); } else setAccepted(true);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <main className="page narrow" style={{ paddingTop: '8vh' }}>
      <h1>BM Dev Restaurant</h1>
      {x.error ? <div className="card stack"><p role="alert">{x.error}</p><Link to="/login">Ir a iniciar sesión</Link></div>
        : !x.data ? <Loading />
        : accepted ? <div className="card stack"><p>Listo: ya sos dueño de <strong>{x.data.restaurant}</strong>. Entrá con tu email y tu contraseña de siempre.</p><Link className="btn primary" to="/login">Iniciar sesión</Link></div>
        : (
          <form className="card stack" onSubmit={submit}>
            <p style={{ margin: 0 }}>{x.data.kind === 'activate'
              ? <>Hola, {x.data.name}. Definí tu contraseña para entrar{x.data.restaurant ? <> al panel de <strong>{x.data.restaurant}</strong></> : ' como Superadmin'}.</>
              : <>Hola, {x.data.name}. Te invitaron a administrar <strong>{x.data.restaurant}</strong> con tu cuenta {x.data.email}. Tu contraseña no cambia.</>}</p>
            {x.data.kind === 'activate' && <>
              <input type="email" autoComplete="username" value={x.data.email} readOnly hidden />
              <div className="field"><label htmlFor="pw1">Contraseña (8 caracteres o más)</label><input id="pw1" type="password" autoComplete="new-password" minLength={8} value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} required /></div>
              <div className="field"><label htmlFor="pw2">Repetila</label><input id="pw2" type="password" autoComplete="new-password" minLength={8} value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required /></div>
            </>}
            {err && <p className="field-error" role="alert">{err}</p>}
            <button className="primary big block" disabled={busy}>{busy ? 'Un momento…' : x.data.kind === 'activate' ? 'Guardar y entrar' : 'Aceptar invitación'}</button>
          </form>
        )}
    </main>
  );
}
