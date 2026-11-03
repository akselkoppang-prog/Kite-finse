import { daylightHours } from '../geo';

/** Scenario-modell for gjennomførbarhet. Alle parametre er antagelser du kan endre. */
export interface Scenario {
  id: 'A' | 'B' | 'C';
  name: string;
  kiteShare: number; // andel av distansen på kite
  kiteKmh: number; // effektiv snittfart på kite inkl. kryss, pauser i bevegelse
  skiKmh: number; // ski med 40 kg pulk
  movingHours: number; // effektive timer i bevegelse per dag
  weatherDays: number; // forventede liggedager
  detourFactor: number; // ekstra distanse for terrengtilpasning og omveier
  text: string;
}

export const SCENARIOS: Scenario[] = [
  { id: 'A', name: 'Optimistisk', kiteShare: 0.85, kiteKmh: 14, skiKmh: 3.5, movingHours: 7, weatherDays: 0, detourFactor: 1.1, text: 'Stabil vind 7–11 m/s fra gunstig sektor, fast snø, god sikt.' },
  { id: 'B', name: 'Realistisk', kiteShare: 0.55, kiteKmh: 11, skiKmh: 3, movingHours: 6.5, weatherDays: 1, detourFactor: 1.2, text: 'Varierende vind, noe motvind/vindstille, noe skigåing og navigasjon i dårlig sikt.' },
  { id: 'C', name: 'Konservativt', kiteShare: 0.35, kiteKmh: 9, skiKmh: 2.5, movingHours: 6, weatherDays: 2, detourFactor: 1.3, text: 'Ugunstig vind, whiteout-perioder, løs snø, omveier rundt magasiner.' },
];

export interface ScenarioResult {
  scenario: Scenario;
  distKm: number;
  kmPerDay: number;
  travelDays: number;
  totalDays: number;
  hoursNeeded: number;
  daylight: number;
  verdict: string;
}

export function runScenario(s: Scenario, routeKm: number, date: Date, lat: number): ScenarioResult {
  const distKm = routeKm * s.detourFactor;
  const kmPerHour = 1 / (s.kiteShare / s.kiteKmh + (1 - s.kiteShare) / s.skiKmh);
  const daylight = daylightHours(date, lat);
  const hours = Math.min(s.movingHours, daylight - 3); // 3 t til leir, smelting, pakking
  const kmPerDay = kmPerHour * hours;
  const travelDays = Math.ceil((distKm / kmPerDay) * 10) / 10;
  const totalDays = Math.ceil(travelDays) + s.weatherDays;
  const verdict =
    totalDays <= 3 ? 'Tre dager er mulig i dette scenarioet.' : totalDays <= 4 ? 'Tre dager er lite sannsynlig – planlegg for 4.' : `Krever ${totalDays} dager – tre dager er urealistisk.`;
  return { scenario: s, distKm, kmPerDay, travelDays, totalDays, hoursNeeded: distKm / kmPerHour, daylight, verdict };
}
