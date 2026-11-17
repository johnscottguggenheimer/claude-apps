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
 *   { action: 'save_food', ingredient_id?, name, kcal, prot, carb, fat,
 *     assign?: { match_key? | name+unit, grams_per_unit? } }
 *     Fas 4: skapa eget livsmedel med etikettvärden per 100 g, eller ändra
 *     ett eget/AI-livsmedel (id >= 950000). SLV-rader går inte att ändra.
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

/** Rader som använder ett livsmedel: sparat ingredient_id eller inlärd matchning. */
function linesUsingFood(catalog: NutritionCatalog, lines: IngLine[], id: number): IngLine[] {
  return lines.filter((l) => l.ingredient_id === id || catalog.learned.get(l.key)?.ingredient_id === id);
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

  // Egna och AI-skapade livsmedel (fas 4): ogranskade först, sedan mest använda.
  const foods = [];
  for (const f of catalog.byId.values()) {
    if (f.id < CUSTOM_FOOD_ID_START) continue;
    foods.push({
      ...foodSummary(catalog, f.id)!,
      origin: f.source === 'user' ? 'user' : 'ai',
      recipes: uniqueRecipes(linesUsingFood(catalog, lines, f.id)),
    });
  }
  foods.sort(
    (a, b) =>
      Number(b.needs_review) - Number(a.needs_review) ||
      b.recipes.length - a.recipes.length ||
      String(a.name).localeCompare(String(b.name), 'sv')
  );

  return json({ ok: true, unresolved, matches, weights, foods });
}

type ReviewBody = {
  action?: string;
  match_key?: string;
  name?: string;
  unit?: string | null;
  ingredient_id?: number;
  grams_per_unit?: number;
  kcal?: number;
  prot?: number;
  carb?: number;
  fat?: number;
  assign?: { match_key?: string; name?: string; unit?: string | null; grams_per_unit?: number };
};

function userMatchStmt(db: D1Database, key: string, ingredientId: number, note: string) {
  return db
    .prepare(
      `INSERT INTO learned_matches (match_key, ingredient_id, source, confidence, needs_review, note)
       VALUES (?, ?, 'user', 'high', 0, ?)
       ON CONFLICT(match_key) DO UPDATE SET
         ingredient_id = excluded.ingredient_id,
         source = 'user',
         confidence = 'high',
         needs_review = 0,
         note = excluded.note,
         updated_at = datetime('now')`
    )
    .bind(key, ingredientId, note);
}

function userWeightStmt(db: D1Database, ingredientId: number, unit: string, grams: number) {
  return db
    .prepare(
      `INSERT INTO learned_unit_weights (ingredient_id, unit, grams_per_unit, source, needs_review)
       VALUES (?, ?, ?, 'user', 0)
       ON CONFLICT(ingredient_id, unit) DO UPDATE SET
         grams_per_unit = excluded.grams_per_unit,
         source = 'user',
         needs_review = 0,
         updated_at = datetime('now')`
    )
    .bind(ingredientId, unit, grams);
}

/** match_key direkt, eller byggd från name+unit. null = ogiltig. */
function resolveKey(matchKeyIn: unknown, name: unknown, unit: string | null | undefined): string | null {
  let key = String(matchKeyIn || '').trim();
  if (!key && name) key = matchKey(normalizeIngredientName(String(name)), unit ?? null);
  if (!key || !key.includes('|')) return null;
  const [namePart, cls] = key.split('|');
  if (!namePart || (cls !== 'spoon' && cls !== 'bulk')) return null;
  return key;
}

/** Valfri gramvikt för en styckenhet. undefined = ingen vikt, null = ogiltig. */
function parseWeight(unitIn: unknown, gramsIn: unknown): { unit: string; grams: number } | undefined | null {
  const unit = String(unitIn || '').toLowerCase().trim();
  if (gramsIn == null || gramsIn === '' || !unit || unit === 'g') return undefined;
  const grams = Number(gramsIn);
  if (!Number.isFinite(grams) || grams < 0 || grams > 5000) return null;
  return { unit, grams };
}

type Per100 = { kcal: number; prot: number; carb: number; fat: number };

function parsePer100(body: ReviewBody): Per100 | string {
  const vals = { kcal: Number(body.kcal), prot: Number(body.prot), carb: Number(body.carb), fat: Number(body.fat) };
  for (const [k, v] of Object.entries(vals)) {
    if (!Number.isFinite(v) || v < 0) return 'Ogiltigt värde: ' + k;
  }
  if (vals.kcal > 900) return 'Energi över 900 kcal per 100 g';
  if (vals.prot + vals.carb + vals.fat > 100.5) return 'Protein + kolhydrater + fett över 100 g per 100 g';
  return vals;
}

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
    const key = resolveKey(body.match_key, body.name, body.unit);
    if (!key) return json({ error: 'Saknar eller ogiltig match_key/name' }, 400);

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
      userMatchStmt(db, key, ingredientId, body.action === 'approve_match' ? 'Godkänd' : 'Vald manuellt'),
    ];
    // Att godkänna en matchning mot ett AI-livsmedel godkänner även livsmedlets värden.
    if (body.action === 'approve_match' && ingredientId >= CUSTOM_FOOD_ID_START) {
      stmts.push(db.prepare('UPDATE ingredients SET needs_review = 0 WHERE id = ?').bind(ingredientId));
    }
    // Omatchad styckrad: vikt kan anges samtidigt som livsmedlet väljs.
    const weight = parseWeight(body.unit, body.grams_per_unit);
    if (weight === null) return json({ error: 'Ogiltig gramvikt' }, 400);
    if (weight) stmts.push(userWeightStmt(db, ingredientId, weight.unit, weight.grams));
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
    await userWeightStmt(db, ingredientId, unit, grams).run();
    for (const l of lines) {
      if (l.ingredient_id === ingredientId && String(l.unit || '').toLowerCase().trim() === unit) {
        affectedIds.add(l.recipe.id);
      }
    }
  } else if (body.action === 'save_food') {
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) return json({ error: 'Namn saknas eller är för långt' }, 400);
    const per100 = parsePer100(body);
    if (typeof per100 === 'string') return json({ error: per100 }, 400);

    let ingredientId: number;
    const editing = body.ingredient_id != null;
    if (editing) {
      ingredientId = Number(body.ingredient_id);
      const food = catalog.byId.get(ingredientId);
      if (!Number.isInteger(ingredientId) || !food) return json({ error: 'Okänt livsmedel' }, 400);
      if (ingredientId < CUSTOM_FOOD_ID_START) {
        return json({ error: 'Livsmedel från SLV kan inte ändras. Skapa ett eget i stället.' }, 400);
      }
    } else {
      const row = await db
        .prepare('SELECT MAX(id) AS m FROM ingredients WHERE id >= ?')
        .bind(CUSTOM_FOOD_ID_START)
        .first<{ m: number | null }>();
      ingredientId = Math.max(CUSTOM_FOOD_ID_START, (row?.m ?? CUSTOM_FOOD_ID_START - 1) + 1);
    }

    const lower = name.toLowerCase();
    for (const f of catalog.byId.values()) {
      if (f.id !== ingredientId && f.canonical_name.toLowerCase() === lower) {
        return json({ error: 'Det finns redan ett livsmedel som heter ' + f.canonical_name }, 409);
      }
    }

    let assignKey: string | null = null;
    let assignWeight: { unit: string; grams: number } | undefined;
    if (body.assign) {
      assignKey = resolveKey(body.assign.match_key, body.assign.name, body.assign.unit);
      if (!assignKey) return json({ error: 'Ogiltig rad att koppla' }, 400);
      const w = parseWeight(body.assign.unit, body.assign.grams_per_unit);
      if (w === null) return json({ error: 'Ogiltig gramvikt' }, 400);
      assignWeight = w;
    }

    const stmts: D1PreparedStatement[] = [];
    if (editing) {
      const oldName = catalog.byId.get(ingredientId)!.canonical_name;
      stmts.push(
        db
          .prepare(
            `UPDATE ingredients SET canonical_name = ?, kcal_per_100g = ?, protein_per_100g = ?,
               fat_per_100g = ?, carbs_per_100g = ?, needs_review = 0, source = 'user',
               category = CASE WHEN category = 'ai_estimated' THEN 'egen' ELSE category END,
               updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(name, per100.kcal, per100.prot, per100.fat, per100.carb, ingredientId)
      );
      if (oldName.toLowerCase() !== lower) {
        // Behåll gamla namnet som alias så inlärda rader fortsätter hitta livsmedlet.
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO ingredient_aliases (ingredient_id, alias, source, needs_review)
               VALUES (?, ?, 'user', 0)`
            )
            .bind(ingredientId, lower)
        );
      }
    } else {
      stmts.push(
        db
          .prepare(
            `INSERT INTO ingredients (id, canonical_name, category, kcal_per_100g, protein_per_100g,
               fat_per_100g, carbs_per_100g, needs_review, source, updated_at)
             VALUES (?, ?, 'egen', ?, ?, ?, ?, 0, 'user', datetime('now'))`
          )
          .bind(ingredientId, name, per100.kcal, per100.prot, per100.fat, per100.carb),
        db
          .prepare(
            `INSERT OR IGNORE INTO ingredient_aliases (ingredient_id, alias, source, needs_review)
             VALUES (?, ?, 'user', 0)`
          )
          .bind(ingredientId, lower)
      );
    }
    if (assignKey) {
      stmts.push(userMatchStmt(db, assignKey, ingredientId, editing ? 'Värden ändrade' : 'Eget livsmedel'));
      if (assignWeight) stmts.push(userWeightStmt(db, ingredientId, assignWeight.unit, assignWeight.grams));
      for (const l of lines) if (l.key === assignKey) affectedIds.add(l.recipe.id);
    }
    await db.batch(stmts);
    if (editing) for (const l of linesUsingFood(catalog, lines, ingredientId)) affectedIds.add(l.recipe.id);

    const affected = recipes.filter((r) => affectedIds.has(String(r.id)));
    const recomputed = await recomputeRecipes(db, affected);
    return json({ ok: true, ingredient_id: ingredientId, recomputed });
  } else {
    return json({ error: 'Okänd action' }, 400);
  }

  const affected = recipes.filter((r) => affectedIds.has(String(r.id)));
  const recomputed = await recomputeRecipes(db, affected);
  return json({ ok: true, recomputed });
}
