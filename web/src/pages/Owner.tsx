import { Link } from 'react-router-dom';
import { api, useLive, useLoad, useMe } from '../lib.tsx';
import { ErrorBox, Loading, Money } from '../ui.tsx';
import { Icon, type IconName } from '../icons.tsx';

// Cada aviso dice qué es con una palabra además del color: demora y diferencia de caja pesan más que el resto.
const KIND: Record<string, [IconName, string, string]> = {
  cuenta: ['receipt', 'Cuenta', 'warn'], demora: ['clock', 'Demora', 'bad'], caja: ['money', 'Caja', 'bad'],
  stock: ['box', 'Stock', 'warn'], pedidos: ['bike', 'Pedidos', 'warn'], reparto: ['alert', 'Reparto', 'bad'],
};
const METHOD: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };

// Accesos del dueño agrupados por lo que quiere hacer, no por cómo está armado el sistema.
const HUB: { title: string; links: [string, string][] }[] = [
  { title: 'Carta y marca', links: [['/app/personalizar/marca', 'Logo, colores y estilo de carta'], ['/app/personalizar/carta', 'Platos, precios, variantes y combos'], ['/app/personalizar/vista', 'Vista previa en el celular']] },
  { title: 'Operación', links: [['/app/config/mesas', 'Mesas, sectores y QR'], ['/app/config/local', 'Horarios, cobros y funciones'], ['/app/config/canales', 'Retiro, delivery y zonas'], ['/app/config/promos', 'Promociones']] },
  { title: 'Equipo', links: [['/app/config/equipo', 'Personas y permisos'], ['/app/config/auditoria', 'Registro de cambios'], ['/app/config/sucursales', 'Otros locales']] },
  { title: 'Números', links: [['/app/caja/historial', 'Cierres de caja anteriores'], ['/app/stock?tab=margenes', 'Márgenes: qué platos empujar'], ['/app/stock?tab=prep', 'Preparación del próximo turno']] },
];

export default function Owner() {
  const { me } = useMe();
  const d = useLoad(() => api('/api/dashboard'));
  const floor = useLoad(() => api('/api/floor'));
  const branches = useLoad(() => api('/api/reports/branches'));
  useLive(['floor', 'lines', 'cash', 'orders', 'menu'], () => { d.reload(); floor.reload(); });
  if (d.error) return <div className="page"><ErrorBox error={d.error} retry={d.reload} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const s = d.data.summary;
  const cobrado = s ? s.byMethod.reduce((t: number, m: any) => t + m.neto, 0) : 0;
  const tables: any[] = floor.data?.tables ?? [];
  const visits: any[] = floor.data?.visits ?? [];
  const busy = tables.filter((t) => t.visit_id).length;
  const bills = new Set((floor.data?.calls ?? []).filter((c: any) => c.reason === 'cuenta').map((c: any) => c.visit_id)).size;
  const noWaiter = visits.filter((v) => !v.waiter).length;
  const toClean = tables.filter((t) => !t.visit_id && t.needs_cleaning).length;
  return (
    <main className="page owner">
      <div className="page-head">
        <div><h1>Hola, {me?.user.name.split(' ')[0]}</h1><div className="sub">Fecha operativa {d.data.operationalDate}{s ? ' · caja abierta' : ' · caja cerrada'}</div></div>
        <div className="row">
          <a className="btn ghost" href={`/m/${me?.restaurant.slug}`} target="_blank" rel="noreferrer"><Icon name="external" />Ver mi carta</a>
          <Link className="btn primary" to="/app/salon"><Icon name="salon" />Abrir mesa</Link>
        </div>
      </div>

      <div className="owner-grid">
        <section aria-labelledby="h-attn" className="owner-attn">
          <h2 id="h-attn" className="rule-title">Qué necesita atención {d.data.allAlerts > 3 && <span className="muted">+{d.data.allAlerts - 3} de menor prioridad</span>}</h2>
          {d.data.alerts.length === 0 ? <p className="empty-line">Nada urgente. El turno viene en orden.</p> : (
            <div className="attn">
              {d.data.alerts.map((a: any, i: number) => {
                const [icon, label, tone] = KIND[a.kind] ?? ['alert', 'Aviso', 'warn'];
                return <Link key={i} to={a.link} className={`is-${tone}`}><span className="ico"><Icon name={icon} /></span><span><span className="attn-kind">{label}</span>{a.text}</span><span className="go">Resolver</span></Link>;
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="h-floor" className="owner-floor">
          <div className="rule-title"><h2 id="h-floor">Salón ahora</h2><Link className="small" to="/app/salon">Ver salón</Link></div>
          {floor.error ? <ErrorBox error={floor.error} retry={floor.reload} /> : !floor.data ? <Loading /> : <>
            <p className="floor-now"><strong className="num">{busy}</strong> de {tables.length} mesas ocupadas</p>
            <ul className="floor-facts">
              <li className={bills ? 'is-warn' : ''}><span className="num">{bills}</span> {bills === 1 ? 'pide la cuenta' : 'piden la cuenta'}</li>
              <li className={noWaiter ? 'is-warn' : ''}><span className="num">{noWaiter}</span> sin mozo asignado</li>
              <li><span className="num">{toClean}</span> para limpiar</li>
            </ul>
            <p className="small muted" style={{ margin: 0 }}>Desde el salón abrís mesas, habilitás los pedidos por QR y asignás mozo. Podés abrir una mesa antes de asignarle mozo.</p>
          </>}
        </section>
      </div>

      <section aria-labelledby="h-shift">
        <div className="rule-title"><h2 id="h-shift">Turno en curso</h2>{s && <Link className="small" to="/app/caja/turno">Ver arqueo</Link>}</div>
        {!s ? <p className="empty-line">La caja está cerrada. <Link to="/app/caja/turno">Abrir caja</Link></p> : <>
          <div className="kpi-strip">
            <div><div className="lbl">Vendido</div><div className="val"><Money c={s.ventas} /></div></div>
            <div><div className="lbl">Cobrado</div><div className="val"><Money c={cobrado} /></div></div>
            <div><div className="lbl">Sin cobrar</div><div className="val"><Money c={s.ventas - cobrado} /></div><div className="foot">{s.openVisits.length} {s.openVisits.length === 1 ? 'mesa abierta' : 'mesas abiertas'}</div></div>
            <div><div className="lbl">Efectivo esperado en caja</div><div className="val"><Money c={s.expected} /></div></div>
          </div>
          {s.byMethod.length > 0 && (
            <div className="table-wrap"><table className="ledger">
              <thead><tr><th>Medio</th><th className="right">Neto</th><th className="right">Propinas</th></tr></thead>
              <tbody>{s.byMethod.map((m: any) => <tr key={m.method}><td>{METHOD[m.method] ?? m.method} ({m.n})</td><td className="right"><Money c={m.neto} /></td><td className="right"><Money c={m.propinas} /></td></tr>)}</tbody>
            </table></div>
          )}
        </>}
      </section>

      <section aria-labelledby="h-hub">
        <h2 id="h-hub" className="rule-title">Tu restaurante</h2>
        <div className="hub">
          {HUB.map((h) => (
            <nav key={h.title} aria-label={h.title} className="hub-col">
              <h3>{h.title}</h3>
              <ul>{h.links.map(([to, l]) => <li key={to}><Link to={to}>{l}</Link></li>)}</ul>
            </nav>
          ))}
        </div>
      </section>

      {branches.data && branches.data.length > 1 && (
        <section aria-labelledby="h-br"><h2 id="h-br" className="rule-title">Tus locales · últimos 7 días</h2>
          <div className="table-wrap"><table className="ledger"><thead><tr><th>Local</th><th className="right">Ventas</th><th className="right">Cobros</th><th className="right">Pedidos</th><th className="right">Mesas abiertas</th></tr></thead>
            <tbody>{branches.data.map((b: any) => <tr key={b.id}><td>{b.name}</td><td className="right"><Money c={b.ventas_7d} /></td><td className="right"><Money c={b.cobros_7d} /></td><td className="right">{b.pedidos_7d}</td><td className="right">{b.mesas_abiertas}</td></tr>)}</tbody></table></div>
        </section>
      )}

      <section aria-labelledby="h-exp" className="owner-exp">
        <h2 id="h-exp" className="rule-title">Exportar planillas (CSV)</h2>
        <div className="row">
          <a className="btn small" href="/api/export/ventas">Ventas</a>
          <a className="btn small" href="/api/export/cobros">Cobros</a>
          <a className="btn small" href="/api/export/turnos">Turnos</a>
          <a className="btn small" href="/api/export/auditoria">Auditoría</a>
          {d.data.lastClosed && <span className="small muted">Último cierre: diferencia <Money c={d.data.lastClosed.difference ?? 0} />. <Link to={`/app/caja/turno/${d.data.lastClosed.id}`}>Ver detalle</Link></span>}
        </div>
      </section>
    </main>
  );
}
