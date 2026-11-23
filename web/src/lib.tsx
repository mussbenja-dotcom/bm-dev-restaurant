import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ars } from '../../shared/money.ts';

export { ars };

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any = {}) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data);
  return data as T;
}

/** Identificador de operación estable (funciona también en HTTP de red local, sin randomUUID). */
export const newOp = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const key = JSON.stringify(deps);
  // El resultado queda atado a sus deps: al cambiar de cuenta o estación no se muestra el dato anterior.
  const [res, setRes] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  const fnRef = useRef(fn);
  const keyRef = useRef(key);
  const seq = useRef(0);
  useLayoutEffect(() => { fnRef.current = fn; keyRef.current = key; });
  const reload = useCallback(async () => {
    const n = ++seq.current, k = keyRef.current;
    let next: { key: string; data: T | null; error: string | null };
    try { next = { key: k, data: await fnRef.current(), error: null }; } catch (e: any) { next = { key: k, data: null, error: e.message }; }
    if (n === seq.current) setRes((prev) => (next.error && prev?.key === k ? { ...prev, error: next.error } : next)); // descarta respuestas viejas
  }, []);
  useEffect(() => { reload(); }, deps); // oxlint-disable-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- deps las define quien llama
  const cur = res?.key === key ? res : null;
  return { data: cur?.data ?? null, error: cur?.error ?? null, loading: !cur, reload };
}

// ---------- Eventos en vivo: un EventSource compartido; al reconectar se recarga todo ----------
type Ev = { type: string; [k: string]: unknown };
const subs = new Set<(e: Ev) => void>();
let es: EventSource | null = null;
let hadError = false;
function ensureEs(url: string) {
  if (es) return;
  es = new EventSource(url);
  es.onmessage = (m) => { const e = JSON.parse(m.data); subs.forEach((s) => s(e)); };
  es.onerror = () => { hadError = true; };
  es.onopen = () => { if (hadError) subs.forEach((s) => s({ type: '*' })); hadError = false; };
}
export function closeLive() { es?.close(); es = null; }

/** Recarga cuando llega un evento de los tipos indicados (o al reconectar). Además consulta cada 30 s como red de seguridad. */
export function useLive(types: string[], reload: () => void, url: string | null = "/api/events") {
  const r = useRef(reload);
  useLayoutEffect(() => { r.current = reload; });
  useEffect(() => {
    if (url) ensureEs(url);
    let t: ReturnType<typeof setTimeout> | undefined;
    const fn = (e: Ev) => { if (e.type === '*' || types.includes(e.type)) { clearTimeout(t); t = setTimeout(() => r.current(), 120); } };
    subs.add(fn);
    const poll = setInterval(() => r.current(), 30_000);
    return () => { subs.delete(fn); clearInterval(poll); clearTimeout(t); };
  }, [types.join(), url]); // oxlint-disable-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- types se compara por contenido
}

/** Avisos dirigidos a esta persona (el servidor solo los manda a quien corresponde). Devuelve el último y cómo descartarlo. */
export function useNotices() {
  const [list, setList] = useState<Ev[]>([]);
  useEffect(() => {
    ensureEs('/api/events');
    const fn = (e: Ev) => { if (e.type === 'notice') setList((l) => [...l.slice(-4), e]); };
    subs.add(fn);
    return () => { subs.delete(fn); };
  }, []);
  return { list, dismiss: (e: Ev) => setList((l) => l.filter((x) => x !== e)) };
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    addEventListener('online', a); addEventListener('offline', b);
    return () => { removeEventListener('online', a); removeEventListener('offline', b); };
  }, []);
  return on;
}

export function useNow(ms = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return now;
}

export const mins = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
export const hhmm = (iso: string | Date) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' });
export const dateAR = (iso: string | Date) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' });
export const todayAR = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + offsetDays * 86400_000));

export function useLocal<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; } });
  const set = useCallback((x: T | ((p: T) => T)) => setV((p) => {
    const n = typeof x === 'function' ? (x as (p: T) => T)(p) : x;
    try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* almacenamiento lleno o bloqueado */ }
    return n;
  }), [key]);
  return [v, set];
}

// ---------- Avisos ----------
type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id)); timers.current.delete(id);
    setItems((x) => x.filter((t) => t.id !== id));
  }, []);
  const byText = useRef(new Map<string, number>());
  const push = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random(), k = `${error}|${text}`;
    // El mismo aviso repetido no se apila: reemplaza al anterior y vuelve a contar desde cero.
    const old = byText.current.get(k);
    if (old !== undefined) dismiss(old);
    byText.current.set(k, id);
    setItems((x) => [...x, { id, text, error }]);
    timers.current.set(id, setTimeout(() => { dismiss(id); if (byText.current.get(k) === id) byText.current.delete(k); }, error ? 7000 : 4000));
  }, [dismiss]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-area" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}><span>{t.text}</span><button type="button" className="toast-x" onClick={() => dismiss(t.id)} aria-label="Cerrar aviso">×</button></div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Sesión ----------
export type Me = { user: { id: number; name: string; email: string; isPlatformAdmin: boolean }; roles: string[]; restaurant: any; restaurants: any[]; publicUrl: string };
export const MeCtx = createContext<{ me: Me | null; reload: () => Promise<void> }>({ me: null, reload: async () => {} });
export const useMe = () => useContext(MeCtx);
export const can = (me: Me | null, ...roles: string[]) => !!me && (me.roles.includes('owner') || me.roles.includes('manager') || roles.some((r) => me.roles.includes(r)));
