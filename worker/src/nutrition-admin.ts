/**
 * Admin-endpoints för näringsmatchning (kräver inloggning).
 *
 * POST /api/nutrition/dry-run        { lines: [{ name, amount, unit }] }
 *   Kör hela pipelinen (inkl. AI-väljare) utan att lära in något. För mätning.
 *
 * POST /api/nutrition/reresolve      { ids?: string[], offset?: number, limit?: number, dryRun?: boolean }
 *   Räknar om befintliga recept med AI-väljaren och sparar (om inte dryRun).
 *   Batchas av klienten för att hålla nere antal subrequests per anrop.
 */
import { getRecipe } from './db';
import {
  CUSTOM_FOOD_ID_START,
  nutritionGateError,
  replaceRecipeIngredients,
  resolveRecipeNutrition,
} from './nutrition';
import type { Recipe } from './validate';

type Env = { DB: D1Database; GEMINI_API_KEY?: string };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function key(env: Env): string | null {
  const k = env.GEMINI_API_KEY;
  return k && String(k).trim() ? String(k).trim() : null;
}

export async function handleNutritionDryRun(request: Request, env: Env): Promise<Response> {
  let body: { lines?: { name?: string; amount?: number; unit?: string }[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }
  const lines = (body.lines || []).slice(0, 120);
  if (!lines.length) return json({ error: 'Saknar lines' }, 400);
  const aiKey = key(env);
  if (!aiKey) return json({ error: 'GEMINI_API_KEY saknas' }, 503);

  // Chunk so each Gemini call stays a reasonable size.
  const CHUNK = 30;
  const rows: unknown[] = [];
  const errors: string[] = [];
  for (let start = 0; start < lines.length; start += CHUNK) {
    const part = lines.slice(start, start + CHUNK);
    const recipe: Recipe = {
      id: 'dry-run',
      groups: [{ name: 'x', ingredients: part.map((l) => ({ ...l })) }],
    };
    const res = await resolveRecipeNutrition(env.DB, recipe, { geminiApiKey: aiKey, learn: false });
    if (res.ai?.error) errors.push(res.ai.error);
    const decisionByIdx = new Map((res.decisions || []).map((d) => [d.idx, d]));
    res.resolution.rows.forEach((r, i) => {
      const food = r.ingredient_id != null ? res.catalog?.byId.get(r.ingredient_id) : undefined;
      const d = decisionByIdx.get(i);
      rows.push({
        raw: r.raw_text,
        canonical_name: r.canonical_name,
        ingredient_id: r.ingredient_id,
        resolved_grams: r.resolved_grams,
        grams_source: r.grams_source,
        match_method: r.match_method,
        needs_review: !!r.needs_review,
        created: !!food && (food.source === 'ai' || food.id >= CUSTOM_FOOD_ID_START),
        per100: food
          ? {
              kcal: food.kcal_per_100g,
              protein: food.protein_per_100g,
              fat: food.fat_per_100g,
              carbs: food.carbs_per_100g,
            }
          : null,
        ai: d
          ? { note: d.note, confidence: d.confidence, grams_per_unit: d.gramsPerUnit, estimate: d.estimate }
          : null,
      });
    });
  }
  return json({ ok: true, rows, errors });
}

type LineDiff = {
  raw: string;
  before: string;
  after: string;
};

function lineSummary(ing: Record<string, unknown> | undefined, names: Map<number, string>): string {
  if (!ing) return '–';
  const id = typeof ing.ingredient_id === 'number' ? ing.ingredient_id : null;
  const name = id != null ? names.get(id) ?? `#${id}` : '–';
  const g = typeof ing.resolved_grams === 'number' ? Math.round(ing.resolved_grams) : null;
  const kcal = (ing.macros as { kcal?: number } | undefined)?.kcal;
  return `${name} ${g ?? '?'} g ${kcal ?? '?'} kcal`;
}

export async function handleNutritionReresolve(request: Request, env: Env): Promise<Response> {
  let body: { ids?: string[]; offset?: number; limit?: number; dryRun?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const aiKey = key(env);
  if (!aiKey) return json({ error: 'GEMINI_API_KEY saknas' }, 503);

  // Only ids are sorted here; recipe JSON is parsed just for the selected slice.
  const idRows = await env.DB.prepare('SELECT id FROM recipes ORDER BY id').all<{ id: string }>();
  let ids = (idRows.results || []).map((r) => r.id);
  if (body.ids?.length) ids = ids.filter((id) => body.ids!.includes(id));
  const total = ids.length;
  const offset = Math.max(0, Number(body.offset) || 0);
  const limit = Math.min(10, Math.max(1, Number(body.limit) || 4));
  const selected: Recipe[] = [];
  for (const id of ids.slice(offset, offset + limit)) {
    const r = await getRecipe(env.DB, id);
    if (r) selected.push(r);
  }
  const dryRun = !!body.dryRun;

  const results = [];
  for (const recipe of selected) {
    const res = await resolveRecipeNutrition(env.DB, recipe, {
      geminiApiKey: aiKey,
      learn: !dryRun,
    });
    const names = new Map<number, string>();
    for (const row of res.catalog?.byId.values() || []) names.set(row.id, row.canonical_name);

    const diffs: LineDiff[] = [];
    const oldGroups = (recipe.groups || []) as { ingredients?: Record<string, unknown>[] }[];
    const newGroups = (res.recipe.groups || []) as { ingredients?: Record<string, unknown>[] }[];
    newGroups.forEach((g, gi) =>
      (g.ingredients || []).forEach((ing, ii) => {
        const prev = oldGroups[gi]?.ingredients?.[ii];
        const before = lineSummary(prev, names);
        const after = lineSummary(ing, names);
        if (before !== after) diffs.push({ raw: String(ing.name || ''), before, after });
      })
    );

    const gate = nutritionGateError(res.resolution);
    let saved = false;
    if (!dryRun && !gate) {
      // Keep updated_at so the list order doesn't change.
      await env.DB.prepare('UPDATE recipes SET data = ? WHERE id = ?')
        .bind(JSON.stringify(res.recipe), String(res.recipe.id))
        .run();
      await replaceRecipeIngredients(env.DB, String(res.recipe.id), res.resolution.rows);
      saved = true;
    }
    results.push({
      id: recipe.id,
      before: recipe.macros,
      after: res.recipe.macros,
      ai: res.ai,
      unresolved: gate?.unresolved.length ?? 0,
      saved,
      diffs,
    });
  }

  return json({
    ok: true,
    total,
    offset,
    next: offset + selected.length < total ? offset + selected.length : null,
    results,
  });
}
