/**
 * Measure resolver against golden set (SLV-correct expected macros).
 *
 * Usage:
 *   npx tsx scripts/nutrition-eval/measure.mts
 *
 * Reports:
 *   - share of recipes within ±15% on kcal (krav 85%-mått)
 *   - same for P/F/C
 *   - match_status distribution (current binary)
 *   - lines contributing most to kcal error, sorted by |Δkcal|
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const nutritionUrl = pathToFileURL(path.join(root, 'worker/src/nutrition/index.ts')).href;
const { catalogFromSeed, resolveRecipeIngredients, normalizeIngredientName } =
  await import(nutritionUrl);

const seed = JSON.parse(fs.readFileSync(path.join(root, 'scripts/nutrition-seed.json'), 'utf8'));
const catalog = catalogFromSeed(seed.ingredients);
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set.json'), 'utf8'));

const res = await fetch('https://receptbok.receptbok.workers.dev/api/recipes', {
  headers: { Accept: 'application/json', 'User-Agent': 'receptbok-measure' },
});
const { recipes } = await res.json();
const byId = new Map(recipes.map((r) => [r.id, r]));

const TOL = 0.15;

function within(got, exp) {
  if (exp === 0) return got === 0;
  return Math.abs(got - exp) / exp <= TOL;
}

const perRecipe = [];
const statusCounts = { matched: 0, unmatched: 0, needs_piece_weight: 0 };
const errorLines = [];

for (const g of golden.recipes) {
  const recipe = byId.get(g.id);
  if (!recipe) {
    perRecipe.push({ id: g.id, error: 'recipe missing from API' });
    continue;
  }
  const resolution = resolveRecipeIngredients(catalog, recipe);
  for (const row of resolution.rows) {
    statusCounts[row.match_status] = (statusCounts[row.match_status] || 0) + 1;
  }

  const got = resolution.macros;
  const exp = g.expected_macros;
  const dKcal = got.kcal - exp.kcal;
  const dProt = got.prot - exp.prot;
  const dFat = got.fat - exp.fat;
  const dCarb = got.carb - exp.carb;

  // Per-line: compare oracle line kcal to resolver row kcal by position
  const resolverByPos = new Map();
  for (const row of resolution.rows) {
    resolverByPos.set(`${row.group_index}:${row.ingredient_index}`, row);
  }
  for (const line of g.lines) {
    if (line.status !== 'ok') continue;
    const row = resolverByPos.get(`${line.group_index}:${line.ingredient_index}`);
    const gotK = row?.kcal ?? 0;
    const expK = line.kcal ?? 0;
    const delta = gotK - expK;
    if (Math.abs(delta) >= 20) {
      errorLines.push({
        recipeId: g.id,
        raw: line.raw,
        oracleFood: line.food_name,
        resolverFood: row?.canonical_name || null,
        resolverStatus: row?.match_status || null,
        oracleKcal: expK,
        resolverKcal: Math.round(gotK),
        deltaKcal: Math.round(delta),
        absDelta: Math.abs(Math.round(delta)),
      });
    }
  }

  perRecipe.push({
    id: g.id,
    title: g.title,
    verified: g.verified,
    expected: exp,
    got,
    delta: { kcal: dKcal, prot: dProt, fat: dFat, carb: dCarb },
    pct: {
      kcal: exp.kcal ? +((dKcal / exp.kcal) * 100).toFixed(1) : null,
      prot: exp.prot ? +((dProt / exp.prot) * 100).toFixed(1) : null,
      fat: exp.fat ? +((dFat / exp.fat) * 100).toFixed(1) : null,
      carb: exp.carb ? +((dCarb / exp.carb) * 100).toFixed(1) : null,
    },
    within15: {
      kcal: within(got.kcal, exp.kcal),
      prot: within(got.prot, exp.prot),
      fat: within(got.fat, exp.fat),
      carb: within(got.carb, exp.carb),
    },
  });
}

const measurable = perRecipe.filter((r) => r.verified && r.expected);
const pctWithin = (key) =>
  measurable.length
    ? measurable.filter((r) => r.within15[key]).length / measurable.length
    : null;

errorLines.sort((a, b) => b.absDelta - a.absDelta);

const report = {
  generatedAt: new Date().toISOString(),
  goldenSet: {
    path: 'scripts/nutrition-eval/golden-set.json',
    recipes: golden.recipeCount,
    fullyVerified: golden.fullyVerified,
    method: golden.method,
  },
  tolerance: '±15%',
  krav: {
    target: '≥90% of recipes within ±15% kcal (85% accuracy band)',
    kcalWithin15PctOfVerified: pctWithin('kcal'),
    protWithin15PctOfVerified: pctWithin('prot'),
    fatWithin15PctOfVerified: pctWithin('fat'),
    carbWithin15PctOfVerified: pctWithin('carb'),
    verifiedRecipeCount: measurable.length,
    kcalPassCount: measurable.filter((r) => r.within15.kcal).length,
  },
  matchStatusDistribution: statusCounts,
  topErrorLinesByAbsDeltaKcal: errorLines.slice(0, 40),
  perRecipe: perRecipe.sort(
    (a, b) => Math.abs(b.delta?.kcal || 0) - Math.abs(a.delta?.kcal || 0)
  ),
};

fs.writeFileSync(path.join(__dirname, 'measure.report.json'), JSON.stringify(report, null, 2));

console.log('=== Nutrition measure (vs SLV golden set) ===');
console.log(
  `Verified recipes: ${measurable.length}/${golden.recipeCount}`
);
console.log(
  `kcal within ±15%: ${report.krav.kcalPassCount}/${measurable.length} (${(
    (report.krav.kcalWithin15PctOfVerified || 0) * 100
  ).toFixed(1)}%)`
);
console.log(
  `P/F/C within ±15%: P=${((report.krav.protWithin15PctOfVerified || 0) * 100).toFixed(0)}% F=${((report.krav.fatWithin15PctOfVerified || 0) * 100).toFixed(0)}% C=${((report.krav.carbWithin15PctOfVerified || 0) * 100).toFixed(0)}%`
);
console.log('match_status:', statusCounts);
console.log('\nWorst recipes by |Δkcal|:');
for (const r of report.perRecipe.slice(0, 12)) {
  if (!r.delta) continue;
  console.log(
    `  ${r.id}: Δkcal ${r.delta.kcal} (${r.pct?.kcal}%) expected ${r.expected.kcal} got ${r.got.kcal} ${r.within15?.kcal ? 'PASS' : 'FAIL'}`
  );
}
console.log('\nTop error lines:');
for (const e of errorLines.slice(0, 15)) {
  console.log(
    `  ${e.deltaKcal > 0 ? '+' : ''}${e.deltaKcal} kcal  ${e.raw} | oracle=${e.oracleFood} resolver=${e.resolverFood || e.resolverStatus}`
  );
}
console.log(`\nWrote ${path.join(__dirname, 'measure.report.json')}`);
