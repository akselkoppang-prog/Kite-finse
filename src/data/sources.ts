// Register over datakilder. URL-ene er offentlige tjenester som kalles DIREKTE fra nettleseren din.
// Ingen av dem simuleres. Hvis et kall feiler (nettverk, CORS, endret URL) vises det som GRÅ/feil i appen.
// "researchNote" beskriver hva som er kontrollert under utviklingen (3. nov 2026) og hva som IKKE er kontrollert.

export type SourceId =
  | 'kv-topo'
  | 'kv-graatone'
  | 'kv-raster'
  | 'kv-stedsnavn'
  | 'kv-hoyde'
  | 'nve-vannkraft-rest'
  | 'nve-innsjo-rest'
  | 'nve-vannkraft-wms'
  | 'nve-skred-wms'
  | 'met-forecast'
  | 'varsom'
  | 'bruker-gpx'
  | 'kunnskap-regulering';

export interface SourceDef {
  id: SourceId;
  name: string;
  provider: string;
  kind: 'kartfliser' | 'WMS' | 'REST-API' | 'brukerdata' | 'publisert kilde';
  urls: string[];
  usedFor: string;
  license: string;
  researchNote: string;
  needsKey: boolean;
}

export const SOURCES: Record<SourceId, SourceDef> = {
  'kv-topo': {
    id: 'kv-topo',
    name: 'Topografisk norgeskart (WMTS-cache)',
    provider: 'Kartverket',
    kind: 'kartfliser',
    urls: ['https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png'],
    usedFor: 'Bakgrunnskart med høydekurver, vann, stedsnavn, hytter og veier.',
    license: 'CC BY 4.0 – © Kartverket',
    researchNote:
      'URL-mønster bekreftet via Geonorge-register (capabilities: cache.kartverket.no/v1/wmts/1.0.0/WMTSCapabilities.xml). Geonorge varslet nedetid mai 2025 med alternativ sti /v1/service. Ikke testbar fra utviklingsmiljøet (nettverk sperret) – sjekk at fliser lastes.',
    needsKey: false,
  },
  'kv-graatone': {
    id: 'kv-graatone',
    name: 'Norgeskart gråtone',
    provider: 'Kartverket',
    kind: 'kartfliser',
    urls: ['https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png'],
    usedFor: 'Dempet bakgrunn slik at rute- og risikolag blir tydelige.',
    license: 'CC BY 4.0 – © Kartverket',
    researchNote: 'Samme cache-tjeneste som topo. Lagnavn «topograatone» – verifiser i capabilities hvis fliser mangler.',
    needsKey: false,
  },
  'kv-raster': {
    id: 'kv-raster',
    name: 'Toporaster',
    provider: 'Kartverket',
    kind: 'kartfliser',
    urls: ['https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png'],
    usedFor: 'Klassisk papirkart-stil (N50-lignende), god for høydekurver.',
    license: 'CC BY 4.0 – © Kartverket',
    researchNote: 'Lagnavn «toporaster» – verifiser i capabilities hvis fliser mangler.',
    needsKey: false,
  },
  'kv-stedsnavn': {
    id: 'kv-stedsnavn',
    name: 'Stedsnavn-API (SSR)',
    provider: 'Kartverket / Geonorge',
    kind: 'REST-API',
    urls: ['https://ws.geonorge.no/stedsnavn/v1/navn', 'https://ws.geonorge.no/stedsnavn/v1/punkt'],
    usedFor: 'Henter EKTE koordinater for hytter/stoppesteder (ingen koordinater er hardkodet) og navn på nærmeste sted for delmål.',
    license: 'CC BY 4.0 – © Kartverket',
    researchNote: 'Åpent API uten nøkkel. Svaret inneholder representasjonspunkt (øst/nord) i valgt koordinatsystem. Treff filtreres til Finse–Rjukan-området; kontroller at riktig objekt er valgt.',
    needsKey: false,
  },
  'kv-hoyde': {
    id: 'kv-hoyde',
    name: 'Høydedata punkt-API (DTM)',
    provider: 'Kartverket / Geonorge',
    kind: 'REST-API',
    urls: ['https://ws.geonorge.no/hoydedata/v1/punkt'],
    usedFor: 'Høyde fra nasjonal terrengmodell for profil, helning, aspekt, rygger/daler og vindskygge-beregning.',
    license: 'CC BY 4.0 – © Kartverket',
    researchNote: 'Parametre (koordsys, nord, ost, punkter) fra kjent bruk av API-et; offisiell dokumentasjon ble ikke funnet i søk. Appen prøver batch (punkter=[[ø,n],…]) og faller tilbake til enkeltpunkt.',
    needsKey: false,
  },
  'nve-vannkraft-rest': {
    id: 'nve-vannkraft-rest',
    name: 'Vannkraft – magasiner og dammer (ArcGIS REST)',
    provider: 'NVE',
    kind: 'REST-API',
    urls: ['https://kart.nve.no/enterprise/rest/services/Vannkraft1/MapServer', 'https://nve.geodataonline.no/arcgis/rest/services/Vannkraft1/MapServer'],
    usedFor: 'Polygoner for regulerte magasiner (med høyeste/laveste regulerte vannstand der tjenesten har feltet) og dammer. Brukes til automatisk kryssingskontroll.',
    license: 'NLOD / CC BY 4.0 – © NVE',
    researchNote:
      'NVE-metadata (Geonorge/INSPIRE) bekrefter at magasin-datasettet har vassdragsnr., magasinnr., navn, laveste og høyeste regulerte vannstand. Lag-ID er IKKE bekreftet – appen leter etter lag med «magasin»/«dam» i navnet via tjenestens metadata.',
    needsKey: false,
  },
  'nve-innsjo-rest': {
    id: 'nve-innsjo-rest',
    name: 'Innsjødatabasen (ArcGIS REST)',
    provider: 'NVE',
    kind: 'REST-API',
    urls: ['https://kart.nve.no/enterprise/rest/services/Innsjodatabase2/MapServer', 'https://nve.geodataonline.no/arcgis/rest/services/Innsjodatabase2/MapServer'],
    usedFor: 'Finner ALLE innsjøer ruten krysser. Innsjøer uten dokumentert reguleringsstatus merkes «IKKE VERIFISERT – KRYSSING IKKE TILLATT I PLANEN».',
    license: 'NLOD / CC BY 4.0 – © NVE',
    researchNote: 'Tjenestenavn og lag-ID ikke bekreftet – appen leter etter polygonlag med «innsjø» i navnet. Kan endres under Datakilder.',
    needsKey: false,
  },
  'nve-vannkraft-wms': {
    id: 'nve-vannkraft-wms',
    name: 'Vannkraft WMS',
    provider: 'NVE',
    kind: 'WMS',
    urls: ['https://nve.geodataonline.no/arcgis/services/Vannkraft1/MapServer/WmsServer'],
    usedFor: 'Visuelt kartlag med magasiner, dammer, tunneler og overføringer.',
    license: 'NLOD / CC BY 4.0 – © NVE',
    researchNote: 'WMS-URL oppgitt i INSPIRE-metadata for «Hydroelectric power system WMS». Lagnavn hentes fra GetCapabilities i nettleseren.',
    needsKey: false,
  },
  'nve-skred-wms': {
    id: 'nve-skred-wms',
    name: 'Bratthet / aktsomhet snøskred WMS',
    provider: 'NVE',
    kind: 'WMS',
    urls: [
      'https://nve.geodataonline.no/arcgis/services/Bratthet/MapServer/WMSServer',
      'https://nve.geodataonline.no/arcgis/services/SnoskredAktsomhet/MapServer/WMSServer',
      'https://kart.nve.no/enterprise/services/SnoskredAktsomhet/MapServer/WMSServer',
    ],
    usedFor: 'Bratthetskart (helning ≥27–30°) og aktsomhetsområder for snøskred.',
    license: 'NLOD / CC BY 4.0 – © NVE',
    researchNote:
      'IKKE BEKREFTET. NVE har flyttet tjenester (gis3 → kart.nve.no). NVE melder nytt aktsomhetskart for snøskred (2023). Appen prøver kandidat-URLene; lim inn riktig URL fra kartkatalog.nve.no under Datakilder hvis ingen virker. Appen beregner i tillegg egen helning fra DTM.',
    needsKey: false,
  },
  'met-forecast': {
    id: 'met-forecast',
    name: 'Locationforecast 2.0 (complete)',
    provider: 'MET Norge',
    kind: 'REST-API',
    urls: ['https://api.met.no/weatherapi/locationforecast/2.0/complete'],
    usedFor: 'Vind, vindkast, retning, temperatur, nedbør, skydekke og percentiler (usikkerhet). Kun ~9-10 døgn frem – ikke for turdatoen før rett før avreise.',
    license: 'CC BY 4.0 / NLOD – © MET Norge',
    researchNote: 'Krever identifiserbar klient; nettleseren sender Origin/User-Agent. Ingen nøkkel. Respekter vilkår (ikke spam-polling).',
    needsKey: false,
  },
  varsom: {
    id: 'varsom',
    name: 'Snøskredvarsel API',
    provider: 'NVE / Varsom',
    kind: 'REST-API',
    urls: ['https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/api/AvalancheWarningByCoordinates/Simple', 'https://api01.nve.no/hydrology/forecast/avalanche/v5.0.1/api/AvalancheWarningByCoordinates/Simple'],
    usedFor: 'Faregrad for varslingsregionen på gitte koordinater. Varsles 1. des–31. mai.',
    license: 'NLOD – © NVE',
    researchNote: 'Endepunkt-sti bekreftet via generert klient (PyPI varsom-avalanche-client). Datoformat/rekkefølge på koordinater ikke offisielt bekreftet – appen viser rå respons.',
    needsKey: false,
  },
  'bruker-gpx': {
    id: 'bruker-gpx',
    name: 'Finse Rjukan kite 27.gpx',
    provider: 'Bruker (Garmin Explore, 2026-11-03)',
    kind: 'brukerdata',
    urls: ['data/Finse_Rjukan_kite_27.gpx'],
    usedFor: 'Opprinnelig skisse av ruten. Koordinater og høyder (Garmin DEM) som tegnet av deg.',
    license: 'Privat',
    researchNote: 'Lange rette linjer (opptil 11 km) er IKKE terrengtilpasset. To punkter har høyde innenfor publisert reguleringsintervall for Mårvatn og Kalhovd/Gøysta-magasinet – se Sikkerhet.',
    needsKey: false,
  },
  'kunnskap-regulering': {
    id: 'kunnskap-regulering',
    name: 'Publiserte reguleringshøyder (Mår-reguleringen)',
    provider: 'Store norske leksikon / Wikipedia (sekundærkilder) – Statkraft',
    kind: 'publisert kilde',
    urls: ['https://snl.no/M%C3%A5r_kraftverk', 'https://en.wikipedia.org/wiki/Kalhovdfjorden', 'https://www.statkraft.com/about-statkraft/where-we-operate/norway/mar-hydropower-plant/'],
    usedFor: 'Mårvatn 1100–1121 moh, Kalhovdfjorden 1076–1087 moh, Kalhovdfjorden + Gøystavatn = sammenhengende magasin. Sekundærkilde – skal bekreftes mot NVE Atlas/magasinregister.',
    license: '—',
    researchNote: 'Hentet via websøk 2026-11-03. Ikke primærkilde (NVE).',
    needsKey: false,
  },
};
