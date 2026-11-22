import { useParams, useSearchParams } from 'react-router-dom';
import { api, ars, dateAR, useLoad, useLocal } from '../lib.tsx';
import { ErrorBox, Loading, optionsText } from '../ui.tsx';

const METHOD: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };

/** Precuenta y ticket interno X: se generan localmente, sin conexión con ARCA. Reimprimir no crea cobros. */
const L = ({ a, b, strong }: { a: string; b: string; strong?: boolean }) => <div className="tl" style={strong ? { fontWeight: 900, fontSize: 14 } : undefined}><span>{a}</span><span>{b}</span></div>;

export default function Ticket() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const copy = sp.get('copia') === '1';
  const [width, setWidth] = useLocal<'58' | '80'>('ticket-width', '80');
  const t = useLoad(() => api(`/api/tickets/${id}`), [id]);
  if (t.error) return <div className="page"><ErrorBox error={t.error} /></div>;
  if (!t.data) return <div className="page"><Loading /></div>;
  const s = t.data.snapshot;
  return (
    <>
      <style>{`@page { size: ${width}mm auto; margin: 2mm; }`}</style>
      <div className="no-print page row" style={{ justifyContent: 'center' }}>
        <div className="row" role="group" aria-label="Ancho del papel">
          <button className="chip" aria-pressed={width === '58'} onClick={() => setWidth('58')}>58 mm</button>
          <button className="chip" aria-pressed={width === '80'} onClick={() => setWidth('80')}>80 mm</button>
        </div>
        <button className="primary" onClick={() => print()}>Imprimir o guardar PDF</button>
        <button onClick={() => close()}>Cerrar</button>
      </div>
      <article className={`tk w${width}`} aria-label="Ticket interno">
        <div className="x" aria-label="Comprobante X">X</div>
        <div className="legal">DOCUMENTO NO VALIDO COMO FACTURA</div>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{s.restaurant}</div>
        {s.address && <div style={{ textAlign: 'center' }}>{s.address}</div>}
        <hr />
        <L a={s.kind === 'x' ? 'Ticket interno' : 'Precuenta'} b={`N.º ${String(t.data.number).padStart(6, '0')}`} />
        <L a="Fecha" b={dateAR(s.at)} />
        <div>{s.where}</div>
        {copy && <div style={{ textAlign: 'center', fontWeight: 900, margin: '1mm 0' }}>*** COPIA · reimpreso {dateAR(new Date())} ***</div>}
        <hr />
        {s.lines.map((l: any, i: number) => (
          <div key={i} style={{ marginBottom: '1mm' }}>
            <L a={`${l.qty} x ${l.name}`} b={ars(l.total)} />
            {(l.options?.length > 0) && <div style={{ paddingLeft: '2mm' }}>{optionsText(l.options)}</div>}
            {l.qty > 1 && <div style={{ paddingLeft: '2mm' }}>{ars(l.unit)} c/u</div>}
          </div>
        ))}
        <hr />
        <L a="Subtotal" b={ars(s.subtotal)} />
        {s.fee > 0 && <L a="Envío" b={ars(s.fee)} />}
        {s.discounts.map((d: any, i: number) => <L key={i} a={`${d.kind === 'cortesia' ? 'Cortesía' : d.kind === 'tope' ? 'Ajuste' : 'Descuento'}: ${d.reason}`} b={d.amount < 0 ? `+${ars(-d.amount)}` : `-${ars(d.amount)}`} />)}
        <L a="TOTAL" b={ars(s.total)} strong />
        {s.kind === 'x' && s.payments.length > 0 && <>
          <hr />
          {s.payments.map((p: any, i: number) => (
            <div key={i}>
              <L a={`${METHOD[p.method] ?? p.method}${p.payer ? ` (${p.payer})` : ''}`} b={ars(p.amount)} />
              {p.tendered != null && p.change > 0 && <><L a="  Recibido" b={ars(p.tendered)} /><L a="  Vuelto" b={ars(p.change)} /></>}
              {p.tip > 0 && <L a="  Propina" b={ars(p.tip)} />}
            </div>
          ))}
        </>}
        {s.kind === 'precuenta' && <><hr /><L a="Ya pagado" b={ars(s.paid)} /><L a="SALDO" b={ars(s.due)} strong /></>}
        <hr />
        <div style={{ textAlign: 'center' }}>Comprobante interno sin validez fiscal.<br />Emitido localmente · BM Dev Restaurant</div>
      </article>
    </>
  );
}
