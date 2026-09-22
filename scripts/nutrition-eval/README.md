# Nutrition eval (punkt 1)

## Alias-stickprov
```bash
npx tsx scripts/nutrition-eval/alias-audit.mts          # sample + draft verdicts
# edit alias-audit.verdicts.json
npx tsx scripts/nutrition-eval/alias-audit-report.mts   # rates
```

## Golden set (facit = SLV-rätt mat, inte resolver-output)
```bash
npx tsx scripts/nutrition-eval/build-golden-set.mts
npx tsx scripts/nutrition-eval/measure.mts
```

`golden-corrections.json` maps wrong/missing aliases → correct SLV ids + piece weights.
`golden-set.json` expected macros are computed from those foods × grams.
