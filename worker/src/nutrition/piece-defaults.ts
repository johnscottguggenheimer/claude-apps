/**
 * Category / name-based piece-weight and density schablons.
 * Used when catalog has no piece_weight_g / density_g_per_ml.
 * Intentionally coarse — better than 0 on a 400 g protein row.
 */

export type PieceFoodGroup =
  | 'allium_small' // salladslök, gräslök, vitlöksklyfta
  | 'allium_bulb' // gul lök, rödlök
  | 'pepper' // paprika
  | 'tomato'
  | 'root' // morot, palsternacka
  | 'leafy'
  | 'fruit'
  | 'egg'
  | 'pasta_sheet'
  | 'ginger'
  | 'mushroom'
  | 'default';

/** Grams per piece (1 st). */
export const PIECE_WEIGHT_BY_GROUP: Record<PieceFoodGroup, number> = {
  allium_small: 15,
  allium_bulb: 110,
  pepper: 150,
  tomato: 100,
  root: 80,
  leafy: 30,
  fruit: 120,
  egg: 58,
  pasta_sheet: 20,
  ginger: 12,
  mushroom: 20,
  default: 80,
};

/** g/ml defaults by rough food class for msk/tsk/dl without catalog density. */
export const DENSITY_DEFAULTS = {
  oil: 0.91,
  liquid: 1.0,
  powder: 0.55,
  paste: 1.1,
  solid: 0.7,
  default: 1.0,
} as const;

export function classifyPieceGroup(name: string): PieceFoodGroup {
  const n = String(name || '').toLowerCase();
  if (/vitlök|vitloksklyfta|vitlöksklyfta|gräslök|graslok|salladslök|salladslok|vårlök|varlok/.test(n)) {
    return 'allium_small';
  }
  if (/lök|lok|schalotten|rödlök|rodlok/.test(n)) return 'allium_bulb';
  if (/paprika/.test(n) && !/pulver|krydda/.test(n)) return 'pepper';
  if (/tomat|tomato/.test(n) && !/pur[eé]|krossad|soltork/.test(n)) return 'tomato';
  if (/morot|palsternacka|rotselleri|rödbeta|rodbeta|potatis/.test(n)) return 'root';
  if (/sallad|spenat|ruccola|kål|kal|blad/.test(n)) return 'leafy';
  if (/banan|äpple|apple|päron|apelsin|citron|lime(?!juice)/.test(n)) return 'fruit';
  if (/^ägg$|ägg stort|ägg stora/.test(n)) return 'egg';
  if (/lasagne|lasagna|pasta.?platta/.test(n)) return 'pasta_sheet';
  if (/ingefära|ingefara|ginger/.test(n)) return 'ginger';
  if (/champinjon|svamp|mushroom/.test(n)) return 'mushroom';
  return 'default';
}

export function schablonPieceWeightG(name: string): number {
  return PIECE_WEIGHT_BY_GROUP[classifyPieceGroup(name)];
}

export function schablonDensityGPerMl(name: string): number {
  const n = String(name || '').toLowerCase();
  if (/olja|oil|smör|smor|margarin/.test(n)) return DENSITY_DEFAULTS.oil;
  if (/mjöl|mjol|socker|pulver|stärkelse|starkelse|kakao|proteinpulver/.test(n)) {
    return DENSITY_DEFAULTS.powder;
  }
  if (/pur[eé]|pasta(?! )|miso|tahini|nötssmör|smör/.test(n)) return DENSITY_DEFAULTS.paste;
  if (/vatten|mjölk|mjolk|buljong|vinäger|vinager|juice|soja|sås|sas|vin|öl|ol /.test(n)) {
    return DENSITY_DEFAULTS.liquid;
  }
  return DENSITY_DEFAULTS.default;
}
