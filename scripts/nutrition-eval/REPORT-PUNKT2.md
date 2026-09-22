# Punkt 2-rapport: CURATED-städning

*2026-09-22*

## 0. Förskjutningshypotesen — FÖRKASTAD

Se `OFFSET-HYPOTHESIS.md`. Δ är inte konstant (+4, +3, −47, −57, −95, −6849…).  
Mönster: handgissade ID:n i grönsaksblocket 320–380, inte zippad indexförskjutning.  
→ Fix = namnbaserad rättning av CURATED + PREFERRED_SEARCH, inte mekanisk n±k.

## 1. Städning utförd

`scripts/build-nutrition-seed-from-slv.py`:
- Rättade CURATED (paprika→351, rödlök/gul lök→344, majs→400, salladslök→378 Gräslök, örter, äggvita→1227, kakao→1886, vatten→1953, m.m.)
- PREFERRED_SEARCH utan farliga fallbacks (`|^Purjolök`, `^Paprika$`)
- MANUAL force bara för `vaniljextrakt`
- Seed ombyggd → D1 migrerad (live alias verifierade)

## 2. Mått uppdaterade

- **Primär:** protein ±15 %
- **Sekundär:** kcal ±15 %
- **Rad-nivå:** `ingredient_id` match mot golden

| Mått | Före städning | Efter |
|---|---|---|
| Protein ±15 % | (ej primär) | **96,8 %** (30/31) |
| kcal ±15 % | 100 % (blint) | 100 % |
| Fett / kolhydrat ±15 % | 91 / 88 % | **100 / 90 %** |
| Line `ingredient_id` match | — | **100 %** (445/445) |

## 3. Nytt oberoende stickprov (v2)

- Exkluderar de 100 alias från v1
- Annan urvalsstride
- **Hard-wrong: 0 %** (mål &lt;2 %) → **PASS**
- Uncertain 36 %: nästan allt = medveten 0-kcal-kryddbucket + SLV-saknade proxys (rödlök→gul lök, vårlök→gräslök)

Filer: `alias-audit.v2.{sample,verdicts,report}.json`

## 4. Gate till punkt 3

Hard-wrong &lt;2 % uppnått. Punkt 3 (gram-stege) får starta efter ditt OK.
