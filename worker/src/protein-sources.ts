/**
 * Closed catalog of protein swap targets.
 * AI may only pick ids from this list. Nutrition aliases match MANUAL_FOODS / SLV.
 */
export type ProteinTier = 'fisk' | 'vegetarisk' | 'vegan';

export type ProteinSource = {
  id: string;
  label: string;
  /** Ingredient name written into recipe groups (lowercase, catalog alias). */
  ingredientName: string;
  tier: ProteinTier;
  /** Form hint for AI matching. */
  form: string;
};

export const PROTEIN_SOURCES: ProteinSource[] = [
  { id: 'lax', label: 'Lax', ingredientName: 'laxfilé', tier: 'fisk', form: 'filé / bit' },
  { id: 'torsk', label: 'Torsk', ingredientName: 'torskfilé', tier: 'fisk', form: 'filé' },
  { id: 'sej', label: 'Sej', ingredientName: 'sejfilé', tier: 'fisk', form: 'filé' },
  { id: 'kolja', label: 'Kolja', ingredientName: 'koljafilé', tier: 'fisk', form: 'filé' },
  { id: 'halloumi', label: 'Halloumi', ingredientName: 'halloumi', tier: 'vegetarisk', form: 'skiva / grill' },
  { id: 'feta', label: 'Feta', ingredientName: 'fetaost', tier: 'vegetarisk', form: 'smulad / bit' },
  { id: 'mozzarella', label: 'Mozzarella', ingredientName: 'mozzarella', tier: 'vegetarisk', form: 'skiva / riven' },
  { id: 'oumph-pulled', label: 'Oumph! Pulled', ingredientName: 'oumph pulled', tier: 'vegan', form: 'strimlor / pulled' },
  { id: 'oumph-mince', label: 'Oumph! Mince', ingredientName: 'oumph mince', tier: 'vegan', form: 'färs' },
  { id: 'oumph-kebab', label: 'Oumph! Kebab', ingredientName: 'oumph kebab', tier: 'vegan', form: 'kebabstrimlor' },
  { id: 'oumph-smoky', label: 'Oumph! Smoky Bits', ingredientName: 'oumph smoky bits', tier: 'vegan', form: 'bitar' },
  { id: 'oumph-chunks', label: 'Oumph! The Chunks', ingredientName: 'oumph the chunks', tier: 'vegan', form: 'bitar / gryta' },
  { id: 'oumph-burger', label: 'Oumph! Burger', ingredientName: 'oumph burger', tier: 'vegan', form: 'burgare' },
  { id: 'anamma-fars', label: 'Anamma Färs', ingredientName: 'anamma färs', tier: 'vegan', form: 'färs' },
  { id: 'anamma-korv', label: 'Anamma Korv', ingredientName: 'anamma korv', tier: 'vegan', form: 'korv' },
  { id: 'anamma-nuggets', label: 'Anamma Nuggets', ingredientName: 'anamma nuggets', tier: 'vegan', form: 'nuggets' },
  { id: 'anamma-bacon', label: 'Anamma Bacon', ingredientName: 'anamma bacon', tier: 'vegan', form: 'baconstrips' },
  { id: 'halsans-bonfars', label: 'Hälsans Kök Bönfärs', ingredientName: 'hälsans kök bönfärs', tier: 'vegan', form: 'färs' },
  { id: 'halsans-burgare', label: 'Hälsans Kök Burgare', ingredientName: 'hälsans kök burgare', tier: 'vegan', form: 'burgare' },
  { id: 'naturli-hakket', label: "Naturli' Hakket", ingredientName: 'naturli hakket', tier: 'vegan', form: 'färs' },
  { id: 'naturli-burger', label: "Naturli' Burger", ingredientName: 'naturli burger', tier: 'vegan', form: 'burgare' },
  { id: 'quorn-fars', label: 'Quorn Färs', ingredientName: 'quorn färs', tier: 'vegetarisk', form: 'färs' },
  { id: 'quorn-fileer', label: 'Quorn Filéer', ingredientName: 'quorn filé', tier: 'vegetarisk', form: 'filé' },
  { id: 'quorn-nuggets', label: 'Quorn Nuggets', ingredientName: 'quorn nuggets', tier: 'vegetarisk', form: 'nuggets' },
  { id: 'beyond-burger', label: 'Beyond Burger', ingredientName: 'beyond burger', tier: 'vegan', form: 'burgare' },
  { id: 'beyond-mince', label: 'Beyond Mince', ingredientName: 'beyond mince', tier: 'vegan', form: 'färs' },
  { id: 'tofu', label: 'Tofu', ingredientName: 'tofu', tier: 'vegan', form: 'kuber / stekt' },
  { id: 'tempeh', label: 'Tempeh', ingredientName: 'tempeh', tier: 'vegan', form: 'skiva / bit' },
];

export const PROTEIN_SOURCE_BY_ID = new Map(PROTEIN_SOURCES.map((s) => [s.id, s]));

export type RecipeRestrictiveness = 'meat' | 'fish' | 'plant';

const MEAT_TAGS = new Set(['kyckling', 'notkott', 'flask']);
const FISH_TAGS = new Set(['fisk', 'skaldjur']);

export function recipeRestrictiveness(recipe: {
  tags?: unknown;
  groups?: unknown;
}): RecipeRestrictiveness {
  const tags = Array.isArray(recipe.tags) ? (recipe.tags as string[]) : [];
  if (tags.some((t) => MEAT_TAGS.has(t))) return 'meat';
  if (tags.some((t) => FISH_TAGS.has(t))) return 'fish';
  const text = JSON.stringify(recipe.groups || []).toLowerCase();
  if (/kyckling|nötfärs|nötkött|fläsk|bacon|hamburgare|köttfärs|lamm|hjort|gris/.test(text)) {
    return 'meat';
  }
  if (/lax|torsk|sej|fiskfilé|räka|räkor|tonfisk|fisk/.test(text)) return 'fish';
  return 'plant';
}

/** How many variants to request, and which tiers are allowed (more restriction only). */
export function variantBudget(level: RecipeRestrictiveness): {
  min: number;
  max: number;
  allowedTiers: ProteinTier[];
} {
  if (level === 'meat') return { min: 2, max: 4, allowedTiers: ['fisk', 'vegetarisk', 'vegan'] };
  if (level === 'fish') return { min: 1, max: 2, allowedTiers: ['vegetarisk', 'vegan'] };
  return { min: 0, max: 0, allowedTiers: [] };
}

export function sourcesForPrompt(level: RecipeRestrictiveness): ProteinSource[] {
  const { allowedTiers } = variantBudget(level);
  return PROTEIN_SOURCES.filter((s) => allowedTiers.includes(s.tier));
}
