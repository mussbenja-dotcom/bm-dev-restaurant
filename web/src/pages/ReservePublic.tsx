import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { brandVars } from '../../../shared/color.ts';
import { Icon } from '../icons.tsx';
import { api, todayAR, useLoad, useToast } from '../lib.tsx';
import { ErrorBox, Loading } from '../ui.tsx';

const TZ = 'America/Argentina/Buenos_Aires';
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, ...o });
const noon = (d: string) => new Date(`${d}T12:00:00-03:00`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** «Sábado 28/11» — día de la semana y fecha corta argentina. */
const dayLabel = (d: Date) => cap(`${fmt({ weekday: 'long' }).format(d)} ${fmt({ day: '2-digit', month: '2-digit' }).format(d)}`);
const people = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`;

export default function ReservePublic() {
  const { slug, token } = useParams();
  return token ? <Status token={token} /> : <Book slug={slug!} />;
}

/** Misma piel que la carta: colores, papel y logo del local, ancho cómodo y vuelta a la carta. */
function Frame({ b, slug, children }: { b: any; slug: string; children: React.ReactNode }) {
  return (
    <div className="menu rsv-page" data-style={b.style ?? 'clasica'} data-paper={b.paper ?? 'marfil'} style={brandVars(b.color ?? '#1f4d3a', b.paper ?? 'marfil') as React.CSSProperties}>
      <main className="rp-wrap">
        <Link className="rp-back" to={`/m/${slug}`}><span aria-hidden>←</span> Volver a la carta</Link>
        <header className="rp-head">
          {b.logo && <img className="m-logo" src={`/uploads/${b.logo}`} alt={`Logo de ${b.name}`} />}
          <div>
            <p className="rp-local">{b.name}</p>
            <h1 className="rp-title">Reservá tu mesa</h1>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function Book({ slug }: { slug: string }) {
  const nav = useNavigate();
  const r = useLoad(() => api(`/api/public/r/${slug}`), [slug]);
  const [f, setF] = useState({ name: '', phone: '', party: 2, date: todayAR(), time: '', notes: '' });
  const [days, setDays] = useState(14);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const slotsRef = useRef<HTMLHeadingElement>(null);
  const enabled = !!r.data?.reservations;
  const av = useLoad(() => (enabled ? api(`/api/public/r/${slug}/availability?date=${f.date}`) : Promise.resolve(null)), [slug, f.date, enabled]);

  if (r.error) return <main className="page"><ErrorBox error={r.error} retry={r.reload} /></main>;
  if (!r.data) return <main className="page"><Loading /></main>;
  const b = r.data.restaurant.brand;
  if (!enabled) return <Frame b={b} slug={slug}><p className="rp-note">Este local no toma reservas por la web. Comunicate por teléfono{b.phone ? ` al ${b.phone}` : ''}.</p></Frame>;

  const times: any[] = (av.data?.times ?? []).filter((t: any) => !t.past);
  const canWait = !!av.data?.waitlist;
  const sel = times.find((t) => t.time === f.time);
  const fits = sel ? sel.left >= f.party : false;
  const mode = !sel ? null : fits ? 'book' : canWait ? 'wait' : null;
  const allFull = times.length > 0 && times.every((t) => t.left < f.party);
  const set = (p: Partial<typeof f>) => { setErr(''); setF({ ...f, ...p }); };
  // Si con más personas el horario elegido ya no entra y no hay lista de espera, se deselecciona: el botón no queda trabado sin explicación.
  const setParty = (n: number) => set({ party: n, time: sel && sel.left < n && !canWait ? '' : f.time });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode || busy) return;
    setBusy(true); setErr('');
    try {
      const x = await api(`/api/public/r/${slug}/reservations`, { body: { ...f, waitlist: mode === 'wait' } });
      nav(`/reserva/${x.token}`);
    } catch (e: any) {
      // El servidor vuelve a contar el cupo: si se llenó mientras completaba, conserva los datos y pide otro horario.
      if (e.status === 409 || /Horario no disponible|ya pasó/.test(e.message)) { setF((p) => ({ ...p, time: '' })); av.reload(); slotsRef.current?.scrollIntoView({ block: 'start' }); slotsRef.current?.focus(); }
      setErr(e.status === 0 ? 'No pudimos enviar la reserva. Revisá la conexión y probá de nuevo; tus datos siguen acá.' : e.message);
    } finally { setBusy(false); }
  };

  return (
    <Frame b={b} slug={slug}>
      <form className="rp-form" onSubmit={submit}>
        <section className="rp-step" aria-labelledby="rp-s1">
          <h2 id="rp-s1">¿Cuántos son y qué día?</h2>
          <div className="rp-party" role="group" aria-label="Cantidad de personas">
            <button type="button" className="rp-step-btn" aria-label="Una persona menos" disabled={f.party <= 1} onClick={() => setParty(f.party - 1)}><Icon name="minus" /></button>
            <output aria-live="polite"><strong>{f.party}</strong> {f.party === 1 ? 'persona' : 'personas'}</output>
            <button type="button" className="rp-step-btn" aria-label="Una persona más" disabled={f.party >= 40} onClick={() => setParty(f.party + 1)}><Icon name="plus" /></button>
          </div>
          <div className="rp-days" role="group" aria-label="Día">
            {Array.from({ length: days }, (_, i) => todayAR(i)).map((d, i) => {
              const dt = noon(d);
              return (
                <button key={d} type="button" className="rp-day" aria-pressed={f.date === d} aria-label={`${i === 0 ? 'Hoy, ' : i === 1 ? 'Mañana, ' : ''}${dayLabel(dt)}`} onClick={() => set({ date: d, time: '' })}>
                  <span className="rp-dw">{i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : cap(fmt({ weekday: 'short' }).format(dt).replace('.', ''))}</span>
                  <span className="rp-dd">{fmt({ day: '2-digit', month: '2-digit' }).format(dt)}</span>
                </button>
              );
            })}
            {days < 90 && <button type="button" className="rp-day is-more" onClick={() => setDays(days + 14)}>Más días</button>}
          </div>
        </section>

        <section className="rp-step" aria-labelledby="rp-s2">
          <h2 id="rp-s2" ref={slotsRef} tabIndex={-1}>Elegí el horario <span className="rp-for">{dayLabel(noon(f.date))}</span></h2>
          {av.error ? (
            <div className="rp-state is-error" role="alert">No pudimos consultar los horarios. <button type="button" className="link-btn" onClick={av.reload}>Reintentar</button></div>
          ) : av.loading ? (
            <p className="rp-state" role="status">Buscando horarios…</p>
          ) : !times.length ? (
            <p className="rp-state">No hay horarios para ese día. Probá con otro.</p>
          ) : (
            <>
              <div className="rp-times" role="group" aria-label="Horarios">
                {times.map((t) => {
                  const ok = t.left >= f.party;
                  return (
                    <button key={t.time} type="button" className={`rp-time${ok ? '' : ' is-full'}`} aria-pressed={f.time === t.time} disabled={!ok && !canWait}
                      aria-label={`${t.time}, ${ok ? 'disponible' : canWait ? 'sin lugar, lista de espera' : 'completo'}`} onClick={() => set({ time: t.time })}>
                      <span className="rp-tt">{t.time}</span>
                      <span className="rp-ts">{ok ? 'Disponible' : canWait ? 'Lista de espera' : 'Completo'}</span>
                    </button>
                  );
                })}
              </div>
              {allFull && <p className="rp-state">No quedan lugares para {people(f.party)} ese día.{canWait ? ' Podés anotarte en la lista de espera o elegir otro día.' : ' Probá con otro día.'}</p>}
            </>
          )}
        </section>

        <section className="rp-step" aria-labelledby="rp-s3">
          <h2 id="rp-s3">Tus datos</h2>
          <div className="rp-fields">
            <div className="field"><label htmlFor="rp-n">Nombre</label><input id="rp-n" autoComplete="name" value={f.name} onChange={(e) => set({ name: e.target.value })} required maxLength={60} /></div>
            <div className="field"><label htmlFor="rp-p">Teléfono</label><input id="rp-p" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} required maxLength={30} /></div>
          </div>
          <div className="field"><label htmlFor="rp-o">Comentarios <span className="muted">(opcional)</span></label><textarea id="rp-o" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={300} placeholder="Silla para bebé, celíacos, cumpleaños…" /></div>
        </section>

        <div className="rp-submit">
          <p className="rp-sum" aria-live="polite">
            {sel ? <><strong>{dayLabel(noon(f.date))} · {f.time}</strong> · {people(f.party)}{mode === 'wait' && <span className="rp-waitnote">Ese horario está completo: quedás en lista de espera, todavía no es una reserva.</span>}</> : <span className="muted">Elegí un horario para continuar · {people(f.party)}</span>}
          </p>
          {err && <p className="field-error" role="alert">{err}</p>}
          <button className="primary big" disabled={!mode || busy}>{busy ? 'Enviando…' : mode === 'wait' ? 'Anotarme en la lista de espera' : 'Confirmar reserva'}</button>
        </div>
      </form>
    </Frame>
  );
}

function Status({ token }: { token: string }) {
  const toast = useToast();
  const x = useLoad(() => api(`/api/public/reservations/${token}`), [token]);
  if (x.error) return <main className="page"><ErrorBox error={x.error} retry={x.reload} /></main>;
  if (!x.data) return <main className="page"><Loading /></main>;
  const d = x.data;
  const cancel = async () => { if (!confirm('¿Cancelar la reserva?')) return; try { await api(`/api/public/reservations/${token}/cancel`, { body: {} }); x.reload(); } catch (e: any) { toast(e.message, true); } };
  const head: Record<string, [string, string]> = {
    confirmada: ['Reserva confirmada', 'Te esperamos. Si no podés venir, cancelala desde este enlace.'],
    espera: ['Te anotamos en la lista de espera', 'Todavía no es una reserva: si se libera un lugar, el local se comunica con vos.'],
    sentada: ['Ya estás en tu mesa', '¡Que lo disfrutes!'],
    cancelada: ['Reserva cancelada', 'Si querés, podés hacer una nueva.'],
    ausente: ['Reserva vencida', 'Si querés, podés hacer una nueva.'],
  };
  const [title, lead] = head[d.status] ?? [d.status, ''];
  const slot = new Date(d.slot);
  return (
    <Frame b={d.brand} slug={d.slug}>
      <section className={`rp-done is-${d.status}`} aria-labelledby="rp-done">
        <h2 id="rp-done">{d.status === 'confirmada' && <Icon name="check" />}{title}</h2>
        <p>{lead}</p>
        <dl className="rp-facts">
          <div><dt>Día</dt><dd>{dayLabel(slot)}</dd></div>
          <div><dt>Hora</dt><dd>{fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(slot)}</dd></div>
          <div><dt>Personas</dt><dd>{d.party}</dd></div>
          <div><dt>A nombre de</dt><dd>{d.name}</dd></div>
        </dl>
        {['confirmada', 'espera'].includes(d.status) && <button className="danger" onClick={cancel}>{d.status === 'espera' ? 'Salir de la lista de espera' : 'Cancelar reserva'}</button>}
        {['cancelada', 'ausente'].includes(d.status) && <Link className="btn primary" to={`/reservar/${d.slug}`}>Hacer otra reserva</Link>}
      </section>
      <p className="small muted">Guardá este enlace para consultar o cancelar.</p>
    </Frame>
  );
}
