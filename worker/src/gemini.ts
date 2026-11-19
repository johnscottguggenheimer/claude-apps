import { normalizeRecipe, type Recipe } from './validate';

/**
 * Text / JSON — endast modeller med gratis free tier (Flash / Flash-Lite).
 * Pro, Preview-Pro och bildmodeller används aldrig här.
 * @see https://ai.google.dev/gemini-api/docs/pricing
 */
const TEXT_MODELS_PARSE = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] as const;
const TEXT_MODELS_SIMPLE = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] as const;

/** Bildgenerering — kräver ofta billing; separat kvot från text. */
const IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
] as const;

const QUOTA_HELP =
  'Gratis Gemini API har ofta ingen bildkvot (limit: 0). Aktivera billing i Google AI Studio → API key → projekt med betalning, eller vänta tills dagens kvot återställs. Kvoter: https://ai.google.dev/gemini-api/docs/rate-limits · Usage: https://ai.dev/rate-limit';

const PARSE_SYSTEM = `Du är receptparser för en svensk proteinfokuserad receptbok.
Returnera ENDAST ett JSON-objekt (ingen markdown).

Fält (inget emoji-fält):
- id: kebab-case engelska
- category: frukost | lunch | middag | tillbehor | fika (måltidstyp — inte kök/stil som asiatisk)
- baseServings: number
- tags: array — endast från: kyckling, notkott, flask, fisk, skaldjur, vegetarisk, vegan (proteinkälla + diet — inte tid/makro som hög protein, snabb, meal prep)
- source (läsbar källa: @handle, «Ali Slagle, NYT Cooking», sajtnamn — **utan** «på Instagram/TikTok» i texten)
- **source:** alltid **ursprunglig receptskapare** — @handle på Instagram/TikTok, blogg/sajtnamn, kock + publikation. **Aldrig** personen som vidarebefordrat receptet privat (vän/familj) om de inte själva är kreatören
- **source:** vid skärmdump/reel/caption — läs @handle, kontonamn eller vattenstämpel synligt i bilden/texten; prioritera det. Om okänt: «Okänd källa» — gissa inte vidarebefordrare
- **title:** alltid på **svenska** — översätt engelska/internationella receptnamn till naturlig svenska (behåll etablerade lånord som gochujang, teriyaki, buffalo där det passar). **Obligatoriskt** — title får aldrig vara tom
- **title:** inkludera **aldrig** ordet «protein» (eller «högprotein») — ta bort proteinkrav från namnet men behåll resten (t.ex. «Proteinbanankaka» → «Banankaka»)
- sourceUrl: publik recept-URL (matblogg, NYT Cooking, etc.). Tom sträng för Instagram/TikTok — vi kan inte läsa inloggade sociala länkar; använd @handle i source istället
- badges: array med minst portioner (t.ex. «4 portioner») och tidsuppskattning som **endast** «XX min» (t.ex. «30 min») — aldrig «ca», «under» eller intervall i badge; vid intervall i källan använd högsta minut
- **macros: UTELÄMNA helt** — sätt aldrig kcal/prot/carb/fat på recept eller ingredienser. Makron beräknas server-side separat.
- groups: **obligatoriskt**, minst en grupp med **minst en** ingredient (name lowercase, amount number, unit: g|msk|tsk|st|pinch|näve|strimlor). Tomma groups eller ingredients=[] är ogiltigt — extrahera alla ingredienser från källan. Ingredienser ska **inte** ha macros-fält.
- steps: [{ title, text }]
- tips: exakt 4, första title "För barn" (mild barnvänlig anpassning)

Kategori — måltidstyp:
- frukost: frukostmat
- lunch: lunch, wraps, sallader som huvudmål, lättare rätter
- middag: kvällsmat, huvudrätter
- tillbehor: sidor, spreads, bröd, pickles, tillbehör till annan måltid
- fika: bakverk, sötsaker, bullar till fika

Mått — kritiska regler (fel här ger 1g-mjölk o.dyl.):
- Tillåtna unit: endast g|msk|tsk|st|pinch|näve|strimlor
- tbsp/tablespoon → unit msk (samma siffra). tsp/teaspoon → unit tsk (samma siffra)
- cup/cups → räkna om till gram: vätska/mjölk/yoghurt ≈ 240 g/cup, mjöl/socker/pulver ≈ 120 g/cup, smör ≈ 227 g/cup. Skriv amount i gram, unit g
- ml → g 1:1 för vätskor; dl → amount×100 som g; oz → ×28; lb → ×454
- scoop proteinpulver ≈ 30 g; espresso shot ≈ 30 g; ägg → st
- **ALDRIG** byt bara etiketten till g utan att räkna om. 1 cup ≠ 1 g, 1 tbsp ≠ 1 g, 1 scoop ≠ 1 g, 1¼ cup mjölk ≠ 1.25 g
- Föredra msk/tsk för olja, soja, vinäger, pastasåser, honung, kryddor i små mängder — tvinga inte allt till gram
- Små äkta grammängder (salt, peppar, jäst, bakpulver) får vara några gram
- Ingrediens utan mängd i källan («to taste», «optional», «for garnish», «till servering»): amount 0 och unit som passar (msk/st/näve). 0 visas som «efter smak» i appen. Hitta aldrig på mängder som inte står i källan

Språk — ingredienser och steg (naturlig svenska, inte ord-för-ord):
- **Mejeri med fetthalt:** använd svensk butiksnomenklatur med **procent**, inte «fullfet/lågfet/light» som adjektiv.
  - full-fat / whole milk cottage cheese → «keso 4%» (inte «fullfet keso»)
  - low-fat / reduced-fat cottage cheese → «keso 1,5%»
  - fat-free / nonfat cottage cheese → «keso 0,1%»
  - full-fat Greek yogurt → «grekisk yoghurt 10%» (eller 6–10% om osäkert); nonfat → «grekisk yoghurt 0%»
  - whole milk → «helmjölk»; 2% → «mellanmjölk»; skim → «lättmjölk»
- **Vanliga matord (inte anglicismer):**
  - soy sauce / sojasås → **«soja»** (inte sojasås)
  - cubed / diced → **«tärnad»** (aldrig «kuberad»); skriv «tärnad lax», inte «lax, kuberad»
  - Persian cucumber / persisk gurka → **«gurka»** (i Sverige finns ingen «persisk gurka» i butik)
  - vanilla paste → **«vaniljextrakt»** (eller «vaniljpasta» endast om källan tydligt menar pastaprodukt — föredra vaniljextrakt)
  - spicy mayo / sriracha mayo → **«chilimajonnäs»** (inte «pikant majonnäs»)
  - avocado → **«avokado»** konsekvent (inte avocado)
  - light ketchup / lättketchup / ketchup med lågt kaloriinnehåll → **«ketchup»** (marknadsföring — räkna som vanlig ketchup)
- **Stegverb:** drizzle → «ringla» eller «droppa» — **aldrig** «dryppla». Fold gently → «vänd försiktigt».
- **Maskin-/produktlägen** (Ninja Creami m.fl.): behåll **officiellt engelskt lägesnamn** i citattecken — översätt aldrig «Lite Ice Cream» till «lite glass». Ex: «kör på "Lite Ice Cream"-läget», «kör Re-spin». Skriv «Re-spin», inte «respinna».
- **Engelska skafferitermer** — hitta inte på svenska kalques för ord som svenskar säger på engelska:
  - chocolate chips → **«chocolate chips»** (aldrig «chokladchips» / «choklad chips»)
  - PB2 → **«pb2»** (produktnamn; gärna «pb2 (pulver)» om källan menar pulver)
  - monk fruit → **«monk fruit»** (aldrig «munkfrukt»)
- Översätt instruktioner till flytande svenska men behåll varumärken, lägesnamn och etablerade lånord (gochujang, teriyaki, espresso, Creami).
- Ingrediensnamn: lowercase, svenska vardagsord (cottage cheese → keso, scallion → salladslök, cornstarch → majsstärkelse) — utom listan ovan. Prep före namn när det går («tärnad gurka»).

Uppskatta makros för hela receptet.`

import { isSocialMediaUrl } from './fetch-url';

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

function textGenerationConfig() {
  return {
    responseMimeType: 'application/json',
    temperature: 0.2,
    thinkingConfig: { thinkingBudget: 0 },
  };
}

async function geminiJson(
  apiKey: string,
  parts: GeminiPart[],
  system: string,
  models: readonly string[] = TEXT_MODELS_PARSE
): Promise<string> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: textGenerationConfig(),
  });

  let lastErr = 'Gemini returnerade ingen text';

  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }
    );
    if (res.status === 404) {
      lastErr = `Modell ${model} hittades inte`;
      continue;
    }
    if (res.status === 429) {
      lastErr = `Kvot slut för ${model}`;
      continue;
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini text ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text;
    lastErr = `Modell ${model} returnerade ingen text`;
  }

  throw new Error(lastErr);
}

async function geminiImage(
  apiKey: string,
  parts: GeminiPart[]
): Promise<{ data: string; mimeType: string }> {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      temperature: 0.4,
    },
  });

  let lastErr = 'Gemini returnerade ingen bild';
  let sawQuota = false;

  for (const model of IMAGE_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }
    );
    if (res.status === 404) {
      lastErr = `Modell ${model} hittades inte`;
      continue;
    }
    if (res.status === 429) {
      sawQuota = true;
      lastErr = `Kvot slut för ${model}`;
      continue;
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini image ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[];
    };
    for (const part of data.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) return part.inlineData;
    }
    lastErr = `Modell ${model} returnerade ingen bild`;
  }

  if (sawQuota) {
    throw new Error(`Gemini bildkvot slut (${lastErr}). ${QUOTA_HELP}`);
  }
  throw new Error(lastErr);
}

export async function detectFoodPhoto(
  apiKey: string,
  imageBase64: string,
  mimeType: string
): Promise<boolean> {
  const text = await geminiJson(
    apiKey,
    [
      { inlineData: { mimeType, data: imageBase64 } },
      {
        text:
          'Ska denna bild användas som receptfoto (färdig maträtt på tallrik/skål, serverad mat, aptitretande matfoto)? ' +
          'Svara false om bilden visar: ingredienslista, recepttext, caption, råvaror utan tillagad rätt, steg-foto av enskild ingrediens, paket/etiketter, bara text/UI, eller nästan ingen mat. ' +
          'Svara JSON: {"hasFoodPhoto": true|false}',
      },
    ],
    'Svara endast JSON.',
    TEXT_MODELS_SIMPLE
  );
  try {
    return !!(JSON.parse(text) as { hasFoodPhoto?: boolean }).hasFoodPhoto;
  } catch {
    return false;
  }
}

export async function parseRecipe(
  apiKey: string,
  text: string,
  imageBase64: string | null,
  mimeType: string | null,
  sourceUrl: string
): Promise<Recipe> {
  const parts: GeminiPart[] = [];
  if (imageBase64 && mimeType) {
    parts.push({ inlineData: { mimeType, data: imageBase64 } });
  }
  const prompt = [
    text.trim() ? `Recepttext/beskrivning:\n${text.trim()}` : 'Extrahera recept från bilden.',
    imageBase64 && mimeType
      ? 'Bilden kan vara skärmdump från Instagram/TikTok eller matblogg. Leta efter @handle, kontonamn eller vattenstämpel i bilden och sätt som source (t.ex. @handle på Instagram). source = receptets skapare, inte den som skickat skärmdumpen.'
      : '',
    sourceUrl ? `Källa-URL: ${sourceUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  parts.push({ text: prompt });

  const raw = await geminiJson(apiKey, parts, PARSE_SYSTEM, TEXT_MODELS_PARSE);
  const recipe = normalizeRecipe(JSON.parse(raw) as Recipe);
  if (sourceUrl && !recipe.sourceUrl && !isSocialMediaUrl(sourceUrl)) {
    recipe.sourceUrl = sourceUrl;
  }
  if (recipe.sourceUrl && isSocialMediaUrl(String(recipe.sourceUrl))) {
    recipe.sourceUrl = '';
  }
  delete recipe.emoji;
  return recipe;
}

const MERGE_SYSTEM = `${PARSE_SYSTEM}

MERGE-LÄGE (gäller alltid här):
- Du får ett **befintligt recept** (JSON) plus tillägg (text och/eller bild: caption, anteckningar, fler ingredienser/steg, skärmdump).
- Returnera ett **uppdaterat** recept som **slår ihop** tilläggen med det befintliga — ersätt **inte** receptet wholesale.
- **Behåll** id, title, source, sourceUrl, image, category och övrigt befintligt innehåll om tillägget inte tydligt ersätter dem.
- Nya ingredienser: lägg i befintliga groups när det passar, annars skapa nya groups. Ta inte bort ingredienser som fortfarande gäller.
- Nya steg: integrera/lägg till utan att radera steg som fortfarande gäller. Om tillägget förtydligar ett steg, uppdatera det steget.
- tips: fortfarande exakt 4; uppdatera vid behov (första title "För barn").
- badges: uppdatera portioner/tid om tillägget ändrar det.
- **Sätt aldrig macros** — varken på receptet eller på ingrediensrader.
- Samma språk-, mått- och fältregler som ovan.`;

/** Merge additions into an existing recipe without wholesale replacement. */
export async function mergeRecipe(
  apiKey: string,
  existing: Recipe,
  text: string,
  imageBase64: string | null,
  mimeType: string | null
): Promise<Recipe> {
  const parts: GeminiPart[] = [];
  if (imageBase64 && mimeType) {
    parts.push({ inlineData: { mimeType, data: imageBase64 } });
  }
  const prompt = [
    `Befintligt recept (JSON) — behåll struktur och innehåll, slå bara ihop tilläggen:\n${JSON.stringify(existing)}`,
    text.trim()
      ? `Tillägg att slå ihop med receptet:\n${text.trim()}`
      : 'Extrahera tillägg från bilden och slå ihop med receptet ovan.',
    imageBase64 && mimeType
      ? 'Bilden kan vara skärmdump/caption med extra info — extrahera bara det som ska läggas till eller korrigeras.'
      : '',
    'Returnera det uppdaterade receptet som JSON. Behåll id, title, source, sourceUrl och image från det befintliga receptet om tillägget inte tydligt ersätter dem.',
  ]
    .filter(Boolean)
    .join('\n\n');
  parts.push({ text: prompt });

  const raw = await geminiJson(apiKey, parts, MERGE_SYSTEM, TEXT_MODELS_PARSE);
  const recipe = normalizeRecipe(JSON.parse(raw) as Recipe);

  // Hard-preserve identity / media unless AI returned clear replacements
  if (existing.id) recipe.id = existing.id;
  if ((!recipe.title || !String(recipe.title).trim()) && existing.title) {
    recipe.title = existing.title;
  }
  if ((!recipe.source || recipe.source === 'Okänd källa') && existing.source) {
    recipe.source = existing.source;
  }
  if (!recipe.sourceUrl && existing.sourceUrl) recipe.sourceUrl = existing.sourceUrl;
  if (recipe.sourceUrl && isSocialMediaUrl(String(recipe.sourceUrl))) {
    recipe.sourceUrl = '';
  }
  if (!recipe.image && existing.image) recipe.image = existing.image;
  if (!recipe.category && existing.category) recipe.category = existing.category;
  if (
    (!Array.isArray(recipe.badges) || !(recipe.badges as unknown[]).length) &&
    Array.isArray(existing.badges)
  ) {
    recipe.badges = existing.badges;
  }

  delete recipe.emoji;
  return recipe;
}

const IMAGE_CLEANUP =
  'Remove ALL overlays and non-food UI: play/pause buttons, mute/volume icons, video progress bars, Reels/TikTok/Instagram chrome, timestamps, captions, subtitles, stickers, logos, watermarks, profile avatars, like/comment/share icons, screenshot borders, phone status bar. Output must be clean food photo only — zero text or interface elements.';

function recipeImageContext(recipe: Recipe): { ingredients: string; steps: string } {
  const groups = (recipe.groups || []) as { name?: string; ingredients?: { name: string; amount?: number; unit?: string }[] }[];
  const ingredients = groups
    .map((g) => {
      const items = (g.ingredients || [])
        .map((i) => `${i.amount ?? ''} ${i.unit ?? ''} ${i.name}`.trim())
        .filter(Boolean);
      if (!items.length) return '';
      return g.name ? `${g.name}: ${items.join(', ')}` : items.join(', ');
    })
    .filter(Boolean)
    .join('\n');
  const steps = ((recipe.steps || []) as { title?: string; text?: string }[])
    .map((s, idx) => {
      const title = (s.title || '').trim() || `Steg ${idx + 1}`;
      const text = (s.text || '').trim();
      return text ? `${title}: ${text}` : title;
    })
    .filter(Boolean)
    .join('\n');
  return { ingredients, steps };
}

export async function generateFoodImage(apiKey: string, title: string, description: string): Promise<{ data: string; mimeType: string }> {
  return geminiImage(apiKey, [
    {
      text: `Professional appetizing food photography of "${title}". ${description}. Overhead or 3/4 angle, natural light, realistic, no people, restaurant quality. ${IMAGE_CLEANUP}`,
    },
  ]);
}

/** Ny hero-bild utifrån titel, ingredienser, instruktioner och ev. referensbild — lika vikt på alla fyra. */
export async function generateFoodImageFromRecipe(
  apiKey: string,
  recipe: Recipe,
  imageBase64?: string | null,
  mimeType?: string | null,
  extraInstructions?: string | null
): Promise<{ data: string; mimeType: string }> {
  const title = String(recipe.title || 'maträtt');
  const { ingredients, steps } = recipeImageContext(recipe);
  const parts: GeminiPart[] = [];

  if (imageBase64 && mimeType) {
    parts.push({ inlineData: { mimeType, data: imageBase64 } });
  }

  const refLine = imageBase64
    ? 'An attached inspiration photo is provided — show the SAME dish but with clearly different composition: new camera angle, different plate/board/surface, new garnish placement, and fresh styling. Do NOT copy the reference framing, layout, or props.'
    : 'No reference photo — infer appearance from the recipe text below.';

  const extra = String(extraInstructions || '').trim();
  const extraBlock = extra
    ? `\n5. ADDITIONAL USER DIRECTION (append — do not ignore the recipe above):\n${extra}\n`
    : '';

  parts.push({
    text: `Create a completely new professional appetizing food photograph (not a retouch of an existing photo).

1. DISH NAME: "${title}"
2. REFERENCE IMAGE: ${refLine}
3. INGREDIENTS:
${ingredients || '(see dish name)'}
4. INSTRUCTIONS (plating, texture, finish):
${steps || '(see dish name)'}
${extraBlock}
Vary angle (overhead OR 3/4), natural light, realistic, no people, restaurant quality. ${IMAGE_CLEANUP}`,
  });

  return geminiImage(apiKey, parts);
}

export async function enhanceFoodImage(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  title: string
): Promise<{ data: string; mimeType: string }> {
  return geminiImage(apiKey, [
    { inlineData: { mimeType, data: imageBase64 } },
    {
      text: `This is a photo of "${title}". Create an improved version of THIS EXACT image — same dish, same plating, same bowl/plate, same camera angle and framing. Do not invent a different meal or change the composition. Fix and clean up: sharper focus, better natural lighting, richer appetizing colors, professional food photography. Photorealistic, no people. This may be a video screenshot — ${IMAGE_CLEANUP}`,
    },
  ]);
}

/* Nutrition matching moved to worker/src/nutrition/ (Steg A). */
