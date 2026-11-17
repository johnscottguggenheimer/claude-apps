import { normalizeRecipe, type Recipe } from './validate';

export interface RecipeRow {
  id: string;
  data: string;
  featured_new: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function rowToRecipe(row: RecipeRow): Recipe {
  const recipe = normalizeRecipe(JSON.parse(row.data) as Recipe);
  recipe.updatedAt = row.updated_at;
  recipe.createdAt = row.created_at;
  return recipe;
}

export async function listRecipes(db: D1Database): Promise<{ recipes: Recipe[]; featuredNewIds: string[] }> {
  const { results } = await db
    .prepare('SELECT * FROM recipes ORDER BY updated_at DESC, created_at DESC')
    .all<RecipeRow>();
  const rows = results || [];
  const featuredNewIds = rows.filter((r) => r.featured_new).map((r) => r.id);
  return { recipes: rows.map(rowToRecipe), featuredNewIds };
}

export async function getRecipe(db: D1Database, id: string): Promise<Recipe | null> {
  const row = await db.prepare('SELECT * FROM recipes WHERE id = ?').bind(id).first<RecipeRow>();
  return row ? rowToRecipe(row) : null;
}

export async function getRecipeWithMeta(
  db: D1Database,
  id: string
): Promise<{ recipe: Recipe; featuredNew: boolean } | null> {
  const row = await db.prepare('SELECT * FROM recipes WHERE id = ?').bind(id).first<RecipeRow>();
  if (!row) return null;
  return { recipe: rowToRecipe(row), featuredNew: !!row.featured_new };
}

export async function idExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM recipes WHERE id = ?').bind(id).first();
  return !!row;
}

export async function nextSortOrder(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT MAX(sort_order) AS m FROM recipes').first<{ m: number | null }>();
  return (row?.m ?? -1) + 1;
}

export async function insertRecipe(
  db: D1Database,
  recipe: Recipe,
  opts: { featuredNew?: boolean; sortOrder?: number }
): Promise<void> {
  const now = new Date().toISOString();
  const sortOrder = opts.sortOrder ?? (await nextSortOrder(db));
  await db
    .prepare(
      'INSERT INTO recipes (id, data, featured_new, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(recipe.id, JSON.stringify(recipe), opts.featuredNew ? 1 : 0, sortOrder, now, now)
    .run();
}

export async function updateRecipe(db: D1Database, recipe: Recipe, featuredNew?: boolean): Promise<boolean> {
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT featured_new FROM recipes WHERE id = ?').bind(recipe.id).first<{ featured_new: number }>();
  if (!existing) return false;
  const featured = featuredNew !== undefined ? (featuredNew ? 1 : 0) : existing.featured_new;
  await db
    .prepare('UPDATE recipes SET data = ?, featured_new = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(recipe), featured, now, recipe.id)
    .run();
  return true;
}

/**
 * Set one protein variant's image in place (atomic json_set). Leaves updated_at
 * alone so list order doesn't change, and can't overwrite a concurrent edit of
 * the rest of the recipe. Returns false if the variant no longer exists.
 */
export async function setProteinVariantImage(
  db: D1Database,
  recipeId: string,
  variantId: string,
  image: string
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE recipes
         SET data = json_set(
           data,
           '$.proteinVariants[' || (
             SELECT v.key FROM json_each(recipes.data, '$.proteinVariants') v
             WHERE json_extract(v.value, '$.id') = ?2 LIMIT 1
           ) || '].image',
           ?3
         )
       WHERE id = ?1
         AND EXISTS (
           SELECT 1 FROM json_each(recipes.data, '$.proteinVariants') v
           WHERE json_extract(v.value, '$.id') = ?2
         )`
    )
    .bind(recipeId, variantId, image)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function renameRecipe(
  db: D1Database,
  oldId: string,
  recipe: Recipe,
  featuredNew?: boolean
): Promise<boolean> {
  const newId = String(recipe.id || '');
  if (!newId || newId === oldId) return updateRecipe(db, recipe, featuredNew);

  const row = await db.prepare('SELECT * FROM recipes WHERE id = ?').bind(oldId).first<RecipeRow>();
  if (!row) return false;
  if (await idExists(db, newId)) return false;

  const now = new Date().toISOString();
  const featured = featuredNew !== undefined ? (featuredNew ? 1 : 0) : row.featured_new;

  await db.batch([
    db.prepare(
      'INSERT INTO recipes (id, data, featured_new, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(newId, JSON.stringify(recipe), featured, row.sort_order, row.created_at, now),
    db.prepare('UPDATE recipe_reviews SET recipe_id = ? WHERE recipe_id = ?').bind(newId, oldId),
    // Reassign before DELETE so ON DELETE CASCADE does not wipe nutrition rows.
    db.prepare('UPDATE recipe_ingredients SET recipe_id = ? WHERE recipe_id = ?').bind(newId, oldId),
    db.prepare('DELETE FROM recipes WHERE id = ?').bind(oldId),
  ]);
  return true;
}

export async function markFeaturedSeen(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE recipes SET featured_new = 0 WHERE id = ?').bind(id).run();
}

export async function deleteRecipe(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM recipes WHERE id = ?').bind(id).first();
  if (!row) return false;
  await db.prepare('DELETE FROM recipe_reviews WHERE recipe_id = ?').bind(id).run();
  await db.prepare('DELETE FROM recipes WHERE id = ?').bind(id).run();
  return true;
}
