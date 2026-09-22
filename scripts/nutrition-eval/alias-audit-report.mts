/**
 * Rebuild alias-audit.report.json from existing sample + verdicts (no re-sample).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'alias-audit.sample.json'), 'utf8'));
const verdicts = JSON.parse(fs.readFileSync(path.join(__dirname, 'alias-audit.verdicts.json'), 'utf8'));

const tallies = { ok: 0, wrong: 0, uncertain: 0, missing: 0 };
const detailed = sample.sample.map((row) => {
  const v = verdicts[row.aliasKey];
  if (!v) {
    tallies.missing += 1;
    return { ...row, verdict: 'missing' };
  }
  tallies[v.verdict] += 1;
  return { ...row, verdict: v.verdict, note: v.note };
});

const reviewed = tallies.ok + tallies.wrong + tallies.uncertain;
const hardWrongRate = reviewed ? tallies.wrong / reviewed : null;
const notOkRate = reviewed ? (tallies.wrong + tallies.uncertain) / reviewed : null;

// Usage-weighted error (by useCount)
let useTotal = 0;
let useWrong = 0;
let useUncertain = 0;
for (const d of detailed) {
  useTotal += d.useCount;
  if (d.verdict === 'wrong') useWrong += d.useCount;
  if (d.verdict === 'uncertain') useUncertain += d.useCount;
}

const report = {
  generatedAt: new Date().toISOString(),
  uniqueAliasesUsedInRecipes: sample.uniqueAliasesUsedInRecipes,
  sampleSize: sample.sample.length,
  origin: sample.originNote,
  tallies,
  reviewed,
  rates: {
    hardWrongAmongReviewed: hardWrongRate,
    hardWrongPct: hardWrongRate != null ? +(hardWrongRate * 100).toFixed(1) : null,
    notOkAmongReviewed: notOkRate,
    notOkPct: notOkRate != null ? +(notOkRate * 100).toFixed(1) : null,
    usageWeightedHardWrongPct: useTotal ? +((useWrong / useTotal) * 100).toFixed(1) : null,
    usageWeightedNotOkPct: useTotal ? +(((useWrong + useUncertain) / useTotal) * 100).toFixed(1) : null,
  },
  interpretation:
    hardWrongRate == null
      ? 'Incomplete'
      : hardWrongRate >= 0.08
        ? '≥8% hard-wrong: eget arbetspaket före steg 3–5'
        : hardWrongRate >= 0.05
          ? '5–8% hard-wrong: arbetspaket rekommenderas före stege'
          : hardWrongRate > 0.02
            ? '2–5%: prioriterad städning av använda alias'
            : '~1%: städning',
  systematicCauses: [
    'CURATED i build-nutrition-seed-from-slv.py har felaktiga SLV-nummer (paprika=355 Rödkål, rödlök=348 Mangold, majs=305 Morot, mynta=345 Majskolv, timjan=352 Persilja).',
    'PREFERRED_SEARCH kan inte rädda dem: SLV saknar exakta namn Rödlök/Mynta/Timjan/Vatten/^Paprika$.',
    'MANUAL_FOODS svartpeppar-bucket suger in kryddor/sötningsmedel som 0 kcal (medvetet, men fel food-id).',
    'Auto short-alias first-claim: sallad → Sallad m. skaldjur.',
  ],
  wrongInSample: detailed.filter((d) => d.verdict === 'wrong'),
  uncertainInSample: detailed.filter((d) => d.verdict === 'uncertain'),
};

fs.writeFileSync(path.join(__dirname, 'alias-audit.report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ tallies, rates: report.rates, interpretation: report.interpretation, wrongCount: report.wrongInSample.length }, null, 2));
