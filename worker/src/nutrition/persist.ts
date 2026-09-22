import type { Recipe } from '../validate';
import { loadNutritionCatalog } from './catalog';
import { replaceRecipeIngredients } from './db';
import { listPieceWeightAiCandidates } from './match';
import { cachePieceWeights, estimatePieceWeightsAi } from './piece-ai';
import { resolveAndApplyRecipe } from './resolve';
import type { ResolveRecipeResult } from './types';

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
      return copy;
    }),
  }));
  if (proteinVariants != null) next.proteinVariants = proteinVariants;
  if (dietVariants != null) next.dietVariants = dietVariants;
  return next;
}

export type PersistResolution = {
  recipe: Recipe;
  resolution: ResolveRecipeResult;
  pieceWeightsCached?: number;
};

export type ResolveNutritionOptions = {
  /** When set, missing piece weights are AI-estimated once and cached to D1. */
  geminiApiKey?: string | null;
};

/**
 * Resolve macros from catalog and mirror onto recipe JSON (no recipe_ingredients writes).
 * Gram ladder: catalog → (optional AI cache) → category schablon — never blocks on st.
 */
export async function resolveRecipeNutrition(
  db: D1Database,
  recipe: Recipe,
  opts: ResolveNutritionOptions = {}
): Promise<PersistResolution> {
  const catalog = await loadNutritionCatalog(db);
  const cleaned = stripClientMacros(recipe);
  let applied = resolveAndApplyRecipe(catalog, cleaned);
  let pieceWeightsCached = 0;

  const aiKey = opts.geminiApiKey && String(opts.geminiApiKey).trim();
  if (aiKey) {
    const candidateIds = listPieceWeightAiCandidates(applied.resolution.rows);
    const missing = candidateIds
      .map((id) => catalog.byId.get(id))
      .filter((row): row is NonNullable<typeof row> => {
        if (!row) return false;
        return row.piece_weight_g == null || row.piece_weight_g <= 0;
      });
    if (missing.length) {
      try {
        const estimates = await estimatePieceWeightsAi(aiKey, missing);
        pieceWeightsCached = await cachePieceWeights(db, catalog, estimates);
        if (pieceWeightsCached > 0) {
          applied = resolveAndApplyRecipe(catalog, cleaned);
        }
      } catch {
        // Schablon already applied — AI failure must not block save
      }
    }
  }

  return { ...applied, pieceWeightsCached };
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
