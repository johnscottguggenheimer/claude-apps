import { amountToGramsDetailed, macrosForGrams } from './grams';
import { expandLookupKeys } from './lookup';
import { normalizeIngredientName } from './normalize';
import { unitWeightKey } from './catalog';
import type {
  IngredientRow,
  MatchMethod,
  MatchStatus,
  NutritionCatalog,
  ResolvedIngredient,
} from './types';

/** First id for AI-/user-created foods; nutrition-migrate leaves these alone. */
export const CUSTOM_FOOD_ID_START = 950000;

/** Spoon-sized units often mean a different food (paprika msk = paprikapulver). */
export function unitClass(unit: string | null | undefined): 'spoon' | 'bulk' {
  const u = String(unit || '').toLowerCase().trim();
  return /^(msk|tsk|krm|pinch)$/.test(u) ? 'spoon' : 'bulk';
}

export function matchKey(normalizedName: string, unit: string | null | undefined): string {
  return normalizedName + '|' + unitClass(unit);
}

/** Learned match → exact alias → broader alias keys. */
export function findIngredient(
  catalog: NutritionCatalog,
  normalized: string,
  unit: string | null
): { ingredient: IngredientRow | null; method: MatchMethod; learnedNeedsReview: boolean } {
  if (normalized) {
    const learned = catalog.learned.get(matchKey(normalized, unit));
    const row = learned ? catalog.byId.get(learned.ingredient_id) : undefined;
    if (learned && row) {
      return {
        ingredient: row,
        method: learned.source === 'user' ? 'learned_user' : 'learned_ai',
        learnedNeedsReview: !!learned.needs_review,
      };
    }
    const exact = lookupAlias(catalog, normalized);
    if (exact) return { ingredient: exact, method: 'alias', learnedNeedsReview: false };
    const broad = lookupAliasBroad(catalog, normalized);
    if (broad) return { ingredient: broad, method: 'alias_broad', learnedNeedsReview: false };
  }
  return { ingredient: null, method: 'none', learnedNeedsReview: false };
}

/** Exact alias hit for one key. */
export function lookupAlias(catalog: NutritionCatalog, normalized: string): IngredientRow | null {
  if (!normalized) return null;
  return catalog.byAlias.get(normalized) ?? null;
}

/**
 * Exact alias match, then broader candidate keys (suffix/token drop).
 * Never substring-searches food names (avoids champinjon→skinka).
 */
export function lookupAliasBroad(
  catalog: NutritionCatalog,
  normalized: string
): IngredientRow | null {
  for (const key of expandLookupKeys(normalized)) {
    const hit = lookupAlias(catalog, key);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve one ingredient line against the catalog.
 * Exact alias first, then conservative broader keys — never free substring.
 * Gram ladder: catalog piece/density → category schablon — never blocks on st.
 */
export function resolveIngredientLine(
  catalog: NutritionCatalog,
  rawName: string,
  amount: number | null,
  unit: string | null,
  groupIndex: number,
  ingredientIndex: number
): ResolvedIngredient {
  const raw_text = String(rawName || '').trim();
  const quantity = amount != null && Number.isFinite(amount) ? amount : null;
  const unitNorm = unit != null ? String(unit).trim() || null : null;
  const normalized = normalizeIngredientName(raw_text);
  const found = findIngredient(catalog, normalized, unitNorm);
  const ingredient = found.ingredient;

  const base: ResolvedIngredient = {
    raw_text,
    quantity,
    unit: unitNorm,
    ingredient_id: null,
    canonical_name: null,
    resolved_grams: null,
    kcal: null,
    protein: null,
    fat: null,
    carbs: null,
    match_status: 'unmatched',
    grams_source: null,
    match_method: found.method,
    needs_review: false,
    group_index: groupIndex,
    ingredient_index: ingredientIndex,
  };

  if (!ingredient) {
    return base;
  }

  base.ingredient_id = ingredient.id;
  base.canonical_name = ingredient.canonical_name;
  base.needs_review =
    found.learnedNeedsReview ||
    (ingredient.id >= CUSTOM_FOOD_ID_START && !!ingredient.needs_review);

  if (quantity == null || !unitNorm) {
    base.match_status = 'unmatched';
    return base;
  }

  let gramsResult = amountToGramsDetailed(
    quantity,
    unitNorm,
    raw_text || normalized,
    ingredient
  );

  // Learned grams per unit: user always wins; AI wins over schablon/defaults.
  if (unitNorm.toLowerCase() !== 'g') {
    const learnedW = catalog.unitWeights.get(unitWeightKey(ingredient.id, unitNorm));
    const weak =
      gramsResult == null ||
      gramsResult.source === 'category_fallback' ||
      gramsResult.source === 'unit_default' ||
      gramsResult.source === 'ai_estimated';
    if (learnedW && (learnedW.source === 'user' || weak)) {
      gramsResult = {
        grams: quantity * learnedW.grams_per_unit,
        source: learnedW.source === 'user' ? 'catalog' : 'ai_estimated',
      };
      if (learnedW.needs_review) base.needs_review = true;
    }
  }

  if (gramsResult == null) {
    base.match_status = 'unmatched';
    return base;
  }

  const { grams, source } = gramsResult;
  base.resolved_grams = grams;
  base.grams_source = source;
  if (grams > 0) {
    const m = macrosForGrams(ingredient, grams);
    base.kcal = m.kcal;
    base.protein = m.protein;
    base.fat = m.fat;
    base.carbs = m.carbs;
  } else {
    base.kcal = 0;
    base.protein = 0;
    base.fat = 0;
    base.carbs = 0;
  }
  base.match_status = 'matched' satisfies MatchStatus;
  return base;
}
