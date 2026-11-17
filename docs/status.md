# Status — receptbok

## Kontroll av receptens makron — live

*2026-11-17*

### Varför
Granskningen i fas 3–4 täckte bara det AI själv flaggade (49 av 242 inlärda matchningar). Äldre alias-matchningar, styckvikter från katalogen och kokt/okokt var aldrig systematiskt kontrollerade. En manuell genomgång av prod (446 rader, 32 recept) hittade inga grova fel. Riset är okokt enligt stegen, och de gamla "ursprungsmakrona" i recipes.js var själva fel (t.ex. tonfisksallad 680 → 1729 kcal är rimligt). Men en stickprovsläsning är ingen kontroll.

### Vad som byggdes
- **Migration `0007_recipe_checks.sql`**: `recipe_checks` (AI-bedömning per recept + stämpel), knuten till en hash av portioner + ingredienser (namn, mängd, enhet).
- **`worker/src/nutrition-audit.ts`**, `GET/POST /api/nutrition/audit` (inloggning):
  - *Regler* (live): rader utan data, orimliga gram per enhet (st, msk, tsk, dl, nypa), 0 kcal på riktiga livsmedel, lagrade makron som inte stämmer med raderna, kcal mot 4/4/9, > 1100 kcal per portion.
  - *Oberoende AI* (`action: 'check'`): Gemini 2.5 Flash får bara titel, portioner, ingredienser och steg, inte våra värden. Den uppskattar gram + makron per rad (kokt/okokt från stegen, kasserad vätska räknas bort). Avvikelse = > 10 % kcal eller > 12 % protein på receptet, eller rad med > 40 kcal och > 35 % skillnad (protein > 5 g).
  - *Stämpel* (`verify` / `unverify`): gäller hashen. Ändrade ingredienser → status "Ändrat sedan kontroll".
  - Status: `flagged` → `stale` → `unchecked` → `ok` (AI håller med) → `verified`.
- **`/granska`**: ny sektion *Kontroll av recept* överst (`recept/granska-kontroll.js`). Fulla kort för avvikelser med radtabell Vi/AI och AI:s kommentar, "Byt livsmedel" per avvikande rad (återanvänder sökningen från granska.js via `window.ReviewTools`), "Kör AI-kontroll", "Markera som kontrollerat", länk till redigering. Kompakta listor för ej kontrollerade, AI håller med och kontrollerade. Knapp "Kör AI-kontroll på N recept" kör alla i tur och ordning.

### Verifierat
Lokalt: lista, regelflaggor, simulerad AI-rad (aglio e olio pasta → avvikelse −22 %, radtabell), stämpel + ångra, stämpeln släpper när en mängd ändras, okänt recept 404, AI utan nyckel 503. `tsc` OK. **AI-anropet är inte testat** (Gemini-nyckeln finns bara i Cloudflare).

### Arbetsflöde (när det är deployat)
1. `/granska` → "Kör AI-kontroll på 32 recept".
2. Gå igenom *Avvikelse*: rätta via "Byt livsmedel", vikter i Granska eller redigera receptet. Kör AI-kontroll igen.
3. Markera varje recept som kontrollerat. Målet: alla 32 gröna. Nya eller ändrade recept dyker upp igen automatiskt.

### Första körningen i prod (2026-11-17, version 30659e0f)
- Migration 0007 körd, deployad, pushad. Radtabellen visar bara rader som faktiskt avviker (AI kommenterade nästan varje rad).
- 32 recept AI-kontrollerade: 18 ok, 14 avvikelser. Rättat efter etikett (via `/granska`-API:t, `source='user'`):
  - **PB2** var 221 kcal/100 g i katalogen (id 910001, inte redigerbar). Nytt eget livsmedel *PB2 Original* 462 kcal/P46/K38,5/F11,5 (USDA-etikett), kopplat till "pb2 (pulver)" och "pulveriserat jordnötssmör": bananbröd 2464→2753, peanut butter cups 958→1247.
  - **Riven mozzarella**: nytt *Mozzarella riven 21%* 301 kcal/F21/K3,2 (Arla 21 % riven enligt ICA), protein 23 g uppskattat. Nyckeln normaliseras till "mozzarella", så alla mozzarellarader följde med: hot-honey-sliders 3232→3449, kycklingpizza-wrap 651→720, buffalo-pizza.
  - **Bacon stekt**: 6 g per strimla (var 15 g): buffalo-pizza 1642→1531.
  - **Hela pickles** → Saltgurka u. lag, 65 g/st (var söt inlagd gurka): smashed-pickle-salad 342→263.
  - **Pressad lime** → Limejuice färskpressad, 30 g/st. Gäller alla "lime st": street-corn 1995→1925, thai-kyckling 2111→2076, honey-lime 1197→1179.
- Efter rättning: 22 ok, 10 avvikelser. Nio bedömda som AI-fel eller brus: gyozaskal (AI 15 g/st, rätt ≈ 8), buffalosås, gochujang, affogato (sötningen tvetydig), scones-protein +3 g, smashed-cucumber +45 kcal, hjortfärsbiffar −13 %, kebab −10 %, pb-cups −10 %.
- **Löst:** dumpling-lasagna +31 % (AI 2151 mot 1639). Troligen fläskfärsen: vi räknar *Gris färs rå fett 8%*, amerikansk ground pork ≈ 20 %. Beror på vilken färs John köper.
- `wrangler d1 execute --remote` gav 7403 (inte behörig) mitt i sessionen. Deploy hade fungerat strax innan. Kör `npx wrangler login` om det kvarstår.

### Öppet / nästa steg
1. Fläskfärs löst: "malet fläskkött" → *Gris färs rå fett 15%* (John vet inte fetthalten, 15 % som mellanläge): dumpling-lasagna 1639→1900, AI-avvikelse nu +13 % (wontonskal-vikten står för resten).
2. Stämpla recepten som kontrollerade i `/granska` (inget är stämplat än).
3. AI är en andra åsikt, inte facit. Vid avvikelse avgör etikett/SLV.

---

## Näringsmatchning: fas 4 (egna livsmedel med etikettvärden) — live

*2026-11-17*

### Vad som byggdes
- **`save_food`** i `POST /api/nutrition/review` (`worker/src/nutrition-review.ts`): skapa eget livsmedel (namn + kcal/fett/kolhydrater/protein per 100 g) eller ändra ett eget/AI-livsmedel (id ≥ 950000). Sparas som `source='user'`, `needs_review=0`, kategori `egen`. SLV-rader går inte att ändra (400). Dubblettnamn → 409. Rimlighet: kcal ≤ 900, P+K+F ≤ 100 g.
- Valfritt `assign` (match_key eller name+unit, valfri gramvikt) kopplar raden till livsmedlet som användarmatchning i samma anrop. Vid namnbyte behålls gamla namnet som alias.
- Ändrade värden räknar om alla recept som använder livsmedlet (sparat `ingredient_id` eller inlärd matchning), utan AI.
- `GET /api/nutrition/review` returnerar även `foods`: alla egna/AI-livsmedel, ogranskade först.
- **Migration `0006_food_updated_at.sql`**: `ingredients.updated_at`. Katalogcachens version inkluderar `MAX(updated_at)` så ändrade värden slår igenom direkt (fallback om kolumnen saknas).
- **`/granska`**: ny sektion *Egna livsmedel* (tagg Eget / AI / AI, ogranskat) med *Ändra värden* och *+ Nytt eget livsmedel*. I *Byt livsmedel*-sökningen: "Finns inte? Skapa eget livsmedel från etiketten" (namn förifyllt från raden, kopplas direkt). Osäkra matchningar mot AI-livsmedel har *Ändra värden* (sparar och godkänner matchningen).
- Formuläret följer etikettens ordning (energi, fett, kolhydrater, protein) och varnar när kcal avviker > 15 % från 4/4/9-beräkningen. Varnar, stoppar inte.
- Refaktor: gemensamma `userMatchStmt`, `userWeightStmt`, `resolveKey`, `parseWeight`.

### Verifierat
Lokalt (seed + backup från fas 3, migration 0006 körd lokalt): ändra AI-livsmedel (vetegluten → eget, 2 recept omräknade, namnbyte syns direkt = cachen invalideras), skapa + koppla keso 1,5 % (gochujang-gnocchi 2260→2192 kcal), fristående nytt livsmedel via UI (listan laddas om), skapa eget från osäker matchning via UI (rödlök, 9 recept omräknade), fel: SLV-rad 400, dubblett 409, makron > 100 g 400. `tsc`, `npx tsx src/nutrition/ai-match.test.mts`, `validate-recipes` OK.

### Öppet / nästa steg
1. Deployad 2026-11-17: migration 0006 körd i prod, Worker version 101ab006, pushad. Röktest: `/granska` 302 till login, API 401 utan login, `granska.js` innehåller `save_food`, startsidan och `/api/recipes` OK. Inloggat flöde inte testat i prod.
2. **Prod-granskning klar 2026-11-17** (via `/granska`, alla ändringar som `source='user'`):
   - Nya värden: Kycklingfärs 5 % 130 kcal/P21/F5 (Kronfågel enligt ICA, protein beräknat), Nötfärs extra mager 5 % 129/P21/K0,5/F5 (ICA), Labneh 139/P8,1/K4,1/F10 (lägsta databasvärdet).
   - Nytt eget livsmedel: Keso Supermini 0,2 % 61 kcal/P13/K2,8/F0,2, kopplat till "supermini keso" (var keso 1,5 %).
   - Bytt till SLV: skummjölk → Minimjölk, farinsocker → Brun farin.
   - Övriga 67 matchningar och vikter godkända som de var. Granskningslistan är tom.
   - Största ändringar: chicken-kebab-wraps 2452→2647, middle-eastern-chicken-mince 2519→2616, thai-chicken-cucumber-salad 2038→2111, kyckling-gyoza 1206→1286, dumpling-lasagna 1639→1784 kcal.
   - Dumpling-lasagna-ökningen kom inte från granskningen: receptet var sparat med gyozaskal 8 g/st, men AI lärde in 10 g/st 2026-11-16 och omräkningen tog in den. USDA anger ca 8 g per wontonskal → satt till 8 g/st (user): dumpling-lasagna 1784→1639, kyckling-gyoza 1286→1216 kcal.
   - Uppföljning samma dag: salladslök satt till 15 g/st (5 recept −9 till −22 kcal). Oanvända AI-livsmedel farinsocker och skummjölk markerade som granskade. Sötningsmedel = monk fruit med erytritol → 0 kcal är rätt, oförändrat.
   - Gamla engångsskript (`scripts/fix-*.sql`, `fix-thai-kyckling-groups.mjs`, `migrate-tags.sql`, `persist-language-normalize.sql`) flyttade till `backups/old-oneoff-scripts/` (gitignorerad).
   - Inget kvar att granska. `scripts/slv-raw.json` har bara ny hämtningstid i arbetskopian (ej committad).
3. Kända begränsningar: inga fält för fibrer/socker/salt. Ingen radering av egna livsmedel. Vikter listar recept via `ingredient_id`+enhet i recept-JSON. Listvyn visar ingen säkerhetsnivå.

---

## Näringsmatchning: fas 3 (granskning i stället för spärr) — live

*2026-11-16*

### Vad som byggdes
- **Spärren borttagen.** `POST/PUT /api/recipes` och `/api/nutrition/reresolve` sparar även med omatchade rader. Svaret innehåller `unresolved`. Receptets makron = summa av matchade rader (omatchade räknas inte).
- **Säkerhetsnivå i detaljvyn** (`app.js` `nutritionConfidence`): `incomplete` (rader saknar data → varningsruta "makron räknas utan dem"), `estimated` (AI-bedömda rader → diskret notis), `ok` (ingen ruta). Per rad visas "uppskattad" när makron per ingrediens är på. Länk "Granska" syns bara inloggad (`.is-admin`).
- **Granskningssida `/granska`** (`recept/granska.html` + `granska.js`, inloggning krävs, länk i adminbaren). Tre listor, sorterade på antal recept: *Saknar näringsdata*, *Osäkra matchningar* (AI med `needs_review` eller ogranskat AI-livsmedel), *AI-bedömda vikter*. Åtgärder: Godkänn, Byt livsmedel (sök i katalogen), ange/ändra gram per enhet.
- **API** `worker/src/nutrition-review.ts`: `GET /api/nutrition/review`, `POST /api/nutrition/review` med `approve_match` | `set_match` (match_key eller name+unit, valfri vikt) | `set_weight`. Beslut sparas som `source='user'`, `needs_review=0`. Godkänd matchning mot AI-livsmedel godkänner även livsmedlet. Berörda recept räknas om direkt utan AI, `updated_at` orörd.
- `add.js`: ingen förkontroll före spara. "Räkna om makron" varnar men stoppar inte.
- Katalogcachens version inkluderar antal `ingredients.needs_review=1`, så godkända AI-livsmedel slår igenom direkt.

### Verifierat
Lokalt mot seed + backup (`backups/recipes-2026-11-16.sql`) med simulerade AI-rader: lista, godkänn (vetegluten: hoagie-bread protein 111→217), byt livsmedel med vikt via UI, ändra vikt, felaktiga anrop ger 400, nytt recept med okänd rad sparas och hamnar under "Saknar näringsdata", detaljvyns notis och radflagga. `tsc`, `ai-match.test.mts`, `validate-recipes` OK. **Inte** testat mot prod-datan (export av prod-D1 nekades i sessionen).

### Öppet / nästa steg
1. Deployad 2026-11-16 (version d0ee45e0) och pushad. Remote uppdaterad till `johnscottguggenheimer/claude-apps`.
2. Fas 4: klar, se ovan.
3. Kända begränsningar: vikter listar recept via `ingredient_id`+enhet i recept-JSON, så recept som inte räknats om sedan fas 1 kan saknas i listan. Listvyn visar ingen säkerhetsnivå.

---

## Näringsmatchning: fas 1 (AI-väljare) — live, alla recept omräknade

*2026-11-16*

### Problem
Matchningen var exakt alias-uppslag. De 32 recepten var 100 % matchade bara för att alias skrivits för just dem. Hold-out (82 rader utanför korpusen + kända fel): **23/82 rätt** livsmedel+gram. Vanliga råvaror (kikärtor, havregryn, kokosmjölk, krossade tomater …) hittades inte trots att de finns i SLV. Kända fel i sparade recept: vetegluten → vetemjöl (~100 g protein fel), bacon `strimlor` = 0 g, extra mager nötfärs → blandfärs 70/30, keso 1,5 % → 4 %, labneh → kvarg 1 %.

### Vad som byggdes
- `worker/migrations/0005_learned_matches.sql` — `learned_matches` (namn|enhetsklass → livsmedel), `learned_unit_weights` (gram per enhet), `ingredients.source`. Ingen FK: överlever seed-migrering.
- `nutrition/candidates.ts` — fuzzy kandidatsökning i minnet (token + sammansättning + trigram, trigramindex som förfilter). Recall@12 på hold-out: 68/73.
- `nutrition/ai-match.ts` — Gemini väljer bland kandidater eller "inget", ger gram per enhet och egen uppskattning per 100 g. Runda 2 med AI:ns sökord. Rimlighetskontroll mot egen uppskattning; avvikelse/inget val → AI-livsmedel (id ≥ 950000, `needs_review=1`). Skriver aldrig över SLV.
- Uppslagsordning: inlärd matchning → alias → bredare alias. AI körs bara för rader utan inlärd matchning, eller med svag gramschablon. Fel i AI blockerar aldrig.
- `piece-ai.ts` borttagen (ersatt av gram per enhet i AI-väljaren).
- Admin-endpoints (inloggning): `POST /api/nutrition/dry-run`, `POST /api/nutrition/reresolve`.
- `scripts/nutrition-migrate.mts` raderar inte längre egna livsmedel och läser in inlärt lager innan omräkning.
- Mätning: `scripts/nutrition-eval/holdout-set.json`, `measure-holdout.mts` (lokal recall / `--live`), `reresolve.mts`. Offline-test: `worker/src/nutrition/ai-match.test.mts`.

### Beslut
- Inlärningsnyckel inkluderar enhetsklass (`spoon` = msk/tsk/krm/pinch, `bulk` = övrigt) — "paprika 1 msk" ≠ "paprika 1 st".
- Användarens rättelser (`source='user'`) skrivs aldrig över av AI.
- Spärren vid omatchade rader finns kvar tills fas 3.

### Live-mätning (2026-11-16)
- Migration 0005 körd, Worker deployad (`receptbok.johnscottapps.workers.dev`).
- Hold-out live: **76–77/82** (före: 23/82). Kvarvarande avvikelser är gränsfall (ost som eget livsmedel med rimliga värden, kycklingklubbor utan skinn, labneh något lågt, philadelphia light → extra light).
- Gram: äldre seed-styckvikter utan källa (t.ex. Paprika grön = 10 g) räknas nu som schablon och ersätts av AI-vikt. Bara `piece_weight_source='manual'|'slv'` går före.
- Testomräkning (dry-run) av alla 32 recept: inga AI-fel, 0 omatchade, ~190 ändrade rader, i stort sett alla förbättringar. Tydligast: extra mager nötfärs −365 kcal, grekisk yoghurt → naturell 10 %, vetegluten rätt protein, bacon-strimlor 45 g i stället för 0, kryddor får kcal, rödlök → Lök röd.
- Prompt skärpt för tillagat vs rått och malet kött efter två fel i testomräkningen.
- Känd begränsning: Gemini är inte helt deterministisk vid temperatur 0; första inlärda svaret fryses.
- 503 "Worker exceeded resource limits" (CPU) vid omräkning: katalogen (~2 650 namn normaliseras) och sökindexet byggdes om i varje anrop. Fix: isolate-cache i `catalog.ts` med versionsfråga (antal + max-id), per-anrop-kopior av mapparna, sökindex delat via `searchIndexKey`. Efter fixen inga fel. Planen (gratis/betald) är inte verifierad.

### Omräkning (2026-11-16)
- Backup före: `backups/recipes-2026-11-16.sql` (recipes + recipe_ingredients, gitignorerad).
- Alla 32 recept omräknade och sparade, 0 AI-fel, 0 omatchade rader. `updated_at` orörd (listordningen ändras inte).
- Inlärt: 242 matchningar (35 markerade för granskning), 117 gramvikter, 35 AI-livsmedel (id 950000–950034, mest kryddor + vetegluten, keso 1,5 %, nötfärs extra mager, labneh, cotijaost).
- Största ändringar: gochujang-gnocchi 2260→1875 kcal, honey-lime-teriyaki 770→1197 (risnudlar nu okokta), hoagie-bread protein 111→233, buffalo-pizza +169 (bacon räknas).

### Öppet (fas 1)
- Klart. Fas 3 ovan ersätter spärren.
