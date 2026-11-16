/**
 * Granskning av näringsmatchning (fas 3, kräver inloggning).
 *
 * GET  /api/nutrition/review
 *   Osäkra inlärda matchningar, AI-gramvikter och omatchade rader, med vilka
 *   recept som använder dem.
 *
 * POST /api/nutrition/review
 *   { action: 'approve_match', match_key }
 *   { action: 'set_match', match_key? | name+unit, ingredient_id }
 *   { action: 'set_weight', ingredient_id, unit, grams_per_unit }
 *   Beslut sparas som source='user' (AI skriver aldrig över dem). Berörda
 *   recept räknas om deterministiskt (utan AI) och sparas med orörd updated_at.
 */
import {
  CUSTOM_FOOD_ID_START,
  loadNutritionCatalog,
  matchKey,
  normalizeIngredientName,
  replaceRecipeIngredients,
  resolveRecipeNutrition,
} from './nutrition';
import type { NutritionCatalog } from './nutrition';
import type { Recipe } from './validate';

type Env = { DB: D1Database };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

type RecipeRef = { id: string; title: string };

type IngLine = {
  recipe: RecipeRef;
  name: string;
  amount: number | null;
  unit: string | null;
  ingredient_id: number | null;
  match_status: string | null;
  resolved_grams: number | null;
  key: string;
};

async function loadRecipeLines(db: D1Database): Promise<{ recipes: Recipe[]; lines: IngLine[] }> {
  const rows = await db.prepare('SELECT data FROM recipes').all<{ data: string }>();
  const recipes: Recipe[] = [];
  const lines: IngLine[] = [];
  for (const row of rows.results || []) {
    let r: Recipe;
    try {
      r = JSON.parse(row.data) as Recipe;
    } catch {
      continue;
    }
    recipes.push(r);
    const ref = { id: String(r.id), title: String(r.title || r.id) };
    for (const g of (r.groups || []) as { ingredients?: Record<string, unknown>[] }[]) {
      for (const ing of g.ingredients || []) {
        const name = String(ing.name || '').trim();
        if (!name) continue;
        const unit = ing.unit != null ? String(ing.unit) : null;
        lines.push({
          recipe: ref,
          name,
          amount: typeof ing.amount === 'number' ? ing.amount : null,
          unit,
          ingredient_id: typeof ing.ingredient_id === 'number' ? ing.ingredient_id : null,
          match_status: typeof ing.match_status === 'string' ? ing.match_status : null,
          resolved_grams: typeof ing.resolved_grams === 'number' ? ing.resolved_grams : null,
          key: matchKey(normalizeIngredientName(name), unit),
        });
      }
    }
  }
  return { recipes, lines };
}

function uniqueRecipes(lines: IngLine[]): RecipeRef[] {
  const seen = new Map<string, RecipeRef>();
  for (const l of lines) seen.set(l.recipe.id, l.recipe);
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title, 'sv'));
}

function foodSummary(catalog: NutritionCatalog, id: number | null) {
  if (id == null) return null;
  const f = catalog.byId.get(id);
  if (!f) return { id, name: '#' + id, missing: true };
  return {
    id: f.id,
    name: f.canonical_name,
    kcal: f.kcal_per_100g,
    prot: f.protein_per_100g,
    carb: f.carbs_per_100g,
    fat: f.fat_per_100g,
    ai: f.id >= CUSTOM_FOOD_ID_START || f.source === 'ai',
    needs_review: !!f.needs_review,
  };
}

export async function handleNutritionReviewList(env: Env): Promise<Response> {
  const catalog = await loadNutritionCatalog(env.DB);
  const { lines } = await loadRecipeLines(env.DB);

  const byKey = new Map<string, IngLine[]>();
  for (const l of lines) {
    const arr = byKey.get(l.key) || [];
    arr.push(l);
    byKey.set(l.key, arr);
  }

  const noteRows = await env.DB.prepare(
    'SELECT match_key, note, confidence FROM learned_matches'
  ).all<{ match_key: string; note: string | null; confidence: string | null }>();
  const notes = new Map((noteRows.results || []).map((r) => [r.match_key, r]));

  // Matchningar: inlärd med needs_review, eller pekar på ett ogranskat AI-livsmedel.
  const matches = [];
  for (const [key, m] of catalog.learned) {
    const food = catalog.byId.get(m.ingredient_id);
    const aiFoodUnreviewed = !!food && food.id >= CUSTOM_FOOD_ID_START && !!food.needs_review;
    if (m.source === 'user' || (!m.needs_review && !aiFoodUnreviewed)) continue;
    const used = byKey.get(key) || [];
    const sample = used[0];
    matches.push({
      match_key: key,
      name: sample?.name || key.split('|')[0],
      unit_class: key.split('|')[1] || 'bulk',
      food: foodSummary(catalog, m.ingredient_id),
      confidence: m.confidence,
      note: notes.get(key)?.note || null,
      recipes: uniqueRecipes(used),
      examples: used.slice(0, 3).map((l) => ({ amount: l.amount, unit: l.unit, grams: l.resolved_grams })),
    });
  }

  // Gramvikter från AI som inte är granskade.
  const weights = [];
  for (const [wkey, w] of catalog.unitWeights) {
    if (w.source === 'user' || !w.needs_review) continue;
    const sep = wkey.indexOf('|');
    const ingredientId = Number(wkey.slice(0, sep));
    const unit = wkey.slice(sep + 1);
    const used = lines.filter(
      (l) => l.ingredient_id === ingredientId && String(l.unit || '').toLowerCase().trim() === unit
    );
    weights.push({
      ingredient_id: ingredientId,
      unit,
      grams_per_unit: w.grams_per_unit,
      food: foodSummary(catalog, ingredientId),
      sample_name: used[0]?.name || null,
      recipes: uniqueRecipes(used),
    });
  }

  // Rader utan näringsdata i sparade recept.
  const unresolvedByKey = new Map<string, IngLine[]>();
  for (const l of lines) {
    if (l.match_status !== 'unmatched' && l.match_status !== 'needs_piece_weight') continue;
    const arr = unresolvedByKey.get(l.key) || [];
    arr.push(l);
    unresolvedByKey.set(l.key, arr);
  }
  const unresolved = [...unresolvedByKey.entries()].map(([key, used]) => ({
    match_key: key,
    name: used[0]!.name,
    unit: used[0]!.unit,
    match_status: used[0]!.match_status,
    food: foodSummary(catalog, used[0]!.ingredient_id),
    recipes: uniqueRecipes(used),
  }));

  const byUse = (a: { recipes: RecipeRef[] }, b: { recipes: RecipeRef[] }) =>
    b.recipes.length - a.recipes.length;
  matches.sort(byUse);
  weights.sort(byUse);
  unresolved.sort(byUse);

  return json({ ok: true, unresolved, matches, weights });
}

type ReviewBody = {
  action?: string;
  match_key?: string;
  name?: string;
  unit?: string | null;
  ingredient_id?: number;
  grams_per_unit?: number;
};

/** Räkna om recept utan AI så att granskade beslut slår igenom direkt. */
async function recomputeRecipes(db: D1Database, recipes: Recipe[]) {
  const out = [];
  for (const recipe of recipes) {
    const res = await resolveRecipeNutrition(db, recipe, { geminiApiKey: null });
    await db
      .prepare('UPDATE recipes SET data = ? WHERE id = ?')
      .bind(JSON.stringify(res.recipe), String(res.recipe.id))
      .run();
    await replaceRecipeIngredients(db, String(res.recipe.id), res.resolution.rows);
    out.push({ id: String(recipe.id), before: recipe.macros ?? null, after: res.recipe.macros ?? null });
  }
  return out;
}

export async function handleNutritionReviewAction(request: Request, env: Env): Promise<Response> {
  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }
  const db = env.DB;
  const catalog = await loadNutritionCatalog(db);
  const { recipes, lines } = await loadRecipeLines(db);
  const affectedIds = new Set<string>();

  if (body.action === 'approve_match' || body.action === 'set_match') {
    let key = String(body.match_key || '').trim();
    if (!key && body.name) key = matchKey(normalizeIngredientName(body.name), body.unit ?? null);
    if (!key || !key.includes('|')) return json({ error: 'Saknar match_key eller name' }, 400);
    const [namePart, cls] = key.split('|');
    if (!namePart || (cls !== 'spoon' && cls !== 'bulk')) return json({ error: 'Ogiltig match_key' }, 400);

    let ingredientId: number;
    if (body.action === 'approve_match') {
      const learned = catalog.learned.get(key);
      if (!learned) return json({ error: 'Ingen inlärd matchning för ' + key }, 404);
      ingredientId = learned.ingredient_id;
    } else {
      ingredientId = Number(body.ingredient_id);
      if (!Number.isInteger(ingredientId) || !catalog.byId.has(ingredientId)) {
        return json({ error: 'Okänt livsmedel' }, 400);
      }
    }

    const stmts = [
      db
        .prepare(
          `INSERT INTO learned_matches (match_key, ingredient_id, source, confidence, needs_review, note)
           VALUES (?, ?, 'user', 'high', 0, ?)
           ON CONFLICT(match_key) DO UPDATE SET
             ingredient_id = excluded.ingredient_id,
             source = 'user',
             confidence = 'high',
             needs_review = 0,
             updated_at = datetime('now')`
        )
        .bind(key, ingredientId, body.action === 'approve_match' ? 'Godkänd' : 'Vald manuellt'),
    ];
    // Att godkänna en matchning mot ett AI-livsmedel godkänner även livsmedlets värden.
    if (body.action === 'approve_match' && ingredientId >= CUSTOM_FOOD_ID_START) {
      stmts.push(db.prepare('UPDATE ingredients SET needs_review = 0 WHERE id = ?').bind(ingredientId));
    }
    // Omatchad styckrad: vikt kan anges samtidigt som livsmedlet väljs.
    const wUnit = String(body.unit || '').toLowerCase().trim();
    const wGrams = Number(body.grams_per_unit);
    if (body.grams_per_unit != null && wUnit && wUnit !== 'g') {
      if (!Number.isFinite(wGrams) || wGrams < 0 || wGrams > 5000) {
        return json({ error: 'Ogiltig gramvikt' }, 400);
      }
      stmts.push(
        db
          .prepare(
            `INSERT INTO learned_unit_weights (ingredient_id, unit, grams_per_unit, source, needs_review)
             VALUES (?, ?, ?, 'user', 0)
             ON CONFLICT(ingredient_id, unit) DO UPDATE SET
               grams_per_unit = excluded.grams_per_unit, source = 'user', needs_review = 0,
               updated_at = datetime('now')`
          )
          .bind(ingredientId, wUnit, wGrams)
      );
    }
    await db.batch(stmts);
    for (const l of lines) if (l.key === key) affectedIds.add(l.recipe.id);
  } else if (body.action === 'set_weight') {
    const ingredientId = Number(body.ingredient_id);
    const unit = String(body.unit || '').toLowerCase().trim();
    const grams = Number(body.grams_per_unit);
    if (!Number.isInteger(ingredientId) || !catalog.byId.has(ingredientId)) {
      return json({ error: 'Okänt livsmedel' }, 400);
    }
    if (!unit || unit === 'g') return json({ error: 'Ogiltig enhet' }, 400);
    if (!Number.isFinite(grams) || grams < 0 || grams > 5000) {
      return json({ error: 'Ogiltig gramvikt' }, 400);
    }
    await db
      .prepare(
        `INSERT INTO learned_unit_weights (ingredient_id, unit, grams_per_unit, source, needs_review)
         VALUES (?, ?, ?, 'user', 0)
         ON CONFLICT(ingredient_id, unit) DO UPDATE SET
           grams_per_unit = excluded.grams_per_unit,
           source = 'user',
           needs_review = 0,
           updated_at = datetime('now')`
      )
      .bind(ingredientId, unit, grams)
      .run();
    for (const l of lines) {
      if (l.ingredient_id === ingredientId && String(l.unit || '').toLowerCase().trim() === unit) {
        affectedIds.add(l.recipe.id);
      }
    }
  } else {
    return json({ error: 'Okänd action' }, 400);
  }

  const affected = recipes.filter((r) => affectedIds.has(String(r.id)));
  const recomputed = await recomputeRecipes(db, affected);
  return json({ ok: true, recomputed });
}
