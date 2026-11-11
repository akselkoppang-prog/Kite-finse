import { searchPlace, nearestName, elevations } from './api/kartverket';
import { providerById, fetchAlerts } from './weather/providers';
import { getDB } from '../storage/db';
import { BUILD, versionLine } from './version';
import { discoverLayers, getBases, wmsLayers, envelope } from './api/nve';
import { forecast } from './api/met';
import { avalancheWarnings } from './api/varsom';
import { fetchJson } from './api/http';
import { sunDay, hourOf } from './sun';
import { SOURCES } from '../data/sources';

/**
 * Live-diagnose: kjører EKTE kall mot hver tjeneste fra nettleseren og validerer svarformatet.
 * Ingen stubber. Resultatet viser hva som faktisk virker der appen kjører.
 */
export interface DiagResult {
  id: string;
  name: string;
  ok: boolean;
  ms: number;
  checks: { ok: boolean; text: string }[];
  error?: string;
  at: string;
}

const FINSE = { lat: 60.6007, lon: 7.4996 };

function tileXY(lat: number, lon: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return { x: Math.floor(((lon + 180) / 360) * 2 ** z), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z) };
}

function loadImage(url: string, timeout = 15000): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const img = new Image();
    const t = setTimeout(() => rej(new Error('Tidsavbrudd')), timeout);
    img.onload = () => {
      clearTimeout(t);
      res({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      clearTimeout(t);
      rej(new Error('Flisen kunne ikke lastes (feil URL, nettverk eller blokkert)'));
    };
    img.src = url;
  });
}

type Test = { id: string; name: string; run: (c: (ok: boolean, text: string) => void) => Promise<void>; skip?: () => string | null };

export function buildTests(frostId: string): Test[] {
  return [
    {
      id: 'kv-tiles',
      name: 'Kartverket topo-fliser (WMTS-cache)',
      run: async (c) => {
        for (const layer of ['topo', 'topograatone', 'toporaster']) {
          const { x, y } = tileXY(FINSE.lat, FINSE.lon, 10);
          const url = SOURCES['kv-topo'].urls[0].replace('/topo/', `/${layer}/`).replace('{z}', '10').replace('{y}', String(y)).replace('{x}', String(x));
          try {
            const r = await loadImage(url);
            c(r.w === 256, `${layer}: flis ${r.w}×${r.h} px lastet`);
          } catch (e) {
            c(false, `${layer}: ${(e as Error).message}`);
          }
        }
      },
    },
    {
      id: 'kv-stedsnavn',
      name: 'Kartverket stedsnavn – søk og punkt',
      run: async (c) => {
        const r = await searchPlace('Finse');
        c(r.length > 0, `Søk «Finse»: ${r.length} treff i planområdet`);
        const f = r[0];
        if (f) c(Math.abs(f.lat - FINSE.lat) < 0.1 && Math.abs(f.lon - FINSE.lon) < 0.2, `Første treff ${f.name} (${f.type}) ved ${f.lat.toFixed(4)}, ${f.lon.toFixed(4)} – koordinatrekkefølge nord/øst OK`);
        const n = await nearestName(FINSE, 2000);
        c(!!n, `Punktsøk: nærmeste navn «${n?.name ?? '–'}» (${n?.type ?? '–'})`);
      },
    },
    {
      id: 'kv-hoyde',
      name: 'Kartverket høydedata (DTM) – enkelt og batch',
      run: async (c) => {
        const [a, b] = await elevations([{ lat: 60.6007, lon: 7.4996 }, { lat: 59.8784, lon: 8.5517 }]);
        c(a.z != null && a.z > 1100 && a.z < 1350, `Finse stasjon: ${a.z?.toFixed(1) ?? '–'} moh (forventet ca. 1200–1230) · kilde ${a.datakilde ?? 'ukjent'}`);
        c(b.z != null && b.z > 250 && b.z < 600, `Rjukan (slutt GPX): ${b.z?.toFixed(1) ?? '–'} moh`);
      },
    },
    {
      id: 'nve-vannkraft',
      name: 'NVE Vannkraft – magasin- og damlag',
      run: async (c) => {
        const layers = await discoverLayers('nve-vannkraft-rest', getBases('vk'), /magasin|dam/i);
        c(layers.some((l) => /magasin/i.test(l.name)), `Lag funnet: ${layers.map((l) => `${l.id}:${l.name}`).join(', ')} (${layers[0].base})`);
        const mag = layers.find((l) => /magasin/i.test(l.name));
        if (mag) {
          const p = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'false', f: 'json', resultRecordCount: '3', ...envelope([8.0, 60.0, 8.4, 60.2]) });
          const j = await fetchJson<{ features?: { attributes: Record<string, unknown> }[]; fields?: { name: string }[] }>('nve-vannkraft-rest', `${mag.base}/${mag.id}/query?${p}`);
          const fields = j.fields?.map((f) => f.name) ?? Object.keys(j.features?.[0]?.attributes ?? {});
          c((j.features?.length ?? 0) > 0, `Magasiner i Mår-området: ${j.features?.length ?? 0} (spørring OK)`);
          c(fields.some((f) => /hrv|h(ø|o)y/i.test(f)) && fields.some((f) => /lrv|lav/i.test(f)), `Felter: ${fields.slice(0, 12).join(', ')}${fields.length > 12 ? '…' : ''} – HRV/LRV-felt ${fields.some((f) => /hrv|lrv|vannst/i.test(f)) ? 'funnet' : 'IKKE funnet'}`);
        }
      },
    },
    {
      id: 'nve-innsjo',
      name: 'NVE Innsjødatabase',
      run: async (c) => {
        const layers = await discoverLayers('nve-innsjo-rest', getBases('lake'), /innsj/i);
        const l = layers.find((x) => /polygon/i.test(x.geometryType ?? '')) ?? layers[0];
        c(!!l, `Polygonlag: ${l?.id}:${l?.name} (${l?.geometryType ?? '?'})`);
        const p = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson', resultRecordCount: '2', ...envelope([7.45, 60.58, 7.55, 60.62]) });
        const j = await fetchJson<{ features?: { properties: Record<string, unknown>; geometry?: { type: string } }[] }>('nve-innsjo-rest', `${l.base}/${l.id}/query?${p}`);
        c((j.features?.length ?? 0) > 0 && /Polygon/.test(j.features?.[0]?.geometry?.type ?? ''), `GeoJSON-svar ved Finse: ${j.features?.length ?? 0} innsjøer, geometri ${j.features?.[0]?.geometry?.type ?? '–'}`);
        c(true, `Felter: ${Object.keys(j.features?.[0]?.properties ?? {}).slice(0, 10).join(', ')}`);
      },
    },
    {
      id: 'nve-wms',
      name: 'NVE WMS (vannkraft + bratthet/skred)',
      run: async (c) => {
        for (const [id, urls] of [['nve-vannkraft-wms', SOURCES['nve-vannkraft-wms'].urls], ['nve-skred-wms', SOURCES['nve-skred-wms'].urls]] as const) {
          let okAny = false;
          for (const u of urls) {
            try {
              const l = await wmsLayers(id, u);
              c(true, `${u.split('/services/')[1]}: ${l.length} lag (${l.slice(0, 3).map((x) => x.name).join(', ')}…)`);
              okAny = true;
              break;
            } catch (e) {
              c(false, `${u.split('/services/')[1]}: ${(e as Error).message}`);
            }
          }
          if (!okAny) c(false, `${id}: ingen kandidat-URL virket – lim inn riktig URL under`);
        }
      },
    },
    {
      id: 'met',
      name: 'MET Locationforecast 2.0 (complete)',
      run: async (c) => {
        const f = await forecast({ ...FINSE, label: 'Finse' });
        c(f.rows.length > 24, `${f.rows.length} tidssteg, modell oppdatert ${f.updatedAt}`);
        const r = f.rows[0];
        c(r.windSpeed != null && r.windFrom != null && r.temp != null, `Vind ${r.windSpeed} m/s fra ${r.windFrom}°, ${r.temp} °C`);
        c(r.windGust != null, `Vindkast ${r.windGust != null ? 'finnes' : 'MANGLER'} i svaret`);
        c(r.windP10 != null && r.windP90 != null, `Percentiler (usikkerhet) ${r.windP10 != null ? 'finnes' : 'mangler'}`);
        c(true, `Sikt: finnes ikke i Locationforecast (tåkeandel: ${r.fog ?? '–'} %)`);
      },
    },
    {
      id: 'open-meteo',
      name: 'Open-Meteo (ECMWF / ICON / MET Nordic)',
      run: async (c) => {
        for (const id of ['om-ecmwf', 'om-icon', 'om-metno']) {
          const pr = providerById(id);
          try {
            const f = await pr.fetch({ ...FINSE, label: 'Finse' });
            const r = f.rows[0];
            c(f.rows.length > 24 && r.windSpeed != null && r.windFrom != null, `${pr.short}: ${f.rows.length} timer, vind ${r.windSpeed} m/s fra ${r.windFrom}°, kast ${r.windGust ?? '–'}, sikt ${r.visibility ?? '–'} m`);
          } catch (e) {
            c(false, `${pr.short}: ${(e as Error).message}`);
          }
        }
      },
    },
    {
      id: 'met-alerts',
      name: 'MET farevarsler (MetAlerts)',
      run: async (c) => {
        const a = await fetchAlerts([{ ...FINSE, label: 'Finse' }]);
        c(true, `${a.length} gjeldende farevarsel(er) for Finse${a[0] ? `: ${a[0].title}` : ''}`);
      },
    },
    {
      id: 'varsom',
      name: 'NVE Varsom snøskredvarsel',
      run: async (c) => {
        const r = await avalancheWarnings({ lat: 60.3, lon: 7.8 }, 2);
        c(true, `Svar fra ${r.url.split('/avalanche/')[1]?.split('/')[0]}: ${r.warnings.length} varsel(er)${r.warnings.length === 0 ? ' (normalt utenfor 1. des–31. mai)' : `, region ${r.warnings[0].RegionName}`}`);
      },
    },
    {
      id: 'frost',
      name: 'MET Frost (klimatologi)',
      skip: () => (frostId ? null : 'Krever Frost klient-ID (Vær & vind → Klimatologi)'),
      run: async (c) => {
        const j = await fetchJson<{ data?: { id: string; name: string }[] }>('met-frost', `https://frost.met.no/sources/v0.jsonld?types=SensorSystem&geometry=nearest(POINT(${FINSE.lon} ${FINSE.lat}))&nearestmaxcount=1`, { headers: { Authorization: `Basic ${btoa(`${frostId}:`)}` } });
        c(!!j.data?.length, `Nærmeste stasjon: ${j.data?.[0]?.name ?? '–'} (${j.data?.[0]?.id ?? '–'})`);
      },
    },
    {
      id: 'sun',
      name: 'Solberegning (lokal, SunCalc)',
      run: async (c) => {
        const d = sunDay('2027-03-20', FINSE);
        c(Math.abs(d.daylightH - 12.2) < 0.4, `Jevndøgn 20.03.2027 Finse: ${d.daylightH.toFixed(2)} t dagslys (forventet ≈12,2 t inkl. refraksjon)`);
        const s = hourOf(d.sunrise)!;
        c(s > 6 && s < 7, `Soloppgang ${s.toFixed(2)} lokal tid (CET)`);
      },
    },
    {
      id: 'storage',
      name: 'Lokal lagring og offline',
      run: async (c) => {
        const est = navigator.storage?.estimate ? await navigator.storage.estimate() : undefined;
        if (est) c((est.usage ?? 0) < (est.quota ?? Infinity) * 0.9, `Brukt ${(((est.usage ?? 0) / 1048576)).toFixed(1)} MB av ${(((est.quota ?? 0) / 1048576)).toFixed(0)} MB`);
        // prosjektet ligger i IndexedDB: kontroller at databasen kan åpnes og leses
        try {
          const db = await getDB();
          const n = await db.count('projects');
          const sl = await db.count('slices');
          c(n > 0, `IndexedDB åpnet: ${n} prosjekt(er), ${sl} lagrede deler`);
        } catch (e) {
          c(false, `IndexedDB kan ikke åpnes: ${(e as Error).message}`);
        }
        const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
        c(true, `Varig lagring: ${persisted == null ? 'ukjent i denne nettleseren' : persisted ? 'innvilget' : 'ikke innvilget (nettleseren kan rydde ved plassmangel – ta jevnlig ZIP-kopi)'}`);
        const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
        c(!!reg, `Service worker for offline: ${reg ? 'registrert' : 'ikke registrert (normalt i utviklingsserver)'}`);
      },
    },
    {
      id: 'version',
      name: 'Appversjon',
      run: async (c) => {
        c(true, `Denne fanen kjører ${versionLine()} (${BUILD.channel})`);
        if (BUILD.channel === 'dev' || BUILD.channel === 'test') return;
        try {
          const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
          const j = res.ok ? await res.json() : null;
          c(!!j?.version, j?.version ? `Nyeste på serveren: ${j.version}${j.version === BUILD.version ? ' (du er oppdatert)' : ' – last appen på nytt for å oppdatere'}` : 'Fant ikke version.json på serveren');
        } catch {
          c(true, 'Kunne ikke spørre serveren om nyeste versjon (uten nett?)');
        }
      },
    },
  ];
}

export async function runDiagnostics(frostId: string, onResult: (r: DiagResult) => void): Promise<DiagResult[]> {
  const out: DiagResult[] = [];
  for (const t of buildTests(frostId)) {
    const checks: DiagResult['checks'] = [];
    const t0 = performance.now();
    const skip = t.skip?.();
    let res: DiagResult;
    if (skip) {
      res = { id: t.id, name: t.name, ok: false, ms: 0, checks: [{ ok: false, text: `Hoppet over: ${skip}` }], at: new Date().toISOString() };
    } else {
      try {
        await t.run((ok, text) => checks.push({ ok, text }));
        res = { id: t.id, name: t.name, ok: checks.every((x) => x.ok), ms: performance.now() - t0, checks, at: new Date().toISOString() };
      } catch (e) {
        res = { id: t.id, name: t.name, ok: false, ms: performance.now() - t0, checks, error: (e as Error).message, at: new Date().toISOString() };
      }
    }
    out.push(res);
    onResult(res);
  }
  return out;
}
