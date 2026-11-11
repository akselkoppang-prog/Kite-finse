import { zipSync, strToU8 } from 'fflate';
import { APP_VERSION } from '../version';

/**
 * Tabelldata → CSV og Excel (.xlsx).
 * Excel-filen skrives direkte som Office Open XML (ingen tredjepartsbibliotek). Tall lagres som tall,
 * så Excel/Numbers viser dem med norsk desimalkomma automatisk på norske maskiner.
 */
export type Cell = string | number | null | undefined;
export type Fmt = null | 'km' | 'coord' | 'int' | 'dec1' | 'pct';
export interface Sheet { name: string; header: string[]; rows: Cell[][]; widths?: number[]; formats?: Fmt[] }

/** CSV: «no» = semikolon + desimalkomma (åpnes riktig i norsk Excel), «int» = komma + punktum. UTF-8 med BOM. */
export function toCsv(sh: Sheet, locale: 'no' | 'int' = 'no'): string {
  const sep = locale === 'no' ? ';' : ',';
  const q = (v: Cell, i: number) => {
    if (v == null) return '';
    if (typeof v === 'number') {
      const f = sh.formats?.[i];
      const s = f === 'coord' ? String(v) : f === 'int' ? String(Math.round(v)) : String(Math.round(v * 1000) / 1000);
      return locale === 'no' ? s.replace('.', ',') : s;
    }
    return v.includes(sep) || /["\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return '﻿' + [sh.header.map((h, i) => q(h, i)), ...sh.rows.map((r) => r.map(q))].map((r) => r.join(sep)).join('\r\n') + '\r\n';
}

const x = (s: string) =>
  s
    .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
// stilindekser i styles.xml
const STYLE = { header: 1, km: 2, coord: 3, int: 4, dec1: 5, pct: 6, text: 7 } as const;

function sheetXml(sh: Sheet): string {
  const rows: string[] = [];
  const all: Cell[][] = [sh.header, ...sh.rows];
  all.forEach((r, ri) => {
    const cells = r.map((v, ci) => {
      const ref = `${col(ci)}${ri + 1}`;
      if (v == null || v === '') return '';
      if (ri === 0) return `<c r="${ref}" t="inlineStr" s="${STYLE.header}"><is><t>${x(String(v))}</t></is></c>`;
      if (typeof v === 'number' && Number.isFinite(v)) {
        const f = sh.formats?.[ci];
        return `<c r="${ref}"${f ? ` s="${STYLE[f]}"` : ''}><v>${v}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr" s="${STYLE.text}"><is><t xml:space="preserve">${x(String(v))}</t></is></c>`;
    });
    rows.push(`<row r="${ri + 1}">${cells.join('')}</row>`);
  });
  const widths = sh.header.map((h, i) => sh.widths?.[i] ?? Math.min(60, Math.max(10, h.length + 2, ...sh.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))));
  const filter = sh.rows.length ? `<autoFilter ref="A1:${col(sh.header.length - 1)}${sh.rows.length + 1}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${filter}
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.0000000"/><numFmt numFmtId="166" formatCode="0"/><numFmt numFmtId="167" formatCode="0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F2A44"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const safeSheetName = (s: string, used: Set<string>) => {
  let n = s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Ark';
  let k = 2;
  while (used.has(n)) n = `${n.slice(0, 28)} ${k++}`;
  used.add(n);
  return n;
};

export function toXlsx(sheets: Sheet[], meta: { title: string; author?: string }): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ct = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const defined = sheets
    .map((s, i) => (s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(names[i]).replace(/'/g, "''")}'!$A$1:$${col(s.header.length - 1)}$${s.rows.length + 1}</definedName>` : ''))
    .join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${ct}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ),
    'docProps/core.xml': strToU8(
      `${head}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(meta.title)}</dc:title><dc:creator>${x(meta.author ?? `Snowkite-planlegger ${APP_VERSION}`)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    ),
    'xl/workbook.xml': strToU8(
      `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}</workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files, { level: 6 });
}
