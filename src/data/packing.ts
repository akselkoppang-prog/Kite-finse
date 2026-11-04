export interface PackItem {
  id: string;
  cat: string;
  text: string;
  packed: boolean;
  kg?: number;
}

const L = (cat: string, items: string[]): PackItem[] => items.map((text, i) => ({ id: `${cat}-${i}`, cat, text, packed: false }));

/** Utgangspunkt for pakkelisten. Alt kan endres, slettes og utvides. Vekter fylles inn av deg. */
export const DEFAULT_PACKING: PackItem[] = [
  ...L('Kites', ['Valgte kites (se Kite-quiver)', 'Reparasjonstape/duk for kite']),
  ...L('Barer og liner', ['Bar(er) med riktig linelengde', 'Reservelinesett / linebiter', 'Kniv for linekutt']),
  ...L('Skiutstyr', ['Ski', 'Støvler', 'Feller', 'Staver (justerbare)', 'Bindingsreservedeler + verktøy']),
  ...L('Pulk', ['Pulk med trekkstenger/tau', 'Bremsetau/kjetting for nedkjøring', 'Pulktrekk og stropper']),
  ...L('Telt', ['Telt (stormtelt)', 'Snøplugger/snøfester', 'Snøspade', 'Snøsag', 'Ekstra barduner']),
  ...L('Sovesystem', ['Sovepose (komfort ≤ −20 °C)', 'Liggeunderlag ×2', 'Innerpose / VBL']),
  ...L('Klær', ['Skallbekledning', 'Dunjakke / varmejakke', 'Ullundertøy ×2', 'Votter + reservevotter', 'Ansiktsmaske / balaclava', 'Briller + goggles', 'Hjelm']),
  ...L('Mat', ['Dagsrasjoner (se mat- og brenselkalkulator)', 'Nødrasjon']),
  ...L('Brensel', ['Brenner + reservebrenner/tenning', 'Drivstoff (se kalkulator)', 'Kjele + vindskjerm']),
  ...L('Navigasjon', ['GPS med rute lastet', 'Papirkart (N50) i lomme', 'Kompass', 'Ruteoversikt utskrevet']),
  ...L('Skredutstyr', ['Skredsøker', 'Søkestang', 'Spade (utover teltspade)']),
  ...L('Nødkommunikasjon', ['Satellittkommunikator (inReach/PLB)', 'Mobil + nødnummerliste', 'Vindsekk / bivy', 'Førstehjelp']),
  ...L('Batteri og lading', ['Powerbank(er)', 'Reservebatterier (lithium)', 'Kabler', 'Solcellepanel (valgfritt)']),
];
