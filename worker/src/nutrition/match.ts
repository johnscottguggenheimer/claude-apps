import { amountToGramsDetailed, macrosForGrams } from './grams';
import { expandLookupKeys } from './lookup';
import { normalizeIngredientName } from './normalize';
import type {
  IngredientRow,
  MatchStatus,
  NutritionCatalog,
  ResolvedIngredient,
} from './types';

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
  const ingredient = lookupAliasBroad(catalog, normalized);

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
    group_index: groupIndex,
    ingredient_index: ingredientIndex,
  };

  if (!ingredient) {
    return base;
  }

  base.ingredient_id = ingredient.id;
  base.canonical_name = ingredient.canonical_name;

  if (quantity == null || !unitNorm) {
    base.match_status = 'unmatched';
    return base;
  }

  const gramsResult = amountToGramsDetailed(
    quantity,
    unitNorm,
    raw_text || normalized,
    ingredient
  );

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

/** Ingredient ids that used category piece-weight schablon (candidates for AI cache). */
export function listPieceWeightAiCandidates(rows: ResolvedIngredient[]): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    if (
      row.match_status === 'matched' &&
      row.unit === 'st' &&
      row.grams_source === 'category_fallback' &&
      row.ingredient_id != null
    ) {
      ids.add(row.ingredient_id);
    }
  }
  return [...ids];
}
