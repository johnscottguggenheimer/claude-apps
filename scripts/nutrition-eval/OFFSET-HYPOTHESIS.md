# CURATED offset-hypothesis test (punkt 2, steg 0)

## Hypotes
Fel-ID:n (`paprika→355`, `rödlök→348`, `gul lök→347`) är konstant indexförskjutning (n±k) från en zippad lista.

## Resultat: **FÖRKASTAD**

| Alias | CURATED | Faktisk rad | Rätt id | Δ |
|---|---|---|---|---|
| paprika | 355 | Rödkål | 351 Paprika röd | **+4** |
| rödlök | 348 | Mangold | 344 Lök gul | **+4** |
| gul lök | 347 | Majskorn frysvara | 344 Lök gul | **+3** |
| schalottenlök | 349 | Nässlor | 344 | +5 |
| dill | 330 | Sojabönsgroddar | 377 Dill färsk | **−47** |
| basilika | 322 | Blomkål | 379 Basilika färsk | **−57** |
| majs | 305 | Morot kokt | 400 Majskorn | **−95** |
| mynta | 345 | Majskolv | 7194 Grönmynta | **−6849** |
| ingefära | 338 | Grönkål frysvara | 2269 | **−1931** |
| äggvita | 1225 | Ägg rått | 1227 | −2 |

Unika Δ bland mismatches: dussintals värden, mean ≈ −950. **Ingen konstant förskjutning.**

## Verkligt mönster
Handgissade nummer i grönsaksblocket 320–380 (ungefärlig plats i alfabetisk SLV-lista). Lyckliga träffar (gurka 339, tomat 364, vitlök 371) blandas med grannmissar (+3…+5) och helt fel örter/majs.

**Fix:** rätta CURATED + PREFERRED_SEARCH per alias (namnbaserat), återgenerera seed — inte mekanisk n±k.
