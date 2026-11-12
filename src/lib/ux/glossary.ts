/** Korte forklaringer på fagord som brukes i appen. Vises som hjelpetekst (Term) og i ordlisten på Start. */
export const GLOSSARY: Record<string, string> = {
  scenario: 'Én komplett versjon av planen: avreisedato, rute, dagsetapper, overnatting, utstyr og mat. Endringer i ett scenario påvirker aldri et annet.',
  hovedplan: 'Scenarioet dere regner med å gjennomføre (merket ★). Brukes som utgangspunkt for nye scenarioer og i eksport.',
  quiver: 'Settet med kites dere tar med på turen.',
  kast: 'Vindkast: de sterkeste vindstøtene, ofte 30–60 % over middelvinden. Avgjør om en kite blir for stor.',
  middelvind: 'Gjennomsnittlig vindstyrke over 10 minutter (m/s), slik værmeldinger oppgir den.',
  'vind fra': 'Retningen vinden blåser FRA. «Vind fra vest» blåser mot øst.',
  twa: 'True Wind Angle – vinkelen mellom kjøreretningen og vinden. 90° = vinden rett fra siden (raskest), under ca. 50° er det vanskelig å kjøre mot vinden.',
  vmg: 'Velocity Made Good – farten i den retningen dere faktisk skal, når dere må krysse.',
  polar: 'Kurve som viser hvor fort man kjører ved ulike vinkler mot vinden.',
  delmål: 'Punkter langs ruten som brukes til å dele opp turen og måle fremdrift.',
  'dagsetappe': 'Strekningen dere planlegger å kjøre én dag – fra start til der dere sover.',
  prognose: 'Værmelding fra MET/Open-Meteo. Finnes bare ca. 9 døgn frem; før det bruker appen vinden du selv angir.',
  hrv: 'Høyeste regulerte vannstand i et kraftmagasin. Isen kan være usikker når vannstanden endres.',
  'go/no-go': 'Sjekk på avreisedagen: er vær, varsler og sikkerhetspunkter i orden for å dra?',
  gpx: 'Filformat for ruter og punkter som GPS-er og kartapper leser.',
};
