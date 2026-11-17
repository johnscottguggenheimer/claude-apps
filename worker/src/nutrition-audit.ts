/**
 * Kontroll av receptens makron (kräver inloggning).
 *
 * Tre lager:
 *  1. Regler (deterministiska, körs live): rader utan data, orimliga gram per
 *     enhet, 0 kcal på riktiga livsmedel, gamla makron, kcal per portion.
 *  2. Oberoende AI-bedömning: Gemini får bara receptets text (ingredienser,
 *     steg, portioner), inte våra värden, och uppskattar gram och makron per
 *     rad. Raderna jämförs en och en. Sparas i recipe_checks.
 *  3. Stämpel: John markerar receptet som kontrollerat. Stämpeln gäller
 *     ingredienslistans hash och släpper när ingredienserna ändras.
 *
 * GET  /api/nutrition/audit
 * POST /api/nutrition/audit { action: 'check' | 'verify' | 'unverify', recipe_id }
 */
import { loadNutritionCatalog } from './nutrition';
import type { NutritionCatalog } from './nutrition';
import type { Recipe } from './validate';

type Env = { DB: D1Database; GEMINI_API_KEY?: string };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

type Macros = { kcal: number; prot: number; carb: number; fat: number };

type Row = {
  i: number;
  group: string;
  name: string;
  amount: number | null;
  unit: string | null;
  grams: number | null;
  food: string | null;
  status: string | null;
  macros: Macros | null;
};

type Issue = { row: number | null; level: 'error' | 'warn' | 'info'; text: string };

type AiRow = { i: number; grams: number | null; kcal: number; prot: number; carb: number; fat: number; note?: string | null };

type CheckRow = {
  recipe_id: string;
  ingredients_hash: string;
  our_kcal: number | null;
  our_prot: number | null;
  ai_kcal: number | null;
  ai_prot: number | null;
  ai_carb: number | null;
  ai_fat: number | null;
  ai_rows: string | null;
  ai_summary: string | null;
  checked_at: string | null;
  verified_hash: string | null;
  verified_at: string | null;
};

// Tröskelvärden för när AI och vi anses vara oense.
const RECIPE_KCAL_TOL = 0.1;
const RECIPE_PROT_TOL = 0.12;
const ROW_KCAL_ABS = 40;
const ROW_KCAL_REL = 0.35;
const ROW_PROT_ABS = 5;

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function macrosOf(v: unknown): Macros | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  const kcal = num(m.kcal);
  if (kcal == null) return null;
  return { kcal, prot: num(m.prot) ?? 0, carb: num(m.carb) ?? 0, fat: num(m.fat) ?? 0 };
}

function flattenRows(r: Recipe, catalog: NutritionCatalog): Row[] {
  const rows: Row[] = [];
  let i = 0;
  for (const g of (r.groups || []) as { name?: string; ingredients?: Record<string, unknown>[] }[]) {
    for (const ing of g.ingredients || []) {
      const id = num(ing.ingredient_id);
      rows.push({
        i: i++,
        group: String(g.name || ''),
        name: String(ing.name || '').trim(),
        amount: num(ing.amount),
        unit: ing.unit != null ? String(ing.unit) : null,
        grams: num(ing.resolved_grams),
        food: id != null ? catalog.byId.get(id)?.canonical_name ?? '#' + id : null,
        status: typeof ing.match_status === 'string' ? ing.match_status : null,
        macros: macrosOf(ing.macros),
      });
    }
  }
  return rows;
}

/** Hash av det som avgör makrona: portioner + ingrediensnamn, mängd, enhet. */
async function ingredientsHash(r: Recipe): Promise<string> {
  const groups = ((r.groups || []) as { ingredients?: Record<string, unknown>[] }[]).map((g) =>
    (g.ingredients || []).map((i) => [String(i.name || '').trim().toLowerCase(), i.amount ?? null, i.unit ?? null])
  );
  const data = new TextEncoder().encode(JSON.stringify([r.baseServings ?? null, groups]));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Rader där 0 kcal är rätt.
const ZERO_OK = /vatten|salt\b|^salt|\bis\b|isbitar|vinäger|kaffe|espresso|\bte\b|sötningsmedel|stevia|monk ?fruit|erytritol|bikarbonat|bakpulver|pocherings|lag\b|lake\b|kolsyrat/;

function ruleIssues(r: Recipe, rows: Row[]): Issue[] {
  const out: Issue[] = [];
  for (const row of rows) {
    if (row.status === 'unmatched' || row.status === 'needs_piece_weight') {
      out.push({ row: row.i, level: 'error', text: 'Saknar näringsdata — räknas inte med' });
      continue;
    }
    const unit = String(row.unit || '').toLowerCase().trim();
    if (row.grams != null && row.amount) {
      const per = row.grams / row.amount;
      const bad =
        (unit === 'st' && (per > 400 || per < 1)) ||
        (unit === 'msk' && (per < 4 || per > 25)) ||
        (unit === 'tsk' && (per < 1 || per > 8)) ||
        (unit === 'dl' && (per < 25 || per > 130)) ||
        ((unit === 'pinch' || unit === 'nypa') && per > 2);
      if (bad) out.push({ row: row.i, level: 'warn', text: Math.round(per * 10) / 10 + ' g per ' + unit + ' verkar orimligt' });
    }
    if (row.grams != null && row.grams >= 20 && row.macros && row.macros.kcal < 1 && !ZERO_OK.test(row.name.toLowerCase())) {
      out.push({ row: row.i, level: 'warn', text: '0 kcal för ' + Math.round(row.grams) + ' g' });
    }
  }

  const m = macrosOf(r.macros);
  if (m) {
    const sum = rows.reduce((s, x) => s + (x.macros?.kcal ?? 0), 0);
    if (Math.abs(sum - m.kcal) > Math.max(15, 0.02 * sum)) {
      out.push({ row: null, level: 'warn', text: 'Receptets makron (' + Math.round(m.kcal) + ' kcal) stämmer inte med raderna (' + Math.round(sum) + ' kcal) — räkna om' });
    }
    const calc = 4 * (m.prot + m.carb) + 9 * m.fat;
    if (m.kcal > 0 && Math.abs(calc - m.kcal) > 0.1 * m.kcal) {
      out.push({ row: null, level: 'info', text: 'kcal avviker från protein/kolhydrater/fett (≈ ' + Math.round(calc) + ' kcal) — t.ex. fibrer eller sockeralkoholer' });
    }
    const servings = num(r.baseServings) || 1;
    const per = m.kcal / servings;
    if (per > 1100) out.push({ row: null, level: 'info', text: Math.round(per) + ' kcal per portion — stämmer antal portioner (' + servings + ')?' });
  }
  return out;
}

const AI_SYSTEM = `Du är en noggrann svensk kostekonom. Du får ett recept (titel, portioner, ingredienser med index, steg).
Uppskatta OBEROENDE för varje ingrediensrad: gram och kcal, protein, kolhydrater och fett för den mängd som faktiskt äts i receptet.

Regler:
- Läs stegen för att avgöra om mängden är rå/okokt eller kokt/tillagad (t.ex. "koka riset" = mängden är okokt).
- Om en vätska kasseras (inläggningslag, pocheringsvatten, frityrolja, marinad som hälls bort) räkna bara det som äts och skriv det i note.
- Använd vanliga svenska butiksprodukter och Livsmedelsverkets värden som referens. Vid fetthalt i namnet (keso 1,5%, nötfärs 5%) gäller den.
- "st" = typisk styckvikt för livsmedlet (1 ägg ≈ 55 g utan skal, 1 gul lök ≈ 100 g, 1 vitlöksklyfta ≈ 3–5 g).
- Sötningsmedel av erytritol/stevia/monk fruit = 0 kcal och 0 g kolhydrater.
- note: bara när något är tvetydigt eller sannolikt fel i receptet (kort, svenska). Annars null.

Svara ENDAST med JSON:
{"rows":[{"i":0,"grams":100,"kcal":0,"prot":0,"carb":0,"fat":0,"note":null}],"summary":"1–2 meningar om vad som är osäkert i receptet, annars tom sträng"}`;

const AI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;

async function aiEstimate(apiKey: string, r: Recipe, rows: Row[]): Promise<{ rows: AiRow[]; summary: string }> {
  const payload = {
    title: r.title,
    servings: r.baseServings,
    ingredients: rows.map((x) => ({ i: x.i, group: x.group, name: x.name, amount: x.amount, unit: x.unit })),
    steps: ((r.steps || []) as { title?: string; text?: string }[]).map((s) => [s.title, s.text].filter(Boolean).join(': ')),
  };
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: AI_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0, thinkingConfig: { thinkingBudget: 1024 } },
  });
  let lastErr = 'Gemini returnerade ingen text';
  for (const model of AI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
    );
    if (res.status === 404 || res.status === 429 || res.status >= 500) {
      lastErr = `${model}: ${res.status}`;
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 280)}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    try {
      const parsed = JSON.parse(text) as { rows?: Record<string, unknown>[]; summary?: string };
      const out: AiRow[] = [];
      for (const x of parsed.rows || []) {
        const i = num(x.i);
        if (i == null || i < 0 || i >= rows.length) continue;
        out.push({
          i,
          grams: num(x.grams),
          kcal: num(x.kcal) ?? 0,
          prot: num(x.prot) ?? 0,
          carb: num(x.carb) ?? 0,
          fat: num(x.fat) ?? 0,
          note: typeof x.note === 'string' && x.note.trim() ? x.note.trim() : null,
        });
      }
      if (out.length < rows.length * 0.8) {
        lastErr = `${model}: ofullständigt svar`;
        continue;
      }
      return { rows: out, summary: String(parsed.summary || '').trim() };
    } catch {
      lastErr = `${model}: ogiltig JSON`;
    }
  }
  throw new Error(lastErr);
}

function sumAi(rows: AiRow[]): Macros {
  return rows.reduce(
    (s, x) => ({ kcal: s.kcal + x.kcal, prot: s.prot + x.prot, carb: s.carb + x.carb, fat: s.fat + x.fat }),
    { kcal: 0, prot: 0, carb: 0, fat: 0 }
  );
}

function relDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
}

/** Rader där AI och vi skiljer sig tydligt, störst skillnad först. */
function rowDisagreements(rows: Row[], ai: AiRow[]) {
  const byI = new Map(ai.map((x) => [x.i, x]));
  const out = [];
  for (const row of rows) {
    const a = byI.get(row.i);
    if (!a) continue;
    const ours = row.macros?.kcal ?? 0;
    const oursP = row.macros?.prot ?? 0;
    const dk = Math.abs(ours - a.kcal);
    const dp = Math.abs(oursP - a.prot);
    const kcalOff = dk > ROW_KCAL_ABS && dk > ROW_KCAL_REL * Math.max(ours, a.kcal);
    const protOff = dp > ROW_PROT_ABS && dp > ROW_KCAL_REL * Math.max(oursP, a.prot);
    if (!kcalOff && !protOff && !a.note) continue;
    out.push({
      i: row.i,
      name: row.name,
      amount: row.amount,
      unit: row.unit,
      food: row.food,
      ours: { grams: row.grams, kcal: Math.round(ours), prot: Math.round(oursP) },
      ai: { grams: a.grams, kcal: Math.round(a.kcal), prot: Math.round(a.prot) },
      note: a.note,
      off: kcalOff || protOff,
      delta: dk,
    });
  }
  out.sort((x, y) => Number(y.off) - Number(x.off) || y.delta - x.delta);
  return out;
}

type Status = 'verified' | 'flagged' | 'ok' | 'unchecked' | 'stale';

async function buildItem(r: Recipe, catalog: NutritionCatalog, check: CheckRow | undefined) {
  const rows = flattenRows(r, catalog);
  const hash = await ingredientsHash(r);
  const issues = ruleIssues(r, rows);
  const m = macrosOf(r.macros);

  let ai = null;
  let aiOff = false;
  let rowsOff = 0;
  if (check && check.ai_kcal != null && check.ingredients_hash === hash) {
    let aiRows: AiRow[] = [];
    try {
      aiRows = JSON.parse(check.ai_rows || '[]') as AiRow[];
    } catch {
      aiRows = [];
    }
    const diffs = rowDisagreements(rows, aiRows);
    rowsOff = diffs.filter((d) => d.off).length;
    const kcalDiff = m ? relDiff(m.kcal, check.ai_kcal) : 1;
    const protDiff = m ? relDiff(m.prot, check.ai_prot ?? 0) : 1;
    aiOff = kcalDiff > RECIPE_KCAL_TOL || protDiff > RECIPE_PROT_TOL;
    ai = {
      kcal: Math.round(check.ai_kcal),
      prot: Math.round(check.ai_prot ?? 0),
      carb: Math.round(check.ai_carb ?? 0),
      fat: Math.round(check.ai_fat ?? 0),
      kcal_diff_pct: Math.round(((check.ai_kcal - (m?.kcal ?? 0)) / Math.max(1, m?.kcal ?? 1)) * 100),
      prot_diff_pct: Math.round((((check.ai_prot ?? 0) - (m?.prot ?? 0)) / Math.max(1, m?.prot ?? 1)) * 100),
      summary: check.ai_summary || '',
      rows: diffs,
      checked_at: check.checked_at,
    };
  }

  const verified = !!check?.verified_hash && check.verified_hash === hash;
  const hasErrors = issues.some((x) => x.level !== 'info');
  let status: Status;
  if (verified) status = 'verified';
  else if (check && check.ingredients_hash !== hash && check.ai_kcal != null) status = 'stale';
  else if (!ai) status = hasErrors ? 'flagged' : 'unchecked';
  else status = aiOff || rowsOff > 0 || hasErrors ? 'flagged' : 'ok';

  return {
    id: String(r.id),
    title: String(r.title || r.id),
    servings: num(r.baseServings) || 1,
    macros: m,
    hash,
    status,
    issues: issues.map((x) => ({ ...x, name: x.row != null ? rows[x.row]?.name ?? null : null })),
    ai,
    verified_at: verified ? check?.verified_at ?? null : null,
    was_verified: !!check?.verified_hash && !verified,
  };
}

async function loadChecks(db: D1Database): Promise<Map<string, CheckRow>> {
  try {
    const res = await db.prepare('SELECT * FROM recipe_checks').all<CheckRow>();
    return new Map((res.results || []).map((c) => [c.recipe_id, c]));
  } catch {
    return new Map(); // 0007 inte körd
  }
}

async function loadRecipe(db: D1Database, id: string): Promise<Recipe | null> {
  const row = await db.prepare('SELECT data FROM recipes WHERE id = ?').bind(id).first<{ data: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.data) as Recipe;
  } catch {
    return null;
  }
}

const STATUS_ORDER: Record<Status, number> = { flagged: 0, stale: 1, unchecked: 2, ok: 3, verified: 4 };

export async function handleNutritionAuditList(env: Env): Promise<Response> {
  const catalog = await loadNutritionCatalog(env.DB);
  const checks = await loadChecks(env.DB);
  const res = await env.DB.prepare('SELECT data FROM recipes').all<{ data: string }>();
  const items = [];
  for (const row of res.results || []) {
    let r: Recipe;
    try {
      r = JSON.parse(row.data) as Recipe;
    } catch {
      continue;
    }
    items.push(await buildItem(r, catalog, checks.get(String(r.id))));
  }
  items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title, 'sv'));
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;
  return json({ ok: true, counts, recipes: items, ai_available: !!env.GEMINI_API_KEY });
}

export async function handleNutritionAuditAction(request: Request, env: Env): Promise<Response> {
  let body: { action?: string; recipe_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }
  const id = String(body.recipe_id || '');
  const recipe = id ? await loadRecipe(env.DB, id) : null;
  if (!recipe) return json({ error: 'Okänt recept' }, 404);
  const catalog = await loadNutritionCatalog(env.DB);
  const hash = await ingredientsHash(recipe);
  const m = macrosOf(recipe.macros);

  if (body.action === 'check') {
    const key = env.GEMINI_API_KEY?.trim();
    if (!key) return json({ error: 'GEMINI_API_KEY saknas' }, 503);
    const rows = flattenRows(recipe, catalog);
    let est: { rows: AiRow[]; summary: string };
    try {
      est = await aiEstimate(key, recipe, rows);
    } catch (e) {
      return json({ error: 'AI-kontrollen misslyckades: ' + (e instanceof Error ? e.message : String(e)) }, 502);
    }
    const tot = sumAi(est.rows);
    await env.DB.prepare(
      `INSERT INTO recipe_checks (recipe_id, ingredients_hash, our_kcal, our_prot, our_carb, our_fat,
         ai_kcal, ai_prot, ai_carb, ai_fat, ai_rows, ai_summary, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(recipe_id) DO UPDATE SET
         ingredients_hash = excluded.ingredients_hash,
         our_kcal = excluded.our_kcal, our_prot = excluded.our_prot,
         our_carb = excluded.our_carb, our_fat = excluded.our_fat,
         ai_kcal = excluded.ai_kcal, ai_prot = excluded.ai_prot,
         ai_carb = excluded.ai_carb, ai_fat = excluded.ai_fat,
         ai_rows = excluded.ai_rows, ai_summary = excluded.ai_summary,
         checked_at = excluded.checked_at`
    )
      .bind(
        id, hash, m?.kcal ?? null, m?.prot ?? null, m?.carb ?? null, m?.fat ?? null,
        tot.kcal, tot.prot, tot.carb, tot.fat, JSON.stringify(est.rows), est.summary
      )
      .run();
  } else if (body.action === 'verify') {
    await env.DB.prepare(
      `INSERT INTO recipe_checks (recipe_id, ingredients_hash, our_kcal, our_prot, verified_hash, verified_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(recipe_id) DO UPDATE SET verified_hash = excluded.verified_hash, verified_at = excluded.verified_at`
    )
      .bind(id, hash, m?.kcal ?? null, m?.prot ?? null, hash)
      .run();
  } else if (body.action === 'unverify') {
    await env.DB.prepare('UPDATE recipe_checks SET verified_hash = NULL, verified_at = NULL WHERE recipe_id = ?')
      .bind(id)
      .run();
  } else {
    return json({ error: 'Okänd action' }, 400);
  }

  const checks = await loadChecks(env.DB);
  return json({ ok: true, recipe: await buildItem(recipe, catalog, checks.get(id)) });
}
