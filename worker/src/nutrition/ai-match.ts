/**
 * AI-väljare (fas 1).
 *
 * För rader som inte redan har en inlärd matchning:
 *  1. Kandidater från katalogen (candidates.ts).
 *  2. Gemini väljer ett kandidat-id eller "inget", och ger alltid
 *     - gram per enhet (1 st broccoli, 1 strimla bacon …)
 *     - en egen, oberoende uppskattning av näring per 100 g.
 *  3. Rader utan val får en andra runda med AI:ns egna sökord.
 *  4. Rimlighetskontroll: valt livsmedel får inte avvika kraftigt från AI:ns
 *     egen uppskattning. Avviker det, eller finns inget val, skapas ett
 *     AI-uppskattat livsmedel (id >= 950000, needs_review = 1).
 *
 * AI:n kan aldrig skriva över SLV-värden; den väljer bland dem eller skapar
 * ett separat, märkt livsmedel.
 */
import { findCandidates } from './candidates';
import { unitWeightKey } from './catalog';
import { CUSTOM_FOOD_ID_START, matchKey } from './match';
import { normalizeIngredientName } from './normalize';
import type { IngredientRow, NutritionCatalog } from './types';

export type Per100 = { kcal: number; protein: number; fat: number; carbs: number };

export type AiLineInput = {
  /** Caller's index, echoed back. */
  idx: number;
  raw: string;
  normalized: string;
  amount: number | null;
  unit: string | null;
  /** Current deterministic match, if any (always offered as a candidate). */
  current: IngredientRow | null;
  /** Food is already trusted; only grams per unit are needed. */
  gramsOnly: boolean;
};

export type AiDecision = {
  idx: number;
  /** Existing catalog row chosen. */
  ingredient: IngredientRow | null;
  /** Food to create when nothing in the catalog fits. */
  newFood: { name: string; per100: Per100 } | null;
  gramsPerUnit: number | null;
  confidence: 'high' | 'medium' | 'low';
  needsReview: boolean;
  note: string;
  /** AI's own estimate for the food as described (for eval/debug). */
  estimate: Per100 | null;
};

type GeminiLineOut = {
  i?: number;
  choice?: number | null;
  confidence?: string;
  grams_per_unit?: number | null;
  est_per_100g?: Partial<Per100> | null;
  search?: string[] | null;
  new_name?: string | null;
};

const SYSTEM = `Du matchar ingrediensrader i svenska recept mot Livsmedelsverkets livsmedelsdatabas för att räkna makron. Noggrannhet i protein och kcal är viktigast.

Indata: JSON { "lines": [ { "i", "text", "amount", "unit", "grams_only", "candidates": [ { "id", "name", "kcal", "p", "f", "c" } ] } ] } (näring per 100 g).

Returnera ENDAST JSON: { "lines": [ { "i": number, "choice": number|null, "confidence": "high"|"medium"|"low", "grams_per_unit": number|null, "est_per_100g": { "kcal": number, "protein": number, "fat": number, "carbs": number }, "search": string[]|null, "new_name": string|null } ] }
En post per inrad, samma "i".

choice:
- id för den kandidat som bäst motsvarar livsmedlet SÅ SOM DET ANVÄNDS i receptet, annars null. Bara id från radens egna candidates.
- Tillstånd spelar roll: råvaror som mäts in före tillagning = rå/okokt (pasta, ris, linser, quinoa, kött). Men står det att ingrediensen redan är tillagad ("kokt ris", "strimlad/grillad/stekt kyckling", "förstekt bacon") = tillagad rad (eller null om ingen finns). Kikärtor/bönor i burkstorlek (ca 400 g) = konserv/kokta, inte torkade. Välj aldrig en färdigrätt när råvaran efterfrågas.
- Malet kött ("malet nötkött", "ground beef", "färs") = färs-rad med passande fetthalt (utan angiven fetthalt: ca 10 %), aldrig helt muskelkött.
- Fetthalt och variant ska stämma: "nötfärs 5%" är inte "fett 10%", "keso 1,5%" är inte "fett 4%", "grekisk yoghurt" är naturell 10 % (inte smaksatt), "vetegluten" är inte vetemjöl. Passar ingen kandidat → null.
- Närliggande ersättning är ok om makron per 100 g skiljer högst ~15 % (rödlök → gul lök, thaibasilika → basilika).
- grams_only=true: livsmedlet är redan bestämt; sätt choice till den enda kandidatens id och fokusera på grams_per_unit.

grams_per_unit: vikten i gram för EN enhet av radens unit, för just detta livsmedel. null om unit är "g".
- st = en hel styck som den köps/används (1 broccoli ≈ 400, 1 blomkål ≈ 700, 1 aubergine ≈ 300, 1 äpple ≈ 170, 1 tortillabröd ≈ 40–60, 1 vitlöksklyfta ≈ 4–5). "0.5 st" betyder halv styck — ange ändå vikten för 1 st.
- strimlor/skiva = en skiva/strimla (bacon ≈ 12–20). näve ≈ 20–40 för blad, mer för nötter. pinch ≈ 0,3–1.
- msk/tsk/dl: vikt för 1 sked/1 dl av just detta livsmedel (1 msk jordnötssmör ≈ 16, 1 msk chiafrön ≈ 12, 1 dl grädde ≈ 100).

est_per_100g: din egen oberoende uppskattning av livsmedlet så som raden beskriver det (alltid ifylld, även när du väljer en kandidat). Var realistisk; kryddor i torrform har kcal.

search: om choice är null — 1–3 sökord på Livsmedelsverkets språk för en ny sökning (t.ex. ["Kvarg", "Färskost"], ["Gris skinka lufttorkad"], ["Färskost cream cheese lätt"]). Annars null.
new_name: om choice är null — kort generiskt svenskt namn i gemener för livsmedlet (t.ex. "skyr naturell", "nötfärs 5%", "vetegluten"). Annars null.`;

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;

async function callGemini(apiKey: string, payload: unknown): Promise<GeminiLineOut[]> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  let lastErr = 'Gemini returnerade ingen text';
  for (const model of MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
    );
    if (res.status === 404 || res.status === 429 || res.status >= 500) {
      lastErr = `${model}: ${res.status}`;
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 280)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as { lines?: GeminiLineOut[] };
      return Array.isArray(parsed.lines) ? parsed.lines : [];
    } catch {
      lastErr = `${model}: ogiltig JSON`;
    }
  }
  throw new Error(lastErr);
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePer100(v: Partial<Per100> | null | undefined): Per100 | null {
  if (!v) return null;
  const kcal = num(v.kcal);
  const protein = num(v.protein);
  const fat = num(v.fat);
  const carbs = num(v.carbs);
  if (kcal == null || protein == null || fat == null || carbs == null) return null;
  return { kcal, protein, fat, carbs };
}

/** Physically plausible per-100g values. kcal may be below 4/4/9 (fiber, polyols) but not far above. */
export function validPer100(p: Per100): boolean {
  if (p.kcal < 0 || p.protein < 0 || p.fat < 0 || p.carbs < 0) return false;
  if (p.kcal > 900 || p.protein + p.fat + p.carbs > 105) return false;
  const calc = 4 * p.protein + 4 * p.carbs + 9 * p.fat;
  return p.kcal <= calc * 1.25 + 25;
}

/** Does the chosen catalog row agree with the AI's own estimate? */
export function plausible(row: IngredientRow, est: Per100): boolean {
  const dk = Math.abs(row.kcal_per_100g - est.kcal);
  const dp = Math.abs(row.protein_per_100g - est.protein);
  return dk <= Math.max(40, 0.35 * est.kcal) && dp <= Math.max(6, 0.35 * est.protein);
}

/** Sane grams-per-unit bounds; outside → ignore the AI value. */
export function validGramsPerUnit(unit: string, g: number): boolean {
  const u = unit.toLowerCase();
  const bounds: Record<string, [number, number]> = {
    st: [0.5, 3000],
    msk: [2, 40],
    tsk: [0.5, 15],
    dl: [20, 200],
    pinch: [0, 3],
    näve: [3, 120],
    strimlor: [2, 60],
  };
  const [lo, hi] = bounds[u] || [0.1, 2000];
  return g >= lo && g <= hi;
}

const CANDIDATES_PER_LINE = 10;

function candidatePayload(rows: IngredientRow[]) {
  return rows.map((r) => ({
    id: r.id,
    name: r.canonical_name,
    kcal: Math.round(r.kcal_per_100g),
    p: Math.round(r.protein_per_100g * 10) / 10,
    f: Math.round(r.fat_per_100g * 10) / 10,
    c: Math.round(r.carbs_per_100g * 10) / 10,
  }));
}

function candidateRows(
  catalog: NutritionCatalog,
  line: AiLineInput,
  extraQueries: string[]
): IngredientRow[] {
  if (line.gramsOnly && line.current) return [line.current];
  const rows: IngredientRow[] = [];
  const seen = new Set<number>();
  const push = (r: IngredientRow) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    rows.push(r);
  };
  if (line.current) push(line.current);
  const queries = extraQueries.length ? extraQueries : [line.raw.toLowerCase()];
  const base = extraQueries.length ? extraQueries[0] : line.normalized;
  for (const c of findCandidates(catalog, base, CANDIDATES_PER_LINE, queries)) push(c.row);
  return rows.slice(0, CANDIDATES_PER_LINE + 1);
}

function confidenceOf(v: unknown): 'high' | 'medium' | 'low' {
  return v === 'high' || v === 'medium' ? v : 'low';
}

/** Run the picker (max two Gemini calls). Pure w.r.t. DB. */
export async function aiResolveLines(
  apiKey: string,
  catalog: NutritionCatalog,
  lines: AiLineInput[]
): Promise<AiDecision[]> {
  if (!lines.length) return [];

  const candById = new Map<number, IngredientRow[]>();
  const round1 = lines.map((l) => {
    const cands = candidateRows(catalog, l, []);
    candById.set(l.idx, cands);
    return {
      i: l.idx,
      text: l.raw,
      amount: l.amount,
      unit: l.unit,
      grams_only: l.gramsOnly,
      candidates: candidatePayload(cands),
    };
  });

  const out1 = await callGemini(apiKey, { lines: round1 });
  const byIdx = new Map<number, GeminiLineOut>();
  for (const o of out1) if (o && num(o.i) != null) byIdx.set(Number(o.i), o);

  // Round 2: lines without a choice but with search terms.
  const retry = lines.filter((l) => {
    const o = byIdx.get(l.idx);
    return !l.gramsOnly && o && o.choice == null && Array.isArray(o.search) && o.search.length;
  });
  if (retry.length) {
    const round2 = retry.map((l) => {
      const terms = (byIdx.get(l.idx)!.search || [])
        .map((s) => String(s).toLowerCase().trim())
        .filter(Boolean)
        .slice(0, 3);
      const cands = candidateRows(catalog, { ...l, current: null }, terms);
      candById.set(l.idx, cands);
      return {
        i: l.idx,
        text: l.raw,
        amount: l.amount,
        unit: l.unit,
        grams_only: false,
        candidates: candidatePayload(cands),
      };
    });
    try {
      const out2 = await callGemini(apiKey, { lines: round2 });
      for (const o of out2) {
        if (!o || num(o.i) == null) continue;
        const prev = byIdx.get(Number(o.i));
        // Keep round-1 estimate/grams if round 2 omitted them.
        byIdx.set(Number(o.i), {
          ...prev,
          ...o,
          est_per_100g: o.est_per_100g ?? prev?.est_per_100g,
          grams_per_unit: o.grams_per_unit ?? prev?.grams_per_unit,
          new_name: o.new_name ?? prev?.new_name,
        });
      }
    } catch {
      // Round 2 is best effort; fall through to new-food creation.
    }
  }

  const decisions: AiDecision[] = [];
  for (const l of lines) {
    const o = byIdx.get(l.idx);
    if (!o) continue;
    const confidence = confidenceOf(o.confidence);
    const est = parsePer100(o.est_per_100g);
    const unit = String(l.unit || '').toLowerCase();
    const gpu = num(o.grams_per_unit);
    const gramsPerUnit =
      unit && unit !== 'g' && gpu != null && validGramsPerUnit(unit, gpu) ? gpu : null;

    const allowed = candById.get(l.idx) || [];
    const choiceId = num(o.choice);
    const chosen = choiceId != null ? allowed.find((r) => r.id === choiceId) || null : null;

    if (l.gramsOnly) {
      decisions.push({
        idx: l.idx,
        ingredient: l.current,
        newFood: null,
        gramsPerUnit,
        confidence,
        needsReview: confidence === 'low',
        note: 'grams',
        estimate: est,
      });
      continue;
    }

    if (chosen && (!est || plausible(chosen, est))) {
      decisions.push({
        idx: l.idx,
        ingredient: chosen,
        newFood: null,
        gramsPerUnit,
        confidence,
        needsReview: confidence === 'low' || !est,
        note: chosen.id === l.current?.id ? 'confirmed' : 'picked',
        estimate: est,
      });
      continue;
    }

    // Nothing fits, or the pick contradicts the AI's own estimate → new food.
    const name = normalizeIngredientName(String(o.new_name || l.normalized || l.raw)) || l.normalized;
    if (est && validPer100(est) && name) {
      decisions.push({
        idx: l.idx,
        ingredient: null,
        newFood: { name, per100: est },
        gramsPerUnit,
        confidence: 'low',
        needsReview: true,
        note: chosen
          ? `implausible:${chosen.id}:${chosen.canonical_name}`
          : 'no_candidate',
        estimate: est,
      });
    } else if (chosen) {
      // Estimate unusable — keep the pick but flag it.
      decisions.push({
        idx: l.idx,
        ingredient: chosen,
        newFood: null,
        gramsPerUnit,
        confidence: 'low',
        needsReview: true,
        note: 'picked_unverified',
        estimate: est,
      });
    }
  }
  return decisions;
}

// ---------- applying decisions ----------

function round1dp(n: number): number {
  return Math.round(n * 10) / 10;
}

function customFoodRow(id: number, name: string, p: Per100): IngredientRow {
  return {
    id,
    canonical_name: name,
    category: 'ai_estimated',
    kcal_per_100g: round1dp(p.kcal),
    protein_per_100g: round1dp(p.protein),
    fat_per_100g: round1dp(p.fat),
    carbs_per_100g: round1dp(p.carbs),
    piece_weight_g: null,
    density_g_per_ml: null,
    needs_review: 1,
    piece_weight_source: null,
    source: 'ai',
  };
}

/**
 * Patch the in-memory catalog with decisions (so a re-resolve uses them) and,
 * when `db` is given, persist them as learned rows. Never overwrites user rows.
 */
export async function applyAiDecisions(
  db: D1Database | null,
  catalog: NutritionCatalog,
  lines: AiLineInput[],
  decisions: AiDecision[]
): Promise<{ learned: number; created: number; unitWeights: number }> {
  const lineByIdx = new Map(lines.map((l) => [l.idx, l]));
  const stmts: D1PreparedStatement[] = [];
  let learned = 0;
  let created = 0;
  let unitWeights = 0;

  const createdByName = new Map<string, IngredientRow>();
  let nextTempId = 990000;
  let nextDbId: number | null = null;
  if (db && decisions.some((d) => d.newFood)) {
    const row = await db
      .prepare('SELECT MAX(id) AS m FROM ingredients WHERE id >= ?')
      .bind(CUSTOM_FOOD_ID_START)
      .first<{ m: number | null }>();
    nextDbId = Math.max(CUSTOM_FOOD_ID_START, (row?.m ?? CUSTOM_FOOD_ID_START - 1) + 1);
  }

  for (const d of decisions) {
    const line = lineByIdx.get(d.idx);
    if (!line) continue;
    let ingredient = d.ingredient;

    if (d.newFood) {
      // Reuse an earlier AI/user food with the same name (no duplicates).
      // Never reuse a seed row by alias — that alias may be the very mismatch.
      const aliasHit = catalog.byAlias.get(d.newFood.name);
      const existing =
        createdByName.get(d.newFood.name) ||
        (aliasHit && aliasHit.id >= CUSTOM_FOOD_ID_START ? aliasHit : null);
      if (existing) {
        ingredient = existing;
      } else {
        const id = db ? nextDbId!++ : nextTempId++;
        const taken = [...catalog.byId.values()].some(
          (r) => r.canonical_name.toLowerCase() === d.newFood!.name
        );
        const name = taken ? d.newFood.name + ' (uppskattad)' : d.newFood.name;
        ingredient = customFoodRow(id, name, d.newFood.per100);
        catalog.byId.set(id, ingredient);
        catalog.byAlias.set(ingredient.canonical_name, ingredient);
        createdByName.set(d.newFood.name, ingredient);
        created += 1;
        if (db) {
          stmts.push(
            db
              .prepare(
                `INSERT OR IGNORE INTO ingredients (id, canonical_name, category, kcal_per_100g,
                   protein_per_100g, fat_per_100g, carbs_per_100g, needs_review, source)
                 VALUES (?, ?, 'ai_estimated', ?, ?, ?, ?, 1, 'ai')`
              )
              .bind(
                id,
                ingredient.canonical_name,
                ingredient.kcal_per_100g,
                ingredient.protein_per_100g,
                ingredient.fat_per_100g,
                ingredient.carbs_per_100g
              ),
            db
              .prepare(
                `INSERT OR IGNORE INTO ingredient_aliases (ingredient_id, alias, source, needs_review)
                 VALUES (?, ?, 'ai', 1)`
              )
              .bind(id, ingredient.canonical_name)
          );
        }
      }
    }
    if (!ingredient) continue;

    if (!line.gramsOnly && line.normalized) {
      const key = matchKey(line.normalized, line.unit);
      const prev = catalog.learned.get(key);
      if (!prev || prev.source !== 'user') {
        catalog.learned.set(key, {
          ingredient_id: ingredient.id,
          source: 'ai',
          confidence: d.confidence,
          needs_review: d.needsReview ? 1 : 0,
        });
        learned += 1;
        if (db) {
          stmts.push(
            db
              .prepare(
                `INSERT INTO learned_matches (match_key, ingredient_id, source, confidence, needs_review, note)
                 VALUES (?, ?, 'ai', ?, ?, ?)
                 ON CONFLICT(match_key) DO UPDATE SET
                   ingredient_id = excluded.ingredient_id,
                   confidence = excluded.confidence,
                   needs_review = excluded.needs_review,
                   note = excluded.note,
                   updated_at = datetime('now')
                 WHERE learned_matches.source != 'user'`
              )
              .bind(key, ingredient.id, d.confidence, d.needsReview ? 1 : 0, d.note.slice(0, 200))
          );
        }
      }
    }

    const unit = String(line.unit || '').toLowerCase();
    if (d.gramsPerUnit != null && unit && unit !== 'g') {
      const wKey = unitWeightKey(ingredient.id, unit);
      const prev = catalog.unitWeights.get(wKey);
      if (!prev || prev.source !== 'user') {
        const review = d.confidence === 'low' ? 1 : 0;
        catalog.unitWeights.set(wKey, {
          grams_per_unit: d.gramsPerUnit,
          source: 'ai',
          needs_review: review,
        });
        unitWeights += 1;
        if (db) {
          stmts.push(
            db
              .prepare(
                `INSERT INTO learned_unit_weights (ingredient_id, unit, grams_per_unit, source, needs_review)
                 VALUES (?, ?, ?, 'ai', ?)
                 ON CONFLICT(ingredient_id, unit) DO UPDATE SET
                   grams_per_unit = excluded.grams_per_unit,
                   needs_review = excluded.needs_review,
                   updated_at = datetime('now')
                 WHERE learned_unit_weights.source != 'user'`
              )
              .bind(ingredient.id, unit, d.gramsPerUnit, review)
          );
        }
      }
    }
  }

  if (db && stmts.length) await db.batch(stmts);
  return { learned, created, unitWeights };
}
