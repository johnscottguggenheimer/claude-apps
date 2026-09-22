/**
 * AI piece-weight estimation — returns grams only, never macros.
 * Results are cached on ingredients with source='ai_estimated', needs_review=1.
 */
import type { IngredientRow, NutritionCatalog } from './types';
import { schablonPieceWeightG } from './piece-defaults';

type GeminiPart = { text?: string };

async function geminiJsonSimple(apiKey: string, parts: GeminiPart[], system: string): Promise<string> {
  const models = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] as const;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  let lastErr = 'Gemini returnerade ingen text';
  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
    );
    if (res.status === 404 || res.status === 429) {
      lastErr = `${model}: ${res.status}`;
      continue;
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 280)}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text;
  }
  throw new Error(lastErr);
}

const SYSTEM = `Du uppskattar typisk styckvikt i gram för råvaror i svensk matlagning.
Returnera ENDAST JSON: { "weights": [ { "id": number, "piece_weight_g": number } ] }
- piece_weight_g = typisk vikt för 1 st (hel råvara som köps/används, t.ex. 1 paprika, 1 ägg, 1 lasagneplatta).
- Endast id från den givna listan.
- Inga näringsvärden. Inga andra fält.
- Rimliga intervall: vitlöksklyfta 2–5 g, salladslök 10–25 g, gul lök 80–150 g, paprika 100–200 g, ägg 50–65 g, lasagneplatta 15–25 g.`;

export type PieceWeightEstimate = { id: number; piece_weight_g: number };

/** Batch-estimate piece weights for catalog rows missing piece_weight_g. */
export async function estimatePieceWeightsAi(
  apiKey: string,
  ingredients: IngredientRow[]
): Promise<PieceWeightEstimate[]> {
  if (!ingredients.length) return [];
  const payload = ingredients.map((i) => ({
    id: i.id,
    name: i.canonical_name,
    schablon_hint_g: schablonPieceWeightG(i.canonical_name),
  }));
  const raw = await geminiJsonSimple(
    apiKey,
    [{ text: JSON.stringify({ ingredients: payload }) }],
    SYSTEM
  );
  let parsed: { weights?: { id?: number; piece_weight_g?: number }[] };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return [];
  }
  const allowed = new Set(ingredients.map((i) => i.id));
  const out: PieceWeightEstimate[] = [];
  for (const w of parsed.weights || []) {
    const id = Number(w.id);
    const g = Number(w.piece_weight_g);
    if (!allowed.has(id) || !Number.isFinite(g) || g <= 0 || g > 2000) continue;
    out.push({ id, piece_weight_g: Math.round(g * 10) / 10 });
  }
  return out;
}

/** Persist AI piece weights; mark needs_review=1. Patches in-memory catalog too. */
export async function cachePieceWeights(
  db: D1Database,
  catalog: NutritionCatalog,
  estimates: PieceWeightEstimate[]
): Promise<number> {
  if (!estimates.length) return 0;
  const stmts = estimates.map((e) =>
    db
      .prepare(
        `UPDATE ingredients
         SET piece_weight_g = ?, piece_weight_source = 'ai_estimated', needs_review = 1
         WHERE id = ? AND (piece_weight_g IS NULL OR piece_weight_g <= 0)`
      )
      .bind(e.piece_weight_g, e.id)
  );
  await db.batch(stmts);

  for (const e of estimates) {
    const row = catalog.byId.get(e.id);
    if (!row) continue;
    if (row.piece_weight_g != null && row.piece_weight_g > 0) continue;
    row.piece_weight_g = e.piece_weight_g;
    row.piece_weight_source = 'ai_estimated';
    row.needs_review = 1;
  }
  return estimates.length;
}
