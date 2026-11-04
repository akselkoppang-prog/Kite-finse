import { fetchJson, fetchText } from './http';
import type { SourceId } from '../../data/sources';
import type { LatLon } from '../geo';
import type { FeatureCollection, Feature, Polygon, MultiPolygon, Point } from 'geojson';

interface LayerInfo { id: number; name: string; geometryType?: string; type?: string; subLayerIds?: number[] | null }

export interface DiscoveredLayer { base: string; id: number; name: string; geometryType?: string }

/** Leter etter lag i en ArcGIS MapServer hvis navn matcher regex. Prøver alle kandidat-URLer. */
export async function discoverLayers(source: SourceId, bases: string[], re: RegExp): Promise<DiscoveredLayer[]> {
  let lastErr: unknown;
  for (const base of bases) {
    try {
      const json = await fetchJson<{ layers?: LayerInfo[] }>(source, `${base}/layers?f=json`, undefined, { cacheMs: 3600000, nature: 'kartdata' });
      if (!Array.isArray(json.layers)) throw new Error(`Uventet svar fra ${base} (mangler «layers»)`);
      const hits = (json.layers ?? []).filter((l) => re.test(l.name) && !(l.subLayerIds && l.subLayerIds.length));
      if (hits.length) return hits.map((l) => ({ base, id: l.id, name: l.name, geometryType: l.geometryType }));
      lastErr = new Error(`Ingen lag matcher ${re} i ${base}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Fant ingen lag');
}

async function queryAll(source: SourceId, layer: DiscoveredLayer, params: Record<string, string>, method: 'GET' | 'POST' = 'GET'): Promise<Feature[]> {
  const out: Feature[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const p = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'geojson',
      resultOffset: String(offset),
      resultRecordCount: '1000',
      ...params,
    });
    const url = `${layer.base}/${layer.id}/query`;
    const json = method === 'GET'
      ? await fetchJson<FeatureCollection & { exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } }>(source, `${url}?${p}`)
      : await fetchJson<FeatureCollection & { exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } }>(source, url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: p.toString(),
        });
    const feats = json.features ?? [];
    feats.forEach((f) => (f.properties = { ...(f.properties ?? {}), __layer: layer.name }));
    out.push(...feats);
    const more = json.exceededTransferLimit || json.properties?.exceededTransferLimit;
    if (!more || feats.length === 0) break;
    offset += feats.length;
  }
  return out;
}

export function envelope(b: [number, number, number, number]) {
  return {
    geometry: JSON.stringify({ xmin: b[0], ymin: b[1], xmax: b[2], ymax: b[3], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  };
}

export type PolyFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;

export interface NveHydro {
  reservoirs: PolyFeature[];
  dams: Feature<Point | Polygon, Record<string, unknown>>[];
  layers: DiscoveredLayer[];
  fetchedAt: string;
}

const VK_BASES = ['https://kart.nve.no/enterprise/rest/services/Vannkraft1/MapServer', 'https://nve.geodataonline.no/arcgis/rest/services/Vannkraft1/MapServer'];
const LAKE_BASES = ['https://kart.nve.no/enterprise/rest/services/Innsjodatabase2/MapServer', 'https://nve.geodataonline.no/arcgis/rest/services/Innsjodatabase2/MapServer'];

export function getBases(kind: 'vk' | 'lake'): string[] {
  try {
    const custom = localStorage.getItem(`kite.nveBase.${kind}`);
    if (custom) return [custom, ...(kind === 'vk' ? VK_BASES : LAKE_BASES)];
  } catch {
    /* */
  }
  return kind === 'vk' ? VK_BASES : LAKE_BASES;
}

export async function loadHydropower(b: [number, number, number, number]): Promise<NveHydro> {
  const layers = await discoverLayers('nve-vannkraft-rest', getBases('vk'), /magasin|dam/i);
  const resL = layers.filter((l) => /magasin/i.test(l.name) && /polygon/i.test(l.geometryType ?? 'polygon'));
  const damL = layers.filter((l) => /dam/i.test(l.name));
  const reservoirs: PolyFeature[] = [];
  for (const l of resL) reservoirs.push(...((await queryAll('nve-vannkraft-rest', l, envelope(b))) as PolyFeature[]));
  const dams: NveHydro['dams'] = [];
  for (const l of damL.slice(0, 2)) {
    try {
      dams.push(...((await queryAll('nve-vannkraft-rest', l, envelope(b))) as NveHydro['dams']));
    } catch {
      /* dammer er tilleggsinfo */
    }
  }
  if (!resL.length) throw new Error('Fant ikke magasin-lag i NVE Vannkraft-tjenesten');
  return { reservoirs, dams, layers, fetchedAt: new Date().toISOString() };
}

/** Innsjøer som skjærer en polyline (ruten). Sendes som POST for lange geometrier. */
export async function lakesAlong(line: LatLon[]): Promise<{ lakes: PolyFeature[]; layer: DiscoveredLayer; fetchedAt: string }> {
  const layers = await discoverLayers('nve-innsjo-rest', getBases('lake'), /innsj/i);
  const layer = layers.find((l) => /polygon/i.test(l.geometryType ?? '')) ?? layers[0];
  const geom = { paths: [line.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))])], spatialReference: { wkid: 4326 } };
  const lakes = (await queryAll(
    'nve-innsjo-rest',
    layer,
    { geometry: JSON.stringify(geom), geometryType: 'esriGeometryPolyline', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' },
    'POST',
  )) as PolyFeature[];
  return { lakes, layer, fetchedAt: new Date().toISOString() };
}

/** Innsjøer innen en radius rundt et punkt (for teltplass-vurdering). */
export async function lakesNear(p: LatLon, radiusM: number): Promise<PolyFeature[]> {
  const layers = await discoverLayers('nve-innsjo-rest', getBases('lake'), /innsj/i);
  const layer = layers.find((l) => /polygon/i.test(l.geometryType ?? '')) ?? layers[0];
  return (await queryAll('nve-innsjo-rest', layer, {
    geometry: JSON.stringify({ x: p.lon, y: p.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(radiusM),
    units: 'esriSRUnit_Meter',
  })) as PolyFeature[];
}

/** Finner et navn-felt i NVE-attributter uansett eksakt feltnavn. */
export function featureName(props: Record<string, unknown> | null | undefined): string | undefined {
  if (!props) return undefined;
  const k = Object.keys(props).find((k) => /^(navn|magasinnavn|innsjonavn|vatnavn|name)$/i.test(k)) ?? Object.keys(props).find((k) => /navn/i.test(k));
  const v = k ? props[k] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function findNumeric(props: Record<string, unknown> | null | undefined, re: RegExp): number | undefined {
  if (!props) return undefined;
  const k = Object.keys(props).find((k) => re.test(k));
  const v = k ? Number(props[k]) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

// ---------- WMS GetCapabilities ----------

export interface WmsLayer { name: string; title: string }

export async function wmsLayers(source: SourceId, url: string): Promise<WmsLayer[]> {
  const sep = url.includes('?') ? '&' : '?';
  const xml = await fetchText(source, `${url}${sep}service=WMS&request=GetCapabilities&version=1.3.0`);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: WmsLayer[] = [];
  doc.querySelectorAll('Layer').forEach((l) => {
    const name = l.querySelector(':scope > Name')?.textContent;
    const title = l.querySelector(':scope > Title')?.textContent ?? name ?? '';
    if (name) out.push({ name, title });
  });
  if (!out.length) throw new Error('Ingen lag i GetCapabilities');
  return out;
}
