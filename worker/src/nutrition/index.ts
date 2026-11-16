export type {
  IngredientRow,
  MacroTotals,
  MatchStatus,
  GramsSource,
  NutritionCatalog,
  RecipeIngredientInput,
  ResolveRecipeResult,
  ResolvedIngredient,
  MatchMethod,
  LearnedMatch,
  LearnedUnitWeight,
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
  findIngredient,
  matchKey,
  unitClass,
  CUSTOM_FOOD_ID_START,
} from './match';
export { expandLookupKeys } from './lookup';
export { findCandidates } from './candidates';
export type { Candidate } from './candidates';
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
export { aiResolveLines, applyAiDecisions, plausible, validPer100, validGramsPerUnit } from './ai-match';
export type { AiDecision, AiLineInput, Per100 } from './ai-match';
