/**
 * Independent post-cleanup alias stickprov (different draw than v1).
 *
 * Usage: npx tsx scripts/nutrition-eval/alias-audit-v2.mts
 *
 * - Excludes aliases from alias-audit.sample.json (v1)
 * - Different sampling stride (offset=1 mid-band)
 * - Writes alias-audit.v2.* files
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const nutritionUrl = pathToFileURL(path.join(root, 'worker/src/nutrition/index.ts')).href;
const {
  catalogFromSeed,
  normalizeIngredientName,
  expandLookupKeys,
  lookupAlias,
} = await import(nutritionUrl);

const seed = JSON.parse(fs.readFileSync(path.join(root, 'scripts/nutrition-seed.json'), 'utf8'));
const catalog = catalogFromSeed(seed.ingredients);
const prev = JSON.parse(fs.readFileSync(path.join(__dirname, 'alias-audit.sample.json'), 'utf8'));
const exclude = new Set(prev.sample.map((s) => s.aliasKey));

const res = await fetch('https://receptbok.receptbok.workers.dev/api/recipes', {
  headers: { Accept: 'application/json', 'User-Agent': 'receptbok-alias-audit-v2' },
});
const { recipes } = await res.json();

type Used = {
  aliasKey: string;
  ingredientId: number;
  canonical: string;
  useCount: number;
  recipeIds: string[];
  exampleRaws: string[];
  hitVia: 'exact' | 'broadened';
};

function resolveHit(normalized: string) {
  const keys = expandLookupKeys(normalized);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const hit = lookupAlias(catalog, key);
    if (hit) {
      return {
        aliasKey: key,
        ingredientId: hit.id,
        canonical: hit.canonical_name,
        hitVia: (i === 0 && key === normalized ? 'exact' : 'broadened') as 'exact' | 'broadened',
      };
    }
  }
  const direct = lookupAlias(catalog, normalized);
  if (direct) {
    return {
      aliasKey: normalized,
      ingredientId: direct.id,
      canonical: direct.canonical_name,
      hitVia: 'exact' as const,
    };
  }
  return null;
}

const used = new Map<string, Used>();
for (const recipe of recipes) {
  for (const g of recipe.groups || []) {
    for (const ing of g.ingredients || []) {
      const raw = String(ing.name || '').trim();
      if (!raw) continue;
      const hit = resolveHit(normalizeIngredientName(raw));
      if (!hit) continue;
      const prevU = used.get(hit.aliasKey) || {
        ...hit,
        useCount: 0,
        recipeIds: [],
        exampleRaws: [],
      };
      prevU.useCount += 1;
      if (!prevU.recipeIds.includes(recipe.id)) prevU.recipeIds.push(recipe.id);
      if (prevU.exampleRaws.length < 3 && !prevU.exampleRaws.includes(raw)) prevU.exampleRaws.push(raw);
      if (hit.hitVia === 'broadened') prevU.hitVia = 'broadened';
      used.set(hit.aliasKey, prevU);
    }
  }
}

const pool = [...used.values()]
  .filter((u) => !exclude.has(u.aliasKey))
  .sort((a, b) => b.useCount - a.useCount);

function sampleIndependent(list: Used[], n: number): Used[] {
  const picked: Used[] = [];
  const seen = new Set<string>();
  const take = (item: Used) => {
    if (seen.has(item.aliasKey) || picked.length >= n) return;
    seen.add(item.aliasKey);
    picked.push(item);
  };
  // Different draw: skip every other in top, start mid at offset 1
  for (let i = 1; i < Math.min(list.length, 80) && picked.length < 40; i += 2) take(list[i]);
  const mid = list.slice(20, Math.max(20, list.length - 10));
  const step = Math.max(1, Math.floor(mid.length / 45));
  for (let i = 1; i < mid.length && picked.length < 80; i += step) take(mid[i]);
  for (let i = list.length - 2; i >= 0 && picked.length < n; i -= 2) take(list[i]);
  for (const item of list) {
    if (picked.length >= n) break;
    take(item);
  }
  return picked;
}

const sample = sampleIndependent(pool, 100);

function fold(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9åäö ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Verdict = 'ok' | 'wrong' | 'uncertain';

function classify(alias: string, canonical: string): { verdict: Verdict; note?: string } {
  const a = fold(alias);
  const c = fold(canonical);
  // Intentional 0-kcal spice bucket
  if (canonical === 'svartpeppar' && a !== 'svartpeppar' && a !== 'peppar') {
    return { verdict: 'uncertain', note: '0-kcal spice/sweetener bucket' };
  }
  // Hard wrongs (post-cleanup regressions)
  if (a.includes('paprika') && !a.includes('pulver') && c.includes('rodkal')) {
    return { verdict: 'wrong', note: 'paprika→rödkål regression' };
  }
  if ((a === 'majs' || a.includes('majskarn')) && c.includes('morot')) {
    return { verdict: 'wrong', note: 'majs→morot regression' };
  }
  if ((a === 'rodlok' || a === 'gul lok' || a === 'lok') && (c.includes('mangold') || c.includes('majskorn'))) {
    return { verdict: 'wrong', note: 'lök regression' };
  }
  if (a === 'salladslok' && c.includes('purjolok')) {
    return { verdict: 'wrong', note: 'salladslök→purjolök regression' };
  }
  if (a === 'aggvita' && c.includes('agg ratt')) {
    return { verdict: 'wrong', note: 'äggvita→helt ägg' };
  }
  if (a === 'kakao' && c.includes('kakaosmor')) {
    return { verdict: 'wrong', note: 'kakao→kakaosmör' };
  }
  if (a === 'sallad' && c.includes('skaldjur')) {
    return { verdict: 'wrong', note: 'sallad→skaldjurssallad' };
  }
  // Acceptable proxies
  if (a === 'rodlok' && c.includes('lok gul')) {
    return { verdict: 'uncertain', note: 'SLV saknar rödlök → Lök gul proxy' };
  }
  if ((a === 'salladslok' || a === 'varlok') && c.includes('graslok')) {
    return { verdict: 'uncertain', note: 'SLV saknar salladslök → Gräslök proxy' };
  }
  if (a === 'timjan' && c.includes('persilja')) {
    return { verdict: 'uncertain', note: 'SLV saknar timjan → örtrproxy' };
  }
  // Name alignment
  const aTok = a.split(' ').filter((t) => t.length > 2);
  const cTok = new Set(c.split(' '));
  if (c === a || c.startsWith(a) || a.startsWith(c.split(' ')[0])) {
    return { verdict: 'ok', note: 'name aligns' };
  }
  if (aTok.length && aTok.every((t) => [...cTok].some((x) => x.startsWith(t) || t.startsWith(x)))) {
    return { verdict: 'ok', note: 'token overlap' };
  }
  // Known good Swedish recipe synonyms
  const synonyms: Record<string, string[]> = {
    soja: ['sojasas'],
    keso: ['färskost', 'cottage'],
    kvarg: ['kvarg', 'färskost'],
    olja: ['rapsolja', 'matolja', 'olivolja'],
    mjol: ['vetemjol'],
    bacon: ['gris bacon'],
    tonfisk: ['tonfisk'],
    lax: ['lax'],
  };
  for (const [key, vals] of Object.entries(synonyms)) {
    if (a.includes(key) && vals.some((v) => c.includes(v))) {
      return { verdict: 'ok', note: 'known synonym' };
    }
  }
  return { verdict: 'uncertain', note: 'needs manual eye' };
}

const verdicts: Record<string, { verdict: Verdict; note?: string }> = {};
for (const row of sample) {
  verdicts[row.aliasKey] = classify(row.aliasKey, row.canonical);
}

const tallies = { ok: 0, wrong: 0, uncertain: 0 };
const detailed = sample.map((row) => {
  const v = verdicts[row.aliasKey];
  tallies[v.verdict] += 1;
  return { ...row, ...v };
});

// Manual override pass — print uncertain for review in report
const reviewed = tallies.ok + tallies.wrong + tallies.uncertain;
const hardWrongRate = tallies.wrong / reviewed;

const report = {
  generatedAt: new Date().toISOString(),
  label: 'v2 independent sample after CURATED cleanup',
  excludedV1Count: exclude.size,
  poolAfterExclude: pool.length,
  sampleSize: sample.length,
  tallies,
  rates: {
    hardWrongPct: +(hardWrongRate * 100).toFixed(1),
    uncertainPct: +((tallies.uncertain / reviewed) * 100).toFixed(1),
    okPct: +((tallies.ok / reviewed) * 100).toFixed(1),
  },
  target: '<2% hard-wrong before steg 3–5',
  pass: hardWrongRate < 0.02,
  wrongInSample: detailed.filter((d) => d.verdict === 'wrong'),
  uncertainInSample: detailed.filter((d) => d.verdict === 'uncertain'),
  sampleDetailed: detailed,
};

fs.writeFileSync(path.join(__dirname, 'alias-audit.v2.sample.json'), JSON.stringify({ sample }, null, 2));
fs.writeFileSync(path.join(__dirname, 'alias-audit.v2.verdicts.json'), JSON.stringify(verdicts, null, 2));
fs.writeFileSync(path.join(__dirname, 'alias-audit.v2.report.json'), JSON.stringify(report, null, 2));

console.log('=== Alias audit v2 (independent) ===');
console.log(`Excluded v1: ${exclude.size} | pool: ${pool.length} | sample: ${sample.length}`);
console.log(`ok=${tallies.ok} wrong=${tallies.wrong} uncertain=${tallies.uncertain}`);
console.log(`hard-wrong: ${report.rates.hardWrongPct}% (target <2%) → ${report.pass ? 'PASS' : 'FAIL'}`);
if (report.wrongInSample.length) {
  console.log('WRONG:');
  for (const w of report.wrongInSample) console.log(`  ${w.aliasKey} → ${w.canonical}`);
}
console.log(`Uncertain needing eye: ${tallies.uncertain}`);
for (const u of report.uncertainInSample.slice(0, 25)) {
  console.log(`  ? ${u.aliasKey} → ${u.canonical} (${u.note})`);
}
