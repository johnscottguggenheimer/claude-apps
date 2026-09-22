/**
 * Measure resolver vs golden set.
 * Primary gate: protein ±15%. Secondary: kcal ±15%.
 * Line-level: expected ingredient_id match rate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const nutritionUrl = pathToFileURL(path.join(root, 'worker/src/nutrition/index.ts')).href;
const { catalogFromSeed, resolveRecipeIngredients } = await import(nutritionUrl);

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
  if (exp === 0) return Math.abs(got) < 1;
  return Math.abs(got - exp) / Math.abs(exp) <= TOL;
}

const perRecipe = [];
const statusCounts = { matched: 0, unmatched: 0, needs_piece_weight: 0 };
let lineIdChecked = 0;
let lineIdMatch = 0;
const idMismatches = [];
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
  const resolverByPos = new Map();
  for (const row of resolution.rows) {
    resolverByPos.set(`${row.group_index}:${row.ingredient_index}`, row);
  }

  for (const line of g.lines) {
    if (line.status !== 'ok' || line.food_id == null) continue;
    const row = resolverByPos.get(`${line.group_index}:${line.ingredient_index}`);
    lineIdChecked += 1;
    const rid = row?.ingredient_id ?? null;
    const expectedId = line.food_id;
    // synthetic ids are strings — skip id equality, compare by name if needed
    const idOk =
      typeof expectedId === 'string'
        ? row?.match_status === 'matched' || row?.canonical_name === line.food_name
        : rid === expectedId;
    if (idOk) lineIdMatch += 1;
    else {
      idMismatches.push({
        recipeId: g.id,
        raw: line.raw,
        expectedId,
        expectedName: line.food_name,
        gotId: rid,
        gotName: row?.canonical_name || null,
        status: row?.match_status || null,
      });
    }
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
    delta: {
      kcal: got.kcal - exp.kcal,
      prot: got.prot - exp.prot,
      fat: got.fat - exp.fat,
      carb: got.carb - exp.carb,
    },
    pct: {
      kcal: exp.kcal ? +(((got.kcal - exp.kcal) / exp.kcal) * 100).toFixed(1) : null,
      prot: exp.prot ? +(((got.prot - exp.prot) / exp.prot) * 100).toFixed(1) : null,
      fat: exp.fat ? +(((got.fat - exp.fat) / exp.fat) * 100).toFixed(1) : null,
      carb: exp.carb ? +(((got.carb - exp.carb) / exp.carb) * 100).toFixed(1) : null,
    },
    within15: {
      prot: within(got.prot, exp.prot),
      kcal: within(got.kcal, exp.kcal),
      fat: within(got.fat, exp.fat),
      carb: within(got.carb, exp.carb),
    },
  });
}

const measurable = perRecipe.filter((r) => r.verified && r.expected);
const pctWithin = (key) =>
  measurable.length ? measurable.filter((r) => r.within15[key]).length / measurable.length : null;

errorLines.sort((a, b) => b.absDelta - a.absDelta);

const report = {
  generatedAt: new Date().toISOString(),
  primaryMetric: 'protein ±15%',
  secondaryMetric: 'kcal ±15%',
  goldenSet: {
    path: 'scripts/nutrition-eval/golden-set.json',
    recipes: golden.recipeCount,
    fullyVerified: golden.fullyVerified,
  },
  krav: {
    target: '≥90% recipes within ±15% protein (primary); kcal secondary',
    verifiedRecipeCount: measurable.length,
    protWithin15Pct: pctWithin('prot'),
    protPassCount: measurable.filter((r) => r.within15.prot).length,
    kcalWithin15Pct: pctWithin('kcal'),
    kcalPassCount: measurable.filter((r) => r.within15.kcal).length,
    fatWithin15Pct: pctWithin('fat'),
    carbWithin15Pct: pctWithin('carb'),
  },
  lineLevel: {
    note: 'Regression net vs golden ingredient_id — not independent catalog proof (that is alias-audit v2).',
    checked: lineIdChecked,
    ingredientIdMatch: lineIdMatch,
    ingredientIdMatchRate: lineIdChecked ? +(lineIdMatch / lineIdChecked).toFixed(3) : null,
    mismatchCount: idMismatches.length,
  },
  matchStatusDistribution: statusCounts,
  gramsLadderNote:
    'needs_piece_weight should stay 0 after punkt 3; st rows use catalog / ai_estimated / category_fallback.',

  topIdMismatches: idMismatches.slice(0, 40),
  topErrorLinesByAbsDeltaKcal: errorLines.slice(0, 40),
  perRecipe: perRecipe.sort(
    (a, b) => Math.abs(b.delta?.prot || 0) - Math.abs(a.delta?.prot || 0)
  ),
};

fs.writeFileSync(path.join(__dirname, 'measure.report.json'), JSON.stringify(report, null, 2));

console.log('=== Nutrition measure ===');
console.log(`PRIMARY protein ±15%: ${report.krav.protPassCount}/${measurable.length} (${((report.krav.protWithin15Pct || 0) * 100).toFixed(1)}%)`);
console.log(`SECONDARY kcal ±15%: ${report.krav.kcalPassCount}/${measurable.length} (${((report.krav.kcalWithin15Pct || 0) * 100).toFixed(1)}%)`);
console.log(`F/C ±15%: F=${((report.krav.fatWithin15Pct || 0) * 100).toFixed(0)}% C=${((report.krav.carbWithin15Pct || 0) * 100).toFixed(0)}%`);
console.log(
  `Line ingredient_id match: ${lineIdMatch}/${lineIdChecked} (${((report.lineLevel.ingredientIdMatchRate || 0) * 100).toFixed(1)}%)`
);
console.log('match_status:', statusCounts);
console.log('\nWorst by |Δprot|:');
for (const r of report.perRecipe.slice(0, 10)) {
  if (!r.delta) continue;
  console.log(
    `  ${r.id}: ΔP ${r.delta.prot} (${r.pct?.prot}%) Δkcal ${r.delta.kcal} ${r.within15?.prot ? 'PROT_PASS' : 'PROT_FAIL'}`
  );
}
console.log(`\nWrote measure.report.json`);
