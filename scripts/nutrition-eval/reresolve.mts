/**
 * Räkna om alla recept med AI-väljaren via workern (batchat).
 *
 *   RECEPT_SESSION=<cookie> npx tsx scripts/nutrition-eval/reresolve.mts --dry-run   # bara rapport
 *   RECEPT_SESSION=<cookie> npx tsx scripts/nutrition-eval/reresolve.mts             # sparar + lär in
 *
 * Rapport: scripts/nutrition-eval/reresolve.report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cookie = process.env.RECEPT_SESSION;
if (!cookie) throw new Error('Sätt RECEPT_SESSION');
const base = process.env.RECEPT_BASE || 'https://receptbok.receptbok.workers.dev';
const dryRun = process.argv.includes('--dry-run');

type Result = {
  id: string;
  before?: { kcal: number; prot: number; carb: number; fat: number };
  after?: { kcal: number; prot: number; carb: number; fat: number };
  diffs: { raw: string; before: string; after: string }[];
  unresolved: number;
  saved: boolean;
  ai?: { error?: string };
};

const all: Result[] = [];
let offset: number | null = 0;
while (offset != null) {
  const res = await fetch(base + '/api/nutrition/reresolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `recept_session=${cookie}` },
    body: JSON.stringify({ offset, limit: 3, dryRun }),
  });
  if (!res.ok) throw new Error(`reresolve ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results: Result[]; next: number | null; total: number };
  all.push(...data.results);
  console.log(`${Math.min((offset ?? 0) + data.results.length, data.total)}/${data.total}`);
  offset = data.next;
}

for (const r of all) {
  const b = r.before;
  const a = r.after;
  console.log(
    `\n${r.id}: kcal ${b?.kcal}→${a?.kcal}  P ${b?.prot}→${a?.prot}` +
      (r.ai?.error ? `  [AI-fel: ${r.ai.error}]` : '') +
      (r.unresolved ? `  [${r.unresolved} omatchade]` : '')
  );
  for (const d of r.diffs) console.log(`  ${d.raw}: ${d.before}  →  ${d.after}`);
}
fs.writeFileSync(path.join(__dirname, 'reresolve.report.json'), JSON.stringify(all, null, 1));
