import type { Recipe } from '../validate';
import { loadNutritionCatalog } from './catalog';
import { replaceRecipeIngredients } from './db';
import { aiResolveLines, applyAiDecisions, type AiDecision, type AiLineInput } from './ai-match';
import { unitWeightKey } from './catalog';
import { matchKey } from './match';
import { normalizeIngredientName, isZeroGramSpiceName } from './normalize';
import { resolveAndApplyRecipe } from './resolve';
import type { NutritionCatalog, ResolveRecipeResult, ResolvedIngredient } from './types';

/** Drop any AI-/client-supplied macro fields before authoritative resolve. */
export function stripClientMacros(recipe: Recipe): Recipe {
  const next: Recipe = { ...recipe };
  delete next.macros;
  const proteinVariants = next.proteinVariants;
  const dietVariants = next.dietVariants;
  const groups = (next.groups || []) as {
    name?: string;
    ingredients?: Record<string, unknown>[];
  }[];
  next.groups = groups.map((g) => ({
    ...g,
    ingredients: (g.ingredients || []).map((ing) => {
      const copy = { ...ing };
      delete copy.macros;
      delete copy.match_status;
      delete copy.resolved_grams;
      delete copy.ingredient_id;
      delete copy.grams_source;
      delete copy.match_method;
      delete copy.needs_review;
      return copy;
    }),
  }));
  if (proteinVariants != null) next.proteinVariants = proteinVariants;
  if (dietVariants != null) next.dietVariants = dietVariants;
  return next;
}

export type AiRunInfo = {
  /** Lines sent to the AI picker. */
  lines: number;
  learned: number;
  created: number;
  unitWeights: number;
  error?: string;
};

export type PersistResolution = {
  recipe: Recipe;
  resolution: ResolveRecipeResult;
  ai?: AiRunInfo;
  /** Raw AI decisions (dry-run / eval only). */
  decisions?: AiDecision[];
  aiLines?: AiLineInput[];
  /** Catalog used for the final resolve (includes in-memory AI foods). */
  catalog?: NutritionCatalog;
};

export type ResolveNutritionOptions = {
  /** Enables the AI picker for lines without a learned match. */
  geminiApiKey?: string | null;
  /** Persist AI decisions as learned rows (default true). false = dry-run. */
  learn?: boolean;
};

const WEAK_GRAMS = new Set(['category_fallback', 'unit_default']);

/** Lines the AI should look at: no learned food, or a weak gram estimate. */
export function linesForAi(
  catalog: NutritionCatalog,
  rows: ResolvedIngredient[]
): AiLineInput[] {
  const out: AiLineInput[] = [];
  const seen = new Set<string>();
  rows.forEach((row, idx) => {
    const normalized = normalizeIngredientName(row.raw_text);
    if (!normalized) return;
    const unit = row.unit ? row.unit.toLowerCase() : null;
    const learnedFood = row.match_method === 'learned_ai' || row.match_method === 'learned_user';
    const current = row.ingredient_id != null ? catalog.byId.get(row.ingredient_id) ?? null : null;

    let gramsOnly = false;
    if (learnedFood) {
      const weakGrams =
        !!unit &&
        unit !== 'g' &&
        unit !== 'pinch' &&
        (row.quantity ?? 0) > 0 &&
        WEAK_GRAMS.has(String(row.grams_source)) &&
        !!current &&
        !catalog.unitWeights.has(unitWeightKey(current.id, unit)) &&
        !isZeroGramSpiceName(normalized);
      if (!weakGrams) return;
      gramsOnly = true;
    }

    const key = (gramsOnly ? 'g:' + (current?.id ?? '') + '|' + unit : matchKey(normalized, unit));
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      idx,
      raw: row.raw_text,
      normalized,
      amount: row.quantity,
      unit,
      current,
      gramsOnly,
    });
  });
  return out;
}

/**
 * Resolve macros from catalog and mirror onto recipe JSON (no recipe_ingredients writes).
 * With a Gemini key: AI picker for unlearned lines, learning persisted unless learn=false.
 * AI failure never blocks — the deterministic result stands.
 */
export async function resolveRecipeNutrition(
  db: D1Database,
  recipe: Recipe,
  opts: ResolveNutritionOptions = {}
): Promise<PersistResolution> {
  const catalog = await loadNutritionCatalog(db);
  const cleaned = stripClientMacros(recipe);
  let applied = resolveAndApplyRecipe(catalog, cleaned);

  const aiKey = opts.geminiApiKey && String(opts.geminiApiKey).trim();
  if (!aiKey) return { ...applied, catalog };

  const learn = opts.learn !== false;
  const aiLines = linesForAi(catalog, applied.resolution.rows);
  if (!aiLines.length) return { ...applied, catalog, ai: { lines: 0, learned: 0, created: 0, unitWeights: 0 } };

  try {
    const decisions = await aiResolveLines(aiKey, catalog, aiLines);
    const stats = await applyAiDecisions(learn ? db : null, catalog, aiLines, decisions);
    applied = resolveAndApplyRecipe(catalog, cleaned);
    return {
      ...applied,
      catalog,
      ai: { lines: aiLines.length, ...stats },
      decisions,
      aiLines,
    };
  } catch (e) {
    return {
      ...applied,
      catalog,
      ai: {
        lines: aiLines.length,
        learned: 0,
        created: 0,
        unitWeights: 0,
        error: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

/**
 * Dual-write: resolve → recipe JSON macros/match_status, then recipe_ingredients rows.
 * Call after recipes row exists (insert/update).
 */
export async function persistRecipeNutrition(
  db: D1Database,
  recipe: Recipe,
  opts: ResolveNutritionOptions = {}
): Promise<PersistResolution> {
  const result = await resolveRecipeNutrition(db, recipe, opts);
  await replaceRecipeIngredients(db, String(result.recipe.id), result.resolution.rows);
  return result;
}
