/**
 * Hold-out-mätning för fas 1 (AI-väljare).
 *
 * Lokal (ingen nyckel): kandidat-recall — finns rätt livsmedel bland top-K?
 *   npx tsx scripts/nutrition-eval/measure-holdout.mts
 *
 * Live (hela pipelinen inkl. Gemini, utan att lära in något):
 *   RECEPT_SESSION=<cookie-värde> npx tsx scripts/nutrition-eval/measure-holdout.mts --live
 *   (cookien heter recept_session; kopiera från inloggad webbläsare)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const nut = pathToFileURL(path.join(root, 'worker/src/nutrition/index.ts')).href;
const { catalogFromSeed, findCandidates, normalizeIngredientName, resolveIngredientLine } =
  await import(nut);

type Line = {
  name: string;
  amount: number;
  unit: string;
  expect?: string;
  new_ok?: { kcal: [number, number]; protein?: [number, number] };
  grams?: [number, number];
  note?: string;
};

const set = JSON.parse(fs.readFileSync(path.join(__dirname, 'holdout-set.json'), 'utf8')) as {
  lines: Line[];
};
const seed = JSON.parse(fs.readFileSync(path.join(root, 'scripts/nutrition-seed.json'), 'utf8'));
const catalog = catalogFromSeed(seed.ingredients);
const K = 12;
const live = process.argv.includes('--live');

function inBand(v: number, band?: [number, number]): boolean {
  return !band || (v >= band[0] && v <= band[1]);
}

// ---------- baseline (dagens deterministiska resolver) + kandidat-recall ----------
let baselineOk = 0;
let recallApplicable = 0;
let recallHit = 0;
const misses: string[] = [];
for (const l of set.lines) {
  const re = l.expect ? new RegExp(l.expect, 'i') : null;
  const r = resolveIngredientLine(catalog, l.name, l.amount, l.unit, 0, 0);
  const foodOk = re ? !!r.canonical_name && re.test(r.canonical_name) : false;
  if (foodOk && inBand(r.resolved_grams ?? -1, l.grams)) baselineOk += 1;
  if (!re) continue;
  recallApplicable += 1;
  const cands = findCandidates(catalog, normalizeIngredientName(l.name), K, [l.name]);
  const hit = cands.some((c: { row: { canonical_name: string } }) => re.test(c.row.canonical_name));
  if (hit) recallHit += 1;
  else
    misses.push(
      `${l.name}  →  ${cands
        .slice(0, 5)
        .map((c: { row: { canonical_name: string } }) => c.row.canonical_name)
        .join(' | ')}`
    );
}

console.log(`Rader: ${set.lines.length}`);
console.log(`Baseline (dagens resolver) rätt livsmedel+gram: ${baselineOk}/${set.lines.length}`);
console.log(`Kandidat-recall@${K} (rader med SLV-facit): ${recallHit}/${recallApplicable}`);
if (misses.length) {
  console.log('\nMissar (rätt livsmedel saknas bland kandidaterna):');
  for (const m of misses) console.log('  ' + m);
}

// ---------- live: hela pipelinen via workern ----------
if (live) {
  const cookie = process.env.RECEPT_SESSION;
  if (!cookie) throw new Error('Sätt RECEPT_SESSION');
  const base = process.env.RECEPT_BASE || 'https://receptbok.receptbok.workers.dev';
  const res = await fetch(base + '/api/nutrition/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `recept_session=${cookie}` },
    body: JSON.stringify({
      lines: set.lines.map((l) => ({ name: l.name, amount: l.amount, unit: l.unit })),
    }),
  });
  if (!res.ok) throw new Error(`dry-run ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    rows: {
      canonical_name: string | null;
      resolved_grams: number | null;
      per100: { kcal: number; protein: number } | null;
      created: boolean;
      needs_review: boolean;
    }[];
  };
  let ok = 0;
  const bad: string[] = [];
  set.lines.forEach((l, i) => {
    const r = data.rows[i];
    const re = l.expect ? new RegExp(l.expect, 'i') : null;
    let foodOk = false;
    if (r?.created) {
      foodOk = !!l.new_ok && !!r.per100 && inBand(r.per100.kcal, l.new_ok.kcal) &&
        inBand(r.per100.protein, l.new_ok.protein);
    } else if (r?.canonical_name) {
      foodOk = re ? re.test(r.canonical_name) : false;
      // Utan SLV-facit: accepteras om värdena ligger i bandet.
      if (!foodOk && l.new_ok && r.per100) {
        foodOk = inBand(r.per100.kcal, l.new_ok.kcal) && inBand(r.per100.protein, l.new_ok.protein);
      }
    }
    const gramsOk = inBand(r?.resolved_grams ?? -1, l.grams);
    if (foodOk && gramsOk) ok += 1;
    else
      bad.push(
        `${l.name} ${l.amount} ${l.unit} → ${r?.created ? 'NY ' : ''}${r?.canonical_name ?? '–'} ` +
          `${Math.round(r?.resolved_grams ?? 0)} g` +
          (r?.per100 ? ` (${Math.round(r.per100.kcal)} kcal, P${Math.round(r.per100.protein)}/100g)` : '') +
          (foodOk ? '' : ' [fel livsmedel]') +
          (gramsOk ? '' : ` [gram utanför ${l.grams?.join('–')}]`)
      );
  });
  console.log(`\nLIVE (AI-väljare) rätt livsmedel+gram: ${ok}/${set.lines.length}`);
  for (const b of bad) console.log('  ' + b);
}
