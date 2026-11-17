/* Granska näringsdata (fas 3). CSP: bara DOM-metoder, inga template literals i innerHTML. */
(function() {
  'use strict';

  var root = document.getElementById('review-root');
  var statusEl = document.getElementById('review-status');

  function mk(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function setStatus(msg, isErr) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  function round1(n) {
    return Math.round(Number(n) * 10) / 10;
  }

  function per100Text(food) {
    if (!food || food.kcal == null) return '';
    return Math.round(food.kcal) + ' kcal · P ' + round1(food.prot) + ' · K ' + round1(food.carb) +
      ' · F ' + round1(food.fat) + ' per 100 g';
  }

  function foodLine(prefix, food) {
    var p = mk('div', 'review-food');
    p.appendChild(document.createTextNode(prefix));
    if (!food) {
      p.appendChild(mk('span', 'review-per100', 'inget livsmedel'));
      return p;
    }
    p.appendChild(mk('span', 'review-food-name', food.name));
    if (food.ai) p.appendChild(mk('span', 'review-tag', 'AI-livsmedel'));
    var per = per100Text(food);
    if (per) {
      p.appendChild(document.createTextNode(' '));
      p.appendChild(mk('span', 'review-per100', '· ' + per));
    }
    return p;
  }

  function recipesLine(recipes) {
    var p = mk('div', 'review-recipes');
    if (!recipes || !recipes.length) {
      p.textContent = 'Används inte i något sparat recept';
      return p;
    }
    p.appendChild(document.createTextNode('I: '));
    recipes.forEach(function(r, i) {
      if (i) p.appendChild(document.createTextNode(', '));
      var a = mk('a', '', r.title);
      a.href = '/r/' + encodeURIComponent(r.id);
      p.appendChild(a);
    });
    return p;
  }

  function macroDelta(list) {
    var parts = [];
    (list || []).forEach(function(r) {
      var b = r.before && r.before.kcal;
      var a = r.after && r.after.kcal;
      if (b != null && a != null && b !== a) parts.push(r.id + ' ' + b + '→' + a + ' kcal');
    });
    return parts;
  }

  function post(body) {
    return fetch('/api/nutrition/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Kunde inte spara');
        return data;
      });
    });
  }

  function runAction(card, body, doneLabel) {
    var buttons = card.querySelectorAll('button, input');
    buttons.forEach(function(b) { b.disabled = true; });
    setStatus('Sparar…');
    return post(body).then(function(data) {
      card.classList.add('is-done');
      var n = (data.recomputed || []).length;
      var deltas = macroDelta(data.recomputed);
      setStatus(
        doneLabel + '. ' + (n === 1 ? '1 recept omräknat' : n + ' recept omräknade') +
        (deltas.length ? ': ' + deltas.join(' · ') : '.')
      );
      var actions = card.querySelector('.review-actions');
      if (actions) actions.replaceChildren(mk('span', 'review-per100', doneLabel));
      var search = card.querySelector('.review-search');
      if (search) search.remove();
      // Kontrollvyn (granska-kontroll.js) laddar om sina recept.
      window.dispatchEvent(new CustomEvent('review:changed'));
      return true;
    }).catch(function(e) {
      buttons.forEach(function(b) { b.disabled = false; });
      setStatus(e.message, true);
      return false;
    });
  }

  /** Sökfält mot katalogen; onPick(item) när ett livsmedel väljs. */
  function buildSearch(initial, onPick) {
    var wrap = mk('div', 'review-search');
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Sök livsmedel (t.ex. kikärtor kokta)';
    input.value = initial || '';
    input.autocomplete = 'off';
    var results = mk('div', 'review-results');
    results.setAttribute('role', 'listbox');
    var timer = null;
    var seq = 0;

    function search() {
      var q = input.value.trim();
      if (q.length < 2) {
        results.replaceChildren();
        return;
      }
      var mine = ++seq;
      fetch('/api/ingredients/search?q=' + encodeURIComponent(q) + '&limit=10', { credentials: 'same-origin' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (mine !== seq) return;
          results.replaceChildren();
          var seen = {};
          ((data && data.results) || []).forEach(function(item) {
            if (seen[item.id]) return;
            seen[item.id] = true;
            var btn = mk('button', 'review-result', item.canonical_name);
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            var bits = [];
            if (item.kcal_per_100g != null) bits.push(Math.round(item.kcal_per_100g) + ' kcal/100 g');
            if (item.piece_weight_g) bits.push('styck ≈ ' + item.piece_weight_g + ' g');
            if (item.alias && item.alias !== item.canonical_name.toLowerCase()) bits.push('alias: ' + item.alias);
            btn.appendChild(mk('span', 'review-result-meta', bits.join(' · ')));
            btn.addEventListener('click', function() { onPick(item); });
            results.appendChild(btn);
          });
        })
        .catch(function() { results.replaceChildren(); });
    }

    input.addEventListener('input', function() {
      clearTimeout(timer);
      timer = setTimeout(search, 200);
    });
    wrap.appendChild(input);
    wrap.appendChild(results);
    setTimeout(function() {
      input.focus();
      search();
    }, 0);
    return wrap;
  }

  function needsWeight(unit) {
    var u = String(unit || '').toLowerCase().trim();
    return !!u && u !== 'g' && u !== 'msk' && u !== 'tsk' && u !== 'krm' && u !== 'ml' && u !== 'dl' && u !== 'l';
  }

  function numInput(value) {
    var i = document.createElement('input');
    i.type = 'number';
    i.min = '0';
    i.step = 'any';
    i.inputMode = 'decimal';
    if (value != null) i.value = String(round1(value));
    return i;
  }

  /**
   * Formulär för eget livsmedel (fas 4). Fälten i etikettens ordning:
   * energi, fett, kolhydrater, protein — per 100 g.
   * opts: { food?, name?, assign?, doneLabel }
   */
  function foodForm(card, opts) {
    var existing = card.querySelector('.review-food-form');
    if (existing) {
      existing.remove();
      return;
    }
    var food = opts.food || null;
    var form = mk('form', 'review-food-form');
    form.noValidate = true;

    var nameRow = mk('label', 'review-form-row review-form-row--name');
    nameRow.appendChild(mk('span', '', 'Namn'));
    var nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.value = food ? food.name : (opts.name || '');
    nameIn.placeholder = 't.ex. Keso 1,5 % Arla';
    nameRow.appendChild(nameIn);
    form.appendChild(nameRow);

    form.appendChild(mk('div', 'review-form-caption', 'Per 100 g enligt etiketten'));
    var grid = mk('div', 'review-form-grid');
    var fields = [
      ['kcal', 'Energi', 'kcal'],
      ['fat', 'Fett', 'g'],
      ['carb', 'Kolhydrater', 'g'],
      ['prot', 'Protein', 'g']
    ];
    var inputs = {};
    fields.forEach(function(f) {
      var l = mk('label', 'review-form-row');
      l.appendChild(mk('span', '', f[1]));
      var i = numInput(food ? food[f[0]] : null);
      inputs[f[0]] = i;
      l.appendChild(i);
      l.appendChild(mk('span', 'review-form-unit', f[2]));
      grid.appendChild(l);
    });
    form.appendChild(grid);

    var check = mk('div', 'review-note review-form-check');
    form.appendChild(check);

    function updateCheck() {
      var p = Number(inputs.prot.value) || 0;
      var c = Number(inputs.carb.value) || 0;
      var f = Number(inputs.fat.value) || 0;
      var k = Number(inputs.kcal.value);
      if (inputs.kcal.value === '' || (!p && !c && !f)) {
        check.textContent = '';
        return;
      }
      var calc = Math.round(4 * p + 4 * c + 9 * f);
      var off = Math.abs(calc - k);
      check.textContent = off > 20 && off > k * 0.15
        ? 'Makrona ger ≈ ' + calc + ' kcal. Kontrollera värdena (fibrer och sockeralkoholer kan förklara en del).'
        : '';
    }
    Object.keys(inputs).forEach(function(k) { inputs[k].addEventListener('input', updateCheck); });
    updateCheck();

    var actions = mk('div', 'review-actions');
    var save = mk('button', 'primary', food ? 'Spara värden' : (opts.assign ? 'Skapa och använd' : 'Skapa'));
    save.type = 'submit';
    var cancel = mk('button', '', 'Avbryt');
    cancel.type = 'button';
    cancel.addEventListener('click', function() { form.remove(); });
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(actions);

    form.addEventListener('submit', function(ev) {
      ev.preventDefault();
      var missing = ['kcal', 'fat', 'carb', 'prot'].filter(function(k) { return inputs[k].value.trim() === ''; });
      if (nameIn.value.trim().length < 2 || missing.length) {
        setStatus('Fyll i namn och alla fyra värden.', true);
        return;
      }
      var body = {
        action: 'save_food',
        name: nameIn.value.trim(),
        kcal: Number(inputs.kcal.value),
        fat: Number(inputs.fat.value),
        carb: Number(inputs.carb.value),
        prot: Number(inputs.prot.value)
      };
      if (food) body.ingredient_id = food.id;
      if (opts.assign) body.assign = opts.assign();
      runAction(card, body, opts.doneLabel || 'Sparat').then(function(ok) {
        if (!ok) return;
        form.remove();
        // Nytt fristående livsmedel: ladda om så det syns i listan.
        if (!food && !opts.assign) load(true);
      });
    });

    card.appendChild(form);
    setTimeout(function() { (food ? inputs.kcal : nameIn).focus(); }, 0);
  }

  function toggleSearch(card, line, unit, matchKey) {
    var existing = card.querySelector('.review-search');
    if (existing) {
      existing.remove();
      return;
    }
    var openForm = card.querySelector('.review-food-form');
    if (openForm) openForm.remove();
    var weightIn = null;
    var search = buildSearch(line, function(item) {
      var body = { action: 'set_match', ingredient_id: item.id };
      if (matchKey) body.match_key = matchKey;
      else {
        body.name = line;
        body.unit = unit;
      }
      if (weightIn && weightIn.value.trim() !== '') {
        body.unit = unit;
        body.grams_per_unit = Number(weightIn.value);
      }
      runAction(card, body, 'Bytt till ' + item.canonical_name);
    });
    var own = mk('button', 'review-own-btn', 'Finns inte? Skapa eget livsmedel från etiketten');
    own.type = 'button';
    own.addEventListener('click', function() {
      search.remove();
      foodForm(card, {
        name: line.charAt(0).toUpperCase() + line.slice(1),
        doneLabel: 'Eget livsmedel skapat',
        assign: function() {
          var a = matchKey ? { match_key: matchKey } : { name: line, unit: unit };
          if (weightIn && weightIn.value.trim() !== '') {
            a.unit = unit;
            a.grams_per_unit = Number(weightIn.value);
          }
          return a;
        }
      });
    });
    search.appendChild(own);
    if (needsWeight(unit)) {
      var row = mk('div', 'review-weight-row');
      row.appendChild(document.createTextNode('1 ' + unit + ' ='));
      weightIn = document.createElement('input');
      weightIn.type = 'number';
      weightIn.min = '0';
      weightIn.step = 'any';
      weightIn.placeholder = 'valfritt';
      row.appendChild(weightIn);
      row.appendChild(document.createTextNode('g (lämna tomt för katalogens vikt)'));
      search.insertBefore(row, search.firstChild);
    }
    card.appendChild(search);
  }

  function lineTitle(name, unitText) {
    var t = mk('div', 'review-line', name);
    if (unitText) t.appendChild(mk('span', 'review-unit', unitText));
    return t;
  }

  function unresolvedCard(item) {
    var card = mk('div', 'review-card');
    card.appendChild(lineTitle(item.name, item.unit || ''));
    if (item.match_status === 'needs_piece_weight' || (item.food && item.match_status === 'unmatched')) {
      card.appendChild(foodLine('Hittat: ', item.food));
      card.appendChild(mk('div', 'review-note', 'Vikten per ' + (item.unit || 'enhet') + ' saknas.'));
    } else {
      card.appendChild(mk('div', 'review-note', 'Inget livsmedel hittat.'));
    }
    card.appendChild(recipesLine(item.recipes));
    var actions = mk('div', 'review-actions');
    if (item.food && needsWeight(item.unit)) {
      var row = mk('span', 'review-weight-row review-weight-row--inline');
      row.appendChild(document.createTextNode('1 ' + item.unit + ' ='));
      var w = document.createElement('input');
      w.type = 'number';
      w.min = '0';
      w.step = 'any';
      row.appendChild(w);
      row.appendChild(document.createTextNode('g'));
      var save = mk('button', 'primary', 'Spara vikt');
      save.type = 'button';
      save.addEventListener('click', function() {
        if (w.value.trim() === '') return;
        runAction(card, {
          action: 'set_match',
          match_key: item.match_key,
          ingredient_id: item.food.id,
          unit: item.unit,
          grams_per_unit: Number(w.value)
        }, 'Vikt sparad');
      });
      actions.appendChild(row);
      actions.appendChild(save);
    }
    var pick = mk('button', item.food ? '' : 'primary', 'Välj livsmedel');
    pick.type = 'button';
    pick.addEventListener('click', function() { toggleSearch(card, item.name, item.unit, item.match_key); });
    actions.appendChild(pick);
    card.appendChild(actions);
    return card;
  }

  function matchCard(item) {
    var card = mk('div', 'review-card');
    card.appendChild(lineTitle(item.name, item.unit_class === 'spoon' ? 'msk/tsk' : ''));
    card.appendChild(foodLine('→ ', item.food));
    if (item.note) card.appendChild(mk('div', 'review-note', 'AI: ' + item.note));
    var ex = (item.examples || []).filter(function(e) { return e.grams != null && e.unit && e.unit !== 'g'; })[0];
    if (ex) {
      card.appendChild(mk('div', 'review-recipes', 'Ex: ' + ex.amount + ' ' + ex.unit + ' = ' + Math.round(ex.grams) + ' g'));
    }
    card.appendChild(recipesLine(item.recipes));
    var actions = mk('div', 'review-actions');
    var ok = mk('button', 'primary', item.food && item.food.ai ? 'Godkänn livsmedel och värden' : 'Godkänn');
    ok.type = 'button';
    ok.addEventListener('click', function() {
      runAction(card, { action: 'approve_match', match_key: item.match_key }, 'Godkänd');
    });
    var change = mk('button', '', 'Byt livsmedel');
    change.type = 'button';
    change.addEventListener('click', function() {
      toggleSearch(card, item.name, null, item.match_key);
    });
    actions.appendChild(ok);
    if (item.food && item.food.ai) {
      var edit = mk('button', '', 'Ändra värden');
      edit.type = 'button';
      edit.addEventListener('click', function() {
        var s = card.querySelector('.review-search');
        if (s) s.remove();
        foodForm(card, {
          food: item.food,
          doneLabel: 'Värden sparade',
          assign: function() { return { match_key: item.match_key }; }
        });
      });
      actions.appendChild(edit);
    }
    actions.appendChild(change);
    card.appendChild(actions);
    return card;
  }

  function ownFoodCard(item) {
    var card = mk('div', 'review-card');
    var title = lineTitle(item.name, '');
    if (item.origin === 'user') title.appendChild(mk('span', 'review-tag review-tag--own', 'Eget'));
    else title.appendChild(mk('span', 'review-tag', item.needs_review ? 'AI, ogranskat' : 'AI'));
    card.appendChild(title);
    card.appendChild(mk('div', 'review-food review-per100', per100Text(item)));
    card.appendChild(recipesLine(item.recipes));
    var actions = mk('div', 'review-actions');
    var edit = mk('button', '', 'Ändra värden');
    edit.type = 'button';
    edit.addEventListener('click', function() {
      foodForm(card, { food: item, doneLabel: 'Värden sparade' });
    });
    actions.appendChild(edit);
    card.appendChild(actions);
    return card;
  }

  function newFoodButton() {
    var card = mk('div', 'review-card review-card--new');
    var btn = mk('button', '', '+ Nytt eget livsmedel');
    btn.type = 'button';
    btn.addEventListener('click', function() {
      foodForm(card, { doneLabel: 'Eget livsmedel skapat' });
    });
    card.appendChild(btn);
    return card;
  }

  function weightCard(item) {
    var card = mk('div', 'review-card');
    card.appendChild(lineTitle(item.food ? item.food.name : '#' + item.ingredient_id, 'per ' + item.unit));
    if (item.sample_name) card.appendChild(mk('div', 'review-note', 'Rad: ' + item.sample_name));
    card.appendChild(recipesLine(item.recipes));
    var actions = mk('div', 'review-actions');
    var row = mk('span', 'review-weight-row review-weight-row--inline');
    row.appendChild(document.createTextNode('1 ' + item.unit + ' ='));
    var w = document.createElement('input');
    w.type = 'number';
    w.min = '0';
    w.step = 'any';
    w.value = String(round1(item.grams_per_unit));
    row.appendChild(w);
    row.appendChild(document.createTextNode('g'));
    var save = mk('button', 'primary', 'Godkänn');
    save.type = 'button';
    w.addEventListener('input', function() {
      save.textContent = Number(w.value) === round1(item.grams_per_unit) ? 'Godkänn' : 'Spara vikt';
    });
    save.addEventListener('click', function() {
      if (w.value.trim() === '') return;
      runAction(card, {
        action: 'set_weight',
        ingredient_id: item.ingredient_id,
        unit: item.unit,
        grams_per_unit: Number(w.value)
      }, 'Vikt sparad');
    });
    actions.appendChild(row);
    actions.appendChild(save);
    card.appendChild(actions);
    return card;
  }

  function section(title, hint, items, build, emptyText) {
    var sec = mk('section', 'review-section');
    sec.appendChild(mk('h2', '', title + ' (' + items.length + ')'));
    if (hint) sec.appendChild(mk('p', 'review-section-hint', hint));
    if (!items.length) sec.appendChild(mk('p', 'review-empty', emptyText));
    items.forEach(function(it) { sec.appendChild(build(it)); });
    return sec;
  }

  function render(data, keepStatus) {
    root.replaceChildren();
    var unresolved = data.unresolved || [];
    var matches = data.matches || [];
    var weights = data.weights || [];
    root.appendChild(section(
      'Saknar näringsdata', 'Räknas inte med i receptets makron.',
      unresolved, unresolvedCard, 'Inga rader saknar näringsdata.'
    ));
    root.appendChild(section(
      'Osäkra matchningar', 'AI valde livsmedel med låg säkerhet, eller skapade ett eget livsmedel med uppskattade värden.',
      matches, matchCard, 'Inget att granska.'
    ));
    root.appendChild(section(
      'AI-bedömda vikter', 'Gram per enhet som AI uppskattat. Godkänn eller ändra.',
      weights, weightCard, 'Inget att granska.'
    ));
    var foods = data.foods || [];
    var foodSec = section(
      'Egna livsmedel', 'AI-skapade och egna livsmedel. Ändra värden efter etiketten — ändringen räknar om alla recept som använder livsmedlet.',
      foods, ownFoodCard, 'Inga egna livsmedel än.'
    );
    var hint = foodSec.querySelector('.review-section-hint');
    foodSec.insertBefore(newFoodButton(), hint ? hint.nextSibling : foodSec.children[1] || null);
    root.appendChild(foodSec);
    var total = unresolved.length + matches.length + weights.length;
    if (!keepStatus) setStatus(total ? total + ' att granska.' : 'Allt granskat.');
  }

  function load(keepStatus) {
    fetch('/api/nutrition/review', { credentials: 'same-origin' })
      .then(function(res) {
        if (res.status === 401) {
          location.href = '/login.html?next=' + encodeURIComponent('/granska');
          return null;
        }
        return res.json().then(function(data) {
          if (!res.ok) throw new Error(data.error || 'Kunde inte läsa granskningslistan');
          return data;
        });
      })
      .then(function(data) { if (data) render(data, keepStatus); })
      .catch(function(e) { setStatus(e.message, true); });
  }

  window.ReviewTools = { toggleSearch: toggleSearch };
  window.addEventListener('audit:changed', function() { load(true); });

  load();
})();
