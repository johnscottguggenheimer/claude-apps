/**
 * Alias quality stickprov — weighted by actual recipe usage.
 *
 * Usage:
 *   npx tsx scripts/nutrition-eval/alias-audit.mts
 *
 * Writes:
 *   scripts/nutrition-eval/alias-audit.sample.json   — 100 aliases to review
 *   scripts/nutrition-eval/alias-audit.report.json   — after verdicts applied
 *
 * Verdicts live in alias-audit.verdicts.json (alias → ok|wrong|uncertain|note).
 * Re-run after editing verdicts to refresh the report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const evalDir = __dirname;

const nutritionUrl = pathToFileURL(path.join(root, 'worker/src/nutrition/index.ts')).href;
const {
  catalogFromSeed,
  normalizeIngredientName,
  expandLookupKeys,
  lookupAlias,
} = await import(nutritionUrl);

const seed = JSON.parse(fs.readFileSync(path.join(root, 'scripts/nutrition-seed.json'), 'utf8'));
const catalog = catalogFromSeed(seed.ingredients);

const res = await fetch('https://receptbok.receptbok.workers.dev/api/recipes', {
  headers: { Accept: 'application/json', 'User-Agent': 'receptbok-alias-audit' },
});
if (!res.ok) throw new Error(`API ${res.status}`);
const { recipes } = await res.json();

type Used = {
  aliasKey: string;
  ingredientId: number;
  canonical: string;
  useCount: number;
  recipeIds: string[];
  exampleRaws: string[];
  hitVia: 'exact' | 'broadened';
};

/** Which alias key actually won for this normalized name? */
function resolveHit(normalized: string): {
  aliasKey: string;
  ingredientId: number;
  canonical: string;
  hitVia: 'exact' | 'broadened';
} | null {
  const keys = expandLookupKeys(normalized);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const hit = lookupAlias(catalog, key);
    if (hit) {
      return {
        aliasKey: key,
        ingredientId: hit.id,
        canonical: hit.canonical_name,
        hitVia: i === 0 && key === normalized ? 'exact' : 'broadened',
      };
    }
  }
  // expandLookupKeys always puts full string first; if first differs from normalized still exact map
  const direct = lookupAlias(catalog, normalized);
  if (direct) {
    return {
      aliasKey: normalized,
      ingredientId: direct.id,
      canonical: direct.canonical_name,
      hitVia: 'exact',
    };
  }
  return null;
}

const used = new Map<string, Used>();

for (const recipe of recipes) {
  for (const g of recipe.groups || []) {
    for (const ing of g.ingredients || []) {
      const raw = String(ing.name || '').trim();
      if (!raw) continue;
      const normalized = normalizeIngredientName(raw);
      const hit = resolveHit(normalized);
      if (!hit) continue;
      const prev = used.get(hit.aliasKey) || {
        aliasKey: hit.aliasKey,
        ingredientId: hit.ingredientId,
        canonical: hit.canonical,
        useCount: 0,
        recipeIds: [],
        exampleRaws: [],
        hitVia: hit.hitVia,
      };
      prev.useCount += 1;
      if (!prev.recipeIds.includes(recipe.id)) prev.recipeIds.push(recipe.id);
      if (prev.exampleRaws.length < 3 && !prev.exampleRaws.includes(raw)) {
        prev.exampleRaws.push(raw);
      }
      // prefer recording broadened if ever seen that way
      if (hit.hitVia === 'broadened') prev.hitVia = 'broadened';
      used.set(hit.aliasKey, prev);
    }
  }
}

const usedList = [...used.values()].sort((a, b) => b.useCount - a.useCount);

/** Deterministic sample: top by use, then fill to 100 with mid-tier, then tail. */
function sampleWeighted(list: Used[], n: number): Used[] {
  if (list.length <= n) return list;
  const picked: Used[] = [];
  const seen = new Set<string>();
  const take = (item: Used) => {
    if (seen.has(item.aliasKey) || picked.length >= n) return;
    seen.add(item.aliasKey);
    picked.push(item);
  };
  // Top 40 by usage
  for (const item of list.slice(0, 40)) take(item);
  // Mid band every k-th
  const mid = list.slice(40, Math.max(40, list.length - 20));
  const step = Math.max(1, Math.floor(mid.length / 40));
  for (let i = 0; i < mid.length && picked.length < 80; i += step) take(mid[i]);
  // Tail / rare
  for (let i = list.length - 1; i >= 0 && picked.length < n; i--) take(list[i]);
  // Fill remaining from unused middle
  for (const item of list) {
    if (picked.length >= n) break;
    take(item);
  }
  return picked;
}

const sample = sampleWeighted(usedList, 100);

const samplePath = path.join(evalDir, 'alias-audit.sample.json');
fs.writeFileSync(
  samplePath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      recipes: recipes.length,
      uniqueAliasesUsedInRecipes: usedList.length,
      sampleSize: sample.length,
      sample,
      originNote:
        'Aliases come from scripts/build-nutrition-seed-from-slv.py: (1) auto short/stripped from every SLV name, (2) CURATED id map, (3) PREFERRED_SEARCH regex overrides, (4) USDA/manual. paprika→Rödkål = CURATED id 355 (Rödkål) + PREFERRED_SEARCH ^Paprika$ miss (no exact SLV name). salladslök→Purjolök = PREFERRED_SEARCH ^Salladslök|^Purjolök fallback.',
    },
    null,
    2
  )
);

const verdictsPath = path.join(evalDir, 'alias-audit.verdicts.json');
type Verdict = 'ok' | 'wrong' | 'uncertain';
type VerdictRow = { verdict: Verdict; note?: string };

let verdicts: Record<string, VerdictRow> = {};
if (fs.existsSync(verdictsPath)) {
  verdicts = JSON.parse(fs.readFileSync(verdictsPath, 'utf8'));
}

function classifyHeuristic(alias: string, canonical: string): VerdictRow | null {
  const a = alias.toLowerCase();
  const c = canonical.toLowerCase();
  // Known systematic errors
  if ((a === 'paprika' || a.includes('paprika')) && c.includes('rödkål')) {
    return { verdict: 'wrong', note: 'paprika≠rödkål; curated id 355' };
  }
  if ((a === 'salladslök' || a === 'vårlök') && c.includes('purjolök')) {
    return { verdict: 'wrong', note: 'salladslök≠purjolök; PREFERRED_SEARCH fallback' };
  }
  if (a === 'vårlök' && c.includes('paprika')) {
    return { verdict: 'wrong', note: 'vårlök claimed by paprika grön' };
  }
  // Obvious OK: alias is prefix/substring of canonical or vice versa (simple foods)
  if (c === a || c.startsWith(a + ' ') || c.startsWith(a) || a.startsWith(c)) {
    return { verdict: 'ok', note: 'name aligns with canonical' };
  }
  return null;
}

// Merge heuristics into empty verdicts for sample keys
for (const row of sample) {
  if (verdicts[row.aliasKey]) continue;
  const h = classifyHeuristic(row.aliasKey, row.canonical);
  if (h) verdicts[row.aliasKey] = h;
}

fs.writeFileSync(verdictsPath, JSON.stringify(verdicts, null, 2));

const tallies = { ok: 0, wrong: 0, uncertain: 0, missing: 0 };
const detailed = sample.map((row) => {
  const v = verdicts[row.aliasKey];
  if (!v) {
    tallies.missing += 1;
    return { ...row, verdict: 'missing' as const };
  }
  tallies[v.verdict] += 1;
  return { ...row, verdict: v.verdict, note: v.note };
});

const reviewed = tallies.ok + tallies.wrong + tallies.uncertain;
const errorRate = reviewed ? tallies.wrong / reviewed : null;

const report = {
  generatedAt: new Date().toISOString(),
  uniqueAliasesUsedInRecipes: usedList.length,
  sampleSize: sample.length,
  tallies,
  reviewed,
  errorRateAmongReviewed: errorRate,
  errorRatePct: errorRate != null ? +(errorRate * 100).toFixed(1) : null,
  interpretation:
    errorRate == null
      ? 'Incomplete verdicts'
      : errorRate < 0.02
        ? '~1%: städning'
        : errorRate >= 0.05
          ? '≥5%: eget arbetspaket före steg 3–5'
          : '2–5%: städning med prioritet på använda alias',
  wrongInSample: detailed.filter((d) => d.verdict === 'wrong'),
  uncertainInSample: detailed.filter((d) => d.verdict === 'uncertain'),
  sampleDetailed: detailed,
};

fs.writeFileSync(path.join(evalDir, 'alias-audit.report.json'), JSON.stringify(report, null, 2));

console.log('=== Alias audit ===');
console.log(`Used aliases in recipes: ${usedList.length}`);
console.log(`Sample: ${sample.length}`);
console.log(`Verdicts: ok=${tallies.ok} wrong=${tallies.wrong} uncertain=${tallies.uncertain} missing=${tallies.missing}`);
if (errorRate != null) console.log(`Error rate (reviewed): ${(errorRate * 100).toFixed(1)}%`);
console.log(`Wrote ${samplePath}`);
console.log(`Wrote ${verdictsPath}`);
console.log(`Wrote alias-audit.report.json`);
