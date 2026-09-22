/**
 * Build golden-set.json: expected macros from SLV-correct foods (oracle),
 * independent of current resolver matches.
 *
 * Usage: npx tsx scripts/nutrition-eval/build-golden-set.mts
 *
 * Method per line:
 *  1. normalize name
 *  2. if golden-corrections.foods has key → use that id + piece_weight
 *  3. else use current catalog match (only when alias audit marked ok)
 *  4. grams via amountToGrams with piece_weight override
 *  5. macros from seed per_100g
 *
 * Lines that still cannot resolve are listed; recipe stays in set but flagged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const nutritionUrl = pathToFileURL(path.join(root, 'worker/src/nutrition/index.ts')).href;
const {
  catalogFromSeed,
  normalizeIngredientName,
  expandLookupKeys,
  lookupAlias,
  amountToGrams,
  macrosForGrams,
  resolveRecipeIngredients,
} = await import(nutritionUrl);

const seed = JSON.parse(fs.readFileSync(path.join(root, 'scripts/nutrition-seed.json'), 'utf8'));
const catalog = catalogFromSeed(seed.ingredients);
const corrections = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'golden-corrections.json'), 'utf8')
);
const verdicts = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'alias-audit.verdicts.json'), 'utf8')
);

const byId = new Map(seed.ingredients.map((i) => [i.id, i]));

// Synthetic foods not in seed (lost manual claims)
const synthetics = {
  'synthetic:vaniljextrakt': {
    id: 'synthetic:vaniljextrakt',
    canonical_name: 'vaniljextrakt',
    kcal_per_100g: 288,
    protein_per_100g: 0,
    fat_per_100g: 0,
    carbs_per_100g: 13,
    piece_weight_g: null,
    density_g_per_ml: null,
  },
};

const res = await fetch('https://receptbok.receptbok.workers.dev/api/recipes', {
  headers: { Accept: 'application/json', 'User-Agent': 'receptbok-golden-set' },
});
const { recipes } = await res.json();

/** Prefer diversity: meat/fish/vego, bak, asiatiskt, simple/complex — take all 32 if ≤35. */
const selected = recipes.slice().sort((a, b) => a.id.localeCompare(b.id, 'sv'));

function lookupCatalog(normalized) {
  for (const key of expandLookupKeys(normalized)) {
    const hit = lookupAlias(catalog, key);
    if (hit) return { key, hit };
  }
  return null;
}

function resolveOracleFood(normalized, raw) {
  const foods = corrections.foods || {};
  // Exact correction keys only — never broaden into corrections
  // (paprikapulver must not inherit paprika→Paprika röd).
  if (foods[normalized]) {
    const c = foods[normalized];
    const k = normalized;
    if (typeof c.id === 'string' && c.id.startsWith('synthetic:')) {
      return {
        source: 'correction-synthetic',
        aliasKey: k,
        ingredient: { ...synthetics[c.id], ...c },
        piece_weight_g: c.piece_weight_g ?? null,
      };
    }
    const row = byId.get(c.id);
    if (row) {
      return {
        source: 'correction',
        aliasKey: k,
        ingredient: row,
        piece_weight_g: c.piece_weight_g ?? row.piece_weight_g ?? null,
        note: c.note,
      };
    }
  }

  const cat = lookupCatalog(normalized);
  if (!cat) return null;

  const verd = verdicts[cat.key];
  if (verd?.verdict === 'wrong') {
    return {
      source: 'blocked-wrong-alias',
      aliasKey: cat.key,
      ingredient: null,
      blocked: true,
      note: verd.note || 'alias marked wrong — no oracle without correction',
    };
  }

  return {
    source: verd?.verdict === 'uncertain' ? 'catalog-uncertain' : 'catalog-ok',
    aliasKey: cat.key,
    ingredient: {
      id: cat.hit.id,
      canonical_name: cat.hit.canonical_name,
      kcal_per_100g: cat.hit.kcal_per_100g,
      protein_per_100g: cat.hit.protein_per_100g,
      fat_per_100g: cat.hit.fat_per_100g,
      carbs_per_100g: cat.hit.carbs_per_100g,
      piece_weight_g: cat.hit.piece_weight_g,
      density_g_per_ml: cat.hit.density_g_per_ml,
    },
    piece_weight_g: cat.hit.piece_weight_g,
  };
}

function oracleGrams(qty, unit, raw, ingredient, pieceOverride) {
  const ing = ingredient
    ? {
        ...ingredient,
        piece_weight_g:
          pieceOverride != null ? pieceOverride : ingredient.piece_weight_g ?? null,
      }
    : null;
  return amountToGrams(qty, unit, raw, ing);
}

const goldenRecipes = [];

for (const recipe of selected) {
  const lines = [];
  let kcal = 0;
  let prot = 0;
  let fat = 0;
  let carb = 0;
  let unresolved = 0;

  (recipe.groups || []).forEach((g, gi) => {
    (g.ingredients || []).forEach((ing, ii) => {
      const raw = String(ing.name || '').trim();
      if (!raw) return;
      const normalized = normalizeIngredientName(raw);
      const qty = typeof ing.amount === 'number' ? ing.amount : Number(ing.amount);
      const quantity = Number.isFinite(qty) ? qty : null;
      const unit = ing.unit != null ? String(ing.unit) : null;

      const oracle = resolveOracleFood(normalized, raw);
      if (!oracle?.ingredient || oracle.blocked) {
        unresolved += 1;
        lines.push({
          group_index: gi,
          ingredient_index: ii,
          raw,
          normalized,
          quantity,
          unit,
          status: 'unresolved',
          note: oracle?.note || 'no oracle food',
        });
        return;
      }

      const grams =
        quantity != null && unit
          ? oracleGrams(quantity, unit, raw, oracle.ingredient, oracle.piece_weight_g)
          : null;

      if (grams == null) {
        unresolved += 1;
        lines.push({
          group_index: gi,
          ingredient_index: ii,
          raw,
          normalized,
          quantity,
          unit,
          status: 'needs_grams',
          food_id: oracle.ingredient.id,
          food_name: oracle.ingredient.canonical_name,
          source: oracle.source,
          note: 'could not convert to grams even with piece override',
        });
        return;
      }

      const m =
        grams > 0
          ? macrosForGrams(oracle.ingredient, grams)
          : { kcal: 0, protein: 0, fat: 0, carbs: 0 };

      kcal += m.kcal;
      prot += m.protein;
      fat += m.fat;
      carb += m.carbs;

      lines.push({
        group_index: gi,
        ingredient_index: ii,
        raw,
        normalized,
        quantity,
        unit,
        status: 'ok',
        source: oracle.source,
        food_id: oracle.ingredient.id,
        food_name: oracle.ingredient.canonical_name,
        grams: Math.round(grams * 10) / 10,
        kcal: Math.round(m.kcal),
        prot: Math.round(m.protein),
        fat: Math.round(m.fat),
        carb: Math.round(m.carbs),
        note: oracle.note,
      });
    });
  });

  const expected = {
    kcal: Math.round(kcal),
    prot: Math.round(prot),
    fat: Math.round(fat),
    carb: Math.round(carb),
  };

  // Current resolver (baseline) for comparison — NOT used as facit
  const current = resolveRecipeIngredients(catalog, recipe);

  goldenRecipes.push({
    id: recipe.id,
    title: recipe.title,
    category: recipe.category,
    tags: recipe.tags || [],
    expected_macros: expected,
    current_resolver_macros: current.macros,
    unresolved_line_count: unresolved,
    line_count: lines.length,
    verified: unresolved === 0,
    verification:
      unresolved === 0
        ? 'oracle complete — foods from corrections or ok/uncertain aliases; macros from SLV/manual per_100g'
        : `${unresolved} lines lack oracle food or grams — expected_macros undercounts`,
    lines,
  });
}

const set = {
  generatedAt: new Date().toISOString(),
  method:
    'Expected macros = sum of SLV/manual per_100g × grams for each line. Food choice from golden-corrections.json when present; else catalog only if alias not marked wrong. NOT taken from current resolver output.',
  recipeCount: goldenRecipes.length,
  fullyVerified: goldenRecipes.filter((r) => r.verified).length,
  recipes: goldenRecipes,
};

fs.writeFileSync(path.join(__dirname, 'golden-set.json'), JSON.stringify(set, null, 2));

console.log('=== Golden set ===');
console.log(`Recipes: ${set.recipeCount} | fully verified: ${set.fullyVerified}`);
for (const r of goldenRecipes) {
  const dK = r.current_resolver_macros.kcal - r.expected_macros.kcal;
  const pct = r.expected_macros.kcal
    ? ((dK / r.expected_macros.kcal) * 100).toFixed(0)
    : '?';
  console.log(
    `${r.verified ? '✓' : '✗'} ${r.id}: expected ${r.expected_macros.kcal} kcal | resolver ${r.current_resolver_macros.kcal} (Δ ${dK}, ${pct}%) | lines unresolved ${r.unresolved_line_count}`
  );
}
console.log(`Wrote ${path.join(__dirname, 'golden-set.json')}`);
