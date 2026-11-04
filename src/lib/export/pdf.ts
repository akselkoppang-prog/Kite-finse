import { jsPDF, GState } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cumulative, dirName, fmtDM, haversine, nearestOnRoute, pointAt, type LatLon } from '../geo';
import { cachedElevation } from '../api/kartverket';
import { DAY_COLORS, hhmm, type DayOutcome } from '../sim/expedition';
import { sunDay, hourOf, type SunDay } from '../sun';
import { KITES } from '../../data/kites';
import { kiteName, compareRows, SCENARIO_COLORS } from '../plan/compare';
import { runPlan, type PlanRun } from '../plan/context';
import { STATUS_TEXT, PRESETS } from '../project/meta';
import { LEVEL_TEXT } from '../warnings';
import { blobUrl } from '../../storage/blobs';
import { passTime } from './sheets';
import { renderMap, KV_ATTR, type MapFrame } from './mapimg';
import type { ExportSnapshot } from './snapshot';
import type { Camp, Route } from '../../types';

/* =====================================================================================
 * Ekspedisjonsbrief som PDF (A4). Bygget fra et eksport-øyeblikksbilde – aldri skjermbilde av appen.
 * Struktur: forside · oversikt · rutekart · dag for dag · teltplasser · utstyr · vær og vind ·
 * terreng og sikkerhet · kontakter, kilder og forbehold.
 * ===================================================================================== */

export type PdfScope = { kind: 'alle' } | { kind: 'dag'; day: number } | { kind: 'sammenligning'; ids: string[] };
export interface PdfOptions { scope: PdfScope; onProgress?: (msg: string) => void }

type RGB = [number, number, number];
const C = {
  navy: [15, 42, 68] as RGB,
  ink: [31, 41, 55] as RGB,
  muted: [100, 116, 139] as RGB,
  line: [214, 222, 230] as RGB,
  paper: [246, 248, 250] as RGB,
  ice: [226, 238, 246] as RGB,
  accent: [43, 140, 196] as RGB,
  orange: [234, 88, 12] as RGB,
  red: [185, 28, 28] as RGB,
  amber: [180, 120, 0] as RGB,
  green: [21, 128, 61] as RGB,
  teal: [13, 148, 136] as RGB,
  white: [255, 255, 255] as RGB,
};
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export { T } from './pdf-text';
import { T } from './pdf-text';

const fmtLong = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
const km = (m: number, dec = 1) => `${(m / 1000).toFixed(dec).replace('.', ',')} km`;
const n1 = (v: number) => v.toFixed(1).replace('.', ',');
const isReserve = (d: DayOutcome) => d.reason.startsWith('allerede');
const kiteShortName = (id: string) => {
  const k = KITES.find((x) => x.id === id);
  return k ? `${k.name.split(' ').slice(1, 2).join(' ') || k.name} ${k.size} m²` : id;
};

/* ---------- sideoppsett ---------- */
class Brief {
  doc: jsPDF;
  M = 16;
  y = 0;
  noHeader = new Set<number>();
  sections: (string | null)[] = []; // per side: tekst i toppfeltet (null = forside, ingen topp/bunn)
  constructor(public snap: ExportSnapshot) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    this.doc.setProperties({ title: T(snap.st.project.name), subject: 'Ekspedisjonsplan', creator: 'Snowkite-ekspedisjonsplanlegger', author: 'Snowkite-planlegger' });
    this.sections.push(null);
  }
  get W() { return this.doc.internal.pageSize.getWidth(); }
  get H() { return this.doc.internal.pageSize.getHeight(); }
  get CW() { return this.W - 2 * this.M; }
  get bottom() { return this.H - 16; }
  newPage(section: string, orientation: 'portrait' | 'landscape' = 'portrait') {
    this.doc.addPage('a4', orientation);
    this.sections.push(section);
    this.y = 22;
  }
  ensure(h: number, section?: string) {
    if (this.y + h > this.bottom) this.newPage(section ?? this.sections[this.sections.length - 1] ?? '', this.W > this.H ? 'landscape' : 'portrait');
  }
  font(size: number, style: 'normal' | 'bold' | 'italic' = 'normal', color: RGB = C.ink) {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }
  h1(text: string, kicker?: string) {
    this.ensure(22);
    if (kicker) {
      this.font(8.5, 'bold', C.accent);
      this.doc.text(T(kicker.toUpperCase()), this.M, this.y, { charSpace: 0.6 });
      this.y += 6;
    }
    this.font(19, 'bold', C.navy);
    const lines = this.doc.splitTextToSize(T(text), this.CW);
    this.doc.text(lines, this.M, this.y + 1);
    this.y += lines.length * 7.5 + 3;
    this.doc.setDrawColor(...C.accent);
    this.doc.setLineWidth(0.8);
    this.doc.line(this.M, this.y - 1.5, this.M + 18, this.y - 1.5);
    this.y += 4;
  }
  h2(text: string) {
    this.ensure(14);
    this.font(11.5, 'bold', C.navy);
    this.doc.text(T(text), this.M, this.y);
    this.y += 5.5;
  }
  p(text: string, o: { size?: number; color?: RGB; style?: 'normal' | 'bold' | 'italic'; x?: number; w?: number; gap?: number } = {}) {
    if (!text) return;
    const size = o.size ?? 9.5;
    this.font(size, o.style ?? 'normal', o.color ?? C.ink);
    const lines = this.doc.splitTextToSize(T(text), o.w ?? this.CW);
    const lh = size * 0.42;
    for (const ln of lines) {
      this.ensure(lh + 1);
      this.doc.text(ln, o.x ?? this.M, this.y);
      this.y += lh;
    }
    this.y += o.gap ?? 2;
  }
  bullets(items: string[], size = 9.2) {
    for (const it of items) {
      this.font(size, 'normal', C.ink);
      const lines = this.doc.splitTextToSize(T(it), this.CW - 5);
      this.ensure(lines.length * size * 0.42 + 1);
      this.doc.setFillColor(...C.accent);
      this.doc.circle(this.M + 1.2, this.y - 1.1, 0.7, 'F');
      this.doc.text(lines, this.M + 4.5, this.y);
      this.y += lines.length * size * 0.42 + 1.2;
    }
    this.y += 1.5;
  }
  /** Nøkkeltall i ruter */
  tiles(items: { label: string; value: string; sub?: string; color?: RGB }[], cols = 4, h = 19) {
    const gap = 3;
    const w = (this.CW - gap * (cols - 1)) / cols;
    const rows = Math.ceil(items.length / cols);
    this.ensure(rows * (h + gap));
    items.forEach((it, i) => {
      const x = this.M + (i % cols) * (w + gap);
      const y = this.y + Math.floor(i / cols) * (h + gap);
      this.doc.setFillColor(...C.paper);
      this.doc.setDrawColor(...C.line);
      this.doc.setLineWidth(0.2);
      this.doc.roundedRect(x, y, w, h, 2, 2, 'FD');
      this.doc.setFillColor(...(it.color ?? C.accent));
      this.doc.rect(x, y + 2, 1.1, h - 4, 'F');
      this.font(7, 'bold', C.muted);
      this.doc.text(T(it.label.toUpperCase()), x + 4, y + 5.2, { charSpace: 0.3 });
      let fs = 13;
      this.font(fs, 'bold', C.navy);
      while (fs > 7.5 && this.doc.getTextWidth(T(it.value)) > w - 6) this.font((fs -= 0.5), 'bold', C.navy);
      this.doc.text(T(it.value), x + 4, y + 11.6);
      if (it.sub) {
        this.font(7, 'normal', C.muted);
        this.doc.text(this.doc.splitTextToSize(T(it.sub), w - 6).slice(0, 1), x + 4, y + 16);
      }
    });
    this.y += rows * (h + gap) + 2;
  }
  table(head: string[], body: (string | number)[][], o: { colWidths?: (number | 'auto')[]; fontSize?: number; colors?: (RGB | null)[]; headColor?: RGB; pad?: number } = {}) {
    autoTable(this.doc, {
      head: [head.map(T)],
      body: body.map((r) => r.map((c) => T(c))),
      startY: this.y,
      margin: { left: this.M, right: this.M, top: 22, bottom: 18 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: o.fontSize ?? 8.4, cellPadding: o.pad ?? 1.6, textColor: C.ink, lineColor: C.line, lineWidth: 0.15, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: o.headColor ?? C.navy, textColor: C.white, fontStyle: 'bold', fontSize: (o.fontSize ?? 8.4) - 0.2 },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      columnStyles: Object.fromEntries((o.colWidths ?? []).map((w, i) => [i, { cellWidth: w }])),
      didParseCell: (d) => {
        const col = o.colors?.[d.row.index];
        if (d.section === 'body' && col && d.column.index === 0) {
          d.cell.styles.fillColor = col;
          d.cell.styles.textColor = C.white;
          d.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawPage: () => {
        // ny side lagt til av tabellen: noter seksjonen for topptekst
        while (this.sections.length < this.doc.getNumberOfPages()) this.sections.push(this.sections[this.sections.length - 1]);
      },
    });
    this.y = ((this.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? this.y) + 5;
  }
  note(text: string, color: RGB = C.amber) {
    this.font(8.3, 'normal', C.ink);
    const lines = this.doc.splitTextToSize(T(text), this.CW - 8);
    const h = lines.length * 3.6 + 4.5;
    this.ensure(h + 2);
    this.doc.setFillColor(color[0], color[1], color[2]);
    this.doc.rect(this.M, this.y, 1.2, h, 'F');
    this.doc.setFillColor(...C.paper);
    this.doc.rect(this.M + 1.2, this.y, this.CW - 1.2, h, 'F');
    this.doc.text(lines, this.M + 4.5, this.y + 4.5);
    this.y += h + 3;
  }
  /** Topptekst, bunntekst og sidetall på alle sider unntatt forsiden. */
  finish() {
    const total = this.doc.getNumberOfPages();
    const name = T(this.snap.st.project.name);
    const scen = T(`Scenario: ${this.snap.run.plan.name}`);
    const gen = new Date(this.snap.generatedAt).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' });
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      if (this.sections[i - 1] === null) continue;
      const W = this.W, H = this.H;
      if (!this.noHeader.has(i)) {
      this.doc.setFillColor(...C.navy);
      this.doc.rect(0, 0, W, 2.2, 'F');
      this.font(7.5, 'bold', C.navy);
      this.doc.text(name.toUpperCase(), this.M, 9.5, { charSpace: 0.4 });
      this.font(7.5, 'normal', C.muted);
      this.doc.text(T(this.sections[i - 1] ?? ''), W - this.M, 9.5, { align: 'right' });
      this.doc.setDrawColor(...C.line);
      this.doc.setLineWidth(0.2);
      this.doc.line(this.M, 12, W - this.M, 12);
      }
      this.doc.setDrawColor(...C.line);
      this.doc.line(this.M, H - 11, W - this.M, H - 11);
      this.font(7, 'normal', C.muted);
      this.doc.text(T(`${scen} · laget ${gen} · planlagte verdier, ikke verifisert i terrenget`), this.M, H - 6.5);
      this.font(7.5, 'bold', C.navy);
      this.doc.text(`Side ${i} av ${total}`, W - this.M, H - 6.5, { align: 'right' });
    }
  }
}

/* ---------- tegnehjelpere ---------- */

function arrow(doc: jsPDF, cx: number, cy: number, len: number, bearingTo: number, color: RGB, width = 0.7) {
  const a = ((bearingTo - 90) * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const x0 = cx - (dx * len) / 2, y0 = cy - (dy * len) / 2, x1 = cx + (dx * len) / 2, y1 = cy + (dy * len) / 2;
  doc.setDrawColor(...color);
  doc.setFillColor(...color);
  doc.setLineWidth(width);
  doc.line(x0, y0, x1 - dx * len * 0.25, y1 - dy * len * 0.25);
  const hl = len * 0.38, hw = len * 0.22;
  const bx = x1 - dx * hl, by = y1 - dy * hl;
  doc.triangle(x1, y1, bx - dy * hw, by + dx * hw, bx + dy * hw, by - dx * hw, 'F');
}

/** Vindpil: vinden blåser FRA dir → pil peker dit vinden går. */
function windArrow(doc: jsPDF, cx: number, cy: number, r: number, dirFrom: number, color: RGB = C.accent) {
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.3);
  doc.setFillColor(...C.white);
  doc.circle(cx, cy, r, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(...C.muted);
  doc.text('N', cx, cy - r + 2.3, { align: 'center' });
  arrow(doc, cx, cy, r * 1.45, (dirFrom + 180) % 360, color, 0.9);
}

function polyline(doc: jsPDF, pts: [number, number][], color: RGB, width: number, dash?: number[]) {
  if (pts.length < 2) return;
  doc.setDrawColor(...color);
  doc.setLineWidth(width);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  if (dash) doc.setLineDashPattern(dash, 0);
  const deltas: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'S', false);
  if (dash) doc.setLineDashPattern([], 0);
}

function niceStep(m: number) {
  const p = 10 ** Math.floor(Math.log10(m));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= m) ?? p * 10;
}

interface MapLayers {
  route?: Route;
  segments?: { fromD: number; toD: number; color: RGB; label?: string }[];
  others?: { route: Route; color: RGB; dashed?: boolean; width?: number }[];
  camps?: Camp[];
  points?: { p: LatLon; label: string; color: RGB; num?: string }[];
  flags?: { p: LatLon; label: string; color: RGB }[];
  dim?: boolean; // tegn hele ruten dempet under segmentene
  bare?: boolean; // uten ramme/målestokk/nordpil/kilde (forside)
}

/** Tegn kart (ekte fliser eller koordinatnett) med vektorlag, målestokk, nordpil og kilde. */
function drawMap(b: Brief, fr: MapFrame, x: number, y: number, w: number, h: number, L: MapLayers) {
  const doc = b.doc;
  const P = (p: LatLon): [number, number] => {
    const [fx, fy] = fr.proj(p);
    return [x + fx * w, y + fy * h];
  };
  doc.saveGraphicsState();
  doc.rect(x, y, w, h, null);
  doc.clip();
  doc.discardPath();
  if (fr.dataUrl) doc.addImage(fr.dataUrl, 'JPEG', x, y, w, h, undefined, 'FAST');
  else {
    doc.setFillColor(244, 246, 248);
    doc.rect(x, y, w, h, 'F');
    // koordinatnett
    const tl = fr.unproj(0, 0), br = fr.unproj(1, 1);
    const stepLat = niceStep((tl.lat - br.lat) / 5), stepLon = niceStep((br.lon - tl.lon) / 5);
    doc.setDrawColor(205, 213, 222);
    doc.setLineWidth(0.15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...C.muted);
    for (let la = Math.ceil(br.lat / stepLat) * stepLat; la <= tl.lat; la += stepLat) {
      const [, yy] = P({ lat: la, lon: tl.lon });
      doc.line(x, yy, x + w, yy);
      doc.text(`${la.toFixed(2)}° N`, x + 1.5, yy - 0.8);
    }
    for (let lo = Math.ceil(tl.lon / stepLon) * stepLon; lo <= br.lon; lo += stepLon) {
      const [xx] = P({ lat: tl.lat, lon: lo });
      doc.line(xx, y, xx, y + h);
      doc.text(`${lo.toFixed(2)}° Ø`, xx + 0.8, y + 3);
    }
  }
  // lett hvit slør over kartet så vektorene trer frem
  if (fr.dataUrl) {
    doc.setGState(new GState({ opacity: 0.18 }));
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, w, h, 'F');
    doc.setGState(new GState({ opacity: 1 }));
  }
  for (const o of L.others ?? []) {
    const pts = o.route.waypoints.map(P);
    polyline(doc, pts, C.white, (o.width ?? 0.9) + 0.6);
    polyline(doc, pts, o.color, o.width ?? 0.9, o.dashed ? [1.6, 1.2] : undefined);
  }
  if (L.route) {
    const pts = L.route.waypoints.map(P);
    polyline(doc, pts, C.white, 2.6);
    polyline(doc, pts, L.dim ? [150, 160, 172] : C.red, L.dim ? 1.1 : 1.5);
    if (L.segments?.length) {
      const cum = cumulative(L.route.waypoints);
      for (const s of L.segments) {
        const seg: [number, number][] = [P(pointAt(L.route.waypoints, cum, s.fromD))];
        L.route.waypoints.forEach((wp, i) => cum[i] > s.fromD && cum[i] < s.toD && seg.push(P(wp)));
        seg.push(P(pointAt(L.route.waypoints, cum, s.toD)));
        polyline(doc, seg, C.white, 3);
        polyline(doc, seg, s.color, 1.9);
      }
    }
    const a = P(L.route.waypoints[0]), z = P(L.route.waypoints[L.route.waypoints.length - 1]);
    doc.setFillColor(...C.green);
    doc.setDrawColor(...C.white);
    doc.setLineWidth(0.5);
    doc.circle(a[0], a[1], 1.6, 'FD');
    doc.setFillColor(...C.navy);
    doc.rect(z[0] - 1.6, z[1] - 1.6, 3.2, 3.2, 'FD');
  }
  for (const c of L.camps ?? []) {
    const [cx, cy] = P(c);
    doc.setFillColor(...C.teal);
    doc.setDrawColor(...C.white);
    doc.setLineWidth(0.4);
    doc.triangle(cx, cy - 2.4, cx - 2.1, cy + 1.3, cx + 2.1, cy + 1.3, 'FD');
  }
  for (const pt of L.points ?? []) {
    const [px, py] = P(pt.p);
    doc.setFillColor(...pt.color);
    doc.setDrawColor(...C.white);
    doc.setLineWidth(0.35);
    doc.circle(px, py, pt.num ? 1.9 : 1.1, 'FD');
    if (pt.num) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.3);
      doc.setTextColor(...C.white);
      doc.text(pt.num, px, py + 0.75, { align: 'center' });
    }
  }
  for (const f of L.flags ?? []) {
    const [fx, fy] = P(f.p);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    const tw = doc.getTextWidth(T(f.label)) + 3;
    doc.setDrawColor(...C.navy);
    doc.setLineWidth(0.35);
    doc.line(fx, fy, fx, fy - 5);
    doc.setFillColor(...f.color);
    doc.roundedRect(fx, fy - 8.6, tw, 3.9, 0.6, 0.6, 'F');
    doc.setTextColor(...C.white);
    doc.text(T(f.label), fx + 1.5, fy - 5.8);
  }
  doc.restoreGraphicsState();
  if (L.bare) return;
  // ramme, målestokk, nordpil, kilde
  doc.setDrawColor(...C.navy);
  doc.setLineWidth(0.35);
  doc.rect(x, y, w, h, 'S');
  const mPerMm = fr.metersPerFracX / w;
  const step = niceStep(mPerMm * w * 0.18);
  const sl = step / mPerMm;
  doc.setFillColor(255, 255, 255);
  doc.rect(x + 3, y + h - 8.2, sl + 6, 6, 'F');
  doc.setFillColor(...C.navy);
  doc.rect(x + 6, y + h - 4.6, sl, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(...C.navy);
  doc.text(step >= 1000 ? `${step / 1000} km` : `${step} m`, x + 6, y + h - 5.4);
  doc.setFillColor(255, 255, 255);
  doc.circle(x + w - 7, y + 7, 4, 'F');
  arrow(doc, x + w - 7, y + 7.4, 5.2, 0, C.navy, 0.6);
  doc.setFontSize(5.5);
  doc.text('N', x + w - 7, y + 4.4, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(...C.muted);
  doc.text(T(fr.dataUrl ? KV_ATTR : 'Kartfliser var ikke tilgjengelige da PDF-en ble laget (offline). Ruten er tegnet på et koordinatnett (WGS 84) - ikke et terrengkart.'), x + w, y + h + 3.2, { align: 'right' });
}

function profileChart(b: Brief, x: number, y: number, w: number, h: number, days: DayOutcome[], opts: { fromD?: number; toD?: number; color?: RGB } = {}) {
  const doc = b.doc;
  const prof = b.snap.profile.filter((p) => p.z != null && (opts.fromD == null || (p.d >= opts.fromD - 1 && p.d <= (opts.toD ?? Infinity) + 1))) as { d: number; z: number }[];
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.2);
  doc.setFillColor(...C.white);
  doc.rect(x, y, w, h, 'FD');
  if (prof.length < 2) {
    b.font(8, 'italic', C.muted);
    doc.text('Ingen høydedata for ruten (hent Kartverket DTM eller bruk GPX med høyder).', x + 4, y + h / 2);
    return;
  }
  const d0 = prof[0].d, d1 = prof[prof.length - 1].d;
  let zmin = Math.min(...prof.map((p) => p.z)), zmax = Math.max(...prof.map((p) => p.z));
  const pad = Math.max(20, (zmax - zmin) * 0.12);
  zmin = Math.floor((zmin - pad) / 50) * 50;
  zmax = Math.ceil((zmax + pad) / 50) * 50;
  const L = 12, B = 7;
  const X = (d: number) => x + L + ((d - d0) / Math.max(1, d1 - d0)) * (w - L - 3);
  const Y = (z: number) => y + h - B - ((z - zmin) / Math.max(1, zmax - zmin)) * (h - B - 3);
  // rutenett
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...C.muted);
  const zs = niceStep((zmax - zmin) / 4);
  for (let z = Math.ceil(zmin / zs) * zs; z <= zmax; z += zs) {
    doc.setDrawColor(235, 239, 243);
    doc.line(x + L, Y(z), x + w - 3, Y(z));
    doc.text(`${z}`, x + L - 1.2, Y(z) + 1, { align: 'right' });
  }
  const ks = niceStep((d1 - d0) / 1000 / 8) * 1000;
  for (let d = Math.ceil(d0 / ks) * ks; d <= d1; d += ks) doc.text(`${Math.round(d / 1000)}`, X(d), y + h - 2.2, { align: 'center' });
  doc.text('km', x + w - 3, y + h - 2.2, { align: 'right' });
  doc.text('moh', x + 1.5, y + 3.5);
  // fyll
  const poly: [number, number][] = prof.map((p) => [X(p.d), Y(p.z)]);
  const deltas: [number, number][] = [];
  const pts: [number, number][] = [[X(d0), Y(zmin)], ...poly, [X(d1), Y(zmin)]];
  for (let i = 1; i < pts.length; i++) deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  doc.setFillColor(...C.ice);
  doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'F', true);
  // dagsgrenser
  days.forEach((dd) => {
    if (isReserve(dd)) return;
    const col = hex(DAY_COLORS[(dd.day - 1) % DAY_COLORS.length]);
    const seg = prof.filter((p) => p.d >= dd.startD && p.d <= dd.endD).map((p) => [X(p.d), Y(p.z)] as [number, number]);
    polyline(doc, seg, col, 1.1);
    if (dd.endD < d1 - 50 && dd.endD > d0) {
      doc.setDrawColor(...col);
      doc.setLineDashPattern([1, 1], 0);
      doc.setLineWidth(0.3);
      doc.line(X(dd.endD), y + 3, X(dd.endD), y + h - B);
      doc.setLineDashPattern([], 0);
      doc.setFontSize(5.8);
      doc.setTextColor(...col);
      doc.text(`Dag ${dd.day} slutt`, X(dd.endD) + 0.8, y + 5);
    }
  });
  if (!days.length) polyline(doc, poly, opts.color ?? C.navy, 0.9);
}

/** Dagslysstripe 00–24 med reisevinduet. */
function daylightBar(b: Brief, x: number, y: number, w: number, sun: SunDay, dep: number, arr: number, color: RGB) {
  const doc = b.doc;
  const h = 6;
  const X = (hr: number) => x + (Math.max(0, Math.min(24, hr)) / 24) * w;
  doc.setFillColor(23, 37, 84);
  doc.rect(x, y, w, h, 'F');
  const band = (a: Date | null, z: Date | null, col: RGB) => {
    const ha = hourOf(a), hz = hourOf(z);
    if (ha == null || hz == null) return;
    doc.setFillColor(...col);
    doc.rect(X(ha), y, X(hz) - X(ha), h, 'F');
  };
  band(sun.nauticalDawn, sun.nauticalDusk, [40, 70, 140]);
  band(sun.civilDawn, sun.civilDusk, [70, 110, 190]);
  band(sun.sunrise, sun.sunset, [150, 205, 235]);
  if (arr > dep) {
    doc.setFillColor(...color);
    doc.roundedRect(X(dep), y + 1.7, X(arr) - X(dep), h - 3.4, 0.8, 0.8, 'F');
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...C.muted);
  for (const t of [0, 6, 12, 18, 24]) doc.text(String(t).padStart(2, '0'), X(t), y + h + 3, { align: t === 0 ? 'left' : t === 24 ? 'right' : 'center' });
}

async function imageData(id?: string): Promise<{ data: string; w: number; h: number } | null> {
  if (!id) return null;
  try {
    const url = await blobUrl(id);
    if (!url) return null;
    const blob = await (await fetch(url)).blob();
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
    const bmp = await createImageBitmap(blob);
    return { data, w: bmp.width, h: bmp.height };
  } catch {
    return null;
  }
}
const imgFmt = (data: string) => (data.startsWith('data:image/png') ? 'PNG' : 'JPEG');

/** Bilde beskåret («cover») inn i en boks. */
function coverImage(doc: jsPDF, img: { data: string; w: number; h: number }, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.w, h / img.h);
  const iw = img.w * s, ih = img.h * s;
  doc.saveGraphicsState();
  doc.rect(x, y, w, h, null);
  doc.clip();
  doc.discardPath();
  doc.addImage(img.data, imgFmt(img.data), x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, 'MEDIUM');
  doc.restoreGraphicsState();
}

/* ---------- seksjoner ---------- */

function titleParts(snap: ExportSnapshot) {
  const p = snap.st.project;
  return { a: (p.origin || '').toUpperCase(), z: (p.destination || '').toUpperCase(), name: p.name };
}

async function coverPage(b: Brief, mapFrame: MapFrame | null, photo: { data: string; w: number; h: number } | null) {
  const { doc, snap } = b;
  const W = b.W, H = b.H;
  const heroH = 168;
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, W, H, 'F');
  if (photo) coverImage(doc, photo, 0, 0, W, heroH);
  else if (mapFrame && snap.route) drawMap(b, mapFrame, 0, 0, W, heroH, { route: snap.route, segments: segs(snap), camps: snap.usedCamps, bare: true });
  // mørk overgang for lesbar tittel
  doc.setGState(new GState({ opacity: 0.82 }));
  doc.setFillColor(...C.navy);
  doc.rect(0, heroH - 58, W, 58, 'F');
  doc.setGState(new GState({ opacity: 1 }));
  doc.setFillColor(...C.orange);
  doc.rect(b.M, heroH - 50, 14, 1.4, 'F');
  const t = titleParts(snap);
  doc.setTextColor(...C.white);
  doc.setFont('helvetica', 'bold');
  if (t.a && t.z) {
    doc.setFontSize(34);
    const wa = doc.getTextWidth(T(t.a));
    doc.text(T(t.a), b.M, heroH - 34);
    arrow(doc, b.M + wa + 10, heroH - 37.2, 11, 90, C.orange, 1.4);
    doc.text(T(t.z), b.M + wa + 19, heroH - 34);
    doc.setFontSize(14);
    doc.text(doc.splitTextToSize(T(t.name.toUpperCase()), W - 2 * b.M).slice(0, 2), b.M, heroH - 22, { charSpace: 0.8 });
  } else {
    doc.setFontSize(26);
    doc.text(doc.splitTextToSize(T(t.name.toUpperCase()), W - 2 * b.M).slice(0, 2), b.M, heroH - 34);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(203, 213, 225);
  doc.text(T(`${fmtLong(snap.st.tripDate)} – ${fmtLong(snap.endDate)}`), b.M, heroH - 8);
  // nøkkeltall
  const s = snap.summary;
  const facts: [string, string][] = [
    ['Distanse', km(s.totalKm * 1000, 0)],
    ['Dager', `${s.days}`],
    ['Stigning', `${Math.round(snap.stats.up)} m`],
    ['Ankomst', s.doneDay ? `Dag ${s.doneDay.day} kl. ${hhmm(s.doneDay.arrival)}` : 'ikke nådd'],
  ];
  const fy = heroH + 14;
  const fw = (W - 2 * b.M) / facts.length;
  facts.forEach(([l, v], i) => {
    const x = b.M + i * fw;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(125, 160, 190);
    doc.text(T(l.toUpperCase()), x, fy, { charSpace: 0.5 });
    doc.setFontSize(17);
    doc.setTextColor(...C.white);
    doc.text(T(v), x, fy + 9);
  });
  doc.setDrawColor(45, 75, 105);
  doc.setLineWidth(0.3);
  doc.line(b.M, fy + 16, W - b.M, fy + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  const desc = doc.splitTextToSize(T(snap.st.project.description || ''), W - 2 * b.M);
  doc.text(desc.slice(0, 4), b.M, fy + 25);
  // scenario + status
  const by = H - 40;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(125, 160, 190);
  doc.text('SCENARIO', b.M, by, { charSpace: 0.5 });
  doc.text('RUTE', b.M + 70, by, { charSpace: 0.5 });
  doc.text('STATUS', b.M + 140, by, { charSpace: 0.5 });
  doc.setFontSize(10.5);
  doc.setTextColor(...C.white);
  doc.text(doc.splitTextToSize(T(`${snap.run.plan.name}${snap.run.plan.id === snap.st.mainPlanId ? ' (hovedplan)' : ''}`), 64).slice(0, 2), b.M, by + 6);
  doc.text(doc.splitTextToSize(T(snap.route?.name ?? '–'), 64).slice(0, 2), b.M + 70, by + 6);
  doc.text(T(STATUS_TEXT[snap.st.project.status] ?? ''), b.M + 140, by + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(125, 160, 190);
  doc.text(T(`Ekspedisjonsplan · laget ${new Date(snap.generatedAt).toLocaleString('nb-NO', { dateStyle: 'long', timeStyle: 'short' })} · ${photo ? 'Forsidebilde: eget foto' : mapFrame?.dataUrl ? KV_ATTR : ''}`), b.M, H - 10);
  if (photo && mapFrame && snap.route) {
    // lite kart nederst til høyre når forsiden har foto
    const mw = 52, mh = 40;
    drawMap(b, mapFrame, W - b.M - mw, fy + 22, mw, mh, { route: snap.route, segments: segs(snap) });
  }
}

const segs = (snap: ExportSnapshot) =>
  snap.run.days.filter((d) => !isReserve(d) && d.endD > d.startD).map((d) => ({ fromD: d.startD, toD: d.endD, color: hex(DAY_COLORS[(d.day - 1) % DAY_COLORS.length]), label: `Dag ${d.day}` }));
const dayFlags = (snap: ExportSnapshot) => {
  if (!snap.route) return [];
  const cum = cumulative(snap.route.waypoints);
  return snap.run.days.filter((d) => !isReserve(d) && d.endD > d.startD).map((d) => ({ p: pointAt(snap.route!.waypoints, cum, d.endD), label: `Dag ${d.day} · ${hhmm(d.arrival)}`, color: hex(DAY_COLORS[(d.day - 1) % DAY_COLORS.length]) }));
};

function overviewPage(b: Brief, compact: boolean) {
  const { snap } = b;
  const s = snap.summary;
  const p = snap.st.project;
  b.newPage('Oversikt');
  b.h1('Ekspedisjonsoversikt', `${p.origin || ''} – ${p.destination || ''}`.trim().replace(/^–$/, 'Oversikt'));
  b.tiles([
    { label: 'Distanse', value: km(s.totalKm * 1000), sub: snap.route?.name },
    { label: 'Stigning / fall', value: `${Math.round(snap.stats.up)} / ${Math.round(snap.stats.down)} m`, sub: snap.stats.src },
    { label: 'Varighet', value: `${s.days} dager`, sub: `${fmtShort(snap.st.tripDate)} – ${fmtShort(snap.endDate)}` },
    { label: `Ankomst ${p.destination || 'mål'}`, value: s.doneDay ? `Dag ${s.doneDay.day} ${hhmm(s.doneDay.arrival)}` : `${s.remainingKm.toFixed(0)} km igjen`, sub: s.doneDay ? fmtShort(s.doneDay.date) : 'planen når ikke frem', color: s.doneDay ? C.green : C.red },
    { label: 'Sum kitetid', value: `${n1(s.movingH)} t`, sub: 'aktiv bevegelse (modell)' },
    { label: 'Høyeste punkt', value: snap.stats.hi != null ? `${Math.round(snap.stats.hi)} moh` : '–' },
    { label: 'Last', value: `${snap.st.riderKg} + ${snap.st.pulkKg} kg`, sub: 'kropp + pulk' },
    { label: 'Scenario', value: snap.run.plan.name, sub: snap.run.plan.id === snap.st.mainPlanId ? 'hovedplan' : 'alternativ' },
  ]);
  // dagstripe
  b.h2('Fordeling per dag');
  const total = Math.max(1, s.totalKm * 1000);
  const sx = b.M, sw = b.CW;
  let cx = sx;
  b.ensure(12);
  snap.run.days.forEach((d) => {
    const w = ((d.endD - d.startD) / total) * sw;
    if (w <= 0) return;
    b.doc.setFillColor(...hex(DAY_COLORS[(d.day - 1) % DAY_COLORS.length]));
    b.doc.rect(cx, b.y, w, 6.5, 'F');
    if (w > 16) {
      b.font(7, 'bold', C.white);
      b.doc.text(T(`Dag ${d.day} · ${km(d.endD - d.startD, 0)}`), cx + 2, b.y + 4.4);
    }
    cx += w;
  });
  if (s.remainingKm > 0.05) {
    b.doc.setFillColor(...C.line);
    b.doc.rect(cx, b.y, sx + sw - cx, 6.5, 'F');
  }
  b.y += 11;
  b.table(
    ['Dag', 'Dato', 'Fra – til (km)', 'Distanse', 'Avreise', 'Ankomst', 'Kite', 'Vind', 'Teltplass'],
    snap.run.days.map((d, i) => {
      const pd = snap.run.plan.days[i];
      const camp = snap.st.camps.find((c) => c.id === pd?.campId);
      return isReserve(d)
        ? [`${d.day}`, fmtShort(d.date), 'Reservedag', '–', '–', '–', '–', `${dirName(pd.wind.dir)} ${pd.wind.avg} m/s`, '–']
        : [`${d.day}`, fmtShort(d.date), `${n1(d.startD / 1000)} – ${n1(d.endD / 1000)}`, km(d.endD - d.startD), hhmm(d.departure), `${hhmm(d.arrival)} (${hhmm(d.rangeArrival[0])}–${hhmm(d.rangeArrival[1])})`, kiteName(d.kiteId), `${dirName(pd.wind.dir)} ${pd.wind.avg} m/s (${pd.wind.min}–${pd.wind.max})`, camp?.name ?? (i < snap.run.days.length - 1 ? 'ikke valgt' : p.destination || 'mål')];
    }),
    { colors: snap.run.days.map((d) => hex(DAY_COLORS[(d.day - 1) % DAY_COLORS.length])), fontSize: 8 },
  );
  if (snap.prefs.kites) {
    b.h2('Kites med på turen');
    const q = snap.st.quivers.find((x) => x.id === snap.st.activeQuiverId);
    b.p(`${(q?.kiteIds ?? []).map(kiteName).join(' · ') || 'Ingen valgt'}. Du bruker én kite om gangen; kitene er alternativer for ulik vind.`, { size: 9 });
  }
  if (snap.prefs.profile && compact) {
    b.h2('Høydeprofil');
    b.ensure(48);
    profileChart(b, b.M, b.y, b.CW, 42, snap.run.days);
    b.y += 48;
  }
  if (!compact) {
    b.h2('Forutsetninger for planen');
    b.bullets([
      `Vinden er ${snap.run.plan.days.every((d) => d.windMode === 'manuell') ? 'ditt eget scenario for hver dag - ikke en værmelding' : 'delvis hentet fra MET-prognosen (merket per dag)'}.`,
      'Fremdrift er beregnet med en fysisk modell per 500 m (vind mot kurs, kite, glid, friksjon, pulk), én kite om gangen, med usikkerhet fra vindvariasjon.',
      'Dagen slutter senest ved borgerlig skumring. Pauser, oppskyting og navigasjon er trukket fra.',
      'Ruter og teltplasser er planlagt på kart - ingenting er befart av appen. Is på regulerte vann kan være usikker.',
    ]);
  }
}

async function routeMapPage(b: Brief, landscape: boolean) {
  const { snap } = b;
  if (!snap.route) return;
  b.newPage('Rutekart', landscape ? 'landscape' : 'portrait');
  b.h1(`Rutekart – ${snap.route.name}`, 'Hele ruten');
  const w = b.CW, h = b.bottom - b.y - (landscape ? 20 : 40);
  const others = snap.st.routes.filter((r) => r.id !== snap.route!.id && r.visible !== false).map((r) => ({ route: r, color: [59, 130, 246] as RGB, dashed: true, width: 0.7 }));
  const fr = await renderMap(snap.route.waypoints, w / h, landscape ? 2200 : 1700);
  const named = snap.route.waypoints.filter((wp) => wp.name || wp.description).slice(0, 40);
  const crossings = snap.check.crossings.slice(0, 20);
  drawMap(b, fr, b.M, b.y, w, h, {
    route: snap.route,
    segments: segs(snap),
    others,
    camps: snap.prefs.camps ? snap.st.camps : snap.usedCamps,
    points: [
      ...(snap.prefs.waypoints ? named.map((wp, i) => ({ p: wp, label: wp.name ?? '', color: C.navy, num: String(i + 1) })) : []),
      ...crossings.map((c) => ({ p: c.entry, label: c.barrier.name, color: c.label === 'BRUKERGODKJENT' ? C.teal : c.blocking ? C.red : C.amber })),
    ],
    flags: dayFlags(snap),
  });
  b.y += h + 6;
  // tegnforklaring
  const leg: [RGB, string][] = [[C.green, 'Start'], [C.navy, 'Mål'], ...segs(snap).map((s) => [s.color, s.label ?? ''] as [RGB, string]), [C.teal, 'Teltplass / godkjent av deg'], [C.amber, 'Vann - ikke kontrollert'], [C.red, 'Viktig: regulert vann / sone'], [[59, 130, 246], 'Alternativ rute']];
  let lx = b.M;
  b.font(7.2, 'normal', C.ink);
  for (const [c, t] of leg) {
    const tw = b.doc.getTextWidth(T(t)) + 9;
    if (lx + tw > b.W - b.M) { lx = b.M; b.y += 4.5; }
    b.doc.setFillColor(...c);
    b.doc.rect(lx, b.y - 2.4, 4, 2.6, 'F');
    b.doc.text(T(t), lx + 5.2, b.y);
    lx += tw;
  }
  b.y += 6;
  if (snap.prefs.waypoints && named.length && named.length <= 6) {
    b.p(`Punkter: ${named.map((wp, i) => `${i + 1} ${wp.name ?? ''}`).join(' · ')}`, { size: 7.5, color: C.muted });
  } else if (snap.prefs.waypoints && named.length) {
    b.newPage('Rutekart');
    b.h2('Punkter i kartet');
    b.table(['Nr', 'Navn', 'Km', 'Beskrivelse / notat'], named.map((wp, i) => {
      const cum = cumulative(snap.route!.waypoints);
      const idx = snap.route!.waypoints.indexOf(wp);
      return [String(i + 1), wp.name ?? '–', n1(cum[idx] / 1000), [wp.description, wp.notes].filter(Boolean).join(' · ') || '–'];
    }), { colWidths: [9, 45, 13, 'auto'], fontSize: 8 });
  }
}

async function dayPage(b: Brief, d: DayOutcome) {
  const { snap } = b;
  const i = d.day - 1;
  const pd = snap.run.plan.days[i];
  const route = snap.route!;
  const color = hex(DAY_COLORS[i % DAY_COLORS.length]);
  const cum = cumulative(route.waypoints);
  const startP = pointAt(route.waypoints, cum, d.startD), endP = pointAt(route.waypoints, cum, d.endD);
  const camp = snap.st.camps.find((c) => c.id === pd.campId);
  const near = (p: LatLon) => {
    const pl = Object.values(snap.st.places).map((x) => ({ x, km: haversine(p, x) / 1000 })).sort((a, z) => a.km - z.km)[0];
    return pl && pl.km < 6 ? `${pl.x.name}${pl.km > 1 ? ` (${n1(pl.km)} km unna)` : ''}` : `km ${n1(nearestOnRoute(route.waypoints, p).d / 1000)}`;
  };
  b.newPage(`Dag ${d.day}`);
  // fargebånd
  b.doc.setFillColor(...color);
  b.doc.rect(b.M, b.y - 5, 3, 16, 'F');
  b.font(8.5, 'bold', color);
  b.doc.text(T(`DAG ${d.day}`), b.M + 6, b.y - 1, { charSpace: 0.6 });
  b.font(17, 'bold', C.navy);
  b.doc.text(T(fmtLong(d.date).replace(/^./, (c) => c.toUpperCase())), b.M + 6, b.y + 6.5);
  b.font(9.5, 'normal', C.muted);
  const dest = camp ? camp.name : d.remainingKm <= 0.05 ? snap.st.project.destination || 'Mål' : near(endP);
  b.doc.text(T(`${near(startP)}  –  ${dest}`), b.M + 6, b.y + 12);
  b.y += 20;
  if (isReserve(d)) {
    b.note(`Reservedag: etter planen er du allerede i ${snap.st.project.destination || 'mål'}. Dagen kan brukes ved værstans eller kortere etapper tidligere.`, C.green);
    return;
  }
  const sun = sunDay(d.date, pointAt(route.waypoints, cum, (d.startD + d.endD) / 2));
  b.tiles([
    { label: 'Avreise', value: hhmm(d.departure), color },
    { label: 'Ankomst', value: hhmm(d.arrival), sub: `usikkerhet ${hhmm(d.rangeArrival[0])}–${hhmm(d.rangeArrival[1])}`, color },
    { label: 'Fremdrift', value: km(d.endD - d.startD), sub: `${n1(d.rangeKm[0])}–${n1(d.rangeKm[1])} km`, color },
    { label: 'Igjen etter dagen', value: km(d.remainingKm * 1000, 0), color },
    { label: 'Kite', value: kiteShortName(d.kiteId), sub: `${kiteName(d.kiteId)}${d.kiteAuto ? ' · auto' : ''}`, color: C.orange },
    { label: 'Aktiv kiting', value: `${n1(pd.activeH)} t`, sub: `pauser ${n1(pd.breakH)} t · fart ${pd.speedKmh} km/t`, color: C.orange },
    { label: 'Soloppgang / -nedgang', value: `${hhmm(d.sunrise)} / ${hhmm(d.sunset)}`, sub: `${n1(sun.daylightH)} t dagslys`, color: C.amber },
    { label: 'Dagslys ved ankomst', value: d.daylightLeftH != null ? `${n1(d.daylightLeftH)} t` : '–', sub: `skumring ${hhmm(d.civilDusk)}`, color: d.daylightLeftH != null && d.daylightLeftH < 1 ? C.red : C.amber },
  ], 4, 18);
  // vind
  const vy = b.y;
  b.ensure(30);
  windArrow(b.doc, b.M + 11, b.y + 11, 9.5, pd.wind.dir);
  b.font(8, 'bold', C.muted);
  b.doc.text('VIND', b.M + 26, b.y + 3.5, { charSpace: 0.5 });
  b.font(13, 'bold', C.navy);
  b.doc.text(T(`Fra ${dirName(pd.wind.dir)} (${pd.wind.dir}°) · ${n1(pd.wind.avg)} m/s`), b.M + 26, b.y + 10);
  b.font(8.6, 'normal', C.ink);
  b.doc.text(T(`Spenn ${n1(pd.wind.min)}–${n1(pd.wind.max)} m/s · kast ${n1(pd.wind.gust)} m/s`), b.M + 26, b.y + 15);
  const src = pd.windMode === 'manuell' ? 'EGET SCENARIO - ikke værmelding' : pd.windMode === 'prognose' ? `MET-PROGNOSE${snap.st.routeForecast ? ` (hentet ${new Date(snap.st.routeForecast.fetchedAt).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })})` : ''}` : 'PROGNOSE + DIN JUSTERING';
  b.font(7.2, 'bold', pd.windMode === 'manuell' ? C.amber : C.green);
  b.doc.text(T(src), b.M + 26, b.y + 20.5);
  // dagslys
  b.font(8, 'bold', C.muted);
  b.doc.text('DAGSLYS OG REISEVINDU', b.M + 105, b.y + 3.5, { charSpace: 0.5 });
  daylightBar(b, b.M + 105, b.y + 7, b.CW - 105, sun, d.departure, d.arrival, color);
  b.font(7.5, 'normal', C.muted);
  b.doc.text(T(`Reise ${hhmm(d.departure)}–${hhmm(d.arrival)} · skumring ${hhmm(d.civilDusk)}`), b.M + 105, b.y + 20);
  b.y = vy + 27;
  const notes = [pd.note && `Notat: ${pd.note}`, camp && `Overnatting: ${camp.name}${camp.description ? ` - ${camp.description}` : ''} (${fmtDM(camp)})`, d.reason && `Modell: ${d.reason}.`, d.upwindShare > 0.2 && `${Math.round(d.upwindShare * 100)} % av strekket er mot vinden (kryssing).`, ...d.issues].filter(Boolean) as string[];
  if (notes.length) {
    b.h2('Viktig for dagen');
    b.bullets(notes, 8.4);
  }
  // kart
  if (b.snap.prefs.maps) {
    const h = 68;
    b.ensure(h + 8);
    const pts = [...route.waypoints.filter((_, k) => cum[k] >= d.startD - 2000 && cum[k] <= d.endD + 2000), startP, endP, ...(camp ? [camp] : [])];
    const fr = await renderMap(pts, b.CW / h, 1500, { pad: 0.12 });
    drawMap(b, fr, b.M, b.y, b.CW, h, {
      route,
      dim: true,
      segments: [{ fromD: d.startD, toD: d.endD, color }],
      camps: camp ? [camp] : [],
      flags: [{ p: endP, label: `Mål dag ${d.day} · ${hhmm(d.arrival)}`, color }],
      points: [{ p: startP, label: 'Start', color: C.green }],
    });
    b.y += h + 7;
  }
  if (b.snap.prefs.profile) {
    b.ensure(30);
    profileChart(b, b.M, b.y, b.CW, 24, [d], { fromD: d.startD, toD: d.endD });
    b.y += 29;
  }
  // sjekkpunkter
  const cps: { name: string; dd: number }[] = [];
  const cstep = Math.max(10000, Math.ceil((d.endD - d.startD) / 7 / 5000) * 5000);
  for (let x = Math.ceil(d.startD / cstep) * cstep; x < d.endD - 500; x += cstep) cps.push({ name: `${Math.round(x / 1000)} km`, dd: x });
  route.waypoints.forEach((wp, k) => wp.name && cum[k] > d.startD + 200 && cum[k] < d.endD - 200 && cps.push({ name: wp.name, dd: cum[k] }));
  cps.sort((a, z) => a.dd - z.dd);
  // tilpass antall rader til plassen som er igjen (unngår en nesten tom ekstraside)
  const room = Math.floor((b.bottom - b.y - 18) / 5.4);
  const rowsCp = room >= 3 ? cps.filter((_, k) => cps.length <= room || k % Math.ceil(cps.length / room) === 0).slice(0, room) : cps.slice(0, 10);
  if (rowsCp.length) {
    b.h2('Underveis');
    b.table(['Punkt', 'Km', 'Forventet', 'Høyde', 'Notat'], rowsCp.map((c) => {
      const wp = route.waypoints.find((w2) => w2.name === c.name);
      const z = cachedElevation(pointAt(route.waypoints, cum, c.dd))?.z;
      return [c.name, n1(c.dd / 1000), passTime(snap, c.dd)?.time ?? '–', z != null ? `${Math.round(z)} moh` : '–', [wp?.description, wp?.notes].filter(Boolean).join(' · ')];
    }), { colWidths: [40, 14, 20, 20, 'auto'], fontSize: 7.6, pad: 1.1 });
  }

}

async function campsPages(b: Brief, only?: Camp[]) {
  const { snap } = b;
  const used = only ?? snap.usedCamps;
  const others = only ? [] : snap.st.camps.filter((c) => !used.includes(c));
  if (!used.length && !others.length) return;
  b.newPage('Teltplasser');
  b.h1('Teltplasser', 'Overnatting');
  const route = snap.route;
  for (const c of [...used, ...others]) {
    const di = snap.run.plan.days.findIndex((d) => d.campId === c.id);
    const out = di >= 0 ? snap.run.days[di] : undefined;
    const alts = snap.st.camps.filter((x) => x.id !== c.id && haversine(x, c) < 5000);
    const z = cachedElevation(c)?.z;
    b.ensure(70);
    const top = b.y;
    const mapW = 62, mapH = 46;
    if (snap.prefs.maps) {
      const fr = await renderMap([c, ...alts], mapW / mapH, 700, { pad: 0.3 });
      drawMap(b, fr, b.W - b.M - mapW, top, mapW, mapH, { route, dim: true, camps: [c, ...alts] });
    }
    const tw = snap.prefs.maps ? b.CW - mapW - 6 : b.CW;
    b.font(12.5, 'bold', C.navy);
    b.doc.text(T(c.name), b.M, b.y + 1);
    b.y += 6;
    b.p(out ? `Overnatting etter dag ${di + 1} (${fmtShort(out.date)}) · forventet ankomst ${hhmm(out.arrival)}` : c.role === 'reserve' ? 'Reserveplass' : 'Ikke valgt som overnatting i dette scenarioet', { size: 8.8, color: out ? C.green : C.muted, style: 'bold', w: tw });
    b.p(`Posisjon: ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)} (${fmtDM(c)})${z != null ? ` · ${Math.round(z)} moh` : ''}${route ? ` · ${Math.round(nearestOnRoute(route.waypoints, c).dist)} m fra ruten` : ''}`, { size: 8.5, w: tw });
    if (c.description) b.p(`Beskrivelse: ${c.description}`, { size: 8.8, w: tw });
    if (c.assessment) b.p(`Din vurdering: ${c.assessment}`, { size: 8.8, w: tw });
    if (c.notes ?? c.note) b.p(`Notater: ${c.notes ?? c.note}`, { size: 8.8, w: tw });
    b.p(alts.length ? `Alternativer i nærheten: ${alts.map((a) => `${a.name} (${n1(haversine(a, c) / 1000)} km)`).join(', ')}` : 'Ingen alternative teltplasser registrert innen 5 km.', { size: 8.3, color: C.muted, w: tw });
    b.p(c.approved ? 'Godkjent av deg - din egen vurdering, ikke befart eller verifisert av appen.' : 'Ikke befart. Vurder le, snødybde, skredfare og vann på stedet.', { size: 7.8, color: C.muted, style: 'italic', w: tw });
    if (snap.prefs.photos) {
      const imgs = (c.attachments ?? []).filter((a) => a.blobId).slice(0, 3);
      if (imgs.length) {
        const iw = 40, ih = 30;
        b.ensure(ih + 4);
        let ix = b.M;
        for (const a of imgs) {
          const im = await imageData(a.blobId);
          if (im) {
            coverImage(b.doc, im, ix, b.y, iw, ih);
            ix += iw + 3;
          }
        }
        b.y += ih + 4;
      }
    }
    b.y = Math.max(b.y, top + mapH + 4);
    b.doc.setDrawColor(...C.line);
    b.doc.setLineWidth(0.2);
    b.doc.line(b.M, b.y, b.W - b.M, b.y);
    b.y += 6;
  }
}

function equipmentPage(b: Brief) {
  const { snap } = b;
  const st = snap.st;
  b.newPage('Utstyr');
  b.h1('Utstyr og kites', 'Pakkeliste');
  const q = st.quivers.find((x) => x.id === st.activeQuiverId);
  const used = new Map<string, number[]>();
  snap.run.days.forEach((d) => !isReserve(d) && used.set(d.kiteId, [...(used.get(d.kiteId) ?? []), d.day]));
  b.tiles([
    { label: 'Kroppsvekt', value: `${st.riderKg} kg` },
    { label: 'Pulk', value: `${st.pulkKg} kg` },
    { label: 'Utstyr på kroppen', value: `${st.simParams.extraKg} kg` },
    { label: 'Total last', value: `${st.riderKg + st.pulkKg + st.simParams.extraKg} kg` },
  ]);
  b.h2('Kites (én om gangen)');
  b.table(['Kite', 'Str.', 'Type', 'Vindvindu', 'Brukes', 'Rolle / notat'], KITES.filter((k) => q?.kiteIds.includes(k.id)).map((k) => {
    const o = st.kiteOverrides[k.id];
    return [k.name, `${k.size} m²`, k.type, o ? `${o.low}–${o.high} m/s (ditt)` : 'modell', used.has(k.id) ? `dag ${used.get(k.id)!.join(', ')}` : '–', [st.kiteNotes?.[k.id], k.role].filter(Boolean).join(' · ')];
  }), { colWidths: [38, 13, 26, 26, 20, 'auto'], fontSize: 8 });
  const cats = [...new Set(st.packing.map((p) => p.cat))];
  if (cats.length) {
    b.h2('Pakkeliste');
    const rows: string[][] = [];
    cats.forEach((c) => st.packing.filter((p) => p.cat === c).forEach((p) => rows.push([c, `${p.packed ? '[x]' : '[ ]'} ${p.text}`, p.kg ? `${n1(p.kg)} kg` : ''])));
    b.table(['Kategori', 'Utstyr', 'Vekt'], rows, { colWidths: [34, 'auto', 18], fontSize: 7.8 });
  }
  const f = st.food;
  const days = snap.summary.days + (f.extraDays ?? 0) + (f.reserveDays ?? 0);
  b.h2('Mat og brensel');
  b.p(`${days} dager inkl. reserve · ${f.kcalPerDay} kcal per dag · ca. ${n1((days * f.kcalPerDay) / f.kcalPerKg)} kg mat · ${n1(days * f.fuelLPerDay)} l brensel.`, { size: 9 });
}

function weatherPage(b: Brief) {
  const { snap } = b;
  b.newPage('Vær og vind');
  b.h1('Vær og vind per dag', 'Forutsetninger');
  const allManual = snap.run.plan.days.every((d) => d.windMode === 'manuell');
  b.note(allManual ? 'Alle dager bruker ditt eget vindscenario. Dette er IKKE en værmelding - hent MET-prognosen når turen er innenfor ca. 9 døgn og eksporter på nytt.' : 'Dager merket «MET-prognose» bruker Meteorologisk institutts prognose langs ruten slik den var da den ble hentet. Prognoser endrer seg - sjekk yr.no / varsom.no før avreise.', allManual ? C.amber : C.green);
  const y0 = b.y;
  snap.run.plan.days.forEach((pd, i) => {
    const x = b.M + (i % 5) * 36;
    const yy = y0 + Math.floor(i / 5) * 34;
    windArrow(b.doc, x + 10, yy + 11, 8.5, pd.wind.dir, hex(DAY_COLORS[i % DAY_COLORS.length]));
    b.font(8, 'bold', C.navy);
    b.doc.text(T(`Dag ${i + 1}`), x + 10, yy + 24, { align: 'center' });
    b.font(7.5, 'normal', C.ink);
    b.doc.text(T(`${dirName(pd.wind.dir)} ${n1(pd.wind.avg)} m/s`), x + 10, yy + 28, { align: 'center' });
  });
  b.y = y0 + Math.ceil(snap.run.plan.days.length / 5) * 34 + 2;
  b.table(['Dag', 'Kilde', 'Fra', 'Snitt', 'Spenn', 'Kast', 'Kite', 'Passer kiten?'], snap.run.days.map((d, i) => {
    const pd = snap.run.plan.days[i];
    const fit = d.overShare > 0.25 ? 'For mye vind deler av dagen' : d.underShare > 0.25 ? 'For lite vind deler av dagen' : 'Innenfor kitens område';
    return [`${d.day}`, pd.windMode === 'manuell' ? 'Eget scenario' : pd.windMode === 'prognose' ? 'MET-prognose' : 'Prognose + justering', `${dirName(pd.wind.dir)} (${pd.wind.dir}°)`, `${n1(pd.wind.avg)} m/s`, `${n1(pd.wind.min)}–${n1(pd.wind.max)}`, `${n1(pd.wind.gust)} m/s`, kiteName(d.kiteId), isReserve(d) ? '–' : fit];
  }), { fontSize: 8, colors: snap.run.days.map((d) => hex(DAY_COLORS[(d.day - 1) % DAY_COLORS.length])) });
  b.p('«Passer kiten?» bygger på modellens kraftberegning for din vekt og pulk, eller ditt eget vindvindu for kiten hvis du har lagt det inn.', { size: 8, color: C.muted });
}

function safetyPage(b: Brief) {
  const { snap } = b;
  b.newPage('Terreng og sikkerhet');
  b.h1('Terreng og sikkerhet', 'Risiko og nødinfo');
  if (snap.prefs.profile) {
    b.h2('Høydeprofil');
    b.ensure(56);
    profileChart(b, b.M, b.y, b.CW, 50, snap.run.days);
    b.y += 56;
  }
  const t = snap.route ? snap.st.terrain[Object.keys(snap.st.terrain).find((k) => k.startsWith(snap.route!.id)) ?? ''] : undefined;
  b.h2('Terreng');
  b.bullets([
    `Stigning ${Math.round(snap.stats.up)} m og fall ${Math.round(snap.stats.down)} m over ${km(snap.summary.totalKm * 1000)} (${snap.stats.src}).`,
    snap.stats.hi != null ? `Høyeste punkt ca. ${Math.round(snap.stats.hi)} moh, laveste ca. ${Math.round(snap.stats.lo ?? 0)} moh.` : 'Ingen høydedata.',
    t ? 'Terrenganalyse (helning og le) er gjort for ruten i appen.' : 'Terrenganalyse er ikke kjørt for denne ruten - sjekk bratthet og skredterreng (NVE/Varsom) selv.',
    ...(/rjukan/i.test(snap.st.project.destination) ? ['Krossobanen er stengt: planlegg nedstigningen fra Gvepseborg til Rjukan til fots/ski med pulk (bratt).'] : []),
  ]);
  const approved = snap.check.crossings.filter((c) => c.label === 'BRUKERGODKJENT');
  const other = snap.check.crossings.filter((c) => c.label !== 'BRUKERGODKJENT');
  if (approved.length) {
    b.h2('Vannkryssinger godkjent av deg');
    b.note('Godkjent av deg betyr at DU har vurdert kryssingen for din rute. Det er ikke en offisiell kontroll av isen.', C.teal);
    b.table(['Vann', 'Km', 'Lengde', 'Offisiell status'], approved.map((c) => [c.barrier.name, `${n1(c.fromD / 1000)}–${n1(c.toD / 1000)}`, `${Math.round(c.lengthM)} m`, c.barrier.label]), { fontSize: 8 });
  }
  if (other.length) {
    b.h2('Kryssinger som ikke er vurdert');
    b.table(['Vann / sone', 'Km', 'Lengde', 'Status', 'Merknad'], other.map((c) => [c.barrier.name, `${n1(c.fromD / 1000)}–${n1(c.toD / 1000)}`, `${Math.round(c.lengthM)} m`, c.barrier.label, c.hazards.join('; ') || (c.blocking ? 'Viktig - sjekk is og vannstand' : 'Uavklart')]), { fontSize: 8 });
  }
  if (!snap.check.waterChecked) b.note('Vann langs ruten er ikke kontrollert mot NVE i appen ennå.');
  const ws = snap.warnings.filter((w) => w.level !== 'info');
  if (ws.length) {
    b.h2('Varsler');
    b.table(['Nivå', 'Varsel', 'Din vurdering'], ws.slice(0, 40).map((w) => [LEVEL_TEXT[w.level], `${w.title}: ${w.text}`, w.ack ? `Vurdert av deg: ${w.ack}` : '–']), { colWidths: [24, 'auto', 50], fontSize: 7.8 });
  }
  // nødutganger og hytter
  if (snap.route) {
    const route = snap.route;
    const huts = Object.values(snap.st.places).map((p) => ({ p, n: nearestOnRoute(route.waypoints, p) })).filter((x) => x.n.dist < 6000).sort((a, z) => a.n.d - z.n.d);
    const exits = snap.st.markers.filter((m) => m.category === 'exit');
    if (huts.length || exits.length) {
      b.h2('Avbrudd, hytter og nødutganger nær ruten');
      b.table(['Sted', 'Type', 'Ved km', 'Avstand fra rute', 'Posisjon'], [
        ...exits.map((m) => [m.name, 'Nødutgang (din markør)', n1(nearestOnRoute(route.waypoints, m).d / 1000), `${n1(nearestOnRoute(route.waypoints, m).dist / 1000)} km`, fmtDM(m)]),
        ...huts.slice(0, 25).map((x) => [x.p.name, x.p.type, n1(x.n.d / 1000), `${n1(x.n.dist / 1000)} km`, fmtDM(x.p)]),
      ], { fontSize: 7.8 });
    }
  }
}

function finalPage(b: Brief) {
  const { snap } = b;
  b.newPage('Kontakter og forbehold');
  b.h1('Kontakter, kilder og forbehold', 'Til slutt');
  b.h2('Kontakter og nødinformasjon');
  b.p(snap.st.project.contacts || 'Nødnummer: 112 (politi/redning) · 113 (ambulanse) · 110 (brann)', { size: 10 });
  b.p('Varsle noen hjemme om rute, plan for overnatting og når du senest skal gi lyd. Ha med nødpeilesender/satellittkommunikasjon.', { size: 9, color: C.muted });
  if (snap.st.project.notes) {
    b.h2('Personlige notater');
    b.p(snap.st.project.notes, { size: 9 });
  }
  if (snap.run.plan.note) {
    b.h2('Notat for scenarioet');
    b.p(snap.run.plan.note, { size: 9 });
  }
  b.h2('Datakilder');
  b.table(['Kilde', 'Brukt til'], [
    ['Kartverket - topografisk kart (WMTS-cache)', 'Kartbakgrunn i appen og i denne PDF-en'],
    ['Kartverket - høydedata (DTM, høydedata-API)', 'Høydeprofil, stigning og fall'],
    ['Kartverket - stedsnavn-API', 'Hytter, steder og navn langs ruten'],
    ['NVE - Vannkraft (magasiner, dammer) og Innsjødatabasen', 'Kryssinger av regulerte og andre vann'],
    ['MET Norge - Locationforecast', 'Værmelding langs ruten (bare der det står «MET-prognose»)'],
    ['NVE / Varsom', 'Skredvarsel (sjekk varsom.no før avreise)'],
    ['Din GPX og dine egne punkter', 'Rute, punkter, teltplasser, notater og godkjenninger'],
  ], { colWidths: [80, 'auto'], fontSize: 8 });
  if (snap.prefs.assumptions) {
    const p = snap.st.simParams;
    b.h2('Modellforutsetninger');
    b.bullets([
      `Vekt: ${snap.st.riderKg} kg + pulk ${snap.st.pulkKg} kg + ${p.extraKg} kg på kroppen. Snø: ${snap.st.snow}. Temperatur for luftetthet: ${p.tempC} °C.`,
      `Kitekraft fra vindhastighet ved kitehøyde (logaritmisk vindprofil), kitens areal og løftekoeffisient, begrenset av hva du kan holde. Glidetall gir hvor høyt du kan krysse; sidedrag fra pulk/skrens ${p.groundDragDeg}°.`,
      `Motstand: friksjon for snøtypen, helning og luftmotstand. Komfortfart maks ${p.comfortKmh} km/t. Stagvending ${p.tackSec} s, kitebytte ${p.kiteChangeMin} min.`,
      `Én kite om gangen; «auto» velger kiten som gir best fremdrift. Usikkerhet: pessimistisk/optimistisk vind (±) gir spennet for distanse og ankomst.`,
      'Dagen slutter senest ved borgerlig skumring. Bratte partier og siste nedstigning regnes som gåing.',
    ], 8.5);
  }
  b.h2('Forbehold');
  b.note('Denne planen er laget for planlegging. Ruter, teltplasser og kryssinger er tegnet på kart og ikke befart. Simulert fremdrift er en modell - virkeligheten avhenger av snø, vind, sikt, form og utstyr. Vindscenarioer er antakelser med mindre det står «MET-prognose», og prognoser er usikre. «Godkjent av deg» og «vurdert av deg» er dine egne vurderinger, ikke offisielle kontroller. Bruk eget skjønn, sjekk is, skredvarsel og vær lokalt, og snu i tide.', C.red);
  b.p(`Sist oppdatert: ${new Date(snap.generatedAt).toLocaleString('nb-NO', { dateStyle: 'long', timeStyle: 'short' })}. Prosjekt: ${snap.st.project.name}. Scenario: ${snap.run.plan.name}.`, { size: 8.5, color: C.muted });
}

/** Første side for feltbrief / dags-PDF: kompakt topp med nøkkeltall og nødinfo (ingen helsides forside). */
function briefHeader(b: Brief, title: string) {
  const { snap, doc } = b;
  b.sections[0] = 'Feltbrief';
  b.noHeader.add(1);
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, b.W, 46, 'F');
  doc.setFillColor(...C.orange);
  doc.rect(b.M, 13, 12, 1.2, 'F');
  b.font(8, 'bold', [125, 160, 190]);
  doc.text(T(title.toUpperCase()), b.M, 20, { charSpace: 0.6 });
  b.font(19, 'bold', C.white);
  doc.text(doc.splitTextToSize(T(snap.st.project.name), b.CW).slice(0, 1), b.M, 29);
  b.font(9.5, 'normal', [203, 213, 225]);
  doc.text(T(`${fmtLong(snap.st.tripDate)} – ${fmtLong(snap.endDate)} · scenario «${snap.run.plan.name}»`), b.M, 37);
  b.y = 56;
}

export async function buildPdf(snap: ExportSnapshot, o: PdfOptions): Promise<Blob> {
  const b = new Brief(snap);
  const pr = snap.prefs;
  const step = (m: string) => o.onProgress?.(m);
  if (o.scope.kind === 'sammenligning') return comparePdf(b, o.scope.ids, step);
  if (!snap.route) throw new Error('Prosjektet har ingen rute å eksportere');
  const preset = pr.preset;
  if (o.scope.kind === 'dag') {
    const d = snap.run.days[o.scope.day - 1];
    if (!d) throw new Error('Fant ikke dagen');
    briefHeader(b, `Dagsplan · dag ${d.day}`);
    b.tiles([
      { label: 'Distanse i dag', value: km(d.endD - d.startD) },
      { label: 'Avreise – ankomst', value: `${hhmm(d.departure)} – ${hhmm(d.arrival)}` },
      { label: 'Kite', value: kiteName(d.kiteId) },
      { label: 'Igjen etterpå', value: km(d.remainingKm * 1000, 0) },
    ]);
    b.p(snap.st.project.contacts, { size: 8.5, color: C.muted });
    step('Tegner dagen …');
    await dayPage(b, d);
    const camp = snap.st.camps.find((c) => c.id === snap.run.plan.days[d.day - 1]?.campId);
    if (camp && pr.camps) await campsPages(b, [camp]);
    b.finish();
    return b.doc.output('blob');
  }
  step('Henter kart …');
  // forsidekartet: ruten i øvre del (plass til tittelfeltet nederst)
  const lats = snap.route.waypoints.map((w) => w.lat);
  const span = Math.max(...lats) - Math.min(...lats);
  const lonMid = snap.route.waypoints.reduce((a, w) => a + w.lon, 0) / snap.route.waypoints.length;
  const coverFrame = pr.maps ? await renderMap([...snap.route.waypoints, { lat: Math.min(...lats) - span * 0.75, lon: lonMid }], b.W / 168, 1400, { pad: 0.05 }) : null;
  const photo = pr.photos ? await imageData(snap.st.project.coverBlobId) : null;
  if (preset === 'felt') {
    briefHeader(b, 'Feltbrief');
    b.tiles([
      { label: 'Distanse', value: km(snap.summary.totalKm * 1000, 0) },
      { label: 'Dager', value: `${snap.summary.days}` },
      { label: 'Ankomst', value: snap.summary.doneDay ? `Dag ${snap.summary.doneDay.day} ${hhmm(snap.summary.doneDay.arrival)}` : 'ikke nådd' },
      { label: 'Last', value: `${snap.st.riderKg}+${snap.st.pulkKg} kg` },
    ]);
    b.h2('Nødinformasjon');
    b.p(snap.st.project.contacts, { size: 9.5 });
    b.table(['Dag', 'Distanse', 'Avreise', 'Ankomst', 'Kite', 'Vind', 'Teltplass'], snap.run.days.map((d, i) => {
      const pd = snap.run.plan.days[i];
      return isReserve(d) ? [`${d.day}`, 'reserve', '–', '–', '–', '–', '–'] : [`${d.day}`, km(d.endD - d.startD), hhmm(d.departure), hhmm(d.arrival), kiteName(d.kiteId), `${dirName(pd.wind.dir)} ${pd.wind.avg} m/s`, snap.st.camps.find((c) => c.id === pd.campId)?.name ?? '–'];
    }), { fontSize: 8.3, colors: snap.run.days.map((d) => hex(DAY_COLORS[(d.day - 1) % DAY_COLORS.length])) });
  } else {
    await coverPage(b, coverFrame, photo);
  }
  if (preset !== 'felt' && preset !== 'rute') overviewPage(b, preset === 'kompakt');
  if (pr.maps) {
    step('Lager rutekart …');
    await routeMapPage(b, pr.landscapeMap);
  }
  if (preset === 'rute' && pr.profile) {
    b.newPage('Høydeprofil');
    b.h1('Høydeprofil', 'Terreng');
    profileChart(b, b.M, b.y, b.CW, 70, snap.run.days);
    b.y += 78;
  }
  if (preset === 'full' || preset === 'felt') {
    for (const d of snap.run.days) {
      step(`Dag ${d.day} …`);
      await dayPage(b, d);
    }
  }
  if (pr.camps && preset !== 'kompakt') {
    step('Teltplasser …');
    await campsPages(b);
  }
  if (pr.kites && preset === 'full') equipmentPage(b);
  if (pr.weather && (preset === 'full' || preset === 'kompakt')) weatherPage(b);
  if (pr.safety && preset !== 'rute') safetyPage(b);
  if (preset === 'rute' && pr.waypoints) {
    b.newPage('Rutepunkter');
    b.h1('Rutepunkter og beskrivelser', 'Rute');
    const cum = cumulative(snap.route.waypoints);
    b.table(['Nr', 'Navn', 'Km', 'Posisjon', 'Beskrivelse', 'Notat'], snap.route.waypoints.map((w, i) => ({ w, i })).filter(({ w }) => w.name || w.description || w.notes).map(({ w, i }) => [String(i + 1), w.name ?? '–', n1(cum[i] / 1000), fmtDM(w), w.description ?? '', w.notes ?? '']), { colWidths: [9, 32, 12, 34, 'auto', 40], fontSize: 7.8 });
  }
  finalPage(b);
  b.finish();
  return b.doc.output('blob');
}

async function comparePdf(b: Brief, ids: string[], step: (m: string) => void): Promise<Blob> {
  const { snap } = b;
  const runs: PlanRun[] = ids.map((id) => snap.st.plans.find((p) => p.id === id)).filter(Boolean).map((p) => runPlan(snap.st, p!));
  briefHeader(b, 'Sammenligning av scenarioer');
  b.sections[0] = 'Sammenligning';
  const rows = compareRows(runs, snap.st.camps, snap.st.project.destination);
  b.table(['', ...runs.map((r) => r.plan.name + (r.plan.id === snap.st.mainPlanId ? ' *' : ''))], rows.map((r) => [r.label, ...r.values.map((v) => v.split(' · ').join('\n'))]), { fontSize: 7.6, colWidths: [28, ...runs.map(() => 'auto' as const)] });
  b.p('* = hovedplan. Alle scenarioer er regnet ut på nytt fra lagrede data da PDF-en ble laget.', { size: 7.8, color: C.muted });
  if (snap.prefs.maps) {
    step('Kart …');
    b.newPage('Sammenligning', 'landscape');
    b.h1('Rutene i scenarioene', 'Kart');
    const pts = runs.flatMap((r) => r.route?.waypoints ?? []);
    const w = b.CW, h = b.bottom - b.y - 12;
    const fr = await renderMap(pts, w / h, 2000);
    const others = runs.filter((r) => r.route).map((r, i) => ({ route: r.route!, color: hex(SCENARIO_COLORS[i % SCENARIO_COLORS.length]), width: Math.max(0.6, 3.4 - i * 0.9) }));
    const flags = runs.flatMap((r, i) => {
      if (!r.route) return [];
      const cum = cumulative(r.route.waypoints);
      return r.days.filter((d) => !isReserve(d)).map((d) => ({ p: pointAt(r.route!.waypoints, cum, d.endD), label: `${i + 1}·D${d.day}`, color: hex(SCENARIO_COLORS[i % SCENARIO_COLORS.length]) }));
    });
    drawMap(b, fr, b.M, b.y, w, h, { others, flags });
    b.y += h + 6;
    let lx = b.M;
    runs.forEach((r, i) => {
      b.doc.setFillColor(...hex(SCENARIO_COLORS[i % SCENARIO_COLORS.length]));
      b.doc.rect(lx, b.y - 2.4, 4, 2.6, 'F');
      b.font(7.5, 'normal', C.ink);
      const t = T(`${i + 1}: ${r.plan.name}`);
      b.doc.text(t, lx + 5.2, b.y);
      lx += b.doc.getTextWidth(t) + 12;
    });
  }
  finalPage(b);
  b.finish();
  return b.doc.output('blob');
}

export const PRESET_INFO = PRESETS;
