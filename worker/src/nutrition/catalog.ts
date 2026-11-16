import type {
  IngredientRow,
  LearnedMatch,
  LearnedUnitWeight,
  NutritionCatalog,
} from './types';
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
  source?: string | null;
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
    source: row.source ?? null,
  };
}

export function unitWeightKey(ingredientId: number, unit: string): string {
  return ingredientId + '|' + String(unit || '').toLowerCase().trim();
}

/** Learned layer lives in tables added by 0005; tolerate their absence. */
async function loadLearned(db: D1Database): Promise<{
  learned: Map<string, LearnedMatch>;
  unitWeights: Map<string, LearnedUnitWeight>;
}> {
  const learned = new Map<string, LearnedMatch>();
  const unitWeights = new Map<string, LearnedUnitWeight>();
  try {
    const [m, w] = await db.batch([
      db.prepare(
        'SELECT match_key, ingredient_id, source, confidence, needs_review FROM learned_matches'
      ),
      db.prepare(
        'SELECT ingredient_id, unit, grams_per_unit, source, needs_review FROM learned_unit_weights'
      ),
    ]);
    for (const r of (m.results || []) as {
      match_key: string;
      ingredient_id: number;
      source: 'ai' | 'user';
      confidence: string | null;
      needs_review: number;
    }[]) {
      learned.set(r.match_key, {
        ingredient_id: r.ingredient_id,
        source: r.source,
        confidence: r.confidence,
        needs_review: r.needs_review,
      });
    }
    for (const r of (w.results || []) as {
      ingredient_id: number;
      unit: string;
      grams_per_unit: number;
      source: 'ai' | 'user';
      needs_review: number;
    }[]) {
      unitWeights.set(unitWeightKey(r.ingredient_id, r.unit), {
        grams_per_unit: r.grams_per_unit,
        source: r.source,
        needs_review: r.needs_review,
      });
    }
  } catch {
    // Tables not migrated yet — run with seed aliases only.
  }
  return { learned, unitWeights };
}

type BaseCatalog = {
  version: string;
  byId: Map<number, IngredientRow>;
  byAlias: Map<string, IngredientRow>;
};

/**
 * Isolate-level cache of ingredients + aliases. Building it normalizes ~2 650
 * names (~15 ms CPU), too much to repeat on every request on the Workers CPU
 * budget. Invalidated by a cheap version query (row counts + max ids), so new
 * AI foods/aliases or a seed migration are picked up on the next request.
 */
let baseCache: BaseCatalog | null = null;

async function catalogVersion(db: D1Database): Promise<string> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM ingredients) AS ic, (SELECT MAX(id) FROM ingredients) AS im,
              (SELECT COUNT(*) FROM ingredient_aliases) AS ac, (SELECT MAX(id) FROM ingredient_aliases) AS am`
    )
    .first<{ ic: number; im: number | null; ac: number; am: number | null }>();
  return row ? `${row.ic}:${row.im}:${row.ac}:${row.am}` : 'none';
}

async function loadBase(db: D1Database, version: string): Promise<BaseCatalog> {
  const cols = `id, canonical_name, category, kcal_per_100g, protein_per_100g,
              fat_per_100g, carbs_per_100g, piece_weight_g, density_g_per_ml, needs_review,
              piece_weight_source`;
  let ingredients: D1Result<IngredientDbRow>;
  try {
    ingredients = await db
      .prepare(`SELECT ${cols}, source FROM ingredients`)
      .all<IngredientDbRow>();
  } catch {
    // ingredients.source added in 0005 — fall back before migration.
    ingredients = await db.prepare(`SELECT ${cols} FROM ingredients`).all<IngredientDbRow>();
  }

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
  return { version, byId, byAlias };
}

/**
 * Load the catalog. Maps are per-request copies (callers add AI foods in memory,
 * dry-runs must not leak); the search index is shared via searchIndexKey.
 */
export async function loadNutritionCatalog(db: D1Database): Promise<NutritionCatalog> {
  const version = await catalogVersion(db);
  if (!baseCache || baseCache.version !== version) {
    baseCache = await loadBase(db, version);
  }
  const base = baseCache;
  const { learned, unitWeights } = await loadLearned(db);
  return {
    byAlias: new Map(base.byAlias),
    byId: new Map(base.byId),
    learned,
    unitWeights,
    searchIndexKey: base,
  };
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

  return { byAlias, byId, learned: new Map(), unitWeights: new Map() };
}
