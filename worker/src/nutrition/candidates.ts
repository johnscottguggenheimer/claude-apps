/**
 * Candidate retrieval for the AI picker.
 * Fuzzy, in-memory (catalog is already loaded): token + compound + trigram scoring
 * over canonical names and aliases. Recall matters more than precision here —
 * the AI picks among the candidates and may reject all of them.
 */
import type { IngredientRow, NutritionCatalog } from './types';

type Doc = {
  row: IngredientRow;
  /** Distinct searchable strings (canonical + aliases), lowercased. */
  texts: string[];
  tokens: Set<string>;
  trigrams: Set<string>;
  wordCount: number;
};

type Index = { docs: Doc[]; postings: Map<string, number[]> };

const indexCache = new WeakMap<object, Index>();

/** Docs to fully score per query after trigram prefilter. */
const PREFILTER = 150;

/** Words that describe state/use rather than the food — weak signal on their own. */
const WEAK_TOKENS = new Set([
  'rå', 'kokt', 'kokta', 'stekt', 'm', 'u', 'el', 'och', 'med', 'utan', 'fett', 'typ',
  'konserv', 'frysvara', 'torkad', 'torkade', 'salt', 'lag', 'ca', 'naturell', 'hemlagad',
  'färsk', 'blad', 'skinn', 'ätf', 'drickf', 'berikad', 'veg', 'fullkorn',
]);

function fold(s: string): string {
  return s.toLowerCase().replace(/[éè]/g, 'e').replace(/[^a-zåäö0-9%]+/g, ' ').trim();
}

function tokenize(s: string): string[] {
  return fold(s).split(/\s+/).filter((t) => t.length > 0);
}

function trigramsOf(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of tokenize(s)) {
    const p = ` ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

function buildIndex(catalog: NutritionCatalog): Index {
  const cacheKey = catalog.searchIndexKey ?? catalog;
  const cached = indexCache.get(cacheKey);
  if (cached) return cached;
  const textsById = new Map<number, Set<string>>();
  for (const row of catalog.byId.values()) {
    textsById.set(row.id, new Set([row.canonical_name.toLowerCase()]));
  }
  for (const [alias, row] of catalog.byAlias) {
    textsById.get(row.id)?.add(alias.toLowerCase());
  }
  const docs: Doc[] = [];
  for (const row of catalog.byId.values()) {
    const texts = [...(textsById.get(row.id) || [])];
    const tokens = new Set<string>();
    const trigrams = new Set<string>();
    for (const t of texts) {
      for (const tok of tokenize(t)) tokens.add(tok);
      for (const g of trigramsOf(t)) trigrams.add(g);
    }
    docs.push({ row, texts, tokens, trigrams, wordCount: tokenize(row.canonical_name).length });
  }
  const postings = new Map<string, number[]>();
  docs.forEach((d, i) => {
    for (const g of d.trigrams) {
      const list = postings.get(g);
      if (list) list.push(i);
      else postings.set(g, [i]);
    }
  });
  const index = { docs, postings };
  indexCache.set(cacheKey, index);
  return index;
}

/** Doc indices sharing the most trigrams with any query (cheap prefilter). */
function prefilter(index: Index, queries: string[]): number[] {
  const counts = new Float32Array(index.docs.length);
  for (const q of queries) {
    const grams = trigramsOf(q);
    if (!grams.size) continue;
    const w = 1 / grams.size;
    for (const g of grams) {
      for (const i of index.postings.get(g) || []) counts[i] += w;
    }
  }
  const hits: number[] = [];
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) hits.push(i);
  hits.sort((a, b) => counts[b] - counts[a]);
  return hits.slice(0, PREFILTER);
}

/** Strip common Swedish plural/definite endings for loose token comparison. */
function stem(t: string): string {
  return t.replace(/(orna|arna|erna|ar|er|or|na|en|et|n)$/u, '');
}

function tokenScore(q: string, docTokens: Set<string>): number {
  if (docTokens.has(q)) return 1;
  const qs = stem(q);
  let best = 0;
  for (const d of docTokens) {
    if (d.length < 3) continue;
    const ds = stem(d);
    if (qs.length >= 3 && qs === ds) best = Math.max(best, 0.9);
    // Swedish compounds: "kycklinglårfilé" ⊃ "kyckling", "babyspenat" ⊃ "spenat".
    else if (d.length >= 4 && q.includes(d)) best = Math.max(best, 0.4 + 0.5 * (d.length / q.length));
    else if (q.length >= 4 && d.includes(q)) best = Math.max(best, 0.4 + 0.4 * (q.length / d.length));
    else if (qs.length >= 4 && ds.startsWith(qs)) best = Math.max(best, 0.6);
  }
  return best;
}

export type Candidate = { row: IngredientRow; score: number };

/**
 * Top-k catalog rows for a normalized ingredient name.
 * `extraQueries` lets callers add e.g. the raw text or an English hint.
 */
export function findCandidates(
  catalog: NutritionCatalog,
  normalizedName: string,
  k = 12,
  extraQueries: string[] = []
): Candidate[] {
  const index = buildIndex(catalog);
  const queries = [normalizedName, ...extraQueries].map((q) => q.trim()).filter(Boolean);
  if (!queries.length) return [];

  const scored: Candidate[] = [];
  for (const di of prefilter(index, queries)) {
    const doc = index.docs[di];
    let best = 0;
    for (const q of queries) {
      const qTokens = tokenize(q);
      if (!qTokens.length) continue;
      let tokSum = 0;
      let tokWeight = 0;
      for (const t of qTokens) {
        const w = WEAK_TOKENS.has(t) || /^\d/.test(t) ? 0.3 : 1;
        tokSum += w * tokenScore(t, doc.tokens);
        tokWeight += w;
      }
      const tokPart = tokWeight ? tokSum / tokWeight : 0;

      const qGrams = trigramsOf(q);
      let inter = 0;
      for (const g of qGrams) if (doc.trigrams.has(g)) inter += 1;
      // Containment of query trigrams (doc may be longer: "Kikärtor torkade").
      const triPart = qGrams.size ? inter / qGrams.size : 0;

      const exact = doc.texts.includes(fold(q)) || doc.texts.includes(q.toLowerCase()) ? 0.5 : 0;
      const score = 0.6 * tokPart + 0.4 * triPart + exact;
      if (score > best) best = score;
    }
    if (best < 0.25) continue;
    // Long SLV names are usually composite dishes ("Gryta kikärtsgryta …").
    best -= Math.max(0, doc.wordCount - 4) * 0.025;
    scored.push({ row: doc.row, score: best });
  }

  scored.sort((a, b) => b.score - a.score || a.row.canonical_name.length - b.row.canonical_name.length);
  return scored.slice(0, k);
}
