(function(global) {
  var CATEGORY_ORDER = ['frukost', 'lunch', 'middag', 'tillbehor', 'fika'];
  var CATEGORY_LABELS = {
    frukost: 'Frukost',
    lunch: 'Lunch',
    middag: 'Middag',
    tillbehor: 'Tillbehör',
    fika: 'Fika & bakning'
  };
  var TAG_LABELS = {
    kyckling: 'Kyckling',
    notkott: 'Nötkött',
    flask: 'Fläsk',
    skaldjur: 'Skaldjur',
    vegetarisk: 'Vegetariskt',
    fisk: 'Fisk'
  };
  var DIET_LABELS = {
    all: 'Jag äter allt',
    pesc: 'Jag äter fisk + vegetariskt',
    vegetarisk: 'Jag äter bara vegetariskt'
  };
  var DIET_LEGACY = {
    fisk: 'pesc',
    vegan: 'vegetarisk',
    pescetarian: 'pesc',
    vegetarian: 'vegetarisk'
  };
  var CUISINE_LABELS = {
    asiatiskt: 'Asiatiskt',
    kinesiskt: 'Kinesiskt',
    japanskt: 'Japanskt',
    koreanskt: 'Koreanskt',
    thailandskt: 'Thailändskt',
    mexikanskt: 'Mexikanskt',
    amerikanskt: 'Amerikanskt',
    vietnamesiskt: 'Vietnamesiskt',
    mellanostern: 'Mellanöstern'
  };
  var CUISINE_ORDER = [
    'asiatiskt', 'kinesiskt', 'japanskt', 'koreanskt', 'thailandskt',
    'mexikanskt', 'amerikanskt', 'vietnamesiskt', 'mellanostern'
  ];
  var RECIPE_CUISINE = {
    'buffalo-chicken-crust-pizza': ['amerikanskt'],
    'chicken-kebab-wraps': ['mellanostern'],
    'cinnamon-sugar-donut-holes': ['amerikanskt'],
    'dumpling-lasagna': ['kinesiskt'],
    'edamame-spread': ['japanskt'],
    'gochujang-gnocchi': ['koreanskt'],
    'hoagie-bread': ['amerikanskt'],
    'chocolate-chunk-scones-4-ingredients': ['amerikanskt'],
    'middle-eastern-chicken-mince': ['mellanostern'],
    'thai-chicken-cucumber-salad': ['thailandskt'],
    'honey-lime-teriyaki-beef-noodles': ['japanskt'],
    'hot-honey-chicken-sliders': ['amerikanskt'],
    'mexican-chicken-corn-salad': ['mexikanskt'],
    'numbing-chicken-cucumber': ['kinesiskt'],
    'one-pan-dumplings-with-greens': ['kinesiskt'],
    'rice-paper-shrimp-pancake': ['vietnamesiskt'],
    'smashed-cucumber': ['japanskt'],
    'smashed-pickle-salad': ['amerikanskt'],
    'thai-basil-beef-rolls': ['thailandskt'],
    'tuna-chili-crisp-salad': ['asiatiskt']
  };
  var ANIMAL_INGREDIENT = /kyckling|nötkött|nötfärs|malet nötkött|fläsk|tonfisk|räkor|ägg|keso|ost|grädd|majonnäs|honung|smör|mjölk|yoghurt|fisk|skaldjur|biff|fläskkött|kycklingbröst|kycklingfärs|ventresca|malet fläsk/i;

  var HEADER_MENUS = [
    {
      id: 'type',
      label: 'Typ',
      sections: [{
        name: '',
        items: CATEGORY_ORDER.map(function(cat) {
          return { type: 'category', value: cat, label: CATEGORY_LABELS[cat] };
        })
      }]
    }
  ];

  var LIST_FILTER_MENUS = [
    {
      id: 'protein',
      label: 'Proteinkälla',
      sections: [{
        name: '',
        items: ['kyckling', 'notkott', 'flask', 'skaldjur'].map(function(tag) {
          return { type: 'tag', value: tag, label: TAG_LABELS[tag] || tag };
        })
      }]
    },
    {
      id: 'cuisine',
      label: 'Kök',
      sections: [{
        name: '',
        items: CUISINE_ORDER.map(function(id) {
          return { type: 'cuisine', value: id, label: CUISINE_LABELS[id] };
        })
      }]
    }
  ];

  var MAX_KCAL_100_OPTIONS = [80, 100, 120, 150, 180, 200, 250, 300, 350, 400];
  var MIN_PROT_100_OPTIONS = [5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40];
  var MACRO_RANGE_MENUS = [
    {
      id: 'maxKcal100',
      label: 'Max kcal/100g',
      param: 'maxkcal',
      options: MAX_KCAL_100_OPTIONS
    },
    {
      id: 'minProt100',
      label: 'Min protein/100g',
      param: 'minprot',
      options: MIN_PROT_100_OPTIONS
    }
  ];

  function parseMacroOption(raw, allowed) {
    if (raw == null || raw === '') return null;
    var n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (!Number.isFinite(n)) return null;
    return allowed.indexOf(n) !== -1 ? n : null;
  }

  function copyActiveMulti(multi) {
    multi = multi || {};
    return {
      protein: multi.protein ? multi.protein.slice() : [],
      cuisine: multi.cuisine ? multi.cuisine.slice() : [],
      maxKcal100: multi.maxKcal100 != null ? multi.maxKcal100 : null,
      minProt100: multi.minProt100 != null ? multi.minProt100 : null
    };
  }

  function mk(tag, cls) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function recipeCuisines(r) {
    if (RECIPE_CUISINE[r.id]) return RECIPE_CUISINE[r.id].slice();
    return [];
  }

  function recipeIsVegan(r) {
    if (r.tags && r.tags.indexOf('vegan') !== -1) return true;
    var groups = r.groups || [];
    for (var g = 0; g < groups.length; g++) {
      var ings = groups[g].ingredients || [];
      for (var i = 0; i < ings.length; i++) {
        if (ANIMAL_INGREDIENT.test(ings[i].name || '')) return false;
      }
    }
    return !!(r.tags && r.tags.indexOf('vegetarisk') !== -1) || groups.length > 0;
  }

  function recipeHasVariantTier(r, tiers) {
    var variants = r && r.proteinVariants;
    if (!variants || !variants.length) return false;
    for (var i = 0; i < variants.length; i++) {
      if (tiers.indexOf(variants[i].tier) !== -1) return true;
    }
    return false;
  }

  function recipeIsMeatNative(r) {
    if (!r || !r.tags) return false;
    return r.tags.indexOf('kyckling') !== -1 ||
      r.tags.indexOf('notkott') !== -1 ||
      r.tags.indexOf('flask') !== -1;
  }

  function recipeIsFishNative(r) {
    if (!r || !r.tags) return false;
    return r.tags.indexOf('fisk') !== -1 || r.tags.indexOf('skaldjur') !== -1;
  }

  function recipeIsPlantNative(r) {
    if (!r) return false;
    if (r.tags && (r.tags.indexOf('vegetarisk') !== -1 || r.tags.indexOf('vegan') !== -1)) {
      return true;
    }
    if (recipeIsMeatNative(r) || recipeIsFishNative(r)) return false;
    return recipeIsVegan(r);
  }

  function normalizeDietValue(value) {
    if (!value) return null;
    if (DIET_LEGACY[value]) return DIET_LEGACY[value];
    if (DIET_LABELS[value] && value !== 'all') return value;
    return null;
  }

  function recipeMatchesDiet(r, value) {
    var mode = normalizeDietValue(value);
    if (!mode) return true;
    if (mode === 'pesc') {
      if (recipeIsFishNative(r) || recipeIsPlantNative(r)) return true;
      return recipeHasVariantTier(r, ['fisk', 'vegetarisk', 'vegan']);
    }
    if (mode === 'vegetarisk') {
      if (recipeIsPlantNative(r)) return true;
      return recipeHasVariantTier(r, ['vegetarisk', 'vegan']);
    }
    return true;
  }

  function recipeMatchesCuisine(r, value) {
    var cuisines = recipeCuisines(r);
    if (value === 'asiatiskt') {
      return cuisines.some(function(c) {
        return c === 'asiatiskt' || c === 'kinesiskt' || c === 'japanskt' ||
          c === 'koreanskt' || c === 'thailandskt' || c === 'vietnamesiskt';
      });
    }
    return cuisines.indexOf(value) !== -1;
  }

  function recipeMatchesFilter(r, filter) {
    if (!filter || filter.type === 'all') return true;
    if (filter.type === 'category') return r.category === filter.value;
    if (filter.type === 'tag') {
      return !!(r.tags && r.tags.indexOf(filter.value) !== -1);
    }
    if (filter.type === 'diet') return recipeMatchesDiet(r, filter.value);
    if (filter.type === 'cuisine') return recipeMatchesCuisine(r, filter.value);
    return true;
  }

  function itemAvailable(recipes, item) {
    if (item.type === 'all') return true;
    if (!recipes || !recipes.length) return true;
    if (item.type === 'category') {
      return recipes.some(function(r) { return r.category === item.value; });
    }
    if (item.type === 'tag') {
      return recipes.some(function(r) {
        return r.tags && r.tags.indexOf(item.value) !== -1;
      });
    }
    if (item.type === 'diet') {
      return recipes.some(function(r) { return recipeMatchesDiet(r, item.value); });
    }
    if (item.type === 'cuisine') {
      return recipes.some(function(r) { return recipeMatchesCuisine(r, item.value); });
    }
    return false;
  }

  function recipeMatchesMultiFilters(r, multi) {
    if (!multi) return true;
    var protein = multi.protein || [];
    var cuisine = multi.cuisine || [];
    if (protein.length) {
      var hasProtein = protein.some(function(tag) {
        return !!(r.tags && r.tags.indexOf(tag) !== -1);
      });
      if (!hasProtein) return false;
    }
    if (cuisine.length) {
      var hasCuisine = cuisine.some(function(id) {
        return recipeMatchesCuisine(r, id);
      });
      if (!hasCuisine) return false;
    }
    return true;
  }

  function filterMenus(recipes, menus) {
    return menus.map(function(menu) {
      var sections = menu.sections.map(function(section) {
        var items = section.items.filter(function(item) {
          return itemAvailable(recipes, item);
        });
        return { name: section.name, items: items };
      }).filter(function(section) { return section.items.length; });
      return { id: menu.id, label: menu.label, sections: sections };
    }).filter(function(menu) { return menu.sections.length; });
  }

  function filtersEqual(a, b) {
    if (!a || !b) return false;
    if (a.type === 'all' && b.type === 'all') return true;
    return a.type === b.type && a.value === b.value;
  }

  function isAllFilter(filter) {
    return !filter || filter.type === 'all';
  }

  function isMenuActive(menu, activeFilter) {
    if (isAllFilter(activeFilter)) return false;
    for (var i = 0; i < menu.sections.length; i++) {
      var items = menu.sections[i].items;
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        if (filtersEqual({ type: item.type, value: item.value }, activeFilter)) return true;
      }
    }
    return false;
  }

  function readStoredFilter() {
    try {
      var raw = sessionStorage.getItem('recept_filter');
      if (!raw) return null;
      sessionStorage.removeItem('recept_filter');
      return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function normalizeListState(state) {
    state = state || {};
    var multi = state.activeMulti || {};
    return {
      activeFilter: state.activeFilter || { type: 'all', value: null },
      activeMulti: {
        protein: multi.protein ? multi.protein.slice() : [],
        cuisine: multi.cuisine ? multi.cuisine.slice() : [],
        maxKcal100: parseMacroOption(multi.maxKcal100, MAX_KCAL_100_OPTIONS),
        minProt100: parseMacroOption(multi.minProt100, MIN_PROT_100_OPTIONS)
      },
      favorites: !!state.favorites,
      search: String(state.search || '').trim()
    };
  }

  function buildListUrl(basePath, state) {
    state = normalizeListState(state);
    var params = new URLSearchParams();
    var filter = state.activeFilter;
    if (filter.type === 'category' && filter.value && CATEGORY_ORDER.indexOf(filter.value) !== -1) {
      params.set('typ', filter.value);
    } else if (filter.type === 'diet' && filter.value && DIET_LABELS[filter.value]) {
      params.set('diet', filter.value);
    }
    if (state.activeMulti.protein.length) params.set('protein', state.activeMulti.protein.join(','));
    if (state.activeMulti.cuisine.length) params.set('kok', state.activeMulti.cuisine.join(','));
    if (state.activeMulti.maxKcal100 != null) params.set('maxkcal', String(state.activeMulti.maxKcal100));
    if (state.activeMulti.minProt100 != null) params.set('minprot', String(state.activeMulti.minProt100));
    if (state.favorites) params.set('favoriter', '1');
    if (state.search) params.set('q', state.search);
    var qs = params.toString();
    var path = basePath || '/';
    if (path.slice(-1) !== '/') path += '/';
    return path + (qs ? '?' + qs : '');
  }

  function parseListUrl(search) {
    var params = new URLSearchParams(search || '');
    var state = normalizeListState({});
    var typ = params.get('typ');
    if (typ && CATEGORY_ORDER.indexOf(typ) !== -1) {
      state.activeFilter = { type: 'category', value: typ };
    }
    var diet = params.get('diet');
    var dietNorm = normalizeDietValue(diet);
    if (dietNorm) {
      state.activeFilter = { type: 'diet', value: dietNorm };
    }
    var protein = params.get('protein');
    if (protein) {
      state.activeMulti.protein = protein.split(',').filter(function(v) {
        return TAG_LABELS[v];
      });
    }
    var kok = params.get('kok');
    if (kok) {
      state.activeMulti.cuisine = kok.split(',').filter(function(v) {
        return CUISINE_LABELS[v];
      });
    }
    state.activeMulti.maxKcal100 = parseMacroOption(params.get('maxkcal'), MAX_KCAL_100_OPTIONS);
    state.activeMulti.minProt100 = parseMacroOption(params.get('minprot'), MIN_PROT_100_OPTIONS);
    if (params.get('favoriter') === '1') state.favorites = true;
    var q = params.get('q');
    if (q) state.search = q;
    return state;
  }

  function urlForFilter(basePath, state, filter) {
    var next = normalizeListState(state);
    if (!filter || filter.type === 'all') next.activeFilter = { type: 'all', value: null };
    else next.activeFilter = { type: filter.type, value: filter.value };
    return buildListUrl(basePath, next);
  }

  function filterLabel(filter) {
    if (isAllFilter(filter)) return DIET_LABELS.all;
    if (filter.type === 'category') return CATEGORY_LABELS[filter.value] || filter.value;
    if (filter.type === 'tag') return TAG_LABELS[filter.value] || filter.value;
    if (filter.type === 'diet') return DIET_LABELS[filter.value] || filter.value;
    if (filter.type === 'cuisine') return CUISINE_LABELS[filter.value] || filter.value;
    return DIET_LABELS.all;
  }

  function resetBrowsePanelStyles(root) {
    if (!root) return;
    root.querySelectorAll('.browse-menu .browse-panel').forEach(function(panel) {
      panel.style.position = '';
      panel.style.top = '';
      panel.style.left = '';
      panel.style.right = '';
      panel.style.width = '';
      panel.style.zIndex = '';
    });
  }

  function positionBrowsePanel(menu) {
    if (!window.matchMedia('(max-width: 720px)').matches) return;
    var panel = menu.querySelector('.browse-panel');
    var trigger = menu.querySelector('.browse-trigger');
    if (!panel || !trigger) return;
    var rect = trigger.getBoundingClientRect();
    var left = Math.max(12, Math.min(rect.left, window.innerWidth - 200));
    panel.style.position = 'fixed';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.left = left + 'px';
    panel.style.width = '';
    panel.style.right = 'auto';
    panel.style.zIndex = '60';
  }

  function closeAllMenus(root) {
    resetBrowsePanelStyles(root);
    root.querySelectorAll('.browse-menu.is-open, .list-filter-menu.is-open').forEach(function(el) {
      el.classList.remove('is-open');
      var btn = el.querySelector('.browse-trigger, .list-filter-trigger');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function bindDropdownBehavior(root) {
    if (!root || root._browseBound) return;
    root._browseBound = true;
    var closeTimer = null;

    root.addEventListener('mouseover', function(e) {
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      var menu = e.target.closest('.browse-menu, .list-filter-menu');
      if (!menu || !root.contains(menu)) return;
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      closeAllMenus(root);
      menu.classList.add('is-open');
      if (menu.classList.contains('browse-menu')) positionBrowsePanel(menu);
      var btn = menu.querySelector('.browse-trigger, .list-filter-trigger');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    });

    root.addEventListener('mouseout', function(e) {
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      var menu = e.target.closest('.browse-menu, .list-filter-menu');
      if (!menu || !root.contains(menu)) return;
      if (e.relatedTarget && menu.contains(e.relatedTarget)) return;
      closeTimer = setTimeout(function() {
        menu.classList.remove('is-open');
        var btn = menu.querySelector('.browse-trigger, .list-filter-trigger');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }, 140);
    });

    root.addEventListener('click', function(e) {
      var trigger = e.target.closest('.browse-trigger, .list-filter-trigger');
      if (trigger) {
        e.preventDefault();
        var menu = trigger.closest('.browse-menu, .list-filter-menu');
        var open = menu.classList.contains('is-open');
        closeAllMenus(root);
        if (!open) {
          menu.classList.add('is-open');
          if (menu.classList.contains('browse-menu')) positionBrowsePanel(menu);
          trigger.setAttribute('aria-expanded', 'true');
        }
        return;
      }
      if (e.target.closest('.browse-link')) closeAllMenus(root);
    });

    document.addEventListener('click', function(e) {
      if (!root.contains(e.target)) closeAllMenus(root);
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeAllMenus(root);
    });

    window.addEventListener('resize', function() {
      closeAllMenus(root);
    });
  }

  function renderPanel(section, options) {
    options = options || {};
    var getFilterUrl = options.getFilterUrl;
    var useLinks = !!getFilterUrl;
    var block = mk('div', 'browse-section');
    if (section.name) {
      var heading = mk('p', 'browse-section-name');
      heading.textContent = section.name;
      block.appendChild(heading);
    }
    var list = mk('ul', 'browse-section-links');
    section.items.forEach(function(item) {
      var li = mk('li');
      var filter = { type: item.type, value: item.value };
      var el = useLinks ? mk('a', 'browse-link') : mk('button', 'browse-link');
      if (!useLinks) el.type = 'button';
      el.textContent = item.label;
      el._browseFilter = filter;
      if (useLinks) el.href = getFilterUrl(filter);
      li.appendChild(el);
      list.appendChild(li);
    });
    block.appendChild(list);
    return block;
  }

  function listFilterTriggerLabel(menu, selected) {
    var values = selected[menu.id] || [];
    if (!values.length) return menu.label;
    var labels = [];
    menu.sections.forEach(function(section) {
      section.items.forEach(function(item) {
        if (values.indexOf(item.value) !== -1) labels.push(item.label);
      });
    });
    if (labels.length <= 2) return menu.label + ': ' + labels.join(', ');
    return menu.label + ' (' + labels.length + ')';
  }

  function macroRangeTriggerLabel(menu, selected) {
    var value = selected[menu.id];
    if (value == null) return menu.label;
    return menu.label + ': ' + value;
  }

  function listFilterChevron() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'list-filter-chevron');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 9l6 6 6-6');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function pruneMultiToAvailable(recipes, multi) {
    var next = copyActiveMulti(multi);
    var proteinMenus = filterMenus(recipes, LIST_FILTER_MENUS);
    var available = { protein: {}, cuisine: {} };
    proteinMenus.forEach(function(menu) {
      menu.sections.forEach(function(section) {
        section.items.forEach(function(item) {
          if (menu.id === 'protein' || menu.id === 'cuisine') {
            available[menu.id][item.value] = true;
          }
        });
      });
    });
    next.protein = next.protein.filter(function(v) { return available.protein[v]; });
    next.cuisine = next.cuisine.filter(function(v) { return available.cuisine[v]; });
    return next;
  }

  function renderListFilters(container, options) {
    options = options || {};
    var recipes = options.recipes || null;
    var activeMulti = pruneMultiToAvailable(recipes, options.activeMulti);
    if (
      options.onChange &&
      (activeMulti.protein.join(',') !== copyActiveMulti(options.activeMulti).protein.join(',') ||
        activeMulti.cuisine.join(',') !== copyActiveMulti(options.activeMulti).cuisine.join(','))
    ) {
      // Drop selections that would yield empty results under current diet.
      options.onChange(activeMulti);
      return;
    }
    var menus = filterMenus(recipes, LIST_FILTER_MENUS);
    container.replaceChildren();
    container.hidden = false;

    menus.forEach(function(menu) {
      var wrap = mk('div', 'list-filter-menu');
      var selected = activeMulti[menu.id] || [];
      var trigger = mk('button', 'list-filter-trigger');
      trigger.type = 'button';
      var triggerLabel = mk('span', 'list-filter-trigger-label');
      triggerLabel.textContent = listFilterTriggerLabel(menu, activeMulti);
      trigger.appendChild(triggerLabel);
      trigger.appendChild(listFilterChevron());
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      if (selected.length) trigger.classList.add('has-selection');
      wrap.appendChild(trigger);

      var panel = mk('div', 'list-filter-panel');
      var list = mk('ul', 'list-filter-options');
      menu.sections.forEach(function(section) {
        section.items.forEach(function(item) {
          var li = mk('li');
          var label = mk('label', 'list-filter-option');
          var input = document.createElement('input');
          input.type = 'checkbox';
          input.value = item.value;
          input.checked = selected.indexOf(item.value) !== -1;
          label.appendChild(input);
          var span = document.createElement('span');
          span.textContent = item.label;
          label.appendChild(span);
          li.appendChild(label);
          list.appendChild(li);

          input.addEventListener('change', function() {
            var next = copyActiveMulti(activeMulti);
            var bucket = (next[menu.id] || []).slice();
            if (input.checked) {
              if (bucket.indexOf(item.value) === -1) bucket.push(item.value);
            } else {
              bucket = bucket.filter(function(v) { return v !== item.value; });
            }
            next[menu.id] = bucket;
            if (options.onChange) options.onChange(next);
          });
        });
      });
      panel.appendChild(list);
      wrap.appendChild(panel);
      container.appendChild(wrap);
    });

    MACRO_RANGE_MENUS.forEach(function(menu) {
      var wrap = mk('div', 'list-filter-menu');
      var selectedValue = activeMulti[menu.id];
      var trigger = mk('button', 'list-filter-trigger');
      trigger.type = 'button';
      var triggerLabel = mk('span', 'list-filter-trigger-label');
      triggerLabel.textContent = macroRangeTriggerLabel(menu, activeMulti);
      trigger.appendChild(triggerLabel);
      trigger.appendChild(listFilterChevron());
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      if (selectedValue != null) trigger.classList.add('has-selection');
      wrap.appendChild(trigger);

      var panel = mk('div', 'list-filter-panel');
      var list = mk('ul', 'list-filter-options');
      var choices = [null].concat(menu.options);
      choices.forEach(function(opt) {
        var li = mk('li');
        var label = mk('label', 'list-filter-option');
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'list-filter-' + menu.id;
        input.value = opt == null ? '' : String(opt);
        input.checked = selectedValue == null ? opt == null : selectedValue === opt;
        label.appendChild(input);
        var span = document.createElement('span');
        span.textContent = opt == null ? 'Alla' : String(opt);
        label.appendChild(span);
        li.appendChild(label);
        list.appendChild(li);

        input.addEventListener('change', function() {
          if (!input.checked) return;
          var next = copyActiveMulti(activeMulti);
          next[menu.id] = opt == null ? null : opt;
          if (options.onChange) options.onChange(next);
        });
      });
      panel.appendChild(list);
      wrap.appendChild(panel);
      container.appendChild(wrap);
    });

    bindDropdownBehavior(container);
  }

  function render(nav, options) {
    options = options || {};
    var recipes = options.recipes || null;
    var activeFilter = options.activeFilter || { type: 'all', value: null };
    var linkMode = !!options.linkMode;
    var getFilterUrl = options.getFilterUrl;
    var useLinks = !!(getFilterUrl || linkMode);
    var menus = filterMenus(recipes, HEADER_MENUS);
    nav.replaceChildren();

    function wirePick(el, filter) {
      var href = getFilterUrl ? getFilterUrl(filter) : (linkMode ? buildListUrl('/', { activeFilter: filter }) : null);
      if (href && el.tagName === 'A') el.href = href;
      if (linkMode) return;
      el.addEventListener('click', function(e) {
        if (href) e.preventDefault();
        if (options.onSelect) options.onSelect(filter);
      });
    }

    var allEl = useLinks ? mk('a', 'browse-tab browse-tab-all') : mk('button', 'browse-tab browse-tab-all');
    if (!useLinks) allEl.type = 'button';
    allEl.textContent = 'Alla';
    if (isAllFilter(activeFilter)) allEl.classList.add('active');
    wirePick(allEl, { type: 'all', value: null });
    nav.appendChild(allEl);

    menus.forEach(function(menu) {
      var wrap = mk('div', 'browse-menu');
      var trigger = mk('button', 'browse-tab browse-trigger');
      trigger.type = 'button';
      trigger.textContent = menu.label;
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      if (isMenuActive(menu, activeFilter)) trigger.classList.add('active');
      wrap.appendChild(trigger);

      var panel = mk('div', 'browse-panel');
      var panelInner = mk('div', 'browse-panel-inner');
      menu.sections.forEach(function(section) {
        panelInner.appendChild(renderPanel(section, { getFilterUrl: getFilterUrl || (linkMode ? function(filter) {
          return buildListUrl('/', { activeFilter: filter });
        } : null) }));
      });
      panel.appendChild(panelInner);
      wrap.appendChild(panel);
      nav.appendChild(wrap);

      panel.querySelectorAll('.browse-link').forEach(function(btn) {
        var filter = btn._browseFilter;
        if (filtersEqual(filter, activeFilter)) btn.classList.add('active');
        if (!linkMode) wirePick(btn, filter);
      });
    });
    bindDropdownBehavior(nav);
  }

  global.ReceptBrowseNav = {
    CATEGORY_ORDER: CATEGORY_ORDER,
    CATEGORY_LABELS: CATEGORY_LABELS,
    TAG_LABELS: TAG_LABELS,
    DIET_LABELS: DIET_LABELS,
    filterLabel: filterLabel,
    readStoredFilter: readStoredFilter,
    buildListUrl: buildListUrl,
    parseListUrl: parseListUrl,
    urlForFilter: urlForFilter,
    normalizeDietValue: normalizeDietValue,
    recipeMatchesFilter: recipeMatchesFilter,
    recipeMatchesMultiFilters: recipeMatchesMultiFilters,
    recipeMatchesDiet: recipeMatchesDiet,
    recipeIsFishNative: recipeIsFishNative,
    recipeIsPlantNative: recipeIsPlantNative,
    render: render,
    renderListFilters: renderListFilters
  };
})(window);
