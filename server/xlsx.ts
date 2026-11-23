// Planillas .xlsx sin dependencias: un ZIP con el XML mínimo de Office Open XML que Excel abre tal cual.
// Los textos van como inlineStr: nunca se interpretan como fórmula (no hace falta el escape del CSV).
import { promisify } from 'node:util';
import { crc32, deflateRaw } from 'node:zlib';
import { TZ } from './core.ts';

export type Kind = 'text' | 'wrap' | 'money' | 'date' | 'int';
export type Col = { header: string; width: number; kind?: Kind };
export type Cell = string | number | Date | null | undefined;
/** Una fila. tone 'bad' la pinta de rojo claro (anulaciones, reversiones); hot resalta columnas puntuales (p. ej. una diferencia de caja). */
export type Row = { c: Cell[]; tone?: 'bad'; hot?: number[] };
export type Report = {
  sheet: string; // nombre de la hoja (≤ 31 caracteres)
  title: string;
  restaurant: string;
  period: string;
  summary?: [string, Cell, Kind?][]; // totales calculados por el sistema, arriba de la tabla
  cols: Col[];
  rows: Row[];
};

const GREEN = 'FF1E4D3A', BAND = 'FFEDF5F0', LINE = 'FFD3E2D8', RED_BG = 'FFFDE4E2', RED = 'FF9B1C1C';
const NUMFMT: Record<Kind, number> = { text: 0, wrap: 0, money: 164, date: 165, int: 1 };

// oxlint-disable-next-line no-control-regex -- quita los caracteres de control que el XML de Excel no admite
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').slice(0, 32767)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number): string => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/** Fecha → número de serie de Excel en la hora del local (Excel no guarda zona horaria). */
export function excelDate(d: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 86_400_000 + 25569;
}

/** Arma el .xlsx de un reporte: título, local y período arriba; encabezado verde fijo con filtros; filas alternadas. */
export function buildXlsx(r: Report): Promise<Buffer> {
  // Estilos: cada combinación (fuente, relleno, borde, formato, ajuste) se registra una sola vez.
  const xfs: string[] = ['0|0|0|0|0'];
  const xf = (font: number, fill: number, border: number, kind: Kind = 'text') => {
    const k = `${font}|${fill}|${border}|${NUMFMT[kind]}|${kind === 'wrap' ? 1 : 0}`;
    const i = xfs.indexOf(k);
    return i >= 0 ? i : xfs.push(k) - 1;
  };
  const cell = (ref: string, v: Cell, s: number) => {
    if (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return `<c r="${ref}" s="${s}"/>`;
    if (v instanceof Date) return `<c r="${ref}" s="${s}"><v>${excelDate(v)}</v></c>`;
    if (typeof v === 'number') return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  };
  const rows: string[] = [];
  const add = (cells: [Cell, number][], ht?: number) => { const n = rows.length + 1; rows.push(`<row r="${n}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.map(([v, st], i) => cell(colName(i) + n, v, st)).join('')}</row>`); };
  const at = (v: Cell, st: number): [Cell, number] => [v, st];

  add([at(r.title, xf(1, 0, 0))], 24);
  add([at(r.restaurant, xf(5, 0, 0))]);
  add([at(r.period, xf(3, 0, 0))]);
  // Totales: la etiqueta ocupa las primeras columnas (combinadas) y el valor queda en una columna ancha.
  const span = Math.max(1, Math.min(3, r.cols.length - 1)), merges: string[] = [];
  for (const [label, v, kind] of r.summary ?? []) {
    const n = rows.length + 1;
    if (span > 1) merges.push(`A${n}:${colName(span - 1)}${n}`);
    add([at(label, xf(5, 0, 0)), ...Array.from({ length: span - 1 }, () => at(null, 0)), at(v, xf(5, 0, 0, kind))]);
  }
  add([]);
  const head = rows.length + 1;
  add(r.cols.map((c) => at(c.header, xf(2, 2, 1, 'wrap'))), 30);
  r.rows.forEach((row, i) => {
    const bg = row.tone === 'bad' ? 5 : i % 2 ? 3 : 4;
    add(r.cols.map((c, j) => at(row.c[j], row.hot?.includes(j) ? xf(4, 5, 1, c.kind) : xf(row.tone === 'bad' ? 4 : 0, bg, 1, c.kind))));
  });
  const last = rows.length, lastCol = colName(r.cols.length - 1);
  const range = `$A$${head}:$${lastCol}$${Math.max(last, head)}`;
  const sheetName = esc(r.sheet.replace(/[\\/?*[\]:']/g, '').slice(0, 31));

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastCol}${Math.max(last, head)}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${head}" topLeftCell="A${head + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${head + 1}" sqref="A${head + 1}"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${r.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
<autoFilter ref="${range.replace(/\$/g, '')}"/>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$ &quot;#,##0.00;-&quot;$ &quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>
<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="${GREEN}"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF5F6B64"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="${RED}"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${GREEN}"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="${BAND}"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="${RED_BG}"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="${LINE}"/></left><right style="thin"><color rgb="${LINE}"/></right><top style="thin"><color rgb="${LINE}"/></top><bottom style="thin"><color rgb="${LINE}"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.map((k) => {
    const [font, fill, border, fmt, wrap] = k.split('|').map(Number);
    return `<xf fontId="${font}" fillId="${fill}" borderId="${border}" numFmtId="${fmt}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"${wrap ? ' wrapText="1"' : ''}/></xf>`;
  }).join('')}</cellXfs>
</styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName}'!${range}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'${sheetName}'!$${head}:$${head}</definedName></definedNames>
</workbook>`;

  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ]);
}

const deflate = promisify(deflateRaw);

/** ZIP mínimo (deflate, sin cifrado ni ZIP64): alcanza para planillas de hasta ~4 GB. La compresión es asíncrona: no frena al resto del servidor. */
async function zip(files: [string, string][]): Promise<Buffer> {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8'), data = await deflate(raw), fname = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); // 01/01/1980 00:00
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(fname.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(fname.length, 28);
    c.writeUInt32LE(offset, 42);
    local.push(h, fname, data); central.push(c, fname);
    offset += h.length + fname.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
