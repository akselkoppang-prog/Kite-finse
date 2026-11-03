# Snowkite-ekspedisjon Finse → Rjukan (mars/april 2027)

Interaktivt planleggingsverktøy for en snowkite-travers over Hardangervidda med pulk.
Kartet og alle data hentes **direkte fra Kartverket, NVE og MET Norge i nettleseren din**. Ingenting er simulert,
og ingen koordinater for hytter eller vann er hardkodet.

> ⚠️ Alle ruter er **forslag – ikke verifisert i terrenget**. Regulerte vann og vann uten dokumentert
> reguleringsstatus blokkerer ruteaksept. Verktøyet erstatter ikke egen vurdering, skredvarsel eller lokalkunnskap.

## Kom i gang

```bash
npm install
npm run dev        # http://localhost:5173
# eller produksjonsbygg:
npm run build && npm run preview
```

Krever Node 18+. Ingen API-nøkler trengs (per nov. 2026).

**GitHub Pages:** workflowen `.github/workflows/pages.yml` bygger og publiserer ved push til `main`.
Slå på Pages i repoets innstillinger (Settings → Pages → Source: GitHub Actions).

## Arbeidsflyt

1. **Kart & rute → Hent ekte data**
   1. Hent hytter/steder (Kartverket stedsnavn-API) → lager tre alternative rutekorridorer.
   2. Last regulerte magasiner (NVE Vannkraft, ArcGIS REST).
   3. Finn alle vann ruten krysser (NVE Innsjødatabase).
   4. Terrenganalyse (Kartverket DTM): helning, rygger/daler og le for alle vindretninger.
2. Se kryssinger → **Foreslå omvei** (lager en ny rute rundt barrieren) → kjør steg 3–4 på nytt.
3. Dra punktene i kartet, sett inn punkter, tegn forbudte/usikre soner og legg til teltplasser.
4. **Vær & vind**: velg vindretning og se kurs-/le-analyse og hvordan rutene rangeres. Henter MET-prognose.
5. **Kite-quiver**: velg vind, kast, snø, pulk og terreng → begrunnet kiterangering.
6. **Sikkerhet**: ruteaksept, vannregister, Varsom-skredvarsel, logistikk og sjekkliste.
7. **Dagplan**: scenario A/B/C, dagsetapper og beregnede teltplass-kandidater per natt.
8. Eksporter GPX (rute + teltplasser) eller lagre hele planen som JSON.

Planen lagres automatisk i nettleseren (localStorage).

## Funn så langt (2026-11-03)

| Funn | Status | Kilde |
|---|---|---|
| GPX-punkt #16 (60.1812, 8.1673) har høyde 1117 moh – innenfor Mårvatns reguleringsintervall 1100–1121 moh | 🔴 Ligger trolig på magasinet | GPX + SNL «Mår kraftverk» |
| GPX-punkt #19 (60.0168, 8.3891) 1079 moh og #20 (59.9289, 8.4801) 1087 moh – innenfor Kalhovd/Gøysta-magasinets 1076–1087 moh | 🔴 Ligger trolig på magasinet | GPX + SNL/Wikipedia «Kalhovdfjorden» |
| Kalhovdfjorden og Gøystavatn er ett sammenhengende magasin (også Strengetjønnan, Kilsfjorden, Sprogen, Geitebufjorden, Grytefjorden, Viervatnet) | 🔴 Regulert | Wikipedia «Kalhovdfjorden» |
| Krossobanen stanset av Statens jernbanetilsyn 19.06.2024, under istandsetting; kildene oppgir gjenåpning alt fra 2027 til 2028 | 🔴 Planlegg uten | Telemark fylkeskommune, TU.no, Komoot |
| Ryes vei: ca. 4 km, ~500 høydemeter, 21 svinger, brukes som akebakke om vinteren – ingen kilde bekrefter at den egner seg for ski med pulk | 🟡 Sjekk selv | visitrjukan.com |
| GPX-ruten er 113 km i rette linjer (opptil 11 km lange strekk) | 🟡 Faktisk distanse blir lengre | Beregnet |
| Gjennomførbarhet: scenario A ≈ 2–3 dager, B ≈ 6, C ≈ 10 (inkl. liggedager) | 🟡 Tre dager er ambisiøst | Beregnet modell |

Reguleringshøydene er fra sekundærkilder og **må bekreftes i NVE Atlas**. Når NVE-dataene lastes i appen, vises
NVEs egne attributter.

## Datakilder

| Kilde | Bruk | Merknad |
|---|---|---|
| Kartverket WMTS-cache (`topo`, `topograatone`, `toporaster`) | Bakgrunnskart | CC BY 4.0 |
| Kartverket stedsnavn-API | Koordinater for hytter/steder | Treffet kan velges/kontrolleres |
| Kartverket høydedata punkt-API | DTM-profil, helning, le | Batch med fallback til enkeltpunkt, cache lokalt |
| NVE Vannkraft (ArcGIS REST + WMS) | Magasiner, dammer | Lag finnes automatisk etter navn |
| NVE Innsjødatabase (ArcGIS REST) | Alle vann ruten krysser | Vann uten dokumentasjon → «IKKE VERIFISERT – KRYSSING IKKE TILLATT I PLANEN» |
| NVE bratthet/snøskred WMS | Skredterreng-kartlag | URL ikke bekreftet – velg under Datakilder |
| MET Locationforecast 2.0 complete | Vind, kast, percentiler, temp, nedbør, sky | Bare ~9 døgn frem |
| NVE Varsom API | Skredvarsel ved koordinat | Varsles 1. des–31. mai |

Utviklingsmiljøet hadde ikke nettverkstilgang til disse tjenestene, så endepunktene er satt opp etter
dokumentasjon og metadata og **testes første gang i din nettleser**. Feil vises tydelig under **Datakilder**,
der du også kan lime inn andre URL-er. Ingen tjeneste blir erstattet med falske data.

## Hva modellene gjør (og ikke gjør)

- **Kryssing**: ruten samples hver 40 m og testes mot NVE-polygoner og egne soner.
- **Auto-omvei**: konvekst hull rundt barrieren + 300 m buffer, korteste side. Ikke terrengtilpasset.
- **Vind**: kursvinkel mot valgt vindretning + DTM-le (terreng 0,6–1,5 km oppvind). Ingen strømningsmodell.
- **Kite**: relativ trekkmodell (areal × vind², last × friksjon). Ikke sikkerhetsgrenser og ikke produsentdata –
  overstyr vinduene med egne tall.
- **Teltplass**: DTM-helning, le, bratt terreng innen 150 m, avstand til vann og avbrudd. Alltid «beregnet – ikke befart».
- **Scenarioer**: fart og andel kite er antagelser i `src/lib/analysis/feasibility.ts`.

## Struktur

```
src/
  data/        kilder, vannregister, stedsnavn-spørringer, kites
  lib/api/     Kartverket, NVE, MET, Varsom (+ statuslogging)
  lib/analysis barrierer/omvei, terreng, vind, kite, teltplass, scenarioer
  state/       zustand-store (lagres lokalt) + avledede hooks
  components/  kart (Leaflet), høydeprofil (ECharts), ruteplanlegger, tabeller
  pages/       vind, kite, sikkerhet, dagplan, tidslinje, datakilder
public/data/   din GPX
```

Teknologi: React 18 + TypeScript + Vite, Leaflet, ECharts, Turf, Zustand.
