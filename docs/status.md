# Status — receptbok

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
2. Gå igenom `/granska` i prod: 35 AI-livsmedel och osäkra matchningar från fas 1. Lägg in etikettvärden för keso 1,5 %, labneh, cotijaost, nötfärs extra mager m.fl.
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
