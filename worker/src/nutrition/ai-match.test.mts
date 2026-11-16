/**
 * Offline-test av AI-väljarens logik med mockad Gemini.
 * Kör: npx tsx worker/src/nutrition/ai-match.test.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogFromSeed } from './catalog.ts';
import { resolveAndApplyRecipe } from './resolve.ts';
import { aiResolveLines, applyAiDecisions } from './ai-match.ts';
import { linesForAi } from './persist.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const seed = JSON.parse(readFileSync(path.join(root, 'scripts/nutrition-seed.json'), 'utf8'));
const catalog = catalogFromSeed(seed.ingredients);

// Mock: pick by regex on candidate name; fixed estimates/grams per line text.
const SCRIPT: Record<string, { pick?: RegExp; est: number[]; gpu?: number; search?: string[]; name?: string }> = {
  vetegluten: { pick: /^Vetemjöl$/, est: [370, 75, 2, 14] }, // sloppy pick → must be rejected
  'bacon, förstekt': { pick: /^Gris bacon rå$/, est: [340, 13, 32, 0], gpu: 15 },
  broccoli: { pick: /^Broccoli$/, est: [34, 3, 0.4, 4], gpu: 400 },
  kikärtor: { pick: /^Kikärtor konserv/, est: [115, 7, 2, 14] },
  skyr: { est: [63, 11, 0.2, 4], search: ['Kvarg'], name: 'skyr naturell' },
  prosciutto: { est: [250, 26, 16, 0], search: ['Gris skinka lufttorkad'], pick: /lufttorkad/ },
  ägg: { pick: /^Ägg rått$/, est: [140, 12.5, 10, 0.5], gpu: 58 },
};

let calls = 0;
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  calls += 1;
  const req = JSON.parse(init.body);
  const payload = JSON.parse(req.contents[0].parts[0].text);
  const lines = payload.lines.map((l: { i: number; text: string; candidates: { id: number; name: string }[] }) => {
    const s = SCRIPT[l.text];
    const cand = s?.pick ? l.candidates.find((c) => s.pick!.test(c.name)) : undefined;
    const est = s ? { kcal: s.est[0], protein: s.est[1], fat: s.est[2], carbs: s.est[3] } : null;
    return {
      i: l.i,
      choice: cand ? cand.id : null,
      confidence: 'high',
      grams_per_unit: s?.gpu ?? null,
      est_per_100g: est,
      search: cand ? null : s?.search ?? null,
      new_name: cand ? null : s?.name ?? l.text,
    };
  });
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ lines }) }] } }] }),
    { status: 200 }
  );
}) as typeof fetch;

const recipe = {
  id: 't',
  groups: [
    {
      name: 'x',
      ingredients: [
        { name: 'vetegluten', amount: 160, unit: 'g' },
        { name: 'bacon, förstekt', amount: 3, unit: 'strimlor' },
        { name: 'broccoli', amount: 1, unit: 'st' },
        { name: 'kikärtor', amount: 400, unit: 'g' },
        { name: 'skyr', amount: 300, unit: 'g' },
        { name: 'prosciutto', amount: 80, unit: 'g' },
        { name: 'ägg', amount: 2, unit: 'st' },
      ],
    },
  ],
};

const before = resolveAndApplyRecipe(catalog, recipe);
const lines = linesForAi(catalog, before.resolution.rows);
assert.equal(lines.length, 7, 'all lines unlearned → all to AI');

const decisions = await aiResolveLines('k', catalog, lines);
await applyAiDecisions(null, catalog, lines, decisions);
const after = resolveAndApplyRecipe(catalog, recipe).resolution.rows;
const by = (n: string) => after.find((r) => r.raw_text === n)!;

// vetegluten: Vetemjöl contradicts estimate (P 10 vs 75) → new AI food
assert.match(String(by('vetegluten').canonical_name), /vetegluten/);
assert.ok((by('vetegluten').protein ?? 0) > 100, 'gluten protein ~120 g');
assert.equal(by('vetegluten').needs_review, true);
// bacon strimlor: 3 × 15 g instead of 0
assert.equal(Math.round(by('bacon, förstekt').resolved_grams!), 45);
// broccoli: 400 g, not 80 g schablon
assert.equal(Math.round(by('broccoli').resolved_grams!), 400);
assert.match(String(by('kikärtor').canonical_name), /^Kikärtor konserv/);
// skyr: round 2 search finds nothing fitting → new food
assert.equal(by('skyr').canonical_name, 'skyr naturell');
// prosciutto: round 2 search finds SLV row
assert.match(String(by('prosciutto').canonical_name), /lufttorkad/);
assert.equal(by('ägg').match_method, 'learned_ai');
assert.equal(calls, 2, 'round 1 + one round 2');

// Second pass: everything learned → no AI lines.
assert.equal(linesForAi(catalog, after).length, 0, 'learned lines skip AI');

for (const r of after)
  console.log(
    `${r.raw_text.padEnd(16)} → ${String(r.canonical_name).padEnd(34)} ${Math.round(r.resolved_grams ?? 0)} g  ${Math.round(r.kcal ?? 0)} kcal  P${Math.round(r.protein ?? 0)}  ${r.match_method}${r.needs_review ? ' ⚑' : ''}`
  );
console.log('OK');
