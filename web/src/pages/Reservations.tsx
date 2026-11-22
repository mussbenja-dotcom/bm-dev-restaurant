import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, hhmm, todayAR, useLive, useLoad, useMe, useToast } from '../lib.tsx';
import { ErrorBox, Loading, Modal } from '../ui.tsx';
import { Icon } from '../icons.tsx';

const ST: Record<string, [string, string]> = { confirmada: ['Confirmada', 'st-open'], espera: ['Lista de espera', 'st-wait'], sentada: ['Sentada', 'st-ok'], cancelada: ['Cancelada', 'st-free'], ausente: ['No vino', 'st-bad'] };
const shift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export default function Reservations() {
  const { me } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [day, setDay] = useState(todayAR());
  const r = useLoad(() => api(`/api/reservations?date=${day}`), [day]);
  const floor = useLoad(() => api('/api/floor'));
  useLive(['reservations', 'floor'], () => { r.reload(); floor.reload(); });
  const [form, setForm] = useState<any>(null);
  const [seat, setSeat] = useState<any>(null);
  const [table, setTable] = useState('');
  if (r.error) return <div className="page"><ErrorBox error={r.error} retry={r.reload} /></div>;
  if (!r.data) return <div className="page"><Loading /></div>;
  const cfg = r.data.config;
  const list: any[] = r.data.reservations;
  const used = (t: string) => list.filter((x: any) => hhmm(x.slot) === t && ['confirmada', 'sentada'].includes(x.status)).reduce((s: number, x: any) => s + x.party, 0);
  const act = async (x: any, status: string) => { try { await api(`/api/reservations/${x.id}/status`, { body: { status } }); r.reload(); } catch (e: any) { toast(e.message, true); } };
  const save = async () => { try { await api('/api/reservations', { body: { ...form, date: day } }); setForm(null); r.reload(); toast('Reserva cargada'); } catch (e: any) { toast(e.message, true); } };
  const sit = async () => {
    try { const v = await api('/api/visits', { body: { tableId: Number(table), guests: seat.party, reservationId: seat.id } }); setSeat(null); nav(`/app/mesa/${v.id}`); } catch (e: any) { toast(e.message, true); }
  };
  // Agenda: los horarios configurados (aunque estén vacíos) más cualquier otro que tenga reservas.
  const times: string[] = [...new Set<string>([...(cfg.times ?? []), ...list.map((x: any) => hhmm(x.slot))])].sort();
  const covers = list.filter((x: any) => ['confirmada', 'sentada'].includes(x.status)).reduce((s: number, x: any) => s + x.party, 0);
  const today = day === todayAR();
  return (
    <main className="page">
      <div className="page-head">
        <div><h1>Reservas</h1>
          <div className="sub">{list.length ? `${list.length} ${list.length === 1 ? 'reserva' : 'reservas'} · ${covers} cubiertos confirmados` : 'Sin reservas para este día'}</div></div>
        <div className="row">
          <a className="btn ghost" href={`/reservar/${me!.restaurant.slug}`} target="_blank" rel="noreferrer"><Icon name="external" />Enlace público</a>
          <button className="primary" onClick={() => setForm({ name: '', phone: '', party: 2, time: cfg.times?.[0] ?? '21:00', notes: '', waitlist: false })}><Icon name="plus" />Nueva reserva</button>
        </div>
      </div>
      <div className="res-day" role="group" aria-label="Día">
        <span className="res-date">{today ? 'Hoy, ' : ''}{longDay(day)}</span>
        <button className="small" aria-label="Día anterior" onClick={() => setDay(shift(day, -1))}>Anterior</button>
        <button className="small" aria-label="Día siguiente" onClick={() => setDay(shift(day, 1))}>Siguiente</button>
        {!today && <button className="ghost" onClick={() => setDay(todayAR())}>Volver a hoy</button>}
        <input type="date" aria-label="Elegir día" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
      </div>
      {!cfg.enabled && <p className="cash-alert">Las reservas por enlace están desactivadas. Activalas en Configuración → Retiro y delivery.</p>}
      <div className="agenda">
        {times.map((t) => {
          const rows = list.filter((x: any) => hhmm(x.slot) === t);
          const left = (cfg.capacity ?? 0) - used(t);
          return (
            <section key={t} className="slot" aria-label={`${t}, quedan ${Math.max(0, left)} cubiertos`}>
              <div className="slot-time"><strong>{t}</strong><span className={`slot-cap${left <= 0 ? ' is-full' : ''}`}>{left <= 0 ? 'Completo' : `Quedan ${left} de ${cfg.capacity}`}</span></div>
              <div className="slot-list">
                {!rows.length && <p className="slot-empty">Sin reservas</p>}
                {rows.map((x: any) => (
                  <div key={x.id} className={`rsv is-${x.status}`}>
                    <span className="rsv-party">{x.party}<small>pers.</small></span>
                    <div className="rsv-who"><strong>{x.name}</strong> <span className={`pill ${ST[x.status][1]}`}>{ST[x.status][0]}</span>{x.table_number && <span className="small"> · mesa {x.table_number}</span>}
                      <div className="small">{[x.phone, x.notes].filter(Boolean).join(' · ')}</div></div>
                    <div className="rsv-acts">
                      {['confirmada', 'espera'].includes(x.status) && <button className="primary" onClick={() => { setTable(''); setSeat(x); }}>Sentar</button>}
                      {x.status === 'espera' && <button onClick={() => act(x, 'confirmada')}>Confirmar lugar</button>}
                      {x.status === 'confirmada' && <button onClick={() => act(x, 'ausente')}>No vino</button>}
                      {['confirmada', 'espera'].includes(x.status) && <button className="ghost" onClick={() => act(x, 'cancelada')}>Cancelar</button>}
                      {x.phone && x.status === 'espera' && <a className="btn small" href={`https://wa.me/${x.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${x.name}, se liberó una mesa para ${x.party} en ${me!.restaurant.name} a las ${hhmm(x.slot)}. ¿La confirmamos?`)}`} target="_blank" rel="noreferrer">Avisar por WhatsApp</a>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <Modal title="Nueva reserva" open={!!form} onClose={() => setForm(null)} footer={<button className="primary" disabled={!form?.name} onClick={save}>Guardar</button>}>
        {form && <div className="stack">
          <div className="field"><label htmlFor="rn">Nombre</label><input id="rn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="rp">Teléfono</label><input id="rp" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="rq">Personas</label><input id="rq" type="number" min={1} value={form.party} onChange={(e) => setForm({ ...form, party: Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor="rt">Horario</label><select id="rt" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}>{(cfg.times ?? []).map((t: string) => <option key={t} value={t}>{t} · quedan {cfg.capacity - used(t)}</option>)}</select></div>
          </div>
          <div className="field"><label htmlFor="rno">Notas</label><input id="rno" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <label className="check"><input type="checkbox" checked={form.waitlist} onChange={(e) => setForm({ ...form, waitlist: e.target.checked })} /> Si no hay lugar, anotar en lista de espera</label>
        </div>}
      </Modal>
      <Modal title={`Sentar a ${seat?.name ?? ''}`} open={!!seat} onClose={() => setSeat(null)} footer={<button className="primary" disabled={!table} onClick={sit}>Abrir mesa</button>}>
        <div className="field"><label htmlFor="st">Mesa libre</label><select id="st" value={table} onChange={(e) => setTable(e.target.value)}><option value="">Elegí…</option>{(floor.data?.tables ?? []).filter((t: any) => !t.visit_id).map((t: any) => <option key={t.id} value={t.id}>{t.number} · {t.area} · {t.seats} lugares</option>)}</select></div>
      </Modal>
    </main>
  );
}
