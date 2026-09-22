# Punkt 1-rapport: alias-kvalitet + golden baseline

*2026-09-22 — ingen resolver-ändring, bara mätning.*

## 1. Hur aliasen uppstod

`scripts/build-nutrition-seed-from-slv.py` bygger alias i lager:

1. **Auto** — kortnamn + strippad SLV-titel (first-claim vinner)
2. **CURATED** — hårdkodad `alias → SLV-nummer` (**force**)
3. **PREFERRED_SEARCH** — regex som *ska* rätta CURATED, men ofta missar
4. **USDA/manual** — bara om aliasen är ledig

`paprika → Rödkål` är **inte** mystisk auto-generering. CURATED sätter `"paprika": 355` och #355 *är* Rödkål. `PREFERRED_SEARCH` `^Paprika$` hittar inget (SLV har bara Paprika grön/röd/gul). Samma mönster:

| Alias | CURATED-id | Faktisk SLV-rad |
|---|---|---|
| paprika / röd paprika | 355 | Rödkål |
| rödlök | 348 | Mangold |
| gul lök / lök | 347 | Majskorn frysvara |
| majs / majskärnor | 305 | Morot kokt m. salt |
| mynta | 345 | Majskolv |
| timjan | 352 | Persilja blad |
| vaniljextrakt | 1892 | Socker |
| vatten | 1975 | Salt (medveten 0-kcal-hack) |

`salladslök → Purjolök` kommer från `PREFERRED_SEARCH`: `^Salladslök|^Purjolök` (ingen Salladslök i SLV → Purjolök).

Separat: **MANUAL `svartpeppar`-bucket** suger in ~30 kryddor/sötningsmedel som 0 kcal (medvetet).

Det är samma klass av fel som de 222 gissade raderna: automatik + overifierad output som blev sanning.

---

## 2. Alias-stickprov (100, viktat mot receptanvändning)

| | |
|---|---|
| Unika alias använda i 32 recept | 216 |
| Stickprov | 100 |
| **ok** | 65 |
| **wrong** (fel mat) | **13 (13 %)** |
| **uncertain** (0-kcal-bucket / fetproxy) | 22 |
| Hard-wrong, usage-viktat | **13,9 %** |
| not-ok (wrong+uncertain), usage-viktat | 29,7 % |

**Tolkning: ≥8 % hard-wrong → eget arbetspaket före steg 3–5.**

Kända wrong i stickprovet: paprika, röd paprika, salladslök, rödlök, majs, majskärnor, konserverad majs, mynta, timjan, vaniljextrakt, kakao→kakaosmör, äggvita→helt ägg, sallad→skaldjurssallad.

Filer: `alias-audit.sample.json`, `alias-audit.verdicts.json`, `alias-audit.report.json`.

---

## 3. Golden set + mätkommando

Facit byggs från **rätt SLV-rad** via `golden-corrections.json` + ok/uncertain-katalog — **inte** från nuvarande resolver-output.

```bash
npx tsx scripts/nutrition-eval/build-golden-set.mts
npx tsx scripts/nutrition-eval/measure.mts
```

### Baseline (nuvarande resolver vs SLV-oracle)

| Mått | Resultat |
|---|---|
| Recept i set | 32 (hela korpusen) |
| kcal inom ±15 % | **32/32 (100 %)** |
| protein ±15 % | 97 % |
| fett ±15 % | 91 % |
| kolhydrat ±15 % | **88 %** |
| match_status | 432 matched / 0 unmatched / **14 needs_piece_weight** |

### Varför 100 % kcal trots 13 % fel-alias?

Många felträffar har **liknande kcal/100 g** (paprika ≈ rödkål ≈ 30). Kravet ser uppfyllt ut på kcal medan **identiteten** är fel. Materiala kcal-missar syns där densiteten skiljer:

| Rad | Oracle | Resolver | Δkcal |
|---|---|---|---|
| lasagneplattor (st) | Pasta okokt + styckvikt | needs_piece_weight → 0 | −286 |
| kakao | Kakaopulver | Kakaosmör | +194 |
| konserverad majs | Majskorn | Morot kokt | −145 |
| äggvita | Äggvita rå | Ägg rått | +118 |
| majskärnor | Majskorn | Morot | −106 |

**Slutsats för krav 2:** kcal-bandet ensamt döljer alias-felen. Mät P/F/C + fel-rader sorterade på |Δkcal|; alias-städning är fortfarande blockerande före stege 3–5.

---

## 4. Implikationer för ordningen (oförändrad, med skärpa)

1. ~~Golden set + mät~~ **klart (denna rapport)**
2. **Nytt före schema/stege:** CURATED-id-audit + rensa fel-alias (arbetspaket — 13 % hard-wrong)
3. Gram-stege (uppfyller krav 1 praktiskt på denna korpus)
4. Steg 3–5
5. Formell gate-borttagning

Väntar på OK innan punkt 2 (schema) eller alias-städningspaketet.
