export type {
  IngredientRow,
  MacroTotals,
  MatchStatus,
  GramsSource,
  NutritionCatalog,
  RecipeIngredientInput,
  ResolveRecipeResult,
  ResolvedIngredient,
} from './types';

export {
  normalizeIngredientName,
  isCookingSprayName,
  isOilLikeName,
  isCitrusJuiceName,
  isZeroGramSpiceName,
} from './normalize';

export { amountToGrams, amountToGramsDetailed, macrosForGrams } from './grams';
export {
  lookupAlias,
  lookupAliasBroad,
  resolveIngredientLine,
  listPieceWeightAiCandidates,
} from './match';
export { expandLookupKeys } from './lookup';
export {
  roundMacros,
  resolveRecipeIngredients,
  applyResolutionToRecipe,
  resolveAndApplyRecipe,
  listUnresolved,
  nutritionGateError,
} from './resolve';
export type { UnresolvedIngredient } from './resolve';
export { loadNutritionCatalog, catalogFromSeed } from './catalog';
export {
  replaceRecipeIngredients,
  deleteRecipeIngredients,
  reassignRecipeIngredients,
  sumRecipeIngredientMacros,
} from './db';
export {
  stripClientMacros,
  resolveRecipeNutrition,
  persistRecipeNutrition,
} from './persist';
export type { PersistResolution, ResolveNutritionOptions } from './persist';
export { schablonPieceWeightG, classifyPieceGroup } from './piece-defaults';
export { estimatePieceWeightsAi, cachePieceWeights } from './piece-ai';
