/**
 * Protein-source variants (more-restrictive swaps only).
 * AI picks 2–4 ids from a closed list; macros from nutrition catalog.
 */
import type { Recipe } from './validate';
import { normalizeRecipe } from './validate';
import { resolveAndApplyRecipe } from './nutrition/resolve';
import type { NutritionCatalog } from './nutrition/types';
import {
  PROTEIN_SOURCE_BY_ID,
  recipeRestrictiveness,
  sourcesForPrompt,
  variantBudget,
  type ProteinSource,
  type ProteinTier,
  type RecipeRestrictiveness,
} from './protein-sources';

export type ProteinVariant = {
  id: string;
  label: string;
  tier: ProteinTier;
  title: string;
  reason?: string;
  groups: Recipe['groups'];
  macros?: { kcal: number; prot: number; carb: number; fat: number };
  image?: string;
};

export type ProteinVariantsList = ProteinVariant[];

export {
  recipeRestrictiveness,
  variantBudget,
  PROTEIN_SOURCE_BY_ID,
  type RecipeRestrictiveness,
  type ProteinSource,
};

export function recipeNeedsProteinVariants(recipe: Recipe): boolean {
  const level = recipeRestrictiveness(recipe);
  return variantBudget(level).max > 0;
}

function catalogBlock(sources: ProteinSource[]): string {
  return sources
    .map((s) => `- id="${s.id}" | ${s.label} | ingredient="${s.ingredientName}" | tier=${s.tier} | form=${s.form}`)
    .join('\n');
}

function buildSystemPrompt(level: RecipeRestrictiveness): string {
  const budget = variantBudget(level);
  const sources = sourcesForPrompt(level);
  return `Du skapar proteinkälle-varianter av svenska recept.
Returnera ENDAST JSON:
{
  "variants": [
    {
      "id": "exakt-id-från-listan",
      "title": "svensk recepttitel för varianten (utan ordet protein)",
      "reason": "1 mening varför bytet passar form+smak",
      "groups": [ { "name": "...", "ingredients": [ { "name": "lowercase", "amount": number, "unit": "g|msk|tsk|st|pinch|näve|strimlor" } ] } ]
    }
  ]
}

Regler:
- Originalnivå: ${level}. Välj ${budget.min}–${budget.max} alternativ (aldrig fler).
- Endast id från listan nedan. Hitta aldrig på nya id.
- Bara mer restriktivt: kött→fisk/vego; fisk→vego; aldrig tvärtom.
- SUPERVIKTIGT: ersättaren måste passa receptets FORM och SMAK (färs→färs/mince, burgare→burgare, pulled/strimlor→pulled/kebab, filé→filé/halloumi/tofu, bacon→bacon/strips, gryta→chunks/färs).
- Byt bara proteinkällan (och ev. tillagningsord i steg behöver du inte ändra — bara groups). Övriga ingredienser oförändrade.
- I groups: använd ingredient-namnet från listan för den nya proteinkällan (samma amount/unit ungefär som originalproteinets rad).
- Inga macros-fält.
- Titlar på svenska utan «protein».

Tillåtna proteinkällor:
${catalogBlock(sources)}`;
}

type GeminiPart = { text?: string };

async function geminiJsonSimple(apiKey: string, parts: GeminiPart[], system: string): Promise<string> {
  const models = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] as const;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.35,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  let lastErr = 'Gemini returnerade ingen text';
  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
    );
    if (res.status === 404 || res.status === 429) {
      lastErr = `${model}: ${res.status}`;
      continue;
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 280)}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text;
  }
  throw new Error(lastErr);
}

function compactRecipeForPrompt(recipe: Recipe): object {
  return {
    id: recipe.id,
    title: recipe.title,
    tags: recipe.tags,
    baseServings: recipe.baseServings,
    groups: recipe.groups,
  };
}

function normalizeVariantGroups(
  raw: unknown
): { name: string; ingredients: { name: string; amount: number; unit: string }[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      const group = g as { name?: string; ingredients?: unknown[] };
      const ingredients = Array.isArray(group.ingredients)
        ? (group.ingredients
            .map((ing) => {
              const row = ing as { name?: string; amount?: number; unit?: string };
              const name = String(row.name || '')
                .toLowerCase()
                .trim();
              if (!name) return null;
              return {
                name,
                amount: Number(row.amount) || 0,
                unit: String(row.unit || 'g'),
              };
            })
            .filter(Boolean) as { name: string; amount: number; unit: string }[])
        : [];
      return { name: String(group.name || 'Ingredienser'), ingredients };
    })
    .filter((g) => g.ingredients.length > 0);
}

export async function proposeProteinVariants(
  apiKey: string,
  recipe: Recipe
): Promise<ProteinVariantsList> {
  const level = recipeRestrictiveness(recipe);
  const budget = variantBudget(level);
  if (budget.max === 0) return [];

  const raw = await geminiJsonSimple(
    apiKey,
    [
      {
        text: `Skapa proteinkälle-varianter för detta recept:\n${JSON.stringify(compactRecipeForPrompt(recipe))}`,
      },
    ],
    buildSystemPrompt(level)
  );

  let parsed: { variants?: unknown[] };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error('Kunde inte tolka proteinkälle-varianter från AI');
  }

  const allowed = new Set(sourcesForPrompt(level).map((s) => s.id));
  const seen = new Set<string>();
  const out: ProteinVariantsList = [];

  for (const item of parsed.variants || []) {
    if (out.length >= budget.max) break;
    const block = item as Record<string, unknown>;
    const id = String(block.id || '').trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    const src = PROTEIN_SOURCE_BY_ID.get(id);
    if (!src) continue;
    const groups = normalizeVariantGroups(block.groups);
    if (!groups.length) continue;
    seen.add(id);
    out.push({
      id,
      label: src.label,
      tier: src.tier,
      title: String(block.title || recipe.title || ''),
      reason: block.reason ? String(block.reason) : undefined,
      groups,
    });
  }

  return out;
}

export function resolveProteinVariantsMacros(
  catalog: NutritionCatalog,
  baseRecipe: Recipe,
  variants: ProteinVariantsList
): ProteinVariantsList {
  return variants.map((v) => {
    const draft: Recipe = {
      ...baseRecipe,
      title: v.title || baseRecipe.title,
      groups: v.groups,
    };
    delete draft.macros;
    delete draft.dietVariants;
    delete draft.proteinVariants;
    normalizeRecipe(draft);
    const { recipe: applied } = resolveAndApplyRecipe(catalog, draft);
    return {
      ...v,
      title: String(v.title || applied.title || baseRecipe.title),
      groups: applied.groups,
      macros: applied.macros as ProteinVariant['macros'],
      image: v.image,
    };
  });
}

export async function buildProteinVariantsForRecipe(
  apiKey: string,
  catalog: NutritionCatalog,
  recipe: Recipe
): Promise<ProteinVariantsList | null> {
  if (!recipeNeedsProteinVariants(recipe)) return null;
  const proposed = await proposeProteinVariants(apiKey, recipe);
  if (!proposed.length) return [];
  return resolveProteinVariantsMacros(catalog, recipe, proposed);
}

/** Prefer a variant matching list preference (fisk | vegetarisk). */
export function pickPreferredVariant(
  variants: ProteinVariantsList | null | undefined,
  pref: 'fisk' | 'vegetarisk' | null
): ProteinVariant | null {
  if (!pref || !variants || !variants.length) return null;
  if (pref === 'fisk') {
    return variants.find((v) => v.tier === 'fisk') || null;
  }
  // vegetarisk: prefer vegan/vegetarisk plant
  return (
    variants.find((v) => v.tier === 'vegan') ||
    variants.find((v) => v.tier === 'vegetarisk') ||
    null
  );
}
