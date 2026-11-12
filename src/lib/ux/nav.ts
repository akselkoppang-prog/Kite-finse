import type { Tab } from '../../state/store';

/**
 * Appens struktur på ett sted: hovedseksjoner, undersider og en kort forklaring per side.
 * Rekkefølgen følger planleggingen: start → kart → dagene → vær → utstyr → prosjekt.
 */
export type Main = 'start' | 'kart' | 'plan' | 'vaerkite' | 'utstyr' | 'prosjekt' | 'innstillinger';
export interface Section { id: Main; label: string; short: string; icon: string; hint: string; subs: [Tab, string][] }

export const SECTIONS: Section[] = [
  { id: 'start', label: 'Start', short: 'Start', icon: '🏠', hint: 'Hvor klare er dere, og hva bør gjøres nå', subs: [['status', 'Start og status']] },
  { id: 'kart', label: 'Kart og rute', short: 'Kart', icon: '🗺️', hint: 'Ruten, dagsetappene og vannene på kartet', subs: [['oversikt', 'Kart'], ['overstyring', 'Vann og is']] },
  { id: 'plan', label: 'Dagplan', short: 'Dager', icon: '📅', hint: 'Avreise, dagsetapper, overnatting og alternativer', subs: [['plan', 'Dag for dag'], ['netter', 'Overnatting'], ['scenarier', 'Scenarioer'], ['tidslinje', 'Kalender og sol'], ['dagplan', 'Grovplan og plan B']] },
  { id: 'vaerkite', label: 'Vær & kite', short: 'Vær', icon: '🌬️', hint: 'Værmelding langs ruten og hvilke kites som passer', subs: [['vaer', 'Vær langs ruten'], ['vind', 'Vind i dag'], ['vaerkite', 'Kitevalg'], ['simulator', 'Simulator'], ['kite', 'Kitedatabase']] },
  { id: 'utstyr', label: 'Utstyr & mat', short: 'Utstyr', icon: '🎒', hint: 'Pakkeliste, mat, vann og sikkerhet', subs: [['utstyr', 'Pakkeliste'], ['mat', 'Mat og vann'], ['sikkerhet', 'Sikkerhet']] },
  { id: 'prosjekt', label: 'Prosjekt', short: 'Prosjekt', icon: '📁', hint: 'Prosjektinfo, oppgaver, team og eksport', subs: [['prosjekter', 'Prosjektet'], ['oppgaver', 'Oppgaver og team'], ['eksport', 'Eksport og deling']] },
  { id: 'innstillinger', label: 'Innstillinger', short: 'Oppsett', icon: '⚙️', hint: 'Lagring, datakilder og beregningsmodell', subs: [['lagring', 'Lagring og backup'], ['kilder', 'Datakilder og om appen'], ['modell', 'Modell og kalibrering']] },
];

export const isTab = (t: string): t is Tab => t === 'kart' || SECTIONS.some((s) => s.subs.some(([x]) => x === t));
export const mainOf = (t: Tab): Main => (t === 'kart' ? 'kart' : t === 'prosjekt' ? 'prosjekt' : SECTIONS.find((s) => s.subs.some(([x]) => x === t))?.id ?? 'start');
export const tabLabel = (t: Tab): string => SECTIONS.flatMap((s) => s.subs).find(([x]) => x === t)?.[1] ?? (t === 'kart' ? 'Kart' : t);

/**
 * scope: hva siden gjelder – «scenario» (bare scenarioet som er valgt), «prosjekt» (alle scenarioer i prosjektet)
 * eller «app» (alle prosjekter / denne enheten). adv = siden har detaljer som skjules i enkel visning.
 */
export const PAGE_INFO: Partial<Record<Tab, { text: string; scope: 'scenario' | 'prosjekt' | 'app'; adv?: boolean }>> = {
  status: { text: 'Oversikt over hvor klare dere er. Følg stegene under – trykk på et område for å gå dit.', scope: 'scenario' },
  oversikt: { text: 'Kartet viser ruten og dagsetappene. Trykk på et punkt, vann eller teltplass for detaljer. Panelet til venstre har dagene og varslene.', scope: 'scenario', adv: true },
  kart: { text: 'Kartet viser ruten og dagsetappene. Trykk på et punkt, vann eller teltplass for detaljer.', scope: 'scenario', adv: true },
  overstyring: { text: 'Vann du selv har vurdert som trygge å krysse (f.eks. islagte magasiner). Gjelder alle scenarioer.', scope: 'prosjekt' },
  plan: { text: 'Velg avreise og antall dager, og juster hver dag: start, fart, vind og kite. Tidene regnes ut automatisk.', scope: 'scenario', adv: true },
  netter: { text: 'Velg hvor dere sover hver natt, og se krysninger (ferje, bro, is) langs ruten.', scope: 'scenario', adv: true },
  scenarier: { text: 'Et scenario er én komplett versjon av planen (dato, rute, dager, utstyr, mat). Lag flere for å sammenligne – de påvirker ikke hverandre.', scope: 'prosjekt' },
  tidslinje: { text: 'Soloppgang og solnedgang for hver dag, nedtelling til avreise og go/no-go-sjekk.', scope: 'scenario', adv: true },
  dagplan: { text: 'Grov beregning av hvor mange dager turen tar med ulik vind, og hva dere gjør hvis det går tregere (plan B).', scope: 'scenario', adv: true },
  vaer: { text: 'Været der dere er, når dere er der – dag for dag. Prognosen finnes ca. 9 døgn frem i tid.', scope: 'scenario', adv: true },
  vind: { text: 'Velg en vindretning og se hvordan den treffer hver etappe – eller hent dagens prognose.', scope: 'scenario', adv: true },
  vaerkite: { text: 'Hvilke kites dere tar med, og hvilken som passer vinden hver dag.', scope: 'scenario', adv: true },
  simulator: { text: 'Fysikkbasert beregning av fart og tid for én kite og én vind. Til fordypning – dagplanen virker uten.', scope: 'scenario', adv: true },
  kite: { text: 'Kitene i inventaret med vindområde og egenskaper. Velg hvilke som er med (quiver).', scope: 'prosjekt', adv: true },
  utstyr: { text: 'Pakkelisten for scenarioet: kryss av det som er pakket. Appen sier ifra om noe mangler for kulde, vind eller terreng.', scope: 'scenario', adv: true },
  mat: { text: 'Måltider per dag, hvor mye mat og vann dere trenger, og handleliste.', scope: 'scenario', adv: true },
  sikkerhet: { text: 'Risiko langs ruten, vannregister, skredvarsel og sjekkliste før avreise.', scope: 'prosjekt', adv: true },
  prosjekter: { text: 'Navn, start og mål for prosjektet. Her bytter du også prosjekt eller lager et nytt.', scope: 'prosjekt', adv: true },
  oppgaver: { text: 'Hva som må gjøres før turen, hvem som er med, og budsjettet.', scope: 'prosjekt', adv: true },
  eksport: { text: 'Lag PDF til utskrift, GPX til GPS, Excel, eller en komplett kopi av prosjektet (ZIP).', scope: 'prosjekt', adv: true },
  lagring: { text: 'Alt lagres automatisk i nettleseren. Her tar du sikkerhetskopi, eksporterer og gjenoppretter.', scope: 'app', adv: true },
  kilder: { text: 'Hvor dataene kommer fra, test av forbindelsene, og versjonen av appen.', scope: 'app' },
  modell: { text: 'Antakelsene bak tidsberegningene. Endre bare hvis du vet hva du gjør – «Tilbakestill» gir standardverdiene.', scope: 'app' },
};
