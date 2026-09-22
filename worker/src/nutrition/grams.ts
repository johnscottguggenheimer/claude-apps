/**
 * Convert quantity+unit → grams.
 * Never returns null for a known ingredient with a countable unit —
 * falls back to category schablon (piece) or density default.
 */
import {
  isCookingSprayName,
  isCitrusJuiceName,
  isOilLikeName,
  isZeroGramSpiceName,
} from './normalize';
import { schablonDensityGPerMl, schablonPieceWeightG } from './piece-defaults';
import type { GramsSource, IngredientRow } from './types';

export type GramsResult = {
  grams: number;
  /** How piece weight / density was obtained (for st / volume). */
  source: GramsSource;
};

/**
 * Convert to grams. Returns null only when amount/unit missing or unit unknown
 * AND no safe default exists (should be rare after ladder).
 */
export function amountToGramsDetailed(
  amount: number,
  unit: string,
  rawOrNormalizedName: string,
  ingredient: IngredientRow | null
): GramsResult | null {
  const u = String(unit || '').toLowerCase();
  const name = rawOrNormalizedName || ingredient?.canonical_name || '';
  if (!Number.isFinite(amount) || amount <= 0) return { grams: 0, source: 'unit_default' };

  if (u === 'g') return { grams: amount, source: 'unit_default' };

  if (u === 'dl') {
    const dens =
      ingredient?.density_g_per_ml ??
      (isOilLikeName(name) ? 0.91 : schablonDensityGPerMl(name));
    const src: GramsSource =
      ingredient?.density_g_per_ml != null ? 'catalog' : 'category_fallback';
    return { grams: amount * 100 * dens, source: src };
  }

  if (u === 'msk') {
    if (ingredient?.density_g_per_ml != null) {
      return { grams: amount * 15 * ingredient.density_g_per_ml, source: 'catalog' };
    }
    if (isOilLikeName(name)) return { grams: amount * 14, source: 'unit_default' };
    const dens = schablonDensityGPerMl(name);
    if (dens !== 1.0) return { grams: amount * 15 * dens, source: 'category_fallback' };
    return { grams: amount * 15, source: 'unit_default' };
  }

  if (u === 'tsk') {
    if (ingredient?.density_g_per_ml != null) {
      return { grams: amount * 5 * ingredient.density_g_per_ml, source: 'catalog' };
    }
    if (isOilLikeName(name)) return { grams: amount * 4.5, source: 'unit_default' };
    const dens = schablonDensityGPerMl(name);
    if (dens !== 1.0) return { grams: amount * 5 * dens, source: 'category_fallback' };
    return { grams: amount * 5, source: 'unit_default' };
  }

  if (u === 'st') {
    if (isCookingSprayName(name)) return { grams: amount * 1.5, source: 'unit_default' };
    if (isCitrusJuiceName(name)) return { grams: amount * 30, source: 'unit_default' };
    if (ingredient?.piece_weight_g != null && ingredient.piece_weight_g > 0) {
      const src: GramsSource =
        ingredient.piece_weight_source === 'ai_estimated'
          ? 'ai_estimated'
          : ingredient.piece_weight_source === 'category_fallback'
            ? 'category_fallback'
            : 'catalog';
      return { grams: amount * ingredient.piece_weight_g, source: src };
    }
    // Ladder step 5: category schablon — never null when we have a food line
    const pw = schablonPieceWeightG(name);
    return { grams: amount * pw, source: 'category_fallback' };
  }

  if (u === 'pinch') {
    if (isCookingSprayName(name)) return { grams: amount * 1.5, source: 'unit_default' };
    if (isZeroGramSpiceName(name)) return { grams: 0, source: 'unit_default' };
    if (ingredient) return { grams: amount * 1, source: 'unit_default' };
    return { grams: 0, source: 'unit_default' };
  }

  if (u === 'näve') {
    if (isCookingSprayName(name)) return { grams: amount * 1.5, source: 'unit_default' };
    if (ingredient) return { grams: amount * 20, source: 'unit_default' };
    return { grams: amount * 20, source: 'category_fallback' };
  }

  if (u === 'strimlor') return { grams: 0, source: 'unit_default' };

  // Unknown unit with known ingredient: last-resort assume grams
  if (ingredient) return { grams: amount, source: 'category_fallback' };
  return null;
}

/** Back-compat wrapper — returns grams or null. */
export function amountToGrams(
  amount: number,
  unit: string,
  rawOrNormalizedName: string,
  ingredient: IngredientRow | null
): number | null {
  const r = amountToGramsDetailed(amount, unit, rawOrNormalizedName, ingredient);
  return r ? r.grams : null;
}

export function macrosForGrams(
  ingredient: IngredientRow,
  grams: number
): {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
} {
  const f = grams / 100;
  return {
    kcal: ingredient.kcal_per_100g * f,
    protein: ingredient.protein_per_100g * f,
    fat: ingredient.fat_per_100g * f,
    carbs: ingredient.carbs_per_100g * f,
  };
}
