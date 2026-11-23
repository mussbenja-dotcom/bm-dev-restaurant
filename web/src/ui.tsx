import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ars } from './lib.tsx';
import { Icon } from './icons.tsx';
import { parseArs } from '../../shared/money.ts';

export const Money = ({ c, className = '' }: { c: number; className?: string }) => <span className={`money ${className}`}>{ars(c)}</span>;

/**
 * Diálogo modal. Se cierra con «X», Escape o (si backdropClose) con un clic en el fondo.
 * backdropClose={false} en formularios: un clic afuera no debe perder lo escrito.
 */
export function Modal({ title, open, onClose, children, footer, backdropClose = true, busy = false }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; backdropClose?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Un clic que empieza adentro (p. ej. seleccionar texto) y se suelta en el fondo también llega como clic al <dialog>: solo cuenta si empezó en el fondo.
  const downOnBackdrop = useRef(false);
  const tid = useId(); // dos diálogos abiertos (plato sobre el pedido) no comparten título
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- clic en el fondo = atajo de mouse; teclado: Esc nativo o botón Cerrar
    <dialog ref={ref} onClose={() => { if (busy) ref.current?.showModal(); else onClose(); }} aria-labelledby={tid} aria-busy={busy || undefined}
      onCancel={(e) => { if (busy) e.preventDefault(); }} // Escape no cierra mientras se guarda (si Chrome igual lo cierra, onClose lo reabre): si falla, lo escrito sigue ahí
      onPointerDown={(e) => { downOnBackdrop.current = e.target === ref.current; }}
      onClick={(e) => { if (backdropClose && downOnBackdrop.current && e.target === ref.current) onClose(); downOnBackdrop.current = false; }}>
      {open && <>
        <div className="dlg-head"><h2 id={tid} style={{ margin: 0 }}>{title}</h2><button className="ghost icon-btn" onClick={onClose} aria-label="Cerrar" disabled={busy}><Icon name="close" /></button></div>
        <div className="dlg-body">{children}</div>
        {footer && <div className="dlg-foot">{footer}</div>}
      </>}
    </dialog>
  );
}

/** Campo de importe en pesos: acepta "8000", "8.000" o "8.000,50". Devuelve centavos o NaN. */
export function MoneyInput({ label, value, onChange, id, autoFocus }: { label: string; value: string; onChange: (raw: string, cents: number) => void; id: string; autoFocus?: boolean }) {
  const cents = value ? parseArs(value) : 0;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} inputMode="decimal" autoComplete="off" value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value, parseArs(e.target.value))} aria-invalid={Number.isNaN(cents)} className="num" />
      {Number.isNaN(cents) && <span className="field-error">Importe inválido. Ejemplo: 8.000 o 8000,50</span>}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, label, disabled = false }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; disabled?: boolean }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label={`Menos ${label}`}><Icon name="minus" /></button>
      <span className="num" aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label={`Más ${label}`}><Icon name="plus" /></button>
    </div>
  );
}

export const LINE_STATUS: Record<string, [string, string]> = {
  pending: ['Pendiente', 'st-wait'], preparing: ['En preparación', 'st-open'], ready: ['Listo', 'st-ok'], delivered: ['Entregado', 'st-free'], void: ['Anulado', 'st-bad'],
};
export function LineStatus({ l }: { l: any }) {
  const [t, c] = LINE_STATUS[l.status] ?? [l.status, ''];
  const partial = l.status === 'preparing' && l.qty_ready > 0 ? ` · ${l.qty_ready} de ${l.qty} listos` : '';
  const held = l.held && l.status === 'pending' ? 'En espera' : null;
  return <span className={`pill ${held ? 'st-clean' : c}`}>{held ?? t + partial}</span>;
}

export const optionsText = (opts: any[]) => (opts ?? []).filter((o) => o.grp !== 'Promo').map((o) => (o.qty ? `${o.qty}× ${o.name}` : o.grp.startsWith('Extra') ? `+ ${o.name}${o.grp.includes('mitad') ? ` (${o.grp.replace('Extra ', '')})` : ''}` : o.name)).join(' · ');

/** Pide el PIN de un encargado cuando la acción lo requiere. */
export function usePin() {
  const [state, setState] = useState<{ resolve: (v: string | null) => void } | null>(null);
  const [pin, setPin] = useState('');
  const ask = () => new Promise<string | null>((resolve) => { setPin(''); setState({ resolve }); });
  const done = (v: string | null) => { state?.resolve(v); setState(null); };
  const el = (
    <Modal title="Autorización de encargado" open={!!state} onClose={() => done(null)} footer={<><button onClick={() => done(null)}>Cancelar</button><button className="primary" onClick={() => done(pin)} disabled={pin.length < 4}>Autorizar</button></>}>
      <div className="field"><label htmlFor="pin">PIN del encargado</label><input id="pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && done(pin)} autoFocus /></div>
    </Modal>
  );
  return { ask, el };
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="card" role="alert" style={{ borderColor: 'var(--bad)' }}><strong style={{ color: 'var(--bad)' }}>{error}</strong>{retry && <div style={{ marginTop: 8 }}><button onClick={retry}>Reintentar</button></div>}</div>;
}
export const Loading = () => <p className="muted" aria-busy="true">Cargando…</p>;
