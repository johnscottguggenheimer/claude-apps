/**
 * Local smoke checks for Steg A matching (no D1).
 * Run: node --experimental-strip-types worker/src/nutrition/smoke.mts
 * or via tsx if available.
 */
import { catalogFromSeed } from './catalog.ts';
import { normalizeIngredientName } from './normalize.ts';
import { resolveIngredientLine } from './match.ts';

const catalog = catalogFromSeed([
  {
    id: 1,
    canonical_name: 'champinjon',
    kcal_per_100g: 22,
    protein_per_100g: 3.1,
    fat_per_100g: 0.3,
    carbs_per_100g: 3.3,
    aliases: ['champinjoner', 'svamp', 'mushroom'],
  },
  {
    id: 2,
    canonical_name: 'skinka',
    kcal_per_100g: 120,
    protein_per_100g: 19,
    fat_per_100g: 4.5,
    carbs_per_100g: 1.5,
    aliases: ['ham'],
  },
  {
    id: 3,
    canonical_name: 'kycklingbuljong',
    kcal_per_100g: 5,
    protein_per_100g: 0.5,
    fat_per_100g: 0,
    carbs_per_100g: 0.5,
    aliases: ['chicken broth', 'chicken stock'],
  },
  {
    id: 4,
    canonical_name: 'kyckling',
    kcal_per_100g: 120,
    protein_per_100g: 21,
    fat_per_100g: 3.5,
    carbs_per_100g: 0,
    aliases: ['chicken'],
  },
  {
    id: 5,
    canonical_name: 'hjortfärs',
    kcal_per_100g: 120,
    protein_per_100g: 21,
    fat_per_100g: 4,
    carbs_per_100g: 0,
  },
  {
    id: 6,
    canonical_name: 'palsternacka',
    kcal_per_100g: 75,
    protein_per_100g: 1.2,
    fat_per_100g: 0.3,
    carbs_per_100g: 18,
    piece_weight_g: 120,
  },
  {
    id: 7,
    canonical_name: 'timjan',
    kcal_per_100g: 101,
    protein_per_100g: 5.6,
    fat_per_100g: 1.7,
    carbs_per_100g: 24,
    aliases: ['färsk timjan'],
  },
]);

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// champinjoner must NOT resolve to skinka/ham
const mush = resolveIngredientLine(catalog, 'champinjoner', 250, 'g', 0, 0);
assert(mush.match_status === 'matched', 'champinjoner should match');
assert(mush.canonical_name === 'champinjon', `got ${mush.canonical_name}`);
assert(Math.round(mush.kcal!) === 55, `champ kcal ${mush.kcal}`);

// kycklingbuljong must NOT resolve to kyckling
const broth = resolveIngredientLine(catalog, 'kycklingbuljong', 150, 'g', 0, 0);
assert(broth.canonical_name === 'kycklingbuljong', `broth got ${broth.canonical_name}`);

const chicken = resolveIngredientLine(catalog, 'kyckling', 150, 'g', 0, 0);
assert(chicken.canonical_name === 'kyckling', 'chicken ok');

assert(normalizeIngredientName('finhackad vitlöksklyfta').includes('vitlök'), 'prep strip');
assert(normalizeIngredientName('färsk timjan eller rosmarin') === 'timjan', `eller: ${normalizeIngredientName('färsk timjan eller rosmarin')}`);

const deer = resolveIngredientLine(catalog, 'hjortfärs', 500, 'g', 0, 0);
assert(deer.match_status === 'matched', 'hjortfärs');

const pars = resolveIngredientLine(catalog, 'palsternacka', 1.5, 'st', 0, 0);
assert(pars.match_status === 'matched', 'palsternacka st');
assert(pars.resolved_grams === 180, `pars grams ${pars.resolved_grams}`);

const noPiece = catalogFromSeed([
  {
    id: 1,
    canonical_name: 'palsternacka',
    kcal_per_100g: 75,
    protein_per_100g: 1.2,
    fat_per_100g: 0.3,
    carbs_per_100g: 18,
  },
]);
const np = resolveIngredientLine(noPiece, 'palsternacka', 1, 'st', 0, 0);
assert(np.match_status === 'matched', 'st without catalog weight still matches via schablon');
assert(np.grams_source === 'category_fallback', `grams_source ${np.grams_source}`);
assert(np.resolved_grams != null && np.resolved_grams > 0, 'schablon grams');

console.log('nutrition smoke OK');
