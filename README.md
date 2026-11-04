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

## Versjon 7 – én sammenhengende ekspedisjonsplan

Hvert **scenario** er nå en fullstendig plan: egen avreisedato, rute, værkilde, vind/kite/tider per dag, overnattinger, utstyrsliste og matplan. Alt regnes ut ett sted (`src/lib/plan/insights.ts`), så kart, dagkort, vær, utstyr, mat, status og eksport viser de samme tallene. Endringer i ett scenario rører aldri et annet.

**Hvordan delene henger sammen**

| Endrer du … | … oppdateres |
|---|---|
| avreisedato for scenarioet | vær langs ruten (riktige timer), dagslys, sikkerhet i estimatet, beste-avreise-tabellen |
| rute | distanser, kryssinger av vann, krysninger (ferje/bro/is …), dagsetapper, netter |
| overnatting (Dagplan → Overnatting) | dagens stopp og neste dags start, avstander, ankomsttider, kapasitet mot teamet, påfyll av mat |
| vær / værleverandør | fremdrift (vind, sikt, snøfall), farlige forhold, utstyrsråd (kulde, kast), energibehov |
| utstyrsvekter | pulkvekt i fremdriftsberegningen (+ «hva betyr 5 kg mer?») |
| antall dager / team | mat, vann, brensel, telt- og sengeplass |

**Vær langs ruten** (Vær & kite): Yr/MET Locationforecast og Open-Meteo (ECMWF, DWD ICON, MET Nordic) for punkter hver ~12 km. Været vises der og når simuleringen sier dere er på ruten (motvind/medvind, kast, temperatur og følt temperatur, nedbør/snø, sikt, skydekke), med farlige forhold uthevet. Sammenligning av leverandører (inkl. ankomsttid med hver), MET-farevarsler, siste observasjoner (MET Frost, krever gratis klient-ID) og Windy-kart. «Finn beste avreise» prøver de neste 14 dagene med scenarioet. Prognosens oppdateringstid vises alltid; prognose og observasjon er tydelig skilt. Nye leverandører legges til i `src/lib/weather/providers.ts`.

Windy sitt data-API krever betalt nøkkel som ikke kan holdes hemmelig på en statisk nettside (GitHub Pages har ingen server), så appen bruker Windys offisielle innbyggingskart og lenker. Ingen nøkler ligger i koden.

**Mer realistiske tider**: krysninger med ventetid, overgangstid, rutetabell (neste avgang) og sesong – etter siste avgang stopper dagen ved krysningen. Tretthet per dag, pulkvekt fra utstyr + gjenværende mat og brensel, og fartsreduksjon ved dårlig sikt/snøfall kommer i tillegg til den fysiske vind-/terrengmodellen. Hver dag viser beste tilfelle, realistisk og forsiktig ankomst, sikkerhet (høy/middels/lav) med de største usikkerhetene, og «Hvordan er dette regnet ut?» med tidsbruk (kiting, kryss, ski, gåing, pauser, venting, krysninger).

**Overnatting**: telt, hytte, gapahuk/bu og leirplass med plasser, påfyll og pris; kan gjelde alle eller bare enkelte scenarioer. Natt for natt med dagsetappe, ankomst og varsler (for få plasser, ikke valgt, mørkt ved ankomst).

**Utstyr**: lister som kan deles mellom scenarioer eller kopieres, kategorier, antall, vekt (typisk vekt brukes til du legger inn din egen), pulk/kropp, eier (felles/person), pakket. Råd ut fra netter og overnattingstype, kulde, kast, bratt terreng, vann/is og teamstørrelse – mangler, uegnet (f.eks. sovepose) og kanskje unødvendig (telt når alle netter er på hytte).

**Mat og vann**: måltider per dag fra maler, kcal/protein mot behov (aktivitet, kulde, kroppsvekt), vekt, volum, vann, brensel, handleliste, mat igjen underveis og påfyll ved overnattinger.

**Prosjekt**: Status (beredskap per område og «trenger oppmerksomhet»), oppgaver med frist, ansvarlig, prioritet, milepæl og kobling til scenario, dag, overnatting, utstyr, krysning eller rute-km; team; budsjett og utgifter; dokumenter og lenker.

**Eksport**: PDF og Excel får overnatting, utstyrsliste og -råd, matplan og handleliste, oppgaver og farlige forhold i prognosen – alltid for scenarioets egen dato.

Tester: `npm test` (nå også `tests/plan.test.ts`: krysninger, værnormalisering, farer, mat, utstyrsråd, beredskap og dagsimulering) + Playwright `tests/e2e/v7-e2e.cjs` (med stubber for MET, Open-Meteo og MetAlerts).

## Versjon 6 – prosjekter, scenarioer og eksport

**Prosjekter** (Oversikt → Prosjekt, eller trykk prosjektnavnet øverst)
- Eget navn (endres når som helst – også med ✎ i oversikten), beskrivelse, fra/til, start- og sluttdato, status, ikon, forsidebilde, personlige notater og kontakter/nødinfo.
- Flere prosjekter, hvert med egne ruter, GPX, scenarioer, vind, kites, teltplasser, punkter, vann-godkjenninger, notater og eksportvalg (egne poster i IndexedDB per prosjekt).
- Opprett (tomt eller med Finse–Rjukan-ruten), åpne, dupliser (inkl. bilder med nye id-er), gi nytt navn, arkiver og slett. Sletting krever bekreftelse, tar en beskyttet sikkerhetskopi først og kan angres under «Nylig slettet». Det åpne prosjektet kan ikke slettes.

**Scenarioer** (Dagplan → Scenarioer)
- Hvert scenario har egen rute, vind per dag, avreise, kite per dag, fart, kitetimer, pauser, teltplasser, dagsmål og notater. Endringer i ett scenario rører aldri et annet.
- Lagre som nytt, gi nytt navn, dupliser, sett som hovedplan (★), slett (ikke hovedplanen), del som fil og importer et delt scenario (blir et nytt scenario).
- Sammenligning av to eller flere scenarioer: tabell (rute, distanse, dager, ankomst, distanse og reisetid per dag, kitetid, kite og vind per dag, teltplasser, notater) og kart med én farge per scenario.

**Eksport & deling** (egen hovedseksjon). Alle eksporter lagrer først, tar et øyeblikksbilde av det valgte scenarioet og regner det ut på nytt – de blander aldri scenarioer og endrer aldri prosjektet.

| Format | Innhold |
|---|---|
| PDF | A4 ekspedisjonsbrief: forside (tittel, datoer, kart/foto, nøkkeltall, scenario), oversikt med dagstabell, rutekart (liggende) med dagsfarger, punkter, teltplasser, kryssinger og alternative ruter, én side per dag (avreise, ankomst med usikkerhet, kite, vind med pil, dagslysstripe, dagskart, høydeprofil, passeringstider), teltplasser (kart, koordinater, ankomst, vurdering, alternativer, bilder), utstyr og pakkeliste, vær og vind (eget scenario vs. MET-prognose), terreng og sikkerhet (profil, godkjente/ikke vurderte kryssinger, varsler, hytter og nødutganger), kontakter, kilder, modellforutsetninger og forbehold. Topp-/bunntekst og sidetall. Varianter: Full, Kompakt, Feltbrief, Kun rute, én dag, sammenligning av scenarioer. |
| GPX 1.1 | Hele ruten, én dag, alternativ rute eller km-segment. Full koordinatpresisjon, høyde, punktnavn/-beskrivelser, teltplasser og markører. |
| GeoJSON | RFC 7946 (WGS 84, [lon, lat, høyde]): ruter, dagsetapper, rutepunkter, teltplasser, markører, soner og metadata. |
| Excel (.xlsx) | Oversikt, Dagsplan, Sjekkpunkter (med forventet passering), Rutepunkter, Teltplasser, Vindscenarioer, Kites, Forutsetninger (+ Sammenligning). Skrevet uten tredjepartsbibliotek; tall lagres som tall. |
| CSV | Rutekoordinater, dagsplan, vindscenarioer, rutepunkter. Norsk (semikolon, desimalkomma, UTF-8 med BOM) eller internasjonal. |
| ZIP | `project/{metadata.json, project.json, routes/main-route.gpx, routes/alternative-*.gpx, scenarios/*.json, images/, attachments/, exports/, README.txt}`. Importeres som nytt prosjekt i en annen nettleser (eldre ZIP/JSON-format støttes fortsatt). |

PDF-kartene bruker ekte Kartverket-fliser når nettet er tilgjengelig (eller forhåndslastede fliser). Uten fliser tegnes ruten på et nøytralt koordinatnett med tydelig merknad – aldri et oppdiktet terrengkart.

**Ytelse og bruk**: sider lastes først når de åpnes (PDF-motoren ~150 kB gzip lastes bare ved eksport), færre omberegninger av planen, høydeprofilen blander ikke lenger DTM og GPX punkt for punkt (fjerner falske topper), større trykkflater og 16 px skjemafelt på iPad/iPhone (ingen auto-zoom i Safari), sammenleggbart sidepanel og større kartknapper på berøringsskjerm.

Tester: `npm test` + Playwright-skript (v6: prosjekter, scenarioer og alle eksportformater med kontroll av PDF-tekst/sider, GPX-koordinater, GeoJSON, Excel via openpyxl, CSV og ZIP-reimport; iPad stående/liggende og mobil).

## Versjon 5 – enkel på overflaten

Fem hovedseksjoner (avanserte verktøy ligger i undermenyer og sammenleggbare felt):

| Seksjon | Innhold |
|---|---|
| 🗺️ **Oversikt** | Kartet med dagene i egne farger, 🏁 sluttpunkt og vindpil per dag. Sammendrag, dagliste og varsler. Klikk i kartet → *Legg til teltplass / notat / rutepunkt*. Rutedata og NVE-henting under «Rute og data». |
| 📅 **Dagplan** | Ett kort per dag: avreise, aktiv kitetid, pauser, fart, dagens mål (så langt planen rekker / bestemt distanse / mitt stopp), kite og vind. Resultat: fremdrift langs ruten vs. teoretisk distanse, ankomst med usikkerhet, dagslys, gjenstående km, overnatting. 2–5 dager eller flere. Varianter (f.eks. «dag 1 = 35/50/60 km») lagres separat og sammenlignes – hovedplanen overskrives aldri. Kalender/sol og den gamle avanserte dagsfordelingen ligger som underfaner. |
| 🪁 **Vær & kite** | Hvilke kites du tar med (alternativer – du bruker én om gangen), vindområde per kite med dagenes vind, kite per dag, egne vindgrenser. Værmelding, simulator og kitedatabase som underfaner. |
| 🎒 **Utstyr & planlegging** | Utstyr og mat, sikkerhet, vann-godkjenninger. |
| ⚙️ **Innstillinger** | Lagring og backup, datakilder, modell og kalibrering. |

**Vind per dag** er uavhengig: *Mitt scenario* (manuelt), *Værmelding* (MET, bare når datoen er innenfor ~9 døgn) eller *Værmelding + justering*. Et manuelt scenario vises aldri som prognose.

**Varsler er råd, ikke sperrer.** Tre nivåer – *Informasjon*, *Advarsel*, *Viktig advarsel*. Alt kan planlegges og simuleres uansett. «Merk som vurdert» lagrer din egen vurdering (f.eks. «Vurdert – jeg kjenner området») med dato; den vises som *VURDERT AV DEG* og er aldri en offisiell kontroll.

**Teltplasser**: navn, beskrivelse, din vurdering, notater, bilder, foretrukket/reserve, flytt ved å dra, slett. «Bruk som overnatting etter dag N» setter dagens stopp; forventet ankomst vises fra planen. Sletter du en teltplass, beholdes stoppet ditt i dagplanen.

Tester: `npm test` (logikk, simulering, lagring) + Playwright-skript for nettleseren (v5: 42 sjekker – 3-dagersplan, avreise/fart/timer, 50 km dag 1 med 🏁 i kartet, egen vind for dag 2, kite per dag, varianter, teltplass via kartklikk, beskrivelser, vurderte varsler, dra 🏁, reload, iPad stående/liggende og mobil uten horisontal scroll).

## Versjon 4 – lagring i IndexedDB (rettet «Nettleserlagringen er full»)

**Rotårsak:** Hele app-tilstanden ble lagret som ÉN JSON-streng i `localStorage` (grense ca. 5 MB) ved HVER endring.
I tillegg til planen din inneholdt den hurtigbuffer som kan hentes på nytt: NVE-innsjøpolygoner langs ruten
(lagret én gang per ruteversjon og aldri ryddet), NVE-magasinpolygoner, terrenganalyser, prognoser, kalibreringsspor
og bilder som base64. Da strengen passerte grensen, feilet hver lagring (meldingen viste 16,5 MB). Endringer etter det
fantes bare i minnet. Høydecachen lå i tillegg i localStorage og konkurrerte om de samme 5 MB.

**Ny arkitektur (`src/storage/`):**
| Lager | Innhold |
|---|---|
| `projects` | ett objekt per ekspedisjon |
| `slices` | prosjektdata i 13 små deler (tur, kites, teltplasser, overstyringer, notater, simulering …) – en endring skriver bare sin del |
| `routes` | én post per rute – å dra et punkt skriver bare den ruten |
| `caches` | NVE/terreng/prognose/høydecache – kan ryddes, bare nåværende ruteversjoner lagres |
| `blobs` | bilder som Blob (maks 1600 px JPEG + 240 px miniatyr, SHA-256-duplikatkontroll) |
| `backups` | øyeblikksbilder (automatisk hvert 10. min ved endringer, før sletting av ruter, GPX-import, import og gjenoppretting) |
| `meta` | migreringsstatus, aktivt prosjekt, siste lagring/backup, innstillinger |

- **Autolagring:** 400 ms debounce (maks 2 s), én skriving om gangen, «LAGRET» først når IndexedDB har bekreftet. Lagrer straks når fanen skjules (iPad/Safari suspenderer faner).
- **Feil:** data beholdes i minnet, nødkopi i localStorage, nye forsøk 3 s → 60 s, tydelig banner. Ved neste oppstart tilbys nødkopien.
- **Migrering:** les → valider → beskyttet kopi av originalen → bilder til Blob → skriv → les tilbake og verifiser → «verified». Den gamle localStorage-kopien slettes ikke automatisk.
- **Eksport:** ZIP (`project.json`, `metadata.json`, `routes/*.gpx`, `images/`, `images/thumbs/`, `attachments/`) eller JSON v3 (med/uten bilder). Import godtar alle tidligere formater.
- **Innstillinger / Lagring:** forbruk og kvote, varig lagring, størrelse per kategori, prosjekter, kopier (gjenopprett/last ned/slett), bilder (største først, slett), ubrukte filer, hurtigbuffer, migreringsrapport.
- Ytelse: tidssone-formatering ble opprettet tusenvis av ganger per ruteendring (2–3 s forsinkelse per klikk) – nå ~170 ms.

**Tester:** `npm test` (logikk, simulering, lagring med IndexedDB i minnet). Nettleser-E2E (Chromium) dekker ny ekspedisjon,
GPX-import, 100 rutepunkter, teltplassnotater, flere overstyringer, store bilder (4000×3000 → ~155 kB), kite/dato/simulering,
lukk/åpne nettleser, omlasting, gjenoppretting, ZIP-eksport/import i ren profil, kvotefeil, avbrutt lagring, nødkopi og
avbrutt migrering (52 sjekker).

**Begrensninger:** Safari/WebKit kunne ikke testes i utviklingsmiljøet (kun Chromium). Safari kan slette nettstedsdata etter
7 dager uten bruk (unntatt Hjem-skjerm-apper) og gir ofte ikke «varig lagring» – last ned ZIP jevnlig. Data synkroniseres
ikke mellom enheter.

## Versjon 3 – ytelsessimulator

### Nytt
- **YTELSESSIMULATOR** (egen fane): velg dag, starttid, strekning, kite eller quiver, vindretning (8 forvalg + egendefinert), middel/min/maks/kast, variabilitet, temperatur og time-for-time-vind (manuelt eller MET-prognose langs ruten). Viser ankomst, total-/bevegelses-/kite-/kryss-/ski-/gå-tid, seilt distanse, dagsslutt, dagslys ved ankomst og usikkerhet (P10/P50/P90).
- **Kitevurdering for hele vindfordelingen**: produsentens område (med kildeart), fysikkvindu for din last, ditt eget vindu, og status ved min/snitt/maks/kast.
- **Samme rute med hver kite** (alle 7 + quiver) med forklaring og konfidens, og fartskurver per vinkel mot vinden.
- **Avspilling i kartet** (▶/⏸/⏮, 1×/5×/10×) med posisjon, kite, vind, TWA, bakkefart og fremdrift.
- **SIMULER DAGSDISTANSE** (5–100 km fra valgfritt startpunkt): sluttpunkt, ankomst, dagslys, gjenstående distanse, resten av turen, leirkandidater (DTM ±3 km, ikke bratt/skredutsatt/på vann/no-go), «Velg som leir», «Sett som slutt på dag N».
- **Reiseplan-simulator**: sammenlign planer (f.eks. 50/40/rest, 35/50/rest, 40/35/rest), med konsekvenser når en dag blir for lang.
- **Kitedatabase** med kilde per verdi (produsent / forhandler / test / beregnet / vurdering / ikke funnet / manuell) – redigerbar.
- **Modell & kalibrering**: alle ligninger og parametre redigerbare, kiteparametre per kite, og import av egne GPS-spor for personlig kalibrering.
- **Sol-simulator**: astronomisk/nautisk/borgerlig tussmørke, høydekorreksjon, sammenligning Finse → leirer → dag 3 → Rjukan, tidlig mars → sen april, margin for sluttnedstigning.
- **GODKJENN FOR MIN RUTE**: ett klikk godkjenner én bestemt kryssing for denne turen (USER APPROVED). NVE-status og andre farer påvirkes ikke.
- **Teltplasser**: panel med navn, natt, foretrukket/reserve, notater, bilder, godkjenning, dupliser og tydelig slett.
- **Live-diagnose** (Datakilder): ekte kall mot hver tjeneste fra nettleseren med validering av svarformat.

### Modell (forenklet kraftbalanse – se fanen «Modell & kalibrering»)
```
ρ = p/(R·T)                                      luft fra temperatur og høyde
W_kite = W_10·ln(z_kite/z0)/ln(10/z0)            vind i kitehøyde
F = min(½·ρ·A·c_F·W_a², F_hold)                  kitekraft, resten depowres
ε = atan(1/G) + λ                                 glidetall + bakkens dragvinkel (skrens/pulk)
fremdrift = F (AWA ≥ 90°+ε) ellers F·sin(AWA−ε)
R = m·g·(μ+stigning) + ½·ρ·CdA·V²
V = største fart ≤ komfortfart der fremdrift ≥ R
VMG = max over kurs V(θ)·cos(avvik)  → kryss/jibb, stagvendinger ≈ L·tan(avvik)/korridor
oppstart: ½ρA·c_F·boost·W² ≥ m·g·μ·k_start ;  overpower: ½ρA·c_F·(1−depower)·W² > F_hold·toleranse
```
Per 500 m-etappe: vind for tid og sted → 5 vindkvantiler → én kite oppe (bytter bare når det lønner seg) → tid = snitt over kvantiler (+ stagvendinger, ski/gåing/storm der kiten ikke virker) → dagen slutter ved borgerlig skumring − leirtid eller maks reisetid.

**Antakelser:** c_F (0,78–0,85), depower (0,5–0,65), boost (1,4), μ (0,03–0,13), λ = 10°, F_hold = 0,65 × kroppsvekt, komfortfart 32 km/t × terrengfaktor 0,9. Glidetall G utledes av aspect ratio der den er dokumentert. Ingen kite har publiserte polardiagrammer – alt er estimater med usikkerhet. Kalibrer med egne spor.

### Kitekilder (websøk 2026-11-04)
| Kite | Dokumentert | Kilde |
|---|---|---|
| Peak V5 4 | AR 4,0 · 29 celler · projisert 3,2 m² · 0,70 kg | [flysurfer.com PEAK5](https://flysurfer-com.translate.goog/project/peak5/?_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es&_x_tr_pto=tc) |
| Hyperlink V1 7 | lukket celle · 7–18 kn land/snø (80 kg) | [Maxtrack](https://maxtrack.com/product/ozone-hyperlink-v1/), [Varuste](https://varuste.net/en/p82654/ozone-hyperlink-v1-complete-5m²) |
| Stoke 2 9 | tube, 3 struts, kort bridle · zenith fra 6 kn | [flysurfer.com STOKE2](https://wp.flysurfer.com/project/stoke2/), [S2AS](https://www.s2as.com/products/flysurfer-stoke-2-kitesurf-kite) |
| Sonic 4 10 | 45 celler · 1,78 kg · 12–33 kn (sweet 15–25) · AR 6,4 · projisert 8,32 m² | [flysurfer.com SONIC⁴](https://flysurfer.com/?p=50251), [S2AS](https://s2as.com/products/sonic) |
| Pivot 10 | 3 struts · AR 4,5–4,68 og 14–28 kn (avhenger av årsmodell) | [Naish Pivot](https://www.naish.com/products/pivot), [Pivot LTD](https://www.naish.com/products/pivot-ltd) |
| Soul V1 15 | projisert 12,44 m² · AR 5,6 · 41 celler · 2,74 kg | [flysurfer.com SOUL](https://flysurfer.com/project/soul/) |
| Soul V2 18 | projisert 14,93 m² · AR 5,8 · 41 celler · 8–14 kn | [flysurfer.com SOUL2](https://flysurfer.com/project/soul2/), [Powerkiteshop](https://powerkiteshop.com/products/flysurfer-soul-2) |

Ikke funnet: AR/vekt for Hyperlink V1, Stoke 2 og Pivot; vindområde for Soul V1 og Peak5 (produsentenes vindtabeller er bilder).

### Testresultater
- `npm test`: 60 logikk- og simuleringstester grønne (fysikk, kryss/jibb, rutesimulering, kalibrering, sol, overstyringer).
- Nettleser-E2E (med teststubber fordi utviklingsmiljøet ikke når tjenestene): 70+ sjekker grønne, ingen JS-feil, ingen horisontal scroll på mobil.
- Live-diagnose fra utviklingsmiljøet: alle eksterne tjenester rapporteres som FEIL (nettverket er sperret her) – det er riktig oppførsel. Kjør diagnosen i din nettleser.

### Funnet og rettet i revisjonen
1. DTM-høyder ble hentet flere ganger samtidig fra ulike komponenter → felles pågående-kall per punkt.
2. Kildestatus overskrev «siste OK» ved feil → egne felt for siste OK, siste feil, datatid og dataart.
3. Ingen gjentak ved 429/5xx → eksponentiell backoff med Retry-After.
4. MET-svar ble ikke cachet etter Expires (krav i MET-vilkårene) → minnecache etter Expires/Cache-Control.
5. Full localStorage krasjet lagring → trygg lagring med advarsel, og høydecachen begrenses og halveres ved behov.
6. Ingen validering av koordinater før kall → validering (NaN, byttet lat/lon).
7. Varsom-versjonen var ubekreftet → prøver v6.3.0 → v5.0.1 og husker første som virker.
8. Prognose per turdag brukte UTC-timer → lokal tid (Europe/Oslo).
9. Store GPX-filer tegnet tusenvis av dragbare markører → tynnes ut over 400 punkter.
10. Whitelist: en deaktivert overstyring kunne skygge for en aktiv på samme vann → aktiv overstyring prioriteres.
11. Modellfeil funnet av testene: kryss/jibb-merking var byttet om; sluttpunkt ble ikke nådd eksakt; kalibrering sammenlignet mot fart uten komfortgrense.

### Kjente begrensninger
- Endepunktene til Kartverket/NVE/MET/Varsom kunne ikke verifiseres fra utviklingsmiljøet (nettverket er sperret). Bruk «Kjør alle tester» under Datakilder.
- NVEs lag-ID-er finnes automatisk etter navn. URL-ene til bratthets- og skred-WMS er ubekreftet.
- Prognose langs ruten bruker nærmeste punkt og nærmeste time (ingen interpolasjon). Sikt finnes ikke i MET Locationforecast.
- Fysikkmodellen er stasjonær: kitens egen fart i vinduet, kastdynamikk og kanalisering av vind i terreng er forenklet.
- Terrengskygge for sol (f.eks. Rjukan-dalen) er ikke modellert.

## Versjon 2 – nye funksjoner

| Funksjon | Hvor | Merknad |
|---|---|---|
| **Vann-whitelist** (brukerstyrt overstyring) | Klikk et vann eller en kryssing i kartet · fanen *Overstyringer* | Typer: tur, sesong, permanent. Utløpsdato, krav om gjennomgang før avreise, personlig begrunnelse (påkrevd), kildelenke og hvilken strekning (km) den gjelder. Vises som **USER OVERRIDE** (stiplet turkis). NVE-status endres aldri; dammer innen 500 m og egne forbudte soner blokkerer fortsatt. |
| **Egen kite-quiver** | *Kite-quiver* | Velg/fjern hver kite, primær/sekundær/sterkvind, notater per kite, flere lagrede quivers, dekningssammenligning (2–22 m/s). Forslag er kun råd; ingen kite (heller ikke tube) utelukkes. Valgt quiver vises i toppfeltet. |
| **Snowkite-reisemodell** | *Dagplan* | Fremdrift langs ruten per etappe ut fra kurs mot vind (VMG i motvind/medvind), brukbar vind, le (DTM), gåstrekk (bratt + sluttnedstigning), oppskyting, navigasjon, værstans, tretthet og dagslys. Alle parametre kan endres. Scenario A/B/C. 3 dager er standardmålet. |
| **Dagkort** | *Dagplan* | Start/slutt, distanse, kite-/ski-/overhead-/ventetid, dagslys igjen ved ankomst, høydeprofil, sjekkpunkter, foreslått + alternativ leir, nødutganger, notater. Dra sjekkpunkter mellom dager (eller ◀ ▶), dra 🏁 i kartet, 2–7 dager. |
| **Notater på punkter** | Klikk rutepunkt/markør · «📝 Markør»-modus | Navn, kategori/ikon (13 innebygde + egne), beskrivelse, notater, lenker, bilder (nedskalert), status (uverifisert/advarsel/brukergodkjent/verifisert/blokkert), flytt rekkefølge, bruk som dagsslutt. Kategorier kan skjules i kartlag. |
| **Kalender og sol** | *Kalender* | Velg avreise, antall dager, alternative datoer, ±1 dag. Soloppgang/-nedgang, borgerlig demring/skumring, gylden time og dagslys beregnes (SunCalc) for midtpunktet av hver dagsetappe, tidssone Europe/Oslo. |
| **Vær** | *Vær & vind* | Vindpiler i kartet for hytter + delmål med tidsvelger (MET). Prognose per turdag vises bare når datoene er innenfor ~9 døgn. Effektiv temperatur og snø/regn beregnes. Klimatologi fra MET Frost (krever gratis klient-ID). |
| **Sluttnedstigning** | *Sikkerhet* | Eget segment: Krossobanen-status, Ryes vei-vurdering (fall, helning, svinger og skredterreng målt fra ruten), alternativer. |
| **Utstyr og offline** | *Utstyr & offline* | Pakkeliste med vekt, mat- og brenselkalkulator, nødpunkter, prosjektfil (JSON), GPX med notater, CSV, utskrivbar oversikt, nedlasting av kartfliser langs ruten (service worker). |
| **Turoversikt + endringslogg** | Sidepanel · *Overstyringer* | Dato, dager, distanse, quiver, sjekkpunkter, leirplasser, uløste advarsler, aktive overstyringer, status. Logg over ruteendringer og overstyringer. |

Kartfarger: rød = hovedrute, blå = alternativer, grønn ring = godkjent av deg, gul = advarsel, rød skravur = no-go, lilla = notater, turkis stiplet = USER OVERRIDE.

### Begrensninger i v2
- Ingen åpen kilde gir «verifisert uregulert vann» automatisk, så den klassen brukes ikke.
- Produsentdata for kites er ikke hentet; egenskapene er merket som faglige vurderinger.
- Nærmeste brøytede vei og mobildekning er ikke integrert (ingen åpen API med vinterstatus/dekning).
- Klimatologi krever MET Frost-klient-ID. Sikt finnes ikke i Locationforecast (tåkeandel vises i stedet).
- Offline-fliser fungerer etter at siden er åpnet én gang med nett. NVE/MET-data må hentes før avreise og lagres i prosjektfilen.
- Dra-og-slipp av sjekkpunkter virker med mus; på mobil brukes ◀ ▶.

## Funn så langt (2026-11-03)

| Funn | Status | Kilde |
|---|---|---|
| GPX-punkt #16 (60.1812, 8.1673) har høyde 1117 moh – innenfor Mårvatns reguleringsintervall 1100–1121 moh | 🔴 Ligger trolig på magasinet | GPX + SNL «Mår kraftverk» |
| GPX-punkt #19 (60.0168, 8.3891) 1079 moh og #20 (59.9289, 8.4801) 1087 moh – innenfor Kalhovd/Gøysta-magasinets 1076–1087 moh | 🔴 Ligger trolig på magasinet | GPX + SNL/Wikipedia «Kalhovdfjorden» |
| Kalhovdfjorden og Gøystavatn er ett sammenhengende magasin (også Strengetjønnan, Kilsfjorden, Sprogen, Geitebufjorden, Grytefjorden, Viervatnet) | 🔴 Regulert | Wikipedia «Kalhovdfjorden» |
| Krossobanen stanset av Statens jernbanetilsyn 19.06.2024, under istandsetting; kildene oppgir gjenåpning alt fra 2027 til 2028 | 🔴 Planlegg uten | Telemark fylkeskommune, TU.no, Komoot |
| Ryes vei: ca. 4 km, ~500 høydemeter, 21 svinger, brukes som akebakke om vinteren – ingen kilde bekrefter at den egner seg for ski med pulk | 🟡 Sjekk selv | visitrjukan.com |
| GPX-ruten er 113 km i rette linjer (opptil 11 km lange strekk) | 🟡 Faktisk distanse blir lengre | Beregnet |
| Snowkite-modell (v2) med vind fra NV på din GPX: scenario A ≈ 2–3 dager, B ≈ 3–4, C ≈ 7–8 | 🟡 Tre dager er realistisk med god, stabil vind | Beregnet modell |

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

Teknologi: React 18 + TypeScript + Vite, Leaflet, ECharts, Turf, Zustand, SunCalc.
