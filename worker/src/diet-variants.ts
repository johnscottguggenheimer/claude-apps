/**
 * @deprecated Use protein-variants.ts — kept as thin re-exports for any leftover imports.
 */
export {
  buildProteinVariantsForRecipe as buildDietVariantsForRecipe,
  recipeNeedsProteinVariants as recipeNeedsDietConversion,
  type ProteinVariant as DietVariant,
  type ProteinVariantsList as DietVariantsMap,
} from './protein-variants';
