# Status — receptbok

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

### Öppet / nästa steg
1. Committat (fas 1). Ej pushat till GitHub.
2. Fas 3: ersätt spärren med säkerhetsnivå i UI (`needs_review` finns redan per rad i recept-JSON) + granskningslista för AI-livsmedel och osäkra matchningar.
3. Fas 4: egna produkter med etikettvärden (keso 1,5 %, kesella, skyr …).
