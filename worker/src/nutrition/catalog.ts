import type { IngredientRow, NutritionCatalog } from './types';
import { normalizeIngredientName } from './normalize';

type IngredientDbRow = {
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
  piece_weight_source?: string | null;
};

type AliasDbRow = {
  ingredient_id: number;
  alias: string;
};

function toIngredient(row: IngredientDbRow): IngredientRow {
  return {
    id: row.id,
    canonical_name: row.canonical_name,
    category: row.category,
    kcal_per_100g: row.kcal_per_100g,
    protein_per_100g: row.protein_per_100g,
    fat_per_100g: row.fat_per_100g,
    carbs_per_100g: row.carbs_per_100g,
    piece_weight_g: row.piece_weight_g,
    density_g_per_ml: row.density_g_per_ml,
    needs_review: row.needs_review,
    piece_weight_source: row.piece_weight_source ?? null,
  };
}

/** Load full alias map from D1 (exact match keys = stored alias strings). */
export async function loadNutritionCatalog(db: D1Database): Promise<NutritionCatalog> {
  const ingredients = await db
    .prepare(
      `SELECT id, canonical_name, category, kcal_per_100g, protein_per_100g,
              fat_per_100g, carbs_per_100g, piece_weight_g, density_g_per_ml, needs_review,
              piece_weight_source
       FROM ingredients`
    )
    .all<IngredientDbRow>();

  const aliases = await db
    .prepare('SELECT ingredient_id, alias FROM ingredient_aliases')
    .all<AliasDbRow>();

  const byId = new Map<number, IngredientRow>();
  for (const row of ingredients.results || []) {
    byId.set(row.id, toIngredient(row));
  }

  const byAlias = new Map<string, IngredientRow>();
  for (const row of byId.values()) {
    const key = normalizeIngredientName(row.canonical_name);
    if (key) byAlias.set(key, row);
  }
  for (const a of aliases.results || []) {
    const ing = byId.get(a.ingredient_id);
    if (!ing) continue;
    const key = String(a.alias || '').toLowerCase().trim();
    if (key) byAlias.set(key, ing);
  }

  return { byAlias, byId };
}

/** Build catalog from in-memory seed rows (for dry-run / tests without D1). */
export function catalogFromSeed(
  ingredients: Array<{
    id: number;
    canonical_name: string;
    category?: string | null;
    kcal_per_100g: number;
    protein_per_100g: number;
    fat_per_100g: number;
    carbs_per_100g: number;
    piece_weight_g?: number | null;
    density_g_per_ml?: number | null;
    needs_review?: number;
    piece_weight_source?: string | null;
    aliases?: string[];
  }>
): NutritionCatalog {
  const byId = new Map<number, IngredientRow>();
  const byAlias = new Map<string, IngredientRow>();

  for (const row of ingredients) {
    const ing: IngredientRow = {
      id: row.id,
      canonical_name: row.canonical_name,
      category: row.category ?? null,
      kcal_per_100g: row.kcal_per_100g,
      protein_per_100g: row.protein_per_100g,
      fat_per_100g: row.fat_per_100g,
      carbs_per_100g: row.carbs_per_100g,
      piece_weight_g: row.piece_weight_g ?? null,
      density_g_per_ml: row.density_g_per_ml ?? null,
      needs_review: row.needs_review ?? 0,
      piece_weight_source: row.piece_weight_source ?? null,
    };
    byId.set(ing.id, ing);
    const canonKey = normalizeIngredientName(ing.canonical_name);
    if (canonKey) byAlias.set(canonKey, ing);
    for (const alias of row.aliases || []) {
      const key = String(alias).toLowerCase().trim();
      if (key) byAlias.set(key, ing);
    }
  }

  return { byAlias, byId };
}
