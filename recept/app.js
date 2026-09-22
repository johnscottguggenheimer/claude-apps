const CATEGORY_ORDER = ['frukost', 'lunch', 'middag', 'tillbehor', 'fika'];
const CATEGORY_LABELS = {
  frukost: 'Frukost',
  lunch: 'Lunch',
  middag: 'Middag',
  tillbehor: 'Tillbehör',
  fika: 'Fika & bakning'
};

var TAG_FILTER_ORDER = [
  'kyckling', 'notkott', 'flask', 'fisk', 'skaldjur', 'vegetarisk', 'vegan'
];
var TAG_LABELS = {
  kyckling: 'Kyckling',
  notkott: 'Nötkött',
  flask: 'Fläsk',
  fisk: 'Fisk',
  skaldjur: 'Skaldjur',
  vegetarisk: 'Vegetariskt',
  vegan: 'Veganskt'
};

var PROTEIN_TAG_ORDER = ['kyckling', 'notkott', 'flask', 'fisk', 'skaldjur'];
var OMNIVORE_PROTEIN_TAGS = { kyckling: 1, notkott: 1, flask: 1 };
var FISH_PROTEIN_TAGS = { fisk: 1, skaldjur: 1 };

/** undefined = follow list pref; null = original; string = proteinVariants[].id */
var detailProteinVariantId = undefined;

function primaryProteinTag(r) {
  if (!r || !r.tags) return null;
  for (var i = 0; i < PROTEIN_TAG_ORDER.length; i++) {
    if (r.tags.indexOf(PROTEIN_TAG_ORDER[i]) !== -1) return PROTEIN_TAG_ORDER[i];
  }
  return null;
}

/** Eat-mode from list filter: null | 'pesc' | 'vegetarisk' */
function getListEatMode() {
  if (!activeFilter || activeFilter.type !== 'diet' || !activeFilter.value) return null;
  if (window.ReceptBrowseNav && ReceptBrowseNav.normalizeDietValue) {
    return ReceptBrowseNav.normalizeDietValue(activeFilter.value);
  }
  return activeFilter.value === 'pesc' || activeFilter.value === 'vegetarisk'
    ? activeFilter.value
    : null;
}

function pickPreferredVariant(variants, pref) {
  if (!pref || !variants || !variants.length) return null;
  if (pref === 'fisk') {
    for (var i = 0; i < variants.length; i++) {
      if (variants[i].tier === 'fisk') return variants[i];
    }
    return null;
  }
  if (pref === 'vegan') {
    for (var j = 0; j < variants.length; j++) {
      if (variants[j].tier === 'vegan') return variants[j];
    }
    return null;
  }
  // vegetarisk: vegan first, then lacto-veg
  for (var k = 0; k < variants.length; k++) {
    if (variants[k].tier === 'vegan') return variants[k];
  }
  for (var m = 0; m < variants.length; m++) {
    if (variants[m].tier === 'vegetarisk') return variants[m];
  }
  return null;
}

function pickEatModeVariant(base, mode) {
  if (!base || !mode) return null;
  var nav = window.ReceptBrowseNav;
  if (mode === 'pesc') {
    if (nav && (nav.recipeIsFishNative(base) || nav.recipeIsPlantNative(base))) return null;
    return (
      pickPreferredVariant(base.proteinVariants, 'fisk') ||
      pickPreferredVariant(base.proteinVariants, 'vegetarisk')
    );
  }
  if (mode === 'vegetarisk') {
    if (nav && nav.recipeIsPlantNative(base)) return null;
    return pickPreferredVariant(base.proteinVariants, 'vegetarisk');
  }
  return null;
}

function findProteinVariant(base, variantId) {
  if (!base || !variantId || !base.proteinVariants) return null;
  for (var i = 0; i < base.proteinVariants.length; i++) {
    if (base.proteinVariants[i].id === variantId) return base.proteinVariants[i];
  }
  return null;
}

function applyProteinVariantOverlay(base, variant) {
  if (!base || !variant || !variant.groups) return base;
  var out = {};
  for (var k in base) {
    if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
  }
  out.groups = variant.groups;
  if (variant.macros) out.macros = variant.macros;
  if (variant.title) out.title = variant.title;
  // Ignore stale variant images that point at the original recipe file.
  if (variant.image && variant.image !== base.image) out.image = variant.image;
  out._proteinVariantId = variant.id;
  out._proteinVariantLabel = variant.label || variant.id;
  return out;
}

function getDisplayRecipe(base) {
  if (!base) return base;
  if (detailProteinVariantId === null) return base;
  if (typeof detailProteinVariantId === 'string') {
    var selected = findProteinVariant(base, detailProteinVariantId);
    if (selected) return applyProteinVariantOverlay(base, selected);
  }
  var preferred = pickEatModeVariant(base, getListEatMode());
  if (preferred) return applyProteinVariantOverlay(base, preferred);
  var searchHit = pickSearchMatchingVariant(base, searchQuery);
  if (searchHit) return applyProteinVariantOverlay(base, searchHit);
  return base;
}

function recipeNeedsProteinSwapControl(base) {
  if (!base) return false;
  var tag = primaryProteinTag(base);
  if (tag && (OMNIVORE_PROTEIN_TAGS[tag] || FISH_PROTEIN_TAGS[tag])) return true;
  return !!(base.proteinVariants && base.proteinVariants.length);
}

if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function() {
    while (this.firstChild) this.removeChild(this.firstChild);
    for (var i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
  };
}

var BASE_PATH = (function() {
  var path = location.pathname;
  var idx = path.indexOf('/recept');
  if (idx !== -1) return path.slice(0, idx + 7) + '/';
  if (/^\/r(\/|$)/.test(path)) return '/';
  if (path.endsWith('/')) return path;
  if (/\.html$/i.test(path)) return path.replace(/[^/]+$/, '');
  return '/';
})();

var RECEPT_COOKIE_PATH = (function() {
  var path = location.pathname;
  var idx = path.indexOf('/recept');
  if (idx <= 0) return '/';
  return path.slice(0, idx) || '/';
})();

function assetUrl(path) {
  if (!path || /^https?:\/\//i.test(path)) return path;
  if (path.indexOf('/api/') === 0) return location.origin + path;
  var dir = BASE_PATH;
  if (dir.slice(-1) !== '/') dir += '/';
  var tail = path.replace(/^\//, '');
  return location.origin + dir + tail;
}

function recipePath(id) {
  var base = BASE_PATH;
  if (!base || base === '/') return '/r/' + encodeURIComponent(id);
  if (base.slice(-1) === '/') base = base.slice(0, -1);
  return base + '/r/' + encodeURIComponent(id);
}

function recipeLink(id) {
  return recipePath(id);
}

function addPageUrl(editId, sub) {
  var base = BASE_PATH;
  if (!base.endsWith('/')) base += '/';
  var path = base === '/' ? '/add' : base + 'add';
  if (editId) return path + '/redigera?edit=' + encodeURIComponent(editId);
  return path + '/' + (sub || 'text');
}

var FEATURED_NEW_IDS = [];
var VISIT_COOKIE_NAME = 'recept_seen_new';
var FAVORITES_COOKIE_NAME = 'recept_favorites';
var CARD_DISPLAY_COOKIE_NAME = 'recept_card_display';
var VISIT_COOKIE_MAX_AGE = String(365 * 24 * 60 * 60);
var DEFAULT_CARD_DISPLAY = { showNew: false, showQuickMacros: true };

function readIdCookie(name) {
  try {
    var parts = document.cookie.split(';');
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].trim();
      if (s.indexOf(name + '=') === 0) {
        return JSON.parse(decodeURIComponent(s.slice(name.length + 1)));
      }
    }
  } catch (e) {}
  return {};
}

function writeIdCookie(name, data) {
  document.cookie = name + '=' + encodeURIComponent(JSON.stringify(data)) + ';path=' + RECEPT_COOKIE_PATH + ';max-age=' + VISIT_COOKIE_MAX_AGE + ';SameSite=Lax';
}

function getSeenRecipeIds() {
  return readIdCookie(VISIT_COOKIE_NAME);
}

function getFavoriteIds() {
  return readIdCookie(FAVORITES_COOKIE_NAME);
}

function isFavorite(id) {
  return !!getFavoriteIds()[id];
}

function getCardDisplayPrefs() {
  var data = readIdCookie(CARD_DISPLAY_COOKIE_NAME);
  if (!data || typeof data !== 'object') {
    return { showNew: DEFAULT_CARD_DISPLAY.showNew, showQuickMacros: DEFAULT_CARD_DISPLAY.showQuickMacros };
  }
  return {
    showNew: data.showNew === true,
    showQuickMacros: data.showQuickMacros !== false
  };
}

function setCardDisplayPrefs(prefs) {
  writeIdCookie(CARD_DISPLAY_COOKIE_NAME, {
    showNew: !!prefs.showNew,
    showQuickMacros: !!prefs.showQuickMacros
  });
}

function toggleFavorite(id) {
  var favs = getFavoriteIds();
  if (favs[id]) delete favs[id];
  else favs[id] = 1;
  writeIdCookie(FAVORITES_COOKIE_NAME, favs);
}

function syncFavoriteButton(btn, recipeId) {
  var on = isFavorite(recipeId);
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? 'Ta bort från favoriter' : 'Spara som favorit');
}

function createFavoriteButton(recipeId, extraClass) {
  var btn = mk('button', 'fav-btn' + (extraClass ? ' ' + extraClass : ''));
  btn.type = 'button';
  syncFavoriteButton(btn, recipeId);
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'fav-btn-icon');
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z');
  svg.appendChild(path);
  btn.appendChild(svg);
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(recipeId);
    syncFavoriteButton(btn, recipeId);
    updateFavoritesToggleBtn();
    if (showFavoritesOnly && !document.getElementById('view-detail').classList.contains('hidden')) return;
    if (showFavoritesOnly) renderList();
  });
  return btn;
}

function createCardEditButton(recipeId) {
  var btn = mk('button', 'recipe-card-edit');
  btn.type = 'button';
  btn.textContent = 'Redigera';
  btn.setAttribute('aria-label', 'Redigera recept');
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    try { sessionStorage.setItem('recept_edit_id', recipeId); } catch (err) {}
    location.href = addPageUrl(recipeId);
  });
  return btn;
}

function updateFavoritesToggleBtn() {
  var btn = document.getElementById('favorites-toggle-btn');
  if (!btn) return;
  btn.classList.toggle('active', showFavoritesOnly);
  btn.setAttribute('aria-pressed', showFavoritesOnly ? 'true' : 'false');
}

function markRecipeVisited(id) {
  if (FEATURED_NEW_IDS.indexOf(id) === -1) return;
  var seen = getSeenRecipeIds();
  seen[id] = 1;
  writeIdCookie(VISIT_COOKIE_NAME, seen);
}

function shouldMarkRecipeVisited(id) {
  var skipKey = 'recept_skip_visit_' + id;
  if (sessionStorage.getItem(skipKey)) {
    sessionStorage.removeItem(skipKey);
    return false;
  }
  return true;
}

function shouldShowNewBadge(id) {
  if (FEATURED_NEW_IDS.indexOf(id) === -1) return false;
  return !getSeenRecipeIds()[id];
}

function sortRecipesForList(filtered) {
  return filtered.sort(function(a, b) {
    var aNew = shouldShowNewBadge(a.id) ? 1 : 0;
    var bNew = shouldShowNewBadge(b.id) ? 1 : 0;
    if (aNew !== bNew) return bNew - aNew;
    var au = a.updatedAt || a.createdAt || '';
    var bu = b.updatedAt || b.createdAt || '';
    if (au === bu) return 0;
    return au < bu ? 1 : -1;
  });
}

function getRecipeIdFromLocation() {
  var path = location.pathname.replace(/\/$/, '') || '/';
  var m = path.match(/(?:^|\/)r\/([^/]+)$/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  var raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch (e) { return raw; }
}

function setListUrl(replace) {
  syncFiltersToUrl(replace);
  document.title = 'Macro-friendly recipes';
}

function setRecipeUrl(id, replace) {
  var url = recipePath(id);
  if (replace) history.replaceState({ view: 'recipe', id: id }, '', url);
  else history.pushState({ view: 'recipe', id: id }, '', url);
}

function getFilterState() {
  return {
    activeFilter: activeFilter,
    activeMulti: activeMultiFilter,
    favorites: showFavoritesOnly,
    search: searchQuery.trim()
  };
}

function applyFilterState(state) {
  if (!state) return;
  activeFilter = state.activeFilter || { type: 'all', value: null };
  activeMultiFilter = state.activeMulti || {
    protein: [], cuisine: [], maxKcal100: null, minProt100: null
  };
  showFavoritesOnly = !!state.favorites;
  searchQuery = state.search || '';
  var searchInput = document.getElementById('recipe-search');
  if (searchInput && searchInput.value !== searchQuery) searchInput.value = searchQuery;
}

function buildCurrentListUrl() {
  if (window.ReceptBrowseNav && ReceptBrowseNav.buildListUrl) {
    return ReceptBrowseNav.buildListUrl(BASE_PATH, getFilterState());
  }
  return BASE_PATH + location.search;
}

function syncFiltersToUrl(replace) {
  var url = buildCurrentListUrl();
  if (replace) history.replaceState(history.state || { view: 'list' }, '', url);
  else history.pushState({ view: 'list' }, '', url);
}

function applyFiltersFromUrl() {
  if (!window.ReceptBrowseNav || !ReceptBrowseNav.parseListUrl) return;
  applyFilterState(ReceptBrowseNav.parseListUrl(location.search));
  updateFavoritesToggleBtn();
}

var recipes = [];
var reviewSummaries = {};
var activeFilter = { type: 'all', value: null };
var activeMultiFilter = { protein: [], cuisine: [], maxKcal100: null, minProt100: null };
var searchQuery = '';
var showFavoritesOnly = false;
var currentServings = 1;
var currentId = null;

/** Display-only: max 1 decimal, no trailing .0 (e.g. 3.333… → "3.3", 4 → "4"). */
function fmtNum(val) {
  var n = Math.round(Number(val) * 10) / 10;
  return (Math.abs(n - Math.round(n)) < 1e-9) ? String(Math.round(n)) : n.toFixed(1);
}

function fmt(val, unit) {
  if (unit === 'g') return Math.round(val) + 'g';
  if (unit === 'msk') return fmtNum(val) + ' msk';
  if (unit === 'tsk') {
    if (val < 0.4) return '¼ tsk';
    if (val < 0.7) return '½ tsk';
    if (val < 1.4) return '1 tsk';
    return fmtNum(val) + ' tsk';
  }
  if (unit === 'st') return fmtNum(val) + ' st';
  if (unit === 'pinch') return 'en nypa';
  if (unit === 'näve') return '1 näve';
  if (unit === 'strimlor') return Math.round(val) + ' strimlor';
  return fmtNum(val) + ' ' + unit;
}

function finiteOrNull(n) {
  var v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Steg A: radmakron kommer endast från sparad serverdata (inga klient-lookup). */
function estimateIngredientRow(ing) {
  var name = String(ing.name || '').trim();
  if (!name) return null;
  var grams = finiteOrNull(ing.resolved_grams);
  if (grams != null && grams <= 0) grams = null;
  if (ing.macros && typeof ing.macros === 'object') {
    var mkcal = finiteOrNull(ing.macros.kcal);
    var mprot = finiteOrNull(ing.macros.prot);
    var mcarb = finiteOrNull(ing.macros.carb);
    var mfat = finiteOrNull(ing.macros.fat);
    if (mkcal != null && mprot != null && mcarb != null && mfat != null) {
      return { kcal: mkcal, prot: mprot, carb: mcarb, fat: mfat, grams: grams };
    }
  }
  return null;
}

function countUnresolvedIngredients(r) {
  var n = 0;
  (r.groups || []).forEach(function(g) {
    (g.ingredients || []).forEach(function(ing) {
      var st = ing.match_status;
      if (st === 'unmatched' || st === 'needs_piece_weight') n += 1;
      else if (!st && !(ing.macros && typeof ing.macros === 'object')) {
        /* legacy rows without match_status: treat missing macros as unresolved when macros mode cares */
      }
    });
  });
  return n;
}

function fillIngMacrosCell(cell, row, scale) {
  cell.replaceChildren();
  if (!row) return;
  var s = scale || 1;
  var kcal = finiteOrNull(row.kcal);
  var prot = finiteOrNull(row.prot);
  var carb = finiteOrNull(row.carb);
  var fat = finiteOrNull(row.fat);
  var gramsRaw = finiteOrNull(row.grams);
  var hasMacros = kcal != null && prot != null && carb != null && fat != null;
  var grams = gramsRaw != null && gramsRaw > 0 ? Math.round(gramsRaw * s) : null;
  if (!hasMacros) return;
  // Dölj 0🔥-rader (salt, kryddor, nypor) — ingen utskrift alls.
  if (Math.round(kcal * s) === 0) return;
  var kcalEl = mk('span', 'ing-mac-kcal');
  kcalEl.textContent = Math.round(kcal * s) + '🔥';
  cell.appendChild(kcalEl);
  cell.appendChild(document.createTextNode(' '));
  var pEl = mk('span', 'ing-mac-p');
  pEl.textContent = Math.round(prot * s) + 'P';
  cell.appendChild(pEl);
  cell.appendChild(document.createTextNode(' '));
  var fEl = mk('span', 'ing-mac-f');
  fEl.textContent = Math.round(fat * s) + 'F';
  cell.appendChild(fEl);
  cell.appendChild(document.createTextNode(' '));
  var cEl = mk('span', 'ing-mac-c');
  cEl.textContent = Math.round(carb * s) + 'C';
  cell.appendChild(cEl);
  if (grams != null) {
    cell.appendChild(document.createTextNode(' '));
    var gEl = mk('span', 'ing-mac-g');
    gEl.textContent = grams + 'g';
    cell.appendChild(gEl);
  }
}

function estimateRecipeTotalGrams(r) {
  if (!r || !r.groups) return null;
  var total = 0;
  var any = false;
  r.groups.forEach(function(g) {
    (g.ingredients || []).forEach(function(ing) {
      var grams = finiteOrNull(ing.resolved_grams);
      if (grams == null || grams < 0) return;
      any = true;
      total += grams;
    });
  });
  if (!any) return null;
  return total > 0 ? total : null;
}

/** Per-100g macros from recipe totals + estimated edible grams. Null if unusable. */
function recipeMacrosPer100g(r) {
  if (!r || !r.macros) return null;
  var kcal = finiteOrNull(r.macros.kcal);
  var prot = finiteOrNull(r.macros.prot);
  if (kcal == null || prot == null) return null;
  var totalGrams = estimateRecipeTotalGrams(r);
  if (totalGrams == null || totalGrams < 20) return null;
  var kcal100 = Math.round((kcal / totalGrams) * 100);
  var prot100 = Math.round((prot / totalGrams) * 100);
  if (!Number.isFinite(kcal100) || !Number.isFinite(prot100)) return null;
  return { kcal: kcal100, prot: prot100 };
}

/** Compact list-card label: «30P - 100🔥 / 100g». Omits when grams/macros unusable. */
function formatCardMacrosPer100g(r) {
  var m = recipeMacrosPer100g(r);
  if (!m) return null;
  return m.prot + 'P - ' + m.kcal + '🔥 / 100g';
}

function mk(tag, cls) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function categoryLabel(key) {
  return CATEGORY_LABELS[key] || key;
}

function formatStars(avg) {
  var full = Math.round(avg);
  var s = '';
  for (var i = 1; i <= 5; i++) s += i <= full ? '★' : '☆';
  return s;
}

function sourceKind(r) {
  var url = String(r.sourceUrl || '').toLowerCase();
  var src = String(r.source || '').toLowerCase();
  var label = String(r.source || '').trim();
  if (/^eget recept$/i.test(label)) return 'own';
  if (/claude|chatgpt|gemini|openai|copilot/i.test(src)) return 'ai';
  if (url.indexOf('instagram.com') !== -1 || /\binstagram\b/.test(src)) return 'instagram';
  if (url.indexOf('tiktok.com') !== -1 || /\btiktok\b/.test(src)) return 'tiktok';
  if (url.indexOf('cooking.nytimes.com') !== -1 || /\bnyt cooking\b/.test(src)) return 'nyt';
  if (/^https?:\/\//i.test(url)) return 'web';
  if (/^@[\w.]+/.test(label)) return 'instagram';
  return 'web';
}

function formatSourceLabel(source) {
  if (!source) return '';
  return String(source).trim()
    .replace(/\s+på Instagram\s*$/i, '')
    .replace(/\s+on Instagram\s*$/i, '')
    .replace(/\s+på TikTok\s*$/i, '')
    .replace(/\s+on TikTok\s*$/i, '');
}

function isKnownSource(source) {
  if (!source) return false;
  return !/^okänd källa$/i.test(String(source).trim());
}

function svgEl(tag, attrs) {
  var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    Object.keys(attrs).forEach(function(k) { el.setAttribute(k, attrs[k]); });
  }
  return el;
}

function createLineIcon(kind) {
  var svg = svgEl('svg', {
    class: 'meta-line-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  });
  if (kind === 'clock') {
    svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '10' }));
    svg.appendChild(svgEl('path', { d: 'M12 6v6l4 2' }));
    return svg;
  }
  if (kind === 'own') {
    svg.appendChild(svgEl('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }));
    svg.appendChild(svgEl('circle', { cx: '12', cy: '7', r: '4' }));
    return svg;
  }
  if (kind === 'ai') {
    svg.appendChild(svgEl('path', {
      d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.581 6.135a.5.5 0 0 1-.963 0L9.937 15.5z'
    }));
    return svg;
  }
  if (kind === 'web') {
    svg.appendChild(svgEl('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }));
    svg.appendChild(svgEl('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }));
    return svg;
  }
  if (kind === 'instagram') {
    svg.appendChild(svgEl('rect', { x: '2', y: '2', width: '20', height: '20', rx: '5', ry: '5' }));
    svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '4' }));
    svg.appendChild(svgEl('circle', { cx: '17.5', cy: '6.5', r: '1', fill: 'currentColor', stroke: 'none' }));
    return svg;
  }
  if (kind === 'tiktok') {
    svg.appendChild(svgEl('path', {
      d: 'M9 6v12a3 3 0 1 0 3-3V7h4V4h-7v2z',
      fill: 'currentColor',
      stroke: 'none'
    }));
    return svg;
  }
  svg.appendChild(svgEl('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }));
  svg.appendChild(svgEl('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }));
  return svg;
}

function createSourceIcon(kind) {
  if (kind === 'nyt') {
    var nyt = svgEl('svg', {
      class: 'meta-line-icon meta-line-icon--nyt',
      viewBox: '0 0 20 26',
      fill: 'none',
      'aria-hidden': 'true'
    });
    nyt.appendChild(svgEl('path', {
      d: 'M19.525 15.6349C19.1493 16.6925 18.5552 17.6592 17.7813 18.472C17.0073 19.2849 16.0709 19.9257 15.033 20.3528V15.6349L17.626 13.3089L15.033 11.0169V7.77185C16.0865 7.7499 17.0909 7.32167 17.8361 6.57663C18.5813 5.83159 19.0098 4.82739 19.032 3.77385C19.032 0.98785 16.366 0.00185009 14.867 0.00185009C14.4585 -0.00995777 14.0503 0.0347997 13.654 0.13485V0.26785C13.854 0.26785 14.147 0.23485 14.247 0.23485C15.293 0.23485 16.08 0.72785 16.08 1.67485C16.0717 1.87808 16.0223 2.07752 15.9348 2.26114C15.8473 2.44476 15.7235 2.60875 15.5709 2.74322C15.4183 2.8777 15.2401 2.97987 15.0469 3.04356C14.8537 3.10726 14.6497 3.13117 14.447 3.11385C11.855 3.11385 8.809 1.02085 5.497 1.02085C2.547 0.98785 0.52 3.20085 0.52 5.40585C0.52 7.61185 1.793 8.32485 3.139 8.81785V8.68485C2.89987 8.5325 2.70658 8.31807 2.57978 8.06446C2.45297 7.81085 2.3974 7.52757 2.419 7.24485C2.45518 6.73213 2.69275 6.25454 3.07983 5.91636C3.46691 5.57818 3.97206 5.40688 4.485 5.43985C7.27 5.43985 11.755 7.77285 14.54 7.77285H14.807V11.0449L12.215 13.3099L14.807 15.6358V20.4208C13.7372 20.7984 12.6094 20.9856 11.475 20.9739C7.15 20.9739 4.398 18.3538 4.398 13.9969C4.388 12.9658 4.532 11.9399 4.825 10.9509L6.984 9.99785V19.6339L11.375 17.7018V7.86485L4.938 10.7169C5.24212 9.83553 5.71707 9.02285 6.33566 8.32532C6.95426 7.6278 7.70435 7.05912 8.543 6.65185L8.51 6.53185C4.185 7.50485 0 10.7838 0 15.7018C0 21.3658 4.785 25.2969 10.355 25.2969C16.253 25.2969 19.598 21.3659 19.631 15.6349H19.525Z',
      fill: 'currentColor'
    }));
    return nyt;
  }
  if (kind === 'own' || kind === 'ai' || kind === 'web' || kind === 'instagram' || kind === 'tiktok') {
    return createLineIcon(kind);
  }
  return createLineIcon('web');
}

function appendTimeLine(container, r, className) {
  var time = formatRecipeTime(r);
  if (!time) return;
  var row = mk('div', className || 'recipe-card-time');
  row.appendChild(createLineIcon('clock'));
  var span = document.createElement('span');
  span.textContent = time;
  row.appendChild(span);
  container.appendChild(row);
}

function appendSourceLine(container, r, opts) {
  if (!isKnownSource(r.source)) return;
  opts = opts || {};
  var kind = sourceKind(r);
  var label = formatSourceLabel(r.source);
  var row = mk('div', opts.className || 'recipe-card-source');
  row.appendChild(createSourceIcon(kind));
  var hasUrl = r.sourceUrl && r.sourceUrl !== '#';
  if (hasUrl) {
    var a = mk('a', 'recipe-card-source-label');
    a.href = r.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    row.appendChild(a);
  } else {
    var span = mk('span', 'recipe-card-source-label');
    span.textContent = label;
    row.appendChild(span);
  }
  container.appendChild(row);
}

function recipeVariantMatchesQuery(variant, q) {
  if (!variant || !q) return false;
  if (variant.title && variant.title.toLowerCase().indexOf(q) !== -1) return true;
  if (variant.label && variant.label.toLowerCase().indexOf(q) !== -1) return true;
  if (variant.id && String(variant.id).toLowerCase().indexOf(q) !== -1) return true;
  var groups = variant.groups || [];
  for (var g = 0; g < groups.length; g++) {
    var ings = groups[g].ingredients || [];
    for (var j = 0; j < ings.length; j++) {
      if (ings[j].name && ings[j].name.toLowerCase().indexOf(q) !== -1) return true;
    }
  }
  return false;
}

function recipeMatchesSearch(r, q) {
  if (!q) return true;
  q = q.toLowerCase().trim();
  if (r.title && r.title.toLowerCase().indexOf(q) !== -1) return true;
  if (r.tags) {
    for (var i = 0; i < r.tags.length; i++) {
      var tagLabel = (TAG_LABELS[r.tags[i]] || r.tags[i]).toLowerCase();
      if (tagLabel.indexOf(q) !== -1) return true;
    }
  }
  if (r.groups) {
    for (var g = 0; g < r.groups.length; g++) {
      var ings = r.groups[g].ingredients || [];
      for (var j = 0; j < ings.length; j++) {
        if (ings[j].name && ings[j].name.toLowerCase().indexOf(q) !== -1) return true;
      }
    }
  }
  var variants = r.proteinVariants || [];
  for (var v = 0; v < variants.length; v++) {
    if (recipeVariantMatchesQuery(variants[v], q)) return true;
  }
  return false;
}

function pickSearchMatchingVariant(base, q) {
  if (!base || !q) return null;
  q = q.toLowerCase().trim();
  if (!q) return null;
  var variants = base.proteinVariants || [];
  for (var i = 0; i < variants.length; i++) {
    if (recipeVariantMatchesQuery(variants[i], q)) return variants[i];
  }
  return null;
}

function listHeadingText() {
  var label = window.ReceptBrowseNav
    ? ReceptBrowseNav.filterLabel(activeFilter)
    : 'Jag äter allt';
  if (showFavoritesOnly) {
    if (searchQuery.trim()) return 'Favoriter — sökresultat';
    if (!isAllFilter()) return 'Favoriter — ' + label;
    return 'Favoriter';
  }
  if (searchQuery.trim()) return 'Sökresultat';
  return label;
}

function isAllFilter() {
  return !activeFilter || activeFilter.type === 'all';
}

function recipeMatchesMacroDensity(r) {
  var maxKcal = activeMultiFilter && activeMultiFilter.maxKcal100;
  var minProt = activeMultiFilter && activeMultiFilter.minProt100;
  if (maxKcal == null && minProt == null) return true;
  var m = recipeMacrosPer100g(r);
  if (!m) return false;
  if (maxKcal != null && m.kcal > maxKcal) return false;
  if (minProt != null && m.prot < minProt) return false;
  return true;
}

function recipeMatchesFilter(r) {
  if (window.ReceptBrowseNav) {
    if (!ReceptBrowseNav.recipeMatchesFilter(r, activeFilter)) return false;
    if (!ReceptBrowseNav.recipeMatchesMultiFilters(r, activeMultiFilter)) return false;
    return recipeMatchesMacroDensity(r);
  }
  if (isAllFilter()) return true;
  if (activeFilter.type === 'category') return r.category === activeFilter.value;
  if (activeFilter.type === 'tag') {
    return r.tags && r.tags.indexOf(activeFilter.value) !== -1;
  }
  return recipeMatchesMacroDensity(r);
}

function updateListHeading() {
  var el = document.getElementById('list-heading');
  if (el) el.textContent = listHeadingText();
}

function appendCardDisplayPrefs(container) {
  if (!container) return;
  var prefs = getCardDisplayPrefs();
  var wrap = mk('div', 'list-filter-display-prefs');

  function makePref(key, labelText, checked) {
    var label = mk('label', 'list-filter-display-pref');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    label.appendChild(input);
    var span = document.createElement('span');
    span.textContent = labelText;
    label.appendChild(span);
    input.addEventListener('change', function(e) {
      e.stopPropagation();
      var next = getCardDisplayPrefs();
      next[key] = input.checked;
      setCardDisplayPrefs(next);
      renderList();
    });
    return label;
  }

  wrap.appendChild(makePref('showNew', 'Visa "Nytt!"', prefs.showNew));
  wrap.appendChild(makePref('showQuickMacros', 'Visa quick macros', prefs.showQuickMacros));
  container.appendChild(wrap);
  container.hidden = false;
}

function recipesForListFilters() {
  if (!window.ReceptBrowseNav) return recipes;
  return recipes.filter(function(r) {
    return ReceptBrowseNav.recipeMatchesFilter(r, activeFilter);
  });
}

function renderListFilters() {
  var el = document.getElementById('list-filters');
  if (!el || !window.ReceptBrowseNav) return;
  ReceptBrowseNav.renderListFilters(el, {
    recipes: recipesForListFilters(),
    activeMulti: activeMultiFilter,
    onChange: function(multi) {
      activeMultiFilter = multi;
      syncFiltersToUrl(false);
      renderListFilters();
      renderList();
    }
  });
  appendCardDisplayPrefs(el);
}

function renderBrowseNav() {
  var nav = document.getElementById('browse-nav');
  if (nav) {
    nav.replaceChildren();
    nav.hidden = true;
    var row = nav.closest('.site-nav-row');
    if (row) row.hidden = true;
  }
  renderEatModeControl();
}

function renderEatModeControl() {
  var host = document.getElementById('list-eat-mode');
  if (!host || !window.ReceptBrowseNav) return;
  var labels = ReceptBrowseNav.DIET_LABELS || {};
  var mode = getListEatMode();
  var currentLabel = mode && labels[mode] ? labels[mode] : labels.all || 'Jag äter allt';

  host.replaceChildren();
  var wrap = mk('div', 'list-eat-wrap');
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'list-eat-btn' + (mode ? ' list-eat-btn--active' : '');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Byt: ' + currentLabel);
  var btnLabel = mk('span', 'list-eat-btn-label');
  btnLabel.textContent = 'Byt';
  btn.appendChild(btnLabel);
  var chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'list-eat-chevron');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.setAttribute('aria-hidden', 'true');
  var chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  chevronPath.setAttribute('d', 'M6 9l6 6 6-6');
  chevronPath.setAttribute('fill', 'none');
  chevronPath.setAttribute('stroke', 'currentColor');
  chevronPath.setAttribute('stroke-width', '2');
  chevronPath.setAttribute('stroke-linecap', 'round');
  chevronPath.setAttribute('stroke-linejoin', 'round');
  chevron.appendChild(chevronPath);
  btn.appendChild(chevron);

  var menu = mk('div', 'list-eat-menu');
  menu.setAttribute('role', 'menu');

  function closeMenu() {
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  function addOption(label, filter) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'list-eat-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    var selected =
      (!mode && filter.type === 'all') ||
      (mode && filter.type === 'diet' && filter.value === mode);
    if (selected) item.classList.add('is-selected');
    item.addEventListener('click', function() {
      closeMenu();
      activeFilter = filter;
      detailProteinVariantId = undefined;
      syncFiltersToUrl(false);
      renderEatModeControl();
      renderListFilters();
      renderList();
      updateListHeading();
    });
    menu.appendChild(item);
  }

  addOption(labels.all || 'Jag äter allt', { type: 'all', value: null });
  addOption(labels.pesc || 'Jag äter fisk + vegetariskt', { type: 'diet', value: 'pesc' });
  addOption(labels.vegetarisk || 'Jag äter bara vegetariskt', { type: 'diet', value: 'vegetarisk' });

  btn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    var open = !menu.classList.contains('is-open');
    document.querySelectorAll('.list-eat-menu.is-open').forEach(function(el) {
      el.classList.remove('is-open');
    });
    document.querySelectorAll('.list-eat-btn[aria-expanded="true"]').forEach(function(b) {
      b.setAttribute('aria-expanded', 'false');
    });
    if (open) {
      menu.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    } else {
      closeMenu();
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  host.appendChild(wrap);
}

function inferBaseServingsFromBadges(r) {
  if (!r.badges) return 1;
  for (var i = 0; i < r.badges.length; i++) {
    var b = r.badges[i].toLowerCase();
    var m = b.match(/(\d+(?:[–-]\d+)?)\s*portioner/);
    if (m) {
      var parts = m[1].split(/[–-]/);
      if (parts.length === 2) return Math.round((parseInt(parts[0], 10) + parseInt(parts[1], 10)) / 2);
      return parseInt(parts[0], 10);
    }
    m = b.match(/(?:ca\s+)?(\d+)\s*(?:sliders|pizza|bollar|runda\s+bullar|bullar|wraps)/);
    if (m) return parseInt(m[1], 10);
    m = b.match(/1\s*pannkaka/);
    if (m) return 1;
  }
  return 1;
}

function getBaseServings(r) {
  if (r.baseServings && r.baseServings > 0) return r.baseServings;
  return inferBaseServingsFromBadges(r);
}

/** Label for per-unit macros: pieces/units from badges, else portion. */
function getPerYieldLabel(r) {
  var badges = r.badges || [];
  for (var i = 0; i < badges.length; i++) {
    var b = String(badges[i]).toLowerCase();
    if (/\bportioner?\b/.test(b)) return 'Per portion';
    if (/\brunda\s+bullar\b|\bbullar?\b/.test(b)) return 'Per bulle';
    if (/\bbollar?\b/.test(b)) return 'Per styck';
    if (/\bsliders?\b/.test(b)) return 'Per styck';
    if (/\bwraps?\b/.test(b)) return 'Per styck';
    if (/\bpizza\b/.test(b)) return 'Per pizza';
    if (/\bpannkaka\b/.test(b)) return 'Per pannkaka';
    if (/\bbitar?\b/.test(b)) return 'Per styck';
    if (/(?:ca\s+)?\d+\s*st\b/.test(b)) return 'Per styck';
  }
  return 'Per portion';
}

function servingScale(r) {
  return currentServings / getBaseServings(r);
}

/** Per-unit macros (stable under +/-); whole-batch totals scale with servings. */
function fillDetailMacros(r) {
  if (!r || !r.macros) return;
  var n = getBaseServings(r);
  var scale = servingScale(r);
  var per = {
    kcal: Math.round(r.macros.kcal / n),
    prot: Math.round(r.macros.prot / n),
    carb: Math.round(r.macros.carb / n),
    fat: Math.round(r.macros.fat / n)
  };
  var tot = {
    kcal: Math.round(r.macros.kcal * scale),
    prot: Math.round(r.macros.prot * scale),
    carb: Math.round(r.macros.carb * scale),
    fat: Math.round(r.macros.fat * scale)
  };
  var unitEl = document.getElementById('m-unit');
  if (unitEl) unitEl.textContent = getPerYieldLabel(r);
  var kcalEl = document.getElementById('m-kcal');
  var protEl = document.getElementById('m-prot');
  var carbEl = document.getElementById('m-carb');
  var fatEl = document.getElementById('m-fat');
  var kcalTot = document.getElementById('m-kcal-tot');
  var protTot = document.getElementById('m-prot-tot');
  var carbTot = document.getElementById('m-carb-tot');
  var fatTot = document.getElementById('m-fat-tot');
  if (kcalEl) kcalEl.textContent = String(per.kcal);
  if (protEl) protEl.textContent = per.prot + 'g';
  if (carbEl) carbEl.textContent = per.carb + 'g';
  if (fatEl) fatEl.textContent = per.fat + 'g';
  if (kcalTot) kcalTot.textContent = String(tot.kcal);
  if (protTot) protTot.textContent = tot.prot + 'g';
  if (carbTot) carbTot.textContent = tot.carb + 'g';
  if (fatTot) fatTot.textContent = tot.fat + 'g';
  var servHint = '(' + currentServings + ' port)';
  document.querySelectorAll('.detail-mac-tot-serv').forEach(function(el) {
    el.textContent = servHint;
  });
}

function capitalizeIngName(name) {
  var s = String(name || '').trim();
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase('sv-SE') + s.slice(1);
}

var SHOP_CHECK_PREFIX = 'recept_shop_check_';
var SHOP_MODE_PREFIX = 'recept_shop_mode_';
var ING_MACROS_PREF = 'recept_ing_macros';

function loadShopChecks(recipeId) {
  try {
    var raw = localStorage.getItem(SHOP_CHECK_PREFIX + recipeId);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveShopChecks(recipeId, checks) {
  try {
    localStorage.setItem(SHOP_CHECK_PREFIX + recipeId, JSON.stringify(checks));
  } catch (e) {}
}

function isShopMode(recipeId) {
  try {
    return localStorage.getItem(SHOP_MODE_PREFIX + recipeId) === '1';
  } catch (e) {
    return false;
  }
}

function setShopMode(recipeId, on) {
  try {
    if (on) localStorage.setItem(SHOP_MODE_PREFIX + recipeId, '1');
    else localStorage.removeItem(SHOP_MODE_PREFIX + recipeId);
  } catch (e) {}
}

function isIngMacrosOn() {
  try {
    return localStorage.getItem(ING_MACROS_PREF) === '1';
  } catch (e) {
    return false;
  }
}

function setIngMacrosOn(on) {
  try {
    if (on) localStorage.setItem(ING_MACROS_PREF, '1');
    else localStorage.removeItem(ING_MACROS_PREF);
  } catch (e) {}
}

function ingCheckKey(gi, ii) {
  return gi + ':' + ii;
}

function createToolbarLink(text, onClick) {
  var btn = mk('button', 'detail-shopping-btn');
  btn.type = 'button';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderIngredientToolbar(recipe, toolbarEl, onChange) {
  toolbarEl.replaceChildren();
  if (isIngMacrosOn()) {
    toolbarEl.appendChild(createToolbarLink('Dölj makron', function() {
      setIngMacrosOn(false);
      onChange();
    }));
  } else {
    toolbarEl.appendChild(createToolbarLink('Visa makron per ingrediens', function() {
      setIngMacrosOn(true);
      onChange();
    }));
  }
  if (isShopMode(recipe.id)) {
    toolbarEl.appendChild(createToolbarLink('Nollställ', function() {
      saveShopChecks(recipe.id, {});
      onChange();
    }));
    toolbarEl.appendChild(createToolbarLink('Dölj shoppinglista', function() {
      setShopMode(recipe.id, false);
      onChange();
    }));
    return;
  }
  toolbarEl.appendChild(createToolbarLink('Visa som shoppinglista', function() {
    setShopMode(recipe.id, true);
    onChange();
  }));
}

function renderDetailIngredients(recipe, host) {
  host.replaceChildren();
  var unresolved = countUnresolvedIngredients(recipe);
  if (unresolved > 0) {
    var banner = mk('p', 'ing-nutrition-warning');
    banner.setAttribute('role', 'status');
    banner.textContent =
      unresolved === 1
        ? '1 ingrediens saknar näringsdata'
        : unresolved + ' ingredienser saknar näringsdata';
    host.appendChild(banner);
  }
  host.appendChild(buildDetailIngredientsTable(recipe, isShopMode(recipe.id), isIngMacrosOn()));
}

function badgeTime(r) {
  if (!r.badges) return '';
  for (var i = 0; i < r.badges.length; i++) {
    var b = r.badges[i];
    if (/kcal|protein/i.test(b)) continue;
    if (/^(ca\s+)?(under\s+)?\d+([–-]\d+)?\s*min$/i.test(b)) return b;
  }
  for (var j = 0; j < r.badges.length; j++) {
    var b2 = r.badges[j];
    if (/kcal|protein/i.test(b2)) continue;
    var tm = b2.match(/((?:ca\s+)?(?:under\s+)?\d+(?:[–-]\d+)?\s*min)/i);
    if (tm) return tm[1];
  }
  return '';
}

function formatRecipeTimeMinutes(raw) {
  if (!raw) return '';
  var m = String(raw).match(/(\d+)(?:[–-](\d+))?\s*min/i);
  if (!m) return '';
  var mins = m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10);
  return mins + ' min';
}

function formatRecipeTime(r) {
  return formatRecipeTimeMinutes(badgeTime(r));
}

function formatBadgeLabel(b) {
  if (/kcal|protein/i.test(b)) return b;
  var time = formatRecipeTimeMinutes(b);
  if (time) return time;
  return b;
}

function cardMetricTags(r) {
  var tags = [];
  if (r.macros) {
    var n = getBaseServings(r);
    tags.push(Math.round(r.macros.kcal / n) + ' kcal/port');
    tags.push(Math.round(r.macros.prot / n) + 'g protein/port');
  }
  var time = formatRecipeTime(r);
  if (time) tags.push(time);
  return tags;
}

function appendMetricTags(parent, tags, tagClass) {
  if (!tags.length) return;
  tags.forEach(function(text) {
    var tag = mk('span', tagClass);
    tag.textContent = text;
    parent.appendChild(tag);
  });
}

function buildDetailHero(r, opts) {
  opts = opts || {};
  var hero = mk('div', 'detail-hero');
  if (r.image) {
    hero.classList.add('detail-hero--photo');
    hero.style.backgroundImage = "url('" + assetUrl(r.image) + "')";
  }
  if (opts && opts.includeTitle === false) return hero;
  var title = document.createElement('h1');
  title.className = 'detail-hero-title';
  title.textContent = r.title;
  hero.appendChild(title);
  return hero;
}

function createRecipeCard(r) {
  var display = getDisplayRecipe(r);
  var card = mk('a', 'recipe-card');
  card.href = recipeLink(r.id);

  var media = mk('div', 'recipe-card-media');
  if (display.image) {
    var img = document.createElement('img');
    img.className = 'recipe-card-img';
    img.src = assetUrl(display.image);
    img.alt = '';
    img.loading = 'lazy';
    media.appendChild(img);
  } else if (r.emoji) {
    var emojiEl = mk('span', 'recipe-card-emoji');
    emojiEl.textContent = r.emoji;
    media.appendChild(emojiEl);
  }
  var displayPrefs = getCardDisplayPrefs();
  if (displayPrefs.showNew && shouldShowNewBadge(r.id)) {
    var newLbl = mk('span', 'recipe-card-new');
    newLbl.textContent = 'Nytt!';
    media.appendChild(newLbl);
  }
  if (displayPrefs.showQuickMacros) {
    var macros100 = formatCardMacrosPer100g(display);
    if (macros100) {
      var macLbl = mk('span', 'recipe-card-macros100');
      macLbl.textContent = macros100;
      media.appendChild(macLbl);
    }
  }
  media.appendChild(createCardEditButton(r.id));
  media.appendChild(createFavoriteButton(r.id, 'fav-btn--card'));
  card.appendChild(media);

  var body = mk('div', 'recipe-card-body');
  var title = document.createElement('h2');
  title.className = 'recipe-card-title';
  title.textContent = display.title || r.title;
  body.appendChild(title);
  if (getListEatMode() && display._proteinVariantLabel) {
    var varBadge = mk('span', 'recipe-card-pref-badge recipe-card-pref-badge--swap');
    varBadge.textContent = display._proteinVariantLabel;
    body.appendChild(varBadge);
  }
  appendSourceLine(body, r);
  var rev = reviewSummaries[r.id];
  if (rev && rev.count > 0) {
    var ratingRow = mk('div', 'recipe-card-rating-row');
    var stars = mk('span', 'recipe-card-stars');
    stars.textContent = formatStars(rev.average);
    ratingRow.appendChild(stars);
    var count = mk('span', 'recipe-card-rating-count');
    count.textContent = String(rev.count);
    ratingRow.appendChild(count);
    body.appendChild(ratingRow);
  }
  var time = formatRecipeTime(r);
  if (time) appendTimeLine(body, r);
  if (r.tags && r.tags.length) {
    var tagsWrap = mk('div', 'recipe-card-tags');
    r.tags.slice(0, 4).forEach(function(tagId) {
      var label = TAG_LABELS[tagId] || tagId;
      var tag = mk('span', 'recipe-card-tag');
      tag.textContent = label;
      tagsWrap.appendChild(tag);
    });
    body.appendChild(tagsWrap);
  }
  card.appendChild(body);

  card.addEventListener('click', function(e) {
    if (e.target.closest('.fav-btn')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    showDetail(r.id);
  });
  return card;
}

function renderList() {
  var container = document.getElementById('recipe-list');
  container.replaceChildren();
  updateListHeading();
  var list = recipes.filter(recipeMatchesFilter);
  list = list.filter(function(r) { return recipeMatchesSearch(r, searchQuery); });
  if (showFavoritesOnly) list = list.filter(function(r) { return isFavorite(r.id); });
  list = sortRecipesForList(list);
  if (!list.length) {
    var empty = mk('p', 'list-empty');
    empty.textContent = showFavoritesOnly
      ? 'Inga favoriter ännu — tryck på bokmärket på ett recept.'
      : 'Inga recept matchar filtret.';
    container.appendChild(empty);
    return;
  }
  var grid = mk('div', 'recipe-grid');
  list.forEach(function(r) { grid.appendChild(createRecipeCard(r)); });
  container.appendChild(grid);
}

function showList(skipHistory) {
  document.getElementById('view-list').classList.remove('hidden');
  document.getElementById('view-detail').classList.add('hidden');
  currentId = null;
  if (!skipHistory) setListUrl(false);
  else setListUrl(true);
  window.scrollTo(0, 0);
  updateListHeading();
  renderBrowseNav();
  renderListFilters();
  updateFavoritesToggleBtn();
  renderList();
}

document.getElementById('back-btn').addEventListener('click', function() {
  showList(false);
});

function applyServingsScale() {
  var base = recipes.find(function(x) { return x.id === currentId; });
  var r = getDisplayRecipe(base);
  if (!r) return;
  var scale = servingScale(r);
  document.getElementById('serv-val').textContent = String(currentServings);
  var yieldLine = document.querySelector('.detail-yield');
  if (yieldLine) yieldLine.textContent = 'Listan avser ' + currentServings + ' portioner.';
  fillDetailMacros(r);
  document.querySelectorAll('.ing-amt').forEach(function(el) {
    el.textContent = fmt(parseFloat(el.dataset.base) * scale, el.dataset.unit);
  });
  document.querySelectorAll('.ing-macros').forEach(function(el) {
    var kcal = finiteOrNull(el.dataset.baseKcal);
    var prot = finiteOrNull(el.dataset.baseProt);
    var carb = finiteOrNull(el.dataset.baseCarb);
    var fat = finiteOrNull(el.dataset.baseFat);
    var grams = finiteOrNull(el.dataset.baseGrams);
    if (kcal == null || prot == null || carb == null || fat == null) {
      el.replaceChildren();
      return;
    }
    fillIngMacrosCell(el, { kcal: kcal, prot: prot, carb: carb, fat: fat, grams: grams }, scale);
  });
}

function changeServings(d) {
  currentServings = Math.max(1, currentServings + d);
  applyServingsScale();
}

function createDetailActionIcon(pathList) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'detail-action-icon');
  pathList.forEach(function(d) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
}

function recipeCanonicalUrl(id) {
  return location.origin + recipeLink(id);
}

function createDetailFavoriteAction(recipeId) {
  var btn = mk('button', 'detail-action-btn detail-action-btn--fav');
  btn.type = 'button';
  var svg = createDetailActionIcon(['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z']);
  btn.appendChild(svg);
  var label = mk('span', 'detail-action-label');
  label.textContent = 'Favorit';
  btn.appendChild(label);
  function sync() {
    var on = isFavorite(recipeId);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Ta bort från favoriter' : 'Spara som favorit');
    label.textContent = on ? 'Sparad' : 'Favorit';
    svg.style.fill = on ? 'currentColor' : 'none';
  }
  sync();
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    toggleFavorite(recipeId);
    sync();
    updateFavoritesToggleBtn();
    if (showFavoritesOnly && !document.getElementById('view-detail').classList.contains('hidden')) return;
    if (showFavoritesOnly) renderList();
  });
  return btn;
}

function createDetailShareAction(recipe) {
  var btn = mk('button', 'detail-action-btn detail-action-btn--share');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Dela recept');
  btn.appendChild(createDetailActionIcon([
    'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8',
    'M16 6l-4-4-4 4',
    'M12 2v13'
  ]));
  var label = mk('span', 'detail-action-label');
  label.textContent = 'Dela';
  btn.appendChild(label);

  function flashLabel(text) {
    var prev = label.textContent;
    label.textContent = text;
    window.setTimeout(function() { label.textContent = prev; }, 2000);
  }

  function copyShareUrl(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function() {
        flashLabel('Kopierad!');
      }).catch(function() {});
      return;
    }
    flashLabel('Kopiera länk');
  }

  btn.addEventListener('click', function() {
    var url = recipeCanonicalUrl(recipe.id);
    if (navigator.share) {
      navigator.share({ title: recipe.title, text: recipe.title, url: url }).catch(function(err) {
        if (err && err.name === 'AbortError') return;
        copyShareUrl(url);
      });
      return;
    }
    copyShareUrl(url);
  });
  return btn;
}

function createDetailEditAction(recipeId) {
  var link = mk('a', 'detail-action-btn detail-action-btn--edit');
  link.href = addPageUrl(recipeId);
  link.appendChild(createDetailActionIcon([
    'M12 20h9',
    'M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z'
  ]));
  var label = mk('span', 'detail-action-label');
  label.textContent = 'Redigera';
  link.appendChild(label);
  link.addEventListener('click', function() {
    try { sessionStorage.setItem('recept_edit_id', recipeId); } catch (e) {}
  });
  if (!window.ReceptAdmin || !window.ReceptAdmin.isAdmin) link.classList.add('hidden');
  return link;
}

function appendDetailMetaItem(list, label, valueEl) {
  var row = mk('div', 'detail-meta-item');
  var dt = mk('span', 'detail-meta-label');
  dt.textContent = label;
  var dd = mk('span', 'detail-meta-value');
  if (typeof valueEl === 'string') {
    dd.textContent = valueEl;
  } else {
    dd.appendChild(valueEl);
  }
  row.appendChild(dt);
  row.appendChild(dd);
  list.appendChild(row);
}

function formatTipTitle(title) {
  if (/^seattle$/i.test(String(title || '').trim())) return 'För barn';
  return title;
}

function buildDetailIngredientsTable(r, shopMode, showMacros) {
  if (shopMode) return buildShoppingIngredientList(r, showMacros);

  var table = mk('table', 'ing-table' + (showMacros ? ' ing-table--macros' : ''));
  var tbody = document.createElement('tbody');
  r.groups.forEach(function(g, gi) {
    if (g.name) {
      var headRow = mk('tr', 'ing-grp-head');
      var headCell = document.createElement('th');
      headCell.colSpan = 2;
      headCell.textContent = g.name;
      headRow.appendChild(headCell);
      tbody.appendChild(headRow);
    }
    g.ingredients.forEach(function(ing, ii) {
      var row = mk('tr', 'ing-row');
      var qtyCell = mk('td', 'ing-qty');
      var amtEl = mk('span', 'ing-amt');
      amtEl.dataset.base = ing.amount;
      amtEl.dataset.unit = ing.unit;
      amtEl.textContent = fmt(ing.amount, ing.unit);
      qtyCell.appendChild(amtEl);
      var nameCell = mk('td', 'ing-name');
      var nameText = mk('span', 'ing-name-text');
      nameText.textContent = ing.name;
      nameCell.appendChild(nameText);
      var status = ing.match_status;
      if (status === 'unmatched' || status === 'needs_piece_weight') {
        row.classList.add('ing-row--unresolved');
        var warn = mk('span', 'ing-unresolved-flag');
        warn.textContent = status === 'needs_piece_weight' ? 'saknar styckvikt' : 'saknar näringsdata';
        nameCell.appendChild(warn);
      }
      if (showMacros) {
        var est = estimateIngredientRow(ing);
        if (est && finiteOrNull(est.kcal) != null) {
          var macroEl = mk('span', 'ing-macros');
          macroEl.dataset.baseKcal = String(est.kcal);
          macroEl.dataset.baseProt = String(est.prot);
          macroEl.dataset.baseCarb = String(est.carb);
          macroEl.dataset.baseFat = String(est.fat);
          if (est.grams != null) macroEl.dataset.baseGrams = String(est.grams);
          fillIngMacrosCell(macroEl, est, 1);
          if (macroEl.childNodes.length) nameCell.appendChild(macroEl);
        }
      }
      row.appendChild(qtyCell);
      row.appendChild(nameCell);
      tbody.appendChild(row);
    });
  });
  table.appendChild(tbody);
  return table;
}

function buildShoppingIngredientList(r, showMacros) {
  var checks = loadShopChecks(r.id);
  var list = mk('div', 'ing-shop-list');

  r.groups.forEach(function(g, gi) {
    var group = mk('div', 'ing-shop-group');
    if (g.name) {
      var title = mk('div', 'ing-shop-group-title');
      title.textContent = g.name;
      group.appendChild(title);
    }
    var items = mk('div', 'ing-shop-group-items');
    g.ingredients.forEach(function(ing, ii) {
      var key = ingCheckKey(gi, ii);
      var card = mk('label', 'ing-shop-card');
      if (checks[key]) card.classList.add('ing-shop-card--checked');

      var nameCol = mk('span', 'ing-shop-name');
      var nameText = mk('span', 'ing-name-text');
      nameText.textContent = capitalizeIngName(ing.name);
      nameCol.appendChild(nameText);
      var status = ing.match_status;
      if (status === 'unmatched' || status === 'needs_piece_weight') {
        card.classList.add('ing-row--unresolved');
        var warn = mk('span', 'ing-unresolved-flag');
        warn.textContent = status === 'needs_piece_weight' ? 'saknar styckvikt' : 'saknar näringsdata';
        nameCol.appendChild(warn);
      }
      if (showMacros) {
        var est = estimateIngredientRow(ing);
        if (est && finiteOrNull(est.kcal) != null) {
          var macroEl = mk('span', 'ing-macros');
          macroEl.dataset.baseKcal = String(est.kcal);
          macroEl.dataset.baseProt = String(est.prot);
          macroEl.dataset.baseCarb = String(est.carb);
          macroEl.dataset.baseFat = String(est.fat);
          if (est.grams != null) macroEl.dataset.baseGrams = String(est.grams);
          fillIngMacrosCell(macroEl, est, 1);
          if (macroEl.childNodes.length) nameCol.appendChild(macroEl);
        }
      }

      var qtyCol = mk('span', 'ing-shop-qty');
      var amtEl = mk('span', 'ing-amt');
      amtEl.dataset.base = ing.amount;
      amtEl.dataset.unit = ing.unit;
      amtEl.textContent = fmt(ing.amount, ing.unit);
      qtyCol.appendChild(amtEl);

      var checkCol = mk('span', 'ing-shop-check');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ing-shop-cb';
      cb.checked = !!checks[key];
      cb.setAttribute('aria-label', 'Markera ' + capitalizeIngName(ing.name));
      cb.addEventListener('change', function() {
        checks[key] = cb.checked;
        saveShopChecks(r.id, checks);
        card.classList.toggle('ing-shop-card--checked', cb.checked);
      });
      checkCol.appendChild(cb);

      card.appendChild(nameCol);
      card.appendChild(qtyCol);
      card.appendChild(checkCol);
      items.appendChild(card);
    });
    group.appendChild(items);
    list.appendChild(group);
  });

  return list;
}

function showDetail(id, skipHistory) {
  var base = recipes.find(function(x) { return x.id === id; });
  if (!base) return;
  if (currentId !== id) {
    detailProteinVariantId = undefined;
  }
  if (shouldMarkRecipeVisited(id)) markRecipeVisited(id);
  currentId = id;
  var r = getDisplayRecipe(base);
  document.title = (r.title || base.title) + ' — Macro-friendly recipes';
  if (!skipHistory) setRecipeUrl(id, false);
  else setRecipeUrl(id, true);
  updateAdminUi();
  currentServings = getBaseServings(base);
  var c = document.getElementById('detail-content');
  c.replaceChildren();

  var lead = mk('div', 'detail-lead');
  var copy = mk('div', 'detail-lead-copy');

  var titleEl = document.createElement('h1');
  titleEl.className = 'detail-title';
  titleEl.textContent = r.title || base.title;
  copy.appendChild(titleEl);

  var afterTitle = mk('div', 'detail-after-title');
  var afterLeft = mk('div', 'detail-after-title-main');
  appendSourceLine(afterLeft, base, { className: 'detail-source' });
  appendTimeLine(afterLeft, base, 'detail-time');

  var tagsRow = mk('div', 'detail-tags-row');
  if (base.category) {
    var tagsLine = mk('p', 'detail-tags-line');
    tagsLine.textContent = categoryLabel(base.category);
    tagsRow.appendChild(tagsLine);
  }
  afterLeft.appendChild(tagsRow);
  afterTitle.appendChild(afterLeft);

  if (recipeNeedsProteinSwapControl(base)) {
    afterTitle.appendChild(buildProteinSwapControl(base));
  }
  copy.appendChild(afterTitle);

  var metaList = mk('div', 'detail-meta-list');

  var rev = reviewSummaries[base.id];
  if (rev && rev.count > 0) {
    var ratingVal = mk('span', 'detail-rating-value');
    var stars = mk('span', 'detail-rating-stars');
    stars.textContent = formatStars(rev.average);
    ratingVal.appendChild(stars);
    ratingVal.appendChild(document.createTextNode(' (' + rev.count + ')'));
    appendDetailMetaItem(metaList, 'Betyg', ratingVal);
  }

  var servCtrl = mk('div', 'serv-ctrl serv-ctrl--detail');
  var minusBtn = mk('button', 'serv-btn');
  minusBtn.type = 'button';
  minusBtn.textContent = '−';
  minusBtn.addEventListener('click', function() { changeServings(-1); });
  var servValEl = mk('span', 'serv-val');
  servValEl.id = 'serv-val';
  servValEl.textContent = String(currentServings);
  var servLbl = mk('span', 'serv-lbl');
  servLbl.textContent = 'portioner';
  var plusBtn = mk('button', 'serv-btn');
  plusBtn.type = 'button';
  plusBtn.textContent = '+';
  plusBtn.addEventListener('click', function() { changeServings(1); });
  servCtrl.appendChild(minusBtn);
  servCtrl.appendChild(servValEl);
  servCtrl.appendChild(servLbl);
  servCtrl.appendChild(plusBtn);
  appendDetailMetaItem(metaList, 'Portioner', servCtrl);
  copy.appendChild(metaList);

  var actions = mk('div', 'detail-actions');
  actions.appendChild(createDetailFavoriteAction(base.id));
  actions.appendChild(createDetailShareAction(base));
  actions.appendChild(createDetailEditAction(base.id));
  copy.appendChild(actions);

  var macrosWrap = mk('div', 'detail-macros-wrap');
  var unitLbl = mk('p', 'detail-macros-unit');
  unitLbl.id = 'm-unit';
  unitLbl.textContent = getPerYieldLabel(r);
  macrosWrap.appendChild(unitLbl);
  var macrosDiv = mk('div', 'detail-macros');
  [
    { id: 'm-kcal', totId: 'm-kcal-tot', lbl: 'kcal' },
    { id: 'm-prot', totId: 'm-prot-tot', lbl: 'protein' },
    { id: 'm-carb', totId: 'm-carb-tot', lbl: 'kolhydrater' },
    { id: 'm-fat', totId: 'm-fat-tot', lbl: 'fett' }
  ].forEach(function(m) {
    var mac = mk('div', 'detail-mac');
    var valEl = mk('span', 'detail-mac-val');
    valEl.id = m.id;
    var lblEl = mk('span', 'detail-mac-lbl');
    lblEl.textContent = m.lbl;
    var totWrap = mk('span', 'detail-mac-tot');
    var totVal = mk('span', 'detail-mac-tot-val');
    totVal.id = m.totId;
    var totLbl = mk('span', 'detail-mac-tot-lbl');
    totLbl.textContent = 'totalt';
    var totServ = mk('span', 'detail-mac-tot-serv');
    totWrap.appendChild(totVal);
    totWrap.appendChild(totLbl);
    totWrap.appendChild(totServ);
    mac.appendChild(valEl);
    mac.appendChild(lblEl);
    mac.appendChild(totWrap);
    macrosDiv.appendChild(mac);
  });
  macrosWrap.appendChild(macrosDiv);
  copy.appendChild(macrosWrap);

  var media = mk('div', 'detail-lead-media');
  media.appendChild(buildDetailHero(r, { includeTitle: false }));
  lead.appendChild(copy);
  lead.appendChild(media);
  c.appendChild(lead);

  var recipeGrid = mk('div', 'detail-recipe');
  var ingCol = mk('div', 'detail-recipe-col');
  var ingHeadRow = mk('div', 'detail-sec-head-row');
  var ingHead = mk('h2', 'detail-sec-head');
  ingHead.textContent = 'Ingredienser';
  ingHeadRow.appendChild(ingHead);
  var ingToolbar = mk('div', 'detail-ing-toolbar');
  ingHeadRow.appendChild(ingToolbar);
  ingCol.appendChild(ingHeadRow);
  var yieldLine = mk('p', 'detail-yield');
  yieldLine.textContent = 'Listan avser ' + currentServings + ' portioner.';
  ingCol.appendChild(yieldLine);
  var ingTableHost = mk('div', 'detail-ing-host');
  ingCol.appendChild(ingTableHost);
  function syncIngredientsUi() {
    var display = getDisplayRecipe(base);
    renderDetailIngredients(display, ingTableHost);
    renderIngredientToolbar(display, ingToolbar, syncIngredientsUi);
    applyServingsScale();
  }
  syncIngredientsUi();
  recipeGrid.appendChild(ingCol);

  var stepsCol = mk('div', 'detail-recipe-col');
  var stepsHead = mk('h2', 'detail-sec-head');
  stepsHead.textContent = 'Gör så här';
  stepsCol.appendChild(stepsHead);
  var prep = mk('div', 'detail-prep');
  (base.steps || []).forEach(function(s, i) {
    var step = mk('div', 'prep-step');
    var stepLabel = mk('div', 'prep-step-label');
    stepLabel.textContent = 'Steg ' + (i + 1);
    step.appendChild(stepLabel);
    if (s.title && s.title !== 'Steg') {
      var stitle = mk('div', 'prep-step-title');
      stitle.textContent = s.title;
      step.appendChild(stitle);
    }
    var stext = mk('p', 'prep-step-text');
    stext.textContent = s.text;
    step.appendChild(stext);
    prep.appendChild(step);
  });
  stepsCol.appendChild(prep);
  recipeGrid.appendChild(stepsCol);
  c.appendChild(recipeGrid);

  var tipsHead = mk('h2', 'detail-sec-head detail-sec-head--sub');
  tipsHead.textContent = 'Tips & variationer';
  c.appendChild(tipsHead);
  var tipsGrid = mk('div', 'tips-grid');
  (base.tips || []).forEach(function(t) {
    var box = mk('div', 'tip-box');
    var ttitle = mk('div', 'tip-title');
    ttitle.textContent = formatTipTitle(t.title);
    var ttext = mk('div', 'tip-text');
    ttext.textContent = t.text;
    box.appendChild(ttitle);
    box.appendChild(ttext);
    tipsGrid.appendChild(box);
  });
  c.appendChild(tipsGrid);

  var reviewsHost = mk('div', 'reviews-panel');
  reviewsHost.id = 'reviews-host';
  c.appendChild(reviewsHost);
  loadReviewsPanel(id, reviewsHost);

  document.getElementById('view-list').classList.add('hidden');
  document.getElementById('view-detail').classList.remove('hidden');
  applyServingsScale();
  window.scrollTo(0, 0);

  if (r._proteinVariantId) {
    ensureProteinVariantImage(base, r._proteinVariantId);
  }
}

function buildProteinSwapControl(base) {
  var proteinTag = primaryProteinTag(base);
  var display = getDisplayRecipe(base);
  var activeVariantId = display._proteinVariantId || null;
  var wrap = mk('div', 'detail-diet-wrap');
  var lab = mk('span', 'detail-diet-label');
  lab.textContent = 'Byt proteinkälla';
  wrap.appendChild(lab);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'detail-diet-btn' + (activeVariantId ? ' detail-diet-btn--active' : '');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  var label = activeVariantId
    ? (display._proteinVariantLabel || activeVariantId)
    : (TAG_LABELS[proteinTag] || proteinTag || 'Original');
  btn.appendChild(document.createTextNode(label));
  var caret = mk('span', 'detail-diet-caret');
  caret.textContent = '▾';
  btn.appendChild(caret);

  var menu = mk('div', 'detail-diet-menu');
  menu.setAttribute('role', 'menu');

  function closeMenu() {
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  function selectVariant(variantId) {
    closeMenu();
    var nextId = variantId == null ? null : variantId;
    if (nextId === null && detailProteinVariantId === null) return;
    if (nextId && nextId === detailProteinVariantId) return;
    if (!nextId) {
      detailProteinVariantId = null;
      showDetail(base.id, true);
      return;
    }
    ensureProteinVariants(base).then(function(list) {
      var v = null;
      for (var i = 0; i < (list || []).length; i++) {
        if (list[i].id === nextId) { v = list[i]; break; }
      }
      if (!v) {
        alert('Ingen variant för den proteinkällan.');
        return;
      }
      detailProteinVariantId = nextId;
      showDetail(base.id, true);
      ensureProteinVariantImage(base, nextId);
    }).catch(function(ex) {
      alert(ex.message || 'Kunde inte hämta proteinkälle-varianter');
    });
  }

  function addItem(text, variantId) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'detail-diet-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = text;
    item.addEventListener('click', function() {
      selectVariant(variantId);
    });
    menu.appendChild(item);
  }

  function fillMenu(list) {
    menu.replaceChildren();
    addItem(TAG_LABELS[proteinTag] || proteinTag || 'Original', null);
    (list || []).forEach(function(v) {
      addItem(v.label || v.id, v.id);
    });
  }

  fillMenu(base.proteinVariants || []);

  btn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    var open = !menu.classList.contains('is-open');
    document.querySelectorAll('.detail-diet-menu.is-open').forEach(function(el) {
      el.classList.remove('is-open');
    });
    if (open) {
      menu.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      if (!base.proteinVariants || !base.proteinVariants.length) {
        ensureProteinVariants(base).then(function(list) {
          fillMenu(list || []);
        }).catch(function() { /* keep empty */ });
      }
    } else {
      closeMenu();
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

function ensureProteinVariants(base) {
  if (base.proteinVariants && base.proteinVariants.length) {
    return Promise.resolve(base.proteinVariants);
  }
  return fetch('/api/recipes/' + encodeURIComponent(base.id) + '/protein-variants', {
    credentials: 'same-origin'
  }).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) throw new Error(data.error || 'Kunde inte skapa proteinkälle-varianter');
      var list = data.proteinVariants || [];
      base.proteinVariants = list;
      var idx = recipes.findIndex(function(x) { return x.id === base.id; });
      if (idx !== -1) recipes[idx].proteinVariants = list;
      return list;
    });
  });
}

function ensureProteinVariantImage(base, variantId) {
  var v = findProteinVariant(base, variantId);
  if (!v) return Promise.resolve(null);
  // Same URL as original = slug collision leftover; force regenerate.
  if (v.image && v.image !== base.image) return Promise.resolve(v.image);
  return fetch(
    '/api/recipes/' +
      encodeURIComponent(base.id) +
      '/protein-variants/' +
      encodeURIComponent(variantId) +
      '/image',
    { method: 'POST', credentials: 'same-origin' }
  ).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) return null;
      if (data.image && data.image !== base.image) {
        v.image = data.image;
        var idx = recipes.findIndex(function(x) { return x.id === base.id; });
        if (idx !== -1 && recipes[idx].proteinVariants) {
          for (var i = 0; i < recipes[idx].proteinVariants.length; i++) {
            if (recipes[idx].proteinVariants[i].id === variantId) {
              recipes[idx].proteinVariants[i].image = data.image;
            }
          }
        }
        if (currentId === base.id && detailProteinVariantId === variantId) {
          showDetail(base.id, true);
        }
      }
      return data.image || null;
    });
  }).catch(function() { return null; });
}

function loadReviewsPanel(recipeId, host) {
  host.textContent = 'Hämtar betyg…';
  fetch('/api/recipes/' + encodeURIComponent(recipeId) + '/reviews', { credentials: 'same-origin' })
    .then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Kunde inte hämta betyg');
        return data;
      });
    })
    .then(function(data) {
      if (data.summary) {
        reviewSummaries[recipeId] = data.summary;
      }
      renderReviewsPanel(recipeId, host, data);
    })
    .catch(function(ex) {
      host.textContent = ex.message;
    });
}

function renderReviewsPanel(recipeId, host, data) {
  host.replaceChildren();
  var title = mk('div', 'sec-title');
  title.textContent = 'Betyg & recensioner';
  host.appendChild(title);

  var summaryEl = mk('div', 'reviews-summary');
  if (data.summary && data.summary.count > 0) {
    summaryEl.textContent =
      formatStars(data.summary.average) + ' ' + data.summary.average.toFixed(1) +
      ' · ' + data.summary.count + ' betyg';
  } else {
    summaryEl.textContent = 'Inga betyg än — ge det första!';
  }
  host.appendChild(summaryEl);

  var selected = data.mine ? data.mine.rating : 0;
  var starsRow = mk('div', 'star-picker');
  var starBtns = [];
  for (var s = 1; s <= 5; s++) {
    var starBtn = mk('button', 'star-btn');
    starBtn.type = 'button';
    starBtn.textContent = s <= selected ? '★' : '☆';
    if (s <= selected) starBtn.classList.add('active');
    starBtn.setAttribute('data-star', String(s));
    starBtn.addEventListener('click', (function(val) {
      return function() {
        starBtns.forEach(function(b) {
          var n = parseInt(b.getAttribute('data-star'), 10);
          b.textContent = n <= val ? '★' : '☆';
          b.classList.toggle('active', n <= val);
        });
      };
    })(s));
    starBtns.push(starBtn);
    starsRow.appendChild(starBtn);
  }
  host.appendChild(starsRow);

  var comment = document.createElement('textarea');
  comment.className = 'review-comment';
  comment.placeholder = 'Valfri kommentar (syns för familjen)…';
  comment.value = data.mine && data.mine.comment ? data.mine.comment : '';
  host.appendChild(comment);

  var submitBtn = mk('button', 'review-submit');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Spara betyg';
  submitBtn.addEventListener('click', function() {
    var rating = 0;
    starBtns.forEach(function(b) {
      if (b.classList.contains('active')) {
        var n = parseInt(b.getAttribute('data-star'), 10);
        if (n > rating) rating = n;
      }
    });
    if (!rating) {
      submitBtn.textContent = 'Välj stjärnor först';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sparar…';
    fetch('/api/recipes/' + encodeURIComponent(recipeId) + '/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ rating: rating, comment: comment.value.trim() })
    }).then(function(res) {
      return res.json().then(function(d) {
        if (!res.ok) throw new Error(d.error || 'Sparning misslyckades');
        return d;
      });
    }).then(function(d) {
      if (d.summary) reviewSummaries[recipeId] = d.summary;
      renderReviewsPanel(recipeId, host, d);
    }).catch(function(ex) {
      submitBtn.disabled = false;
      submitBtn.textContent = ex.message;
    });
  });
  host.appendChild(submitBtn);

  if (data.recent && data.recent.length) {
    var listTitle = mk('div', 'sec-title');
    listTitle.textContent = 'Senaste kommentarer';
    listTitle.style.marginTop = '1rem';
    host.appendChild(listTitle);
    var list = mk('div', 'review-list');
    data.recent.forEach(function(item) {
      var row = mk('div', 'review-item');
      var stars = mk('div', 'review-item-stars');
      stars.textContent = formatStars(item.rating);
      row.appendChild(stars);
      if (item.comment) {
        var txt = mk('div', 'review-item-text');
        txt.textContent = item.comment;
        row.appendChild(txt);
      }
      list.appendChild(row);
    });
    host.appendChild(list);
  }
}

function routeFromLocation() {
  var id = getRecipeIdFromLocation();
  if (id && recipes.some(function(r) { return r.id === id; })) showDetail(id, true);
}

window.addEventListener('popstate', function() {
  applyFiltersFromUrl();
  var id = getRecipeIdFromLocation();
  if (id && recipes.some(function(r) { return r.id === id; })) showDetail(id, true);
  else showList(true);
});

window.addEventListener('hashchange', function() {
  var id = getRecipeIdFromLocation();
  if (id && recipes.some(function(r) { return r.id === id; })) showDetail(id, true);
  else if (!location.hash) showList(true);
});

function updateAdminUi() {
  var isAdmin = !!(window.ReceptAdmin && window.ReceptAdmin.isAdmin);
  document.querySelectorAll('.detail-action-btn--edit').forEach(function(el) {
    el.classList.toggle('hidden', !isAdmin);
  });
}

window.addEventListener('recept-auth', function() {
  updateAdminUi();
  if (document.getElementById('view-list') && !document.getElementById('view-list').classList.contains('hidden')) {
    renderList();
  }
});

updateAdminUi();

function bootApp(data) {
  recipes = data.recipes || [];
  reviewSummaries = data.reviewSummaries || {};
  FEATURED_NEW_IDS.length = 0;
  (data.featuredNewIds || []).forEach(function(id) { FEATURED_NEW_IDS.push(id); });
  RecipeValidate.reportAtLoad(recipes, TAG_FILTER_ORDER, CATEGORY_ORDER);
  applyFiltersFromUrl();
  try {
    if (sessionStorage.getItem('recept_show_favorites') === '1') {
      showFavoritesOnly = true;
      sessionStorage.removeItem('recept_show_favorites');
      syncFiltersToUrl(true);
    }
    if (sessionStorage.getItem('recept_search')) {
      searchQuery = sessionStorage.getItem('recept_search');
      sessionStorage.removeItem('recept_search');
      var searchInput = document.getElementById('recipe-search');
      if (searchInput) searchInput.value = searchQuery;
      syncFiltersToUrl(true);
    }
    var storedFilter = ReceptBrowseNav.readStoredFilter();
    if (storedFilter && storedFilter.type && isAllFilter() && !location.search) {
      activeFilter = storedFilter;
      syncFiltersToUrl(true);
    }
  } catch (e) {}
  renderBrowseNav();
  renderListFilters();
  updateFavoritesToggleBtn();
  renderList();
  routeFromLocation();
}

fetch('/api/recipes', { credentials: 'same-origin' })
  .then(function(res) {
    if (!res.ok) throw new Error('Kunde inte hämta recept');
    return res.json();
  })
  .then(function(data) {
    if (data) bootApp(data);
  })
  .catch(function(err) {
    console.error('Kunde inte ladda recept:', err);
    var banner = document.createElement('div');
    banner.className = 'recipe-validate-banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = 'Kunde inte ladda recept. Försök ladda om sidan.';
    document.body.insertBefore(banner, document.body.firstChild);
  });

var brandHome = document.getElementById('brand-home');
if (brandHome) {
  brandHome.addEventListener('click', function(e) {
    if (document.getElementById('view-detail').classList.contains('hidden')) return;
    e.preventDefault();
    showList();
  });
}

var recipeSearch = document.getElementById('recipe-search');
if (recipeSearch) {
  recipeSearch.addEventListener('input', function() {
    searchQuery = recipeSearch.value;
    syncFiltersToUrl(true);
    renderList();
  });
}

var favoritesToggleBtn = document.getElementById('favorites-toggle-btn');
if (favoritesToggleBtn) {
  favoritesToggleBtn.addEventListener('click', function() {
    showFavoritesOnly = !showFavoritesOnly;
    updateFavoritesToggleBtn();
    if (showFavoritesOnly && !document.getElementById('view-detail').classList.contains('hidden')) {
      showList(false);
      return;
    }
    syncFiltersToUrl(false);
    renderList();
  });
  updateFavoritesToggleBtn();
}

document.addEventListener("click", function() {
  document.querySelectorAll(".detail-diet-menu.is-open").forEach(function(el) {
    el.classList.remove("is-open");
  });
  document.querySelectorAll(".detail-diet-btn[aria-expanded=\"true\"]").forEach(function(btn) {
    btn.setAttribute("aria-expanded", "false");
  });
  document.querySelectorAll(".list-eat-menu.is-open").forEach(function(el) {
    el.classList.remove("is-open");
  });
  document.querySelectorAll(".list-eat-btn[aria-expanded=\"true\"]").forEach(function(btn) {
    btn.setAttribute("aria-expanded", "false");
  });
});
