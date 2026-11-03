// Stedsnavn som brukes i planen. INGEN koordinater er lagt inn her – de hentes fra Kartverkets
// stedsnavn-API i nettleseren og lagres med kilde og tidspunkt. Du kan overstyre valgt treff.

export interface PlaceQuery {
  key: string;
  query: string;
  /** Foretrukne navneobjekttyper i SSR (første treff som matcher vinner). */
  preferTypes: string[];
  role: ('hytte' | 'avbrudd' | 'by' | 'transport')[];
  note: string;
}

export const PLACE_QUERIES: PlaceQuery[] = [
  { key: 'finse', query: 'Finse', preferTypes: ['Jernbanestasjon', 'Tettsted', 'Bygdelagsgard', 'Bebyggelse', 'Grend'], role: ['by', 'transport', 'avbrudd'], note: 'Start. Bergensbanen.' },
  { key: 'kraekkja', query: 'Krækkja', preferTypes: ['Turisthytte', 'Hytte', 'Seter'], role: ['hytte', 'avbrudd'], note: 'DNT-hytte. Åpningstid påske/vinter må sjekkes på ut.no.' },
  { key: 'stigstuv', query: 'Stigstuv', preferTypes: ['Turisthytte', 'Hytte'], role: ['hytte', 'avbrudd'], note: 'DNT-hytte.' },
  { key: 'rauhelleren', query: 'Rauhelleren', preferTypes: ['Turisthytte', 'Hytte'], role: ['hytte', 'avbrudd'], note: 'DNT-hytte.' },
  { key: 'tuva', query: 'Tuva', preferTypes: ['Turisthytte', 'Hytte'], role: ['hytte', 'avbrudd'], note: 'Nær Haugastøl/Rv7 – mulig nordøstlig utgang.' },
  { key: 'haugastol', query: 'Haugastøl', preferTypes: ['Jernbanestasjon', 'Tettsted', 'Bebyggelse', 'Grend'], role: ['transport', 'avbrudd'], note: 'Bergensbanen + Rv7. Avbrudd nordover.' },
  { key: 'marbu', query: 'Mårbu', preferTypes: ['Turisthytte', 'Hytte'], role: ['hytte', 'avbrudd'], note: 'DNT-hytte ved Mårvatn (regulert).' },
  { key: 'kalhovd', query: 'Kalhovd', preferTypes: ['Turisthytte', 'Hytte', 'Seter'], role: ['hytte', 'avbrudd'], note: 'Kalhovd turisthytte ved Kalhovdfjorden (regulert).' },
  { key: 'imingfjell', query: 'Imingfjell', preferTypes: ['Turisthytte', 'Hytte', 'Fjell', 'Fjellområde'], role: ['hytte', 'avbrudd'], note: 'Østlig korridor-ide. Vintervei/brøyting IKKE kontrollert.' },
  { key: 'helberghytta', query: 'Helberghytta', preferTypes: ['Turisthytte', 'Hytte'], role: ['hytte', 'avbrudd'], note: 'DNT-hytte nord for Rjukan.' },
  { key: 'gvepseborg', query: 'Gvepseborg', preferTypes: ['Bygning', 'Turisthytte', 'Hytte', 'Annen kulturdetalj', 'Serveringssted'], role: ['hytte', 'avbrudd', 'transport'], note: 'Toppstasjon Krossobanen (stengt siden 19.06.2024).' },
  { key: 'rjukanfjellstue', query: 'Rjukan fjellstue', preferTypes: ['Turisthytte', 'Hotell', 'Bygning', 'Hytte'], role: ['hytte', 'avbrudd', 'transport'], note: 'Ved fylkesvei vest for Rjukan – brøyting/kollektiv ikke kontrollert.' },
  { key: 'rjukan', query: 'Rjukan', preferTypes: ['By', 'Tettsted'], role: ['by', 'transport'], note: 'Mål. Buss/transport ut må sjekkes.' },
];

/** Konseptuelle rutekjeder. Linjer trekkes rett mellom stedsnavn-punktene: ALDRI terrengtilpasset. */
export const ROUTE_CHAINS: { id: string; name: string; color: string; keys: string[]; description: string }[] = [
  {
    id: 'konsept',
    name: 'Konsept (din opprinnelige)',
    color: '#f59e0b',
    keys: ['finse', 'kraekkja', 'stigstuv', 'rauhelleren', 'marbu', 'kalhovd', 'helberghytta', 'gvepseborg', 'rjukan'],
    description: 'Finse → Krækkja → Stigstuv → Rauhelleren → Mårbu → Kalhovd → Helberghytta/Gvepseborg → Rjukan. Rette linjer mellom hytter – vil sannsynligvis krysse regulerte vann (kontrolleres automatisk).',
  },
  {
    id: 'ost',
    name: 'Nord/øst-korridor (via Tuva/Imingfjell)',
    color: '#22d3ee',
    keys: ['finse', 'kraekkja', 'rauhelleren', 'tuva', 'imingfjell', 'kalhovd', 'helberghytta', 'gvepseborg', 'rjukan'],
    description: 'Idé: holde seg øst/nord for Mårvatn og nærmere Rv7 (avbrudd Haugastøl). Lengre, men flere utganger. Ikke terrengvurdert.',
  },
  {
    id: 'vest',
    name: 'Sør/vest-korridor (via Rjukan Fjellstue)',
    color: '#a78bfa',
    keys: ['finse', 'kraekkja', 'stigstuv', 'rauhelleren', 'marbu', 'rjukanfjellstue', 'gvepseborg', 'rjukan'],
    description: 'Idé: passere vest for Kalhovd/Gøysta-magasinet ned mot Fv-vei ved Rjukan Fjellstue. Møsvatn (regulert) ligger sør – ikke terrengvurdert.',
  },
];
