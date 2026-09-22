# Punkt 3-rapport: gram-stege

*2026-09-22*

## Mått-hygien (från din feedback)

- **v2-stickprov 0 % hard-wrong** = katalogbevis.
- **Line `ingredient_id` 100 %** = regressionsnät mot golden (självbekräftande om CURATED+golden byggts tillsammans). Rapporteras separat, inte som katalogverifiering.

## Vad som byggdes

1. **Migration `0004_piece_weight_meta.sql`** — `ingredients.piece_weight_source`, alias `source`/`needs_review`.
2. **Gram-stege** (`grams.ts` + `piece-defaults.ts`):
   - `st`: katalog `piece_weight_g` → AI-cache → kategorischablon (aldrig `null`).
   - `msk`/`tsk`/`dl`: densitet → kategori → generisk default.
3. **AI-styckvikt** (`piece-ai.ts`): batch per recept, returnerar **bara id→gram**, cachas med `piece_weight_source='ai_estimated'`, `needs_review=1`. Fel i AI blockerar inte sparning (schablon redan applicerad).
4. Seed: manuella styckvikter för paprika/lök/ägg/tomat/… (`source=manual`).

## Resultat (live)

| Mått | Värde |
|---|---|
| `needs_piece_weight` | **0** (var 14) |
| `unmatched` | 0 |
| Match rate (dry-run) | **100 %** |
| Lasagne kcal (tung `st`-rad) | 1823 → **2104** (plattor ingår) |
| Gate i praktiken | triggar inte på styckvikt längre |

**Krav 1** är uppfyllt i praktiken: copy-paste → spara utan att bedöma styckvikter. Formell gate-borttagning kvar till punkt 5.

## Nästa stickprov

När AI-cachade styckvikter samlats (`piece_weight_source='ai_estimated'`): inkludera dem i alias/styckvikts-stickprov med `needs_review=1`.
