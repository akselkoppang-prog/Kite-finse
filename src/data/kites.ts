/**
 * Din quiver. «type» og «egenskaper» er FAGLIG VURDERING (kunnskap om modellseriene), ikke hentet
 * fra produsent i denne økten – produsentsider var ikke tilgjengelige fra utviklingsmiljøet.
 * Fyll inn produsentdata (vindområde, vekt, aspect ratio) i Kite-fanen; de lagres lokalt.
 */
export type KiteType = 'lukket-celle foil' | 'åpen-celle foil' | 'tube (LEI)';

export interface Kite {
  id: string;
  name: string;
  size: number;
  type: KiteType;
  maker: string;
  makerUrl: string;
  /** Relativ ytelsesfaktor (0.8–1.15): lavvindskraft/glid. Faglig vurdering. */
  perf: number;
  /** Relativ upwind-evne 0–1. Faglig vurdering. */
  upwind: number;
  assessment: string;
  role: string;
}

export const KITES: Kite[] = [
  {
    id: 'peak4', name: 'Flysurfer Peak V5', size: 4, type: 'lukket-celle foil', maker: 'Flysurfer', makerUrl: 'https://flysurfer.com',
    perf: 0.95, upwind: 0.6,
    assessment: 'Peak-serien er en robust freeride-/ekspedisjonsfoil med stor depower og forutsigbar oppførsel. Liten flate gir lav trekk med 110 kg i moderat vind.',
    role: 'Sterk vind / storm-kite. Siste kite opp før du pakker ned.',
  },
  {
    id: 'hyper7', name: 'Ozone Hyperlink V1', size: 7, type: 'åpen-celle foil', maker: 'Ozone', makerUrl: 'https://www.ozonekites.com',
    perf: 0.95, upwind: 0.65,
    assessment: 'Åpen-celle snøfoil: lett, enkel å pakke og relansere på snø, men mister trykk ved landing og kan kollapse i turbulens.',
    role: 'Fyller hullet mellom 4 og 10 m² – trolig svært nyttig med tung pulk i frisk vind.',
  },
  {
    id: 'stoke9', name: 'Flysurfer Stoke 2', size: 9, type: 'tube (LEI)', maker: 'Flysurfer', makerUrl: 'https://flysurfer.com',
    perf: 0.85, upwind: 0.55,
    assessment: 'Tube-kite: krever pumping, blærer stive/sårbare i streng kulde, tyngre og mer volum. Lite egnet som ekspedisjonskite.',
    role: 'Vurder å la ligge hjemme.',
  },
  {
    id: 'sonic10', name: 'Flysurfer Sonic 4', size: 10, type: 'lukket-celle foil', maker: 'Flysurfer', makerUrl: 'https://flysurfer.com',
    perf: 1.12, upwind: 0.95,
    assessment: 'Høyytelses lukket-celle foil: best glid og upwind i quiveren, høy fart. Krever mer aktiv flyging; mindre tilgivende i rotor/turbulens enn Soul/Peak.',
    role: 'Primærkite ved gode forhold – effektiv distanse og upwind.',
  },
  {
    id: 'pivot10', name: 'Naish Pivot', size: 10, type: 'tube (LEI)', maker: 'Naish', makerUrl: 'https://www.naishkites.com',
    perf: 0.85, upwind: 0.5,
    assessment: 'Tube-kite for wave/freeride – samme ulemper som Stoke på ekspedisjon. Overlapper Sonic 10.',
    role: 'Overflødig – la ligge hjemme.',
  },
  {
    id: 'soul15', name: 'Flysurfer Soul V1', size: 15, type: 'lukket-celle foil', maker: 'Flysurfer', makerUrl: 'https://flysurfer.com',
    perf: 1.08, upwind: 0.85,
    assessment: 'Lettvind lukket-celle foil med god glid og stabilitet. Stor flate gir god trekk med tung pulk i lett vind.',
    role: 'Lettvindskite – avgjørende for fremdrift med pulk i 4–7 m/s.',
  },
  {
    id: 'soul18', name: 'Flysurfer Soul V2', size: 18, type: 'lukket-celle foil', maker: 'Flysurfer', makerUrl: 'https://flysurfer.com',
    perf: 1.1, upwind: 0.85,
    assessment: 'Svært stor flate: gir fremdrift i helt lett vind på hard snø, men tung, treg i svinger og krevende ved vindøkning/kast.',
    role: 'Situasjonsbetinget: kun hvis langvarig lett vind og hard snø er sannsynlig. Overlapper Soul 15.',
  },
];

export const QUIVER_ADVICE = `Faglig vurdering (ikke garanti): En ekspedisjonsquiver bør dekke vindspekteret med 3–4 kites og minimal vekt.
Forslag: Peak 4 (sterk vind) – Hyperlink 7 (frisk vind) – Sonic 10 (primær) – Soul 15 (lett vind).
Soul 18 tas bare med hvis prognosene tilsier langvarig lett vind på hard snø; ellers spares ~2–3 kg og volum.
Tube-kitene (Stoke 9, Pivot 10) frarådes: pumpe, blærer i kulde, vekt, og de overlapper Sonic 10.
Pakk reservelinjer/bridle-reparasjon og vurder å forhåndstrimme Sonic for pulktrekk (mer stabilitet).`;
