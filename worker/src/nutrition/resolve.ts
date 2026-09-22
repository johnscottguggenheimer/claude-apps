import type { Recipe } from '../validate';
import { resolveIngredientLine } from './match';
import type {
  MacroTotals,
  NutritionCatalog,
  RecipeIngredientInput,
  ResolveRecipeResult,
  ResolvedIngredient,
} from './types';

function emptyMacros(): MacroTotals {
  return { kcal: 0, prot: 0, carb: 0, fat: 0 };
}

export function roundMacros(m: MacroTotals): MacroTotals {
  return {
    kcal: Math.max(0, Math.round(m.kcal)),
    prot: Math.max(0, Math.round(m.prot)),
    carb: Math.max(0, Math.round(m.carb)),
    fat: Math.max(0, Math.round(m.fat)),
  };
}

function sumMatched(rows: ResolvedIngredient[]): MacroTotals {
  let total = emptyMacros();
  for (const row of rows) {
    if (row.match_status !== 'matched') continue;
    total.kcal += row.kcal ?? 0;
    total.prot += row.protein ?? 0;
    total.carb += row.carbs ?? 0;
    total.fat += row.fat ?? 0;
  }
  return roundMacros(total);
}

/** Walk recipe.groups and resolve every ingredient line. */
export function resolveRecipeIngredients(
  catalog: NutritionCatalog,
  recipe: Recipe
): ResolveRecipeResult {
  const groups = (recipe.groups || []) as {
    ingredients?: RecipeIngredientInput[];
  }[];
  const rows: ResolvedIngredient[] = [];

  groups.forEach((g, gi) => {
    (g.ingredients || []).forEach((ing, ii) => {
      const name = String(ing.name || '').trim();
      if (!name) return;
      const amount =
        typeof ing.amount === 'number' ? ing.amount : Number(ing.amount);
      const qty = Number.isFinite(amount) ? amount : null;
      const unit = ing.unit != null ? String(ing.unit) : null;
      rows.push(resolveIngredientLine(catalog, name, qty, unit, gi, ii));
    });
  });

  const macros = sumMatched(rows);
  let unmatchedCount = 0;
  let needsPieceWeightCount = 0;
  for (const row of rows) {
    if (row.match_status === 'unmatched') unmatchedCount += 1;
    if (row.match_status === 'needs_piece_weight') needsPieceWeightCount += 1;
  }

  return { rows, macros, unmatchedCount, needsPieceWeightCount };
}

export type UnresolvedIngredient = {
  name: string;
  match_status: 'unmatched' | 'needs_piece_weight';
  group_index: number;
  ingredient_index: number;
};

export function listUnresolved(resolution: ResolveRecipeResult): UnresolvedIngredient[] {
  return resolution.rows
    .filter((r) => r.match_status === 'unmatched' || r.match_status === 'needs_piece_weight')
    .map((r) => ({
      name: r.raw_text,
      match_status: r.match_status as 'unmatched' | 'needs_piece_weight',
      group_index: r.group_index,
      ingredient_index: r.ingredient_index,
    }));
}

export function nutritionGateError(resolution: ResolveRecipeResult): {
  details: string[];
  unresolved: UnresolvedIngredient[];
} | null {
  const unresolved = listUnresolved(resolution);
  if (!unresolved.length) return null;
  const names = unresolved.map((u) => u.name).slice(0, 8);
  const extra = unresolved.length > 8 ? ` (+${unresolved.length - 8} till)` : '';
  const details = [
    unresolved.length === 1
      ? '1 ingrediens saknar näringsdata — kan inte spara'
      : unresolved.length + ' ingredienser saknar näringsdata — kan inte spara',
    names.join(' · ') + extra,
  ];
  return { details, unresolved };
}

/**
 * Mirror resolved macros onto recipe JSON (Steg A dual-write half).
 * Sets ing.macros, ing.match_status, ing.resolved_grams, ing.ingredient_id
 * and recipe.macros = SUM(matched).
 */
export function applyResolutionToRecipe(
  recipe: Recipe,
  result: ResolveRecipeResult
): Recipe {
  const groups = (recipe.groups || []) as {
    name?: string;
    ingredients?: RecipeIngredientInput[];
  }[];

  const byPos = new Map<string, ResolvedIngredient>();
  for (const row of result.rows) {
    byPos.set(`${row.group_index}:${row.ingredient_index}`, row);
  }

  const nextGroups = groups.map((g, gi) => ({
    ...g,
    ingredients: (g.ingredients || []).map((ing, ii) => {
      const row = byPos.get(`${gi}:${ii}`);
      if (!row) return { ...ing };
      const next: RecipeIngredientInput = {
        ...ing,
        match_status: row.match_status,
        resolved_grams: row.resolved_grams,
        ingredient_id: row.ingredient_id,
        grams_source: row.grams_source ?? null,
      };
      if (
        row.match_status === 'matched' &&
        row.kcal != null &&
        row.protein != null &&
        row.carbs != null &&
        row.fat != null
      ) {
        next.macros = {
          kcal: Math.round(row.kcal),
          prot: Math.round(row.protein),
          carb: Math.round(row.carbs),
          fat: Math.round(row.fat),
        };
      } else {
        delete next.macros;
      }
      return next;
    }),
  }));

  return {
    ...recipe,
    groups: nextGroups,
    macros: result.macros,
  };
}

/** Resolve + apply in one step (pure; no DB writes). */
export function resolveAndApplyRecipe(
  catalog: NutritionCatalog,
  recipe: Recipe
): { recipe: Recipe; resolution: ResolveRecipeResult } {
  const resolution = resolveRecipeIngredients(catalog, recipe);
  return { recipe: applyResolutionToRecipe(recipe, resolution), resolution };
}
