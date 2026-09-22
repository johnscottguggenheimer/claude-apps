import {
  clearSessionCookie,
  isAuthed,
  makeSessionCookie,
  requireAuth,
  verifyPassword,
} from './auth';
import {
  detectFoodPhoto,
  enhanceFoodImage,
  generateFoodImageFromRecipe,
  generateFoodImage,
  parseRecipe,
  mergeRecipe,
} from './gemini';
import { fetchImageAsBase64, fetchRecipePage, isSocialMediaUrl } from './fetch-url';
import { getRecipe, getRecipeWithMeta, idExists, insertRecipe, listRecipes, updateRecipe, deleteRecipe, renameRecipe } from './db';
import { resolveRecipeNutrition, replaceRecipeIngredients, nutritionGateError, loadNutritionCatalog } from './nutrition';
import {
  buildProteinVariantsForRecipe,
  recipeNeedsProteinVariants,
  type ProteinVariantsList,
} from './protein-variants';
import { PROTEIN_SOURCE_BY_ID } from './protein-sources';
import {
  ensureVisitor,
  getRecipeReviewData,
  listReviewSummaries,
  upsertReview,
} from './reviews';
import { slugify, normalizeRecipe, validateRecipe, type Recipe } from './validate';

export interface Env {
  ASSETS: Fetcher;
  GEMINI_API_KEY?: string;
  ADMIN_PASSWORD?: string;
  /** @deprecated use ADMIN_PASSWORD */
  AUTH_PASSWORD?: string;
  DB: D1Database;
  IMAGES: R2Bucket;
}

function adminPassword(env: Env): string {
  return env.ADMIN_PASSWORD || env.AUTH_PASSWORD || '';
}

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return Response.json(data, { status, headers: extraHeaders });
}

function extFromMime(mime: string): string {
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('png')) return 'png';
  return 'jpg';
}

function imageKeyFromRef(imageRef: string | undefined | null): string | null {
  if (!imageRef || typeof imageRef !== 'string') return null;
  if (imageRef.startsWith('/api/images/')) return imageRef.slice('/api/images/'.length);
  if (imageRef.startsWith('recipes/')) return imageRef;
  return null;
}

function recipeStorageKey(recipeId: string, ext: string): string {
  return `recipes/${slugify(recipeId)}.${ext}`;
}

function imageRefCandidates(imageRef: string | undefined | null): string[] {
  const key = imageKeyFromRef(imageRef);
  if (!key) return [];
  const keys = [key];
  const m = key.match(/^recipes\/(.+)\.(jpe?g|png|webp)$/i);
  if (m) {
    const slugKey = recipeStorageKey(m[1], m[2].toLowerCase());
    if (!keys.includes(slugKey)) keys.push(slugKey);
  }
  return keys;
}

async function imageRefExists(env: Env, imageRef: string | undefined | null): Promise<boolean> {
  for (const key of imageRefCandidates(imageRef)) {
    if (await env.IMAGES.head(key)) return true;
  }
  return false;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

async function loadRecipeImageFromStorage(
  env: Env,
  imageRef: string | undefined | null
): Promise<{ data: string; mimeType: string } | null> {
  for (const key of imageRefCandidates(imageRef)) {
    const obj = await env.IMAGES.get(key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const mimeType = obj.httpMetadata?.contentType || 'image/jpeg';
    return { data: bytesToBase64(bytes), mimeType };
  }
  return null;
}

async function storeUploadedImage(
  env: Env,
  recipeId: string,
  imageBase64: string,
  mimeType: string
): Promise<string> {
  const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  return storeRecipeImage(env, recipeId, { data: imageBase64, mimeType }, bytes);
}

async function storeRecipeImage(
  env: Env,
  recipeId: string,
  image: { data: string; mimeType: string },
  bytes?: Uint8Array
): Promise<string> {
  const ext = extFromMime(image.mimeType);
  const key = recipeStorageKey(recipeId, ext);
  const data = bytes ?? Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
  await env.IMAGES.put(key, data, {
    httpMetadata: { contentType: image.mimeType, cacheControl: 'public, max-age=31536000' },
  });
  return `/api/images/${key}`;
}

async function enhanceRecipeImage(
  env: Env,
  recipe: Recipe,
  imageBase64: string | null,
  mimeType: string | null,
  existingImageRef?: string | null
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY saknas');

  const title = String(recipe.title || 'maträtt');

  if (!imageBase64) {
    const imageRef =
      existingImageRef ?? (typeof recipe.image === 'string' ? recipe.image : null);
    const loaded = await loadRecipeImageFromStorage(env, imageRef);
    if (loaded) {
      imageBase64 = loaded.data;
      mimeType = loaded.mimeType;
    }
  }

  if (!imageBase64 || !mimeType) {
    throw new Error('Receptet saknar bild att förbättra');
  }

  const image = await enhanceFoodImage(apiKey, imageBase64, mimeType, title);
  return storeRecipeImage(env, String(recipe.id), image);
}

async function generateRecipeImage(
  env: Env,
  recipe: Recipe,
  imageBase64: string | null,
  mimeType: string | null,
  extraInstructions?: string | null
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY saknas');

  const image = await generateFoodImageFromRecipe(
    apiKey,
    recipe,
    imageBase64,
    mimeType,
    extraInstructions
  );
  return storeRecipeImage(env, String(recipe.id), image);
}

async function resolveRecipeImage(
  env: Env,
  recipe: Recipe,
  imageBase64: string | null,
  mimeType: string | null,
  existingImageRef?: string | null
): Promise<string> {
  if (imageBase64 && mimeType) {
    return enhanceRecipeImage(env, recipe, imageBase64, mimeType, existingImageRef);
  }
  return generateRecipeImage(env, recipe, null, null);
}

async function attachProteinVariants(env: Env, recipe: Recipe): Promise<Recipe> {
  const key = geminiKey(env);
  if (!key || !recipeNeedsProteinVariants(recipe)) return recipe;
  try {
    const catalog = await loadNutritionCatalog(env.DB);
    const variants = await buildProteinVariantsForRecipe(key, catalog, recipe);
    if (variants && variants.length) {
      recipe.proteinVariants = variants;
      delete recipe.dietVariants;
    }
  } catch (e) {
    console.warn('proteinVariants failed', e instanceof Error ? e.message : e);
  }
  return recipe;
}

async function handleProteinVariants(env: Env, id: string, force = false): Promise<Response> {
  const existing = await getRecipe(env.DB, id);
  if (!existing) return json({ error: 'Hittades inte' }, 404);
  const current = existing.proteinVariants;
  const has =
    Array.isArray(current) && current.length > 0;
  if (has && !force) {
    return json({ ok: true, proteinVariants: current, cached: true });
  }
  if (!recipeNeedsProteinVariants(existing)) {
    return json({ ok: true, proteinVariants: [], skipped: true });
  }
  const key = geminiKey(env);
  if (!key) return json({ error: 'GEMINI_API_KEY saknas' }, 503);
  try {
    const catalog = await loadNutritionCatalog(env.DB);
    const variants = await buildProteinVariantsForRecipe(key, catalog, existing);
    existing.proteinVariants = variants || [];
    delete existing.dietVariants;
    await updateRecipe(env.DB, existing);
    return json({ ok: true, proteinVariants: existing.proteinVariants, cached: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Proteinkälle-varianter misslyckades' }, 502);
  }
}

/** Lazy-generate an image for one protein variant and persist it. */
async function handleProteinVariantImage(
  env: Env,
  id: string,
  variantId: string
): Promise<Response> {
  const existing = await getRecipe(env.DB, id);
  if (!existing) return json({ error: 'Hittades inte' }, 404);
  const variants = (existing.proteinVariants || []) as ProteinVariantsList;
  const idx = variants.findIndex((v) => v.id === variantId);
  if (idx < 0) return json({ error: 'Varianten finns inte' }, 404);
  const v = variants[idx]!;
  if (v.image) return json({ ok: true, image: v.image, cached: true });

  const src = PROTEIN_SOURCE_BY_ID.get(variantId);
  const draft: Recipe = {
    ...existing,
    id: `${id}--pv-${variantId}`,
    title: v.title || existing.title,
    groups: v.groups,
  };
  delete draft.image;
  try {
    const variantImage = await generateRecipeImage(
      env,
      draft,
      null,
      null,
      src ? `Proteinkälla i bilden: ${src.label}.` : null
    );
    if (!variantImage) return json({ error: 'Kunde inte generera bild' }, 502);
    variants[idx] = {
      ...v,
      image: variantImage,
      label: v.label || src?.label || variantId,
    };
    existing.proteinVariants = variants;
    await updateRecipe(env.DB, existing);
    return json({ ok: true, image: variantImage, cached: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Bild misslyckades' }, 502);
  }
}

function geminiKey(env: Env): string | null {
  const k = env.GEMINI_API_KEY;
  return k && String(k).trim() ? String(k).trim() : null;
}

async function handleEstimateMacros(request: Request, env: Env): Promise<Response> {
  let body: { recipe?: Recipe };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }

  const recipe = body.recipe;
  if (!recipe) return json({ error: 'Saknar recipe' }, 400);

  try {
    const { recipe: resolved, resolution } = await resolveRecipeNutrition(env.DB, recipe, { geminiApiKey: geminiKey(env) });
    const gate = nutritionGateError(resolution);
    return json({
      ok: true,
      macros: resolved.macros,
      recipe: resolved,
      source: 'nutrition',
      unmatchedCount: resolution.unmatchedCount,
      needsPieceWeightCount: resolution.needsPieceWeightCount,
      unresolved: gate?.unresolved || [],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Makroberäkning misslyckades' }, 502);
  }
}

async function handleIngredientSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '')
    .toLowerCase()
    .trim();
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 12));
  if (q.length < 2) return json({ ok: true, results: [] });

  const catalog = await loadNutritionCatalog(env.DB);
  const scored: { score: number; id: number; alias: string; canonical_name: string; kcal_per_100g: number; piece_weight_g: number | null }[] = [];
  const seen = new Set<number>();

  for (const [alias, ing] of catalog.byAlias) {
    if (!alias.includes(q) && !ing.canonical_name.toLowerCase().includes(q)) continue;
    let score = 1000;
    if (alias === q) score = 0;
    else if (alias.startsWith(q)) score = 10 + alias.length;
    else if (ing.canonical_name.toLowerCase().startsWith(q)) score = 20 + ing.canonical_name.length;
    else score = 100 + alias.length;
    // Prefer shorter, non-dish aliases; prefer rows with piece weight when query looks like piece use
    if (ing.canonical_name.length > 48) score += 30;
    scored.push({
      score,
      id: ing.id,
      alias,
      canonical_name: ing.canonical_name,
      kcal_per_100g: ing.kcal_per_100g,
      piece_weight_g: ing.piece_weight_g,
    });
  }

  scored.sort((a, b) => a.score - b.score || a.alias.localeCompare(b.alias, 'sv'));
  const results = [];
  for (const row of scored) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    results.push({
      id: row.id,
      alias: row.alias,
      canonical_name: row.canonical_name,
      kcal_per_100g: row.kcal_per_100g,
      piece_weight_g: row.piece_weight_g,
    });
    if (results.length >= limit) break;
  }
  return json({ ok: true, results });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }
  if (!(await verifyPassword(body.password || '', adminPassword(env)))) {
    return json({ error: 'Fel lösenord' }, 401);
  }
  const cookie = await makeSessionCookie(adminPassword(env));
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}

async function handleLogout(): Promise<Response> {
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

async function handleAuthCheck(request: Request, env: Env): Promise<Response> {
  return json({ ok: await isAuthed(request, adminPassword(env)) });
}

async function handleListRecipes(request: Request, env: Env): Promise<Response> {
  const recipes = await listRecipes(env.DB);
  const reviewSummaries = await listReviewSummaries(env.DB);
  const visitor = ensureVisitor(request);
  const headers = visitor.setCookie ? { 'Set-Cookie': visitor.setCookie } : undefined;
  return json({ ...recipes, reviewSummaries }, 200, headers);
}

async function handleGetReviews(request: Request, env: Env, recipeId: string): Promise<Response> {
  if (!(await getRecipe(env.DB, recipeId))) return json({ error: 'Hittades inte' }, 404);
  const visitor = ensureVisitor(request);
  const data = await getRecipeReviewData(env.DB, recipeId, visitor.visitorId);
  const headers = visitor.setCookie ? { 'Set-Cookie': visitor.setCookie } : undefined;
  return json(data, 200, headers);
}

async function handlePostReview(request: Request, env: Env, recipeId: string): Promise<Response> {
  if (!(await getRecipe(env.DB, recipeId))) return json({ error: 'Hittades inte' }, 404);
  let body: { rating?: number; comment?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }
  const rating = body.rating;
  if (typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return json({ error: 'Betyg ska vara 1–5' }, 400);
  }
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : '';
  const visitor = ensureVisitor(request);
  await upsertReview(env.DB, recipeId, visitor.visitorId, rating, comment);
  const data = await getRecipeReviewData(env.DB, recipeId, visitor.visitorId);
  const headers = visitor.setCookie ? { 'Set-Cookie': visitor.setCookie } : undefined;
  return json(data, 200, headers);
}

async function handleGetRecipe(env: Env, id: string): Promise<Response> {
  const row = await getRecipeWithMeta(env.DB, id);
  if (!row) return json({ error: 'Hittades inte' }, 404);
  return json({ recipe: row.recipe, featuredNew: row.featuredNew });
}

async function handleParse(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY saknas' }, 503);

  let body: {
    text?: string;
    sourceUrl?: string;
    imageBase64?: string;
    mimeType?: string;
    /** When set, merge additions into this recipe instead of creating from scratch. */
    recipe?: Recipe;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }

  const text = body.text || '';
  const sourceUrl = body.sourceUrl || '';
  if (!text.trim() && !body.imageBase64) {
    return json({ error: 'Ange text eller bild' }, 400);
  }

  const existing = body.recipe && typeof body.recipe === 'object' ? body.recipe : null;

  try {
    if (existing) {
      const recipe = await mergeRecipe(
        env.GEMINI_API_KEY,
        existing,
        text,
        body.imageBase64 || null,
        body.mimeType || null
      );
      delete recipe.emoji;
      if (!recipe.id) {
        recipe.id = existing.id
          ? String(existing.id)
          : slugify(String(recipe.title || existing.title || 'recept'));
      }
      const { recipe: resolved } = await resolveRecipeNutrition(env.DB, recipe, { geminiApiKey: geminiKey(env) });
      return json({ recipe: resolved, saveImage: false, merged: true });
    }

    const recipe = await parseRecipe(
      env.GEMINI_API_KEY,
      text,
      body.imageBase64 || null,
      body.mimeType || null,
      sourceUrl
    );
    delete recipe.emoji;
    if (!recipe.id) recipe.id = slugify(String(recipe.title || 'recept'));

    let saveImage = false;
    if (body.imageBase64 && body.mimeType) {
      saveImage = await detectFoodPhoto(env.GEMINI_API_KEY, body.imageBase64, body.mimeType);
    }

    const { recipe: resolved } = await resolveRecipeNutrition(env.DB, recipe, { geminiApiKey: geminiKey(env) });
    return json({ recipe: resolved, saveImage });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Parse misslyckades' }, 502);
  }
}

async function handleGenerateImage(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY saknas' }, 503);

  let body: {
    recipe?: Recipe;
    imageBase64?: string;
    mimeType?: string;
    imageInstructions?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }

  if (!body.recipe) return json({ error: 'Saknar recept' }, 400);

  try {
    const image = await generateFoodImageFromRecipe(
      env.GEMINI_API_KEY,
      body.recipe,
      body.imageBase64 || null,
      body.mimeType || null,
      body.imageInstructions || null
    );
    return json({ imageBase64: image.data, mimeType: image.mimeType });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Bildgenerering misslyckades' }, 502);
  }
}

async function handleEnhanceImage(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY saknas' }, 503);

  let body: { imageBase64?: string; mimeType?: string; title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }

  if (!body.imageBase64 || !body.mimeType) {
    return json({ error: 'Saknar bild' }, 400);
  }

  try {
    const image = await enhanceFoodImage(
      env.GEMINI_API_KEY,
      body.imageBase64,
      body.mimeType,
      String(body.title || 'maträtt')
    );
    return json({ imageBase64: image.data, mimeType: image.mimeType });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Bildförbättring misslyckades' }, 502);
  }
}

async function handleParseUrl(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY saknas' }, 503);

  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }

  const url = (body.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return json({ error: 'Ogiltig URL' }, 400);
  if (isSocialMediaUrl(url)) {
    return json({
      error: 'Instagram/TikTok fungerar inte här — använd Text + bild och klistra in caption.',
    }, 400);
  }

  try {
    const page = await fetchRecipePage(url);
    let imageBase64: string | null = null;
    let mimeType: string | null = null;
    if (page.imageUrl) {
      const img = await fetchImageAsBase64(page.imageUrl, url);
      if (img) {
        const hasFood = await detectFoodPhoto(env.GEMINI_API_KEY, img.data, img.mimeType);
        if (hasFood) {
          imageBase64 = img.data;
          mimeType = img.mimeType;
        }
      }
    }
    const recipe = await parseRecipe(
      env.GEMINI_API_KEY,
      page.text,
      null,
      null,
      url
    );
    if (page.pageTitle && (!recipe.source || recipe.source === 'Okänd källa')) {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        recipe.source = page.pageTitle.includes(host) ? page.pageTitle : `${page.pageTitle} (${host})`;
      } catch {
        /* ignore */
      }
    }
    delete recipe.emoji;
    if (!recipe.id) recipe.id = slugify(String(recipe.title || 'recept'));
    const { recipe: resolved } = await resolveRecipeNutrition(env.DB, recipe, { geminiApiKey: geminiKey(env) });
    return json({
      recipe: resolved,
      imageBase64,
      mimeType,
      imageFromUrl: !!imageBase64,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'URL-tolkning misslyckades' }, 502);
  }
}

async function handleCreateRecipe(request: Request, env: Env): Promise<Response> {
  let body: {
    recipe?: Recipe;
    imageBase64?: string;
    mimeType?: string;
    featuredNew?: boolean;
    skipImageGeneration?: boolean;
    uploadImage?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }

  const recipe = body.recipe;
  if (!recipe) return json({ error: 'Saknar recipe' }, 400);

  delete recipe.emoji;
  if (!recipe.id) recipe.id = slugify(String(recipe.title || 'recept'));
  normalizeRecipe(recipe);

  const skipAiImage = !!body.skipImageGeneration;
  const errors = validateRecipe(recipe, {}, { allowMissingImage: skipAiImage });
  if (errors.length) return json({ error: 'Validering', details: errors }, 400);

  if (await idExists(env.DB, String(recipe.id))) {
    return json({ error: 'Recept-id finns redan', id: recipe.id }, 409);
  }

  try {
    if (body.uploadImage && body.imageBase64 && body.mimeType) {
      recipe.image = await storeUploadedImage(
        env,
        String(recipe.id),
        body.imageBase64,
        body.mimeType
      );
    } else if (!skipAiImage && (!recipe.image || String(recipe.image).startsWith('blob:'))) {
      recipe.image = await resolveRecipeImage(
        env,
        recipe,
        body.imageBase64 || null,
        body.mimeType || null
      );
    } else if (!recipe.image) {
      delete recipe.image;
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Bild misslyckades' }, 502);
  }

  const { recipe: resolved, resolution } = await resolveRecipeNutrition(env.DB, recipe, { geminiApiKey: geminiKey(env) });
  const gate = nutritionGateError(resolution);
  if (gate) {
    return json(
      {
        error: 'Validering',
        details: gate.details,
        unresolved: gate.unresolved,
        unmatchedCount: resolution.unmatchedCount,
        needsPieceWeightCount: resolution.needsPieceWeightCount,
        recipe: resolved,
      },
      400
    );
  }
  await attachProteinVariants(env, resolved);
  await insertRecipe(env.DB, resolved, { featuredNew: !!body.featuredNew });
  await replaceRecipeIngredients(env.DB, String(resolved.id), resolution.rows);
  return json({ ok: true, recipe: resolved, featuredNew: !!body.featuredNew }, 201);
}

async function migrateRecipeImage(
  env: Env,
  oldId: string,
  newId: string,
  imageRef: string | undefined
): Promise<string | null> {
  if (!imageRef) return null;
  for (const key of imageRefCandidates(imageRef)) {
    const obj = await env.IMAGES.get(key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const mimeType = obj.httpMetadata?.contentType || 'image/jpeg';
    const newRef = await storeRecipeImage(
      env,
      newId,
      { data: bytesToBase64(bytes), mimeType },
      bytes
    );
    await env.IMAGES.delete(key);
    return newRef;
  }
  return null;
}

async function handleUpdateRecipe(request: Request, env: Env, id: string): Promise<Response> {
  let body: {
    recipe?: Recipe;
    imageBase64?: string;
    mimeType?: string;
    featuredNew?: boolean;
    regenerateImage?: boolean;
    enhanceImage?: boolean;
    generateImage?: boolean;
    uploadImage?: boolean;
    clearImage?: boolean;
    imageInstructions?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Ogiltig JSON' }, 400);
  }

  const recipe = body.recipe;
  if (!recipe) return json({ error: 'Saknar recipe' }, 400);
  delete recipe.emoji;

  const existing = await getRecipe(env.DB, id);
  if (!existing) return json({ error: 'Hittades inte' }, 404);

  const requestedId = slugify(String(recipe.id || id));
  const renaming = requestedId !== id;
  if (renaming) {
    if (await idExists(env.DB, requestedId)) {
      return json({ error: 'Validering', details: ['Id «' + requestedId + '» är redan upptaget'] }, 400);
    }
    recipe.id = requestedId;
  } else {
    recipe.id = id;
  }

  const existingImage = typeof existing.image === 'string' ? existing.image : undefined;
  const existingImageOk = existingImage ? await imageRefExists(env, existingImage) : false;

  if (!recipe.image && existingImageOk) recipe.image = existingImage;
  else if (recipe.image && !(await imageRefExists(env, recipe.image as string))) {
    delete recipe.image;
  }

  normalizeRecipe(recipe);

  const willSetImage = !!(
    body.generateImage ||
    body.uploadImage ||
    body.enhanceImage ||
    body.regenerateImage
  );
  const errors = validateRecipe(recipe, {}, { allowMissingImage: willSetImage });
  if (errors.length) return json({ error: 'Validering', details: errors }, 400);

  try {
    if (body.generateImage) {
      if (!body.imageBase64 && !existingImageOk) delete recipe.image;
      recipe.image = await generateRecipeImage(
        env,
        recipe,
        body.imageBase64 || null,
        body.mimeType || null,
        body.imageInstructions || null
      );
    } else if (body.enhanceImage || body.regenerateImage) {
      recipe.image = await enhanceRecipeImage(
        env,
        recipe,
        body.imageBase64 || null,
        body.mimeType || null,
        existing.image as string | undefined
      );
    } else if (body.clearImage) {
      delete recipe.image;
    } else if (body.uploadImage && body.imageBase64 && body.mimeType) {
      recipe.image = await storeUploadedImage(env, String(recipe.id), body.imageBase64, body.mimeType);
    } else if (!recipe.image && existingImageOk) {
      recipe.image = existingImage;
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Bild misslyckades' }, 502);
  }

  if (renaming && existingImageOk && existingImage && !body.uploadImage && !body.generateImage && !body.enhanceImage && !body.regenerateImage) {
    const migrated = await migrateRecipeImage(env, id, String(recipe.id), existingImage);
    if (migrated) recipe.image = migrated;
  }

  const { recipe: resolved, resolution } = await resolveRecipeNutrition(env.DB, recipe, { geminiApiKey: geminiKey(env) });
  const gate = nutritionGateError(resolution);
  if (gate) {
    return json(
      {
        error: 'Validering',
        details: gate.details,
        unresolved: gate.unresolved,
        unmatchedCount: resolution.unmatchedCount,
        needsPieceWeightCount: resolution.needsPieceWeightCount,
        recipe: resolved,
      },
      400
    );
  }
  await attachProteinVariants(env, resolved);
  const saved = renaming
    ? await renameRecipe(env.DB, id, resolved, body.featuredNew)
    : await updateRecipe(env.DB, resolved, body.featuredNew);
  if (!saved) {
    return json({ error: renaming ? 'Id upptaget eller kunde inte byta id' : 'Kunde inte spara' }, 400);
  }
  await replaceRecipeIngredients(env.DB, String(resolved.id), resolution.rows);
  const featuredNew = body.featuredNew !== undefined ? !!body.featuredNew : undefined;
  return json({ ok: true, recipe: resolved, featuredNew });
}

async function handleDeleteRecipe(env: Env, id: string): Promise<Response> {
  const existing = await getRecipe(env.DB, id);
  if (!existing) return json({ error: 'Hittades inte' }, 404);

  const imageRef = typeof existing.image === 'string' ? existing.image : undefined;
  if (imageRef) {
    for (const key of imageRefCandidates(imageRef)) {
      await env.IMAGES.delete(key);
    }
  }

  const deleted = await deleteRecipe(env.DB, id);
  if (!deleted) return json({ error: 'Hittades inte' }, 404);
  return json({ ok: true });
}

async function handleImage(env: Env, key: string): Promise<Response> {
  const decoded = decodeURIComponent(key);
  const candidates = imageRefCandidates(`/api/images/${decoded}`);
  for (const candidate of candidates.length ? candidates : [decoded]) {
    const obj = await env.IMAGES.get(candidate);
    if (!obj) continue;
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000');
    return new Response(obj.body, { headers });
  }
  return new Response('Not found', { status: 404 });
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/api/')) return null;

  const pw = adminPassword(env);

  if (path === '/api/health') {
    return json({ ok: true, service: 'receptbok' });
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    return handleLogout();
  }
  if (path === '/api/auth/check' && request.method === 'GET') {
    return handleAuthCheck(request, env);
  }

  if (path.startsWith('/api/images/') && request.method === 'GET') {
    const key = path.slice('/api/images/'.length);
    if (!key || key.includes('..')) return new Response('Bad request', { status: 400 });
    return handleImage(env, key);
  }

  if (path === '/api/recipes' && request.method === 'GET') {
    return handleListRecipes(request, env);
  }

  const reviewMatch = path.match(/^\/api\/recipes\/([^/]+)\/reviews$/);
  if (reviewMatch) {
    const id = decodeURIComponent(reviewMatch[1]);
    if (request.method === 'GET') return handleGetReviews(request, env, id);
    if (request.method === 'POST') return handlePostReview(request, env, id);
  }

  const proteinVarMatch = path.match(/^\/api\/recipes\/([^/]+)\/protein-variants$/);
  if (proteinVarMatch && request.method === 'GET') {
    return handleProteinVariants(env, decodeURIComponent(proteinVarMatch[1]!), false);
  }
  const proteinVarImgMatch = path.match(
    /^\/api\/recipes\/([^/]+)\/protein-variants\/([^/]+)\/image$/
  );
  if (proteinVarImgMatch && request.method === 'POST') {
    return handleProteinVariantImage(
      env,
      decodeURIComponent(proteinVarImgMatch[1]!),
      decodeURIComponent(proteinVarImgMatch[2]!)
    );
  }

  const recipeMatch = path.match(/^\/api\/recipes\/([^/]+)$/);
  if (recipeMatch) {
    const id = decodeURIComponent(recipeMatch[1]);
    if (request.method === 'GET') return handleGetRecipe(env, id);
  }

  const authErr = await requireAuth(request, pw);
  if (authErr) return authErr;

  if (proteinVarMatch && (request.method === 'POST' || request.method === 'PUT')) {
    return handleProteinVariants(env, decodeURIComponent(proteinVarMatch[1]!), true);
  }

  if (path.startsWith('/api/images/')) {
    const key = path.slice('/api/images/'.length);
    if (!key || key.includes('..')) return new Response('Bad request', { status: 400 });
    return handleImage(env, key);
  }

  if (path === '/api/recipes' && request.method === 'POST') {
    return handleCreateRecipe(request, env);
  }
  if (path === '/api/parse' && request.method === 'POST') {
    return handleParse(request, env);
  }
  if (path === '/api/parse-url' && request.method === 'POST') {
    return handleParseUrl(request, env);
  }
  if (path === '/api/enhance-image' && request.method === 'POST') {
    return handleEnhanceImage(request, env);
  }
  if (path === '/api/generate-image' && request.method === 'POST') {
    return handleGenerateImage(request, env);
  }
  if (path === '/api/estimate-macros' && request.method === 'POST') {
    return handleEstimateMacros(request, env);
  }
  if (path === '/api/ingredients/search' && request.method === 'GET') {
    return handleIngredientSearch(request, env);
  }

  if (recipeMatch) {
    const id = decodeURIComponent(recipeMatch[1]!);
    if (request.method === 'PUT') return handleUpdateRecipe(request, env, id);
    if (request.method === 'DELETE') return handleDeleteRecipe(env, id);
  }

  return null;
}

function isAddAdminPath(rawPath: string): boolean {
  return (
    rawPath === '/add.html'
    || /^\/add(\/(text|url|bild|redigera))?\/?$/.test(rawPath)
    || rawPath === '/recept/add'
    || /^\/recept\/add(\/(text|url|bild|redigera))?\/?$/.test(rawPath)
  );
}

/** Fetch add.html without re-entering the Worker (avoids redirect loops). */
function serveAddPage(env: Env): Promise<Response> {
  return env.ASSETS.fetch('https://assets.local/add.html');
}

function addCanonicalPath(rawPath: string, search: string): string | null {
  if (rawPath !== '/add' && rawPath !== '/recept/add') return null;
  const params = new URLSearchParams(search);
  const edit = params.get('edit');
  if (edit) {
    params.delete('edit');
    const rest = params.toString();
    return `${rawPath}/redigera?edit=${encodeURIComponent(edit)}${rest ? '&' + rest : ''}`;
  }
  return `${rawPath}/text`;
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function absoluteAssetUrl(origin: string, imageRef: unknown): string | null {
  if (typeof imageRef !== 'string' || !imageRef.trim()) return null;
  if (/^https?:\/\//i.test(imageRef)) return imageRef;
  if (imageRef.startsWith('/')) return origin + imageRef;
  return origin + '/' + imageRef.replace(/^\.\//, '');
}

function recipeShareDescription(recipe: Recipe): string {
  const badges = Array.isArray(recipe.badges)
    ? (recipe.badges as string[]).filter(Boolean).slice(0, 3).join(' · ')
    : '';
  const source = typeof recipe.source === 'string' && recipe.source.trim() ? recipe.source.trim() : '';
  const parts = [badges, source ? 'Från ' + source : ''].filter(Boolean);
  return parts.join(' — ') || 'Macro-friendly recipes by Jann';
}

function injectRecipeMeta(
  html: string,
  opts: { title: string; description: string; imageUrl: string | null; pageUrl: string; recipeId: string }
): string {
  const pageTitle = `${opts.title} — Macro-friendly recipes`;
  const tags = [
    `<meta charset="UTF-8">`,
    `<title>${escapeHtmlAttr(pageTitle)}</title>`,
    `<meta name="description" content="${escapeHtmlAttr(opts.description)}">`,
    `<link rel="canonical" href="${escapeHtmlAttr(opts.pageUrl)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="Macro-friendly recipes">`,
    `<meta property="og:title" content="${escapeHtmlAttr(opts.title)}">`,
    `<meta property="og:description" content="${escapeHtmlAttr(opts.description)}">`,
    `<meta property="og:url" content="${escapeHtmlAttr(opts.pageUrl)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtmlAttr(opts.title)}">`,
    `<meta name="twitter:description" content="${escapeHtmlAttr(opts.description)}">`,
    `<meta name="recept:id" content="${escapeHtmlAttr(opts.recipeId)}">`,
  ];
  if (opts.imageUrl) {
    tags.push(
      `<meta property="og:image" content="${escapeHtmlAttr(opts.imageUrl)}">`,
      `<meta property="og:image:alt" content="${escapeHtmlAttr(opts.title)}">`,
      `<meta name="twitter:image" content="${escapeHtmlAttr(opts.imageUrl)}">`
    );
  }

  let out = html.replace(/<title>[^<]*<\/title>/i, '');
  out = out.replace(/\s*<meta\s+charset=["']?UTF-8["']?\s*\/?>/i, '');
  out = out.replace(/\s*<meta\s+(?:name|property)="(?:description|og:[^"]+|twitter:[^"]+|recept:id)"[^>]*>/gi, '');
  out = out.replace(/\s*<link\s+rel="canonical"[^>]*>/gi, '');
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n${tags.join('\n')}\n`);
  }
  return out;
}

async function serveRecipeSharePage(request: Request, env: Env, recipeId: string): Promise<Response> {
  const origin = new URL(request.url).origin;
  const pageUrl = `${origin}/r/${encodeURIComponent(recipeId)}`;
  const assetRes = await env.ASSETS.fetch('https://assets.local/index.html');
  let html = await assetRes.text();

  // Alltid root-base så relativa assets funkar under /r/…
  if (!/<base\s/i.test(html) && /<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, '<head$1>\n<base href="/">\n');
  }

  const row = await getRecipeWithMeta(env.DB, recipeId);
  if (row?.recipe) {
    const recipe = row.recipe;
    const title = String(recipe.title || recipeId);
    html = injectRecipeMeta(html, {
      title,
      description: recipeShareDescription(recipe),
      imageUrl: absoluteAssetUrl(origin, recipe.image),
      pageUrl,
      recipeId,
    });
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const apiResponse = await handleApi(request, env, url);
    if (apiResponse) return apiResponse;

    const rawPath = url.pathname.replace(/\/$/, '') || '/';

    const recipePathMatch = rawPath.match(/^\/r\/([^/]+)$/);
    if (recipePathMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const id = decodeURIComponent(recipePathMatch[1]!);
      // Relative asset requests under /r/… (t.ex. /r/theme.js) → root-assets
      if (/\.[a-z0-9]{1,8}$/i.test(id)) {
        const assetUrl = new URL('/' + id, url.origin);
        return env.ASSETS.fetch(new Request(assetUrl, request));
      }
      const page = await serveRecipeSharePage(request, env, id);
      if (request.method === 'HEAD') {
        return new Response(null, { status: page.status, headers: page.headers });
      }
      return page;
    }

    const addCanonical = addCanonicalPath(rawPath, url.search);
    if (addCanonical) {
      return Response.redirect(new URL(addCanonical, url.origin).href, 302);
    }

    if (isAddAdminPath(rawPath)) {
      const authed = await isAuthed(request, adminPassword(env));
      if (!authed) {
        const next = encodeURIComponent(rawPath + url.search);
        return Response.redirect(new URL('/login.html?next=' + next, url.origin).href, 302);
      }
      return serveAddPage(env);
    }

    return env.ASSETS.fetch(request);
  },
};
