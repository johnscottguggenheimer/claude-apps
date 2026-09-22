/** Shared nutrition types for Steg A matching + dual-write. */

export type MatchStatus = 'matched' | 'unmatched' | 'needs_piece_weight';

/** How grams were obtained for a line (gram ladder). */
export type GramsSource =
  | 'catalog'
  | 'ai_estimated'
  | 'category_fallback'
  | 'unit_default';

export type MacroTotals = {
  kcal: number;
  prot: number;
  carb: number;
  fat: number;
};

export type IngredientRow = {
  id: number;
  canonical_name: string;
  category: string | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
  piece_weight_g: number | null;
  density_g_per_ml: number | null;
  needs_review: number;
  /** Provenance of piece_weight_g when set. */
  piece_weight_source?: string | null;
};

/** In-memory catalog: exact alias → ingredient. */
export type NutritionCatalog = {
  byAlias: Map<string, IngredientRow>;
  byId: Map<number, IngredientRow>;
};

export type RecipeIngredientInput = {
  name?: string;
  amount?: number;
  unit?: string;
  macros?: MacroTotals;
  match_status?: MatchStatus;
  resolved_grams?: number | null;
  ingredient_id?: number | null;
  grams_source?: GramsSource | null;
};

export type ResolvedIngredient = {
  raw_text: string;
  quantity: number | null;
  unit: string | null;
  ingredient_id: number | null;
  canonical_name: string | null;
  resolved_grams: number | null;
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  match_status: MatchStatus;
  grams_source?: GramsSource | null;
  group_index: number;
  ingredient_index: number;
};

export type ResolveRecipeResult = {
  rows: ResolvedIngredient[];
  /** SUM of matched rows only — recipe.macros cache. */
  macros: MacroTotals;
  unmatchedCount: number;
  needsPieceWeightCount: number;
};
