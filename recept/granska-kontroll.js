/* Kontroll av receptens makron. CSP: bara DOM-metoder, inga template literals i innerHTML. */
(function() {
  'use strict';

  var root = document.getElementById('audit-root');
  if (!root) return;

  var STATUS_LABEL = {
    flagged: 'Avvikelse',
    stale: 'Ändrat sedan kontroll',
    unchecked: 'Ej kontrollerat',
    ok: 'AI håller med',
    verified: 'Kontrollerat'
  };

  var state = { data: null, running: false, progress: '' };

  function mk(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function chip(status, text) {
    return mk('span', 'audit-chip audit-chip--' + status, text || STATUS_LABEL[status]);
  }

  function api(method, body) {
    return fetch('/api/nutrition/audit', {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Fel ' + res.status);
        return data;
      });
    });
  }

  function pct(n) {
    return (n > 0 ? '+' : '') + n + ' %';
  }

  function macroLine(item) {
    var p = mk('div', 'audit-macros');
    var m = item.macros;
    if (!m) {
      p.textContent = 'Inga makron';
      return p;
    }
    p.appendChild(document.createTextNode(
      'Receptet: ' + Math.round(m.kcal) + ' kcal · P ' + Math.round(m.prot) +
      ' · K ' + Math.round(m.carb) + ' · F ' + Math.round(m.fat) +
      ' (' + Math.round(m.kcal / item.servings) + ' kcal/portion, ' + item.servings + ' port.)'
    ));
    if (item.ai) {
      p.appendChild(mk('br'));
      p.appendChild(document.createTextNode('AI oberoende: ' + item.ai.kcal + ' kcal · P ' + item.ai.prot + ' · K ' + item.ai.carb + ' · F ' + item.ai.fat + ' '));
      var off = Math.abs(item.ai.kcal_diff_pct) > 10 || Math.abs(item.ai.prot_diff_pct) > 12;
      p.appendChild(mk('span', 'audit-diff' + (off ? ' audit-diff--off' : ''),
        '(' + pct(item.ai.kcal_diff_pct) + ' kcal, ' + pct(item.ai.prot_diff_pct) + ' protein)'));
    }
    return p;
  }

  function issuesList(item) {
    var list = (item.issues || []).filter(function(x) { return x.level !== 'info' || item.status !== 'verified'; });
    if (!list.length) return null;
    var ul = mk('ul', 'audit-issues');
    list.forEach(function(x) {
      ul.appendChild(mk('li', x.level === 'error' ? 'audit-issue--error' : '', (x.name ? x.name + ': ' : '') + x.text));
    });
    return ul;
  }

  function amountText(r) {
    return r.amount != null ? r.amount + ' ' + (r.unit || '') : (r.unit || '');
  }

  function rowsTable(item) {
    if (!item.ai || !item.ai.rows.length) return null;
    var wrap = mk('div', 'audit-table-wrap');
    var t = mk('table', 'audit-rows');
    var head = mk('tr');
    ['Rad', 'Vi', 'AI'].forEach(function(h) { head.appendChild(mk('th', '', h)); });
    var thead = mk('thead');
    thead.appendChild(head);
    t.appendChild(thead);
    var tb = mk('tbody');
    item.ai.rows.forEach(function(r) {
      var tr = mk('tr', r.off ? 'is-off' : '');
      var c1 = mk('td');
      c1.appendChild(mk('div', '', r.name + ' · ' + amountText(r)));
      if (r.food) c1.appendChild(mk('div', 'review-per100', '→ ' + r.food));
      if (r.note) c1.appendChild(mk('div', 'review-note', 'AI: ' + r.note));
      if (r.off && window.ReviewTools) {
        var holder = mk('div', 'audit-row-fix');
        var actions = mk('div', 'review-actions');
        var b = mk('button', 'audit-row-btn', 'Byt livsmedel');
        b.type = 'button';
        b.addEventListener('click', function() {
          window.ReviewTools.toggleSearch(holder, r.name, r.unit, null);
        });
        actions.appendChild(b);
        holder.appendChild(actions);
        c1.appendChild(holder);
      }
      tr.appendChild(c1);
      tr.appendChild(mk('td', 'num', (r.ours.grams != null ? Math.round(r.ours.grams) + ' g · ' : '') + r.ours.kcal + ' kcal · P ' + r.ours.prot));
      tr.appendChild(mk('td', 'num', (r.ai.grams != null ? Math.round(r.ai.grams) + ' g · ' : '') + r.ai.kcal + ' kcal · P ' + r.ai.prot));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function replaceItem(updated) {
    if (!state.data) return;
    state.data.recipes = state.data.recipes.map(function(r) { return r.id === updated.id ? updated : r; });
    recount();
    render();
  }

  function recount() {
    var c = {};
    state.data.recipes.forEach(function(r) { c[r.status] = (c[r.status] || 0) + 1; });
    state.data.counts = c;
  }

  function act(item, action, btn) {
    btn.disabled = true;
    var old = btn.textContent;
    if (action === 'check') btn.textContent = 'Kontrollerar…';
    return api('POST', { action: action, recipe_id: item.id })
      .then(function(data) {
        replaceItem(data.recipe);
        if (action !== 'check') window.dispatchEvent(new CustomEvent('audit:changed'));
      })
      .catch(function(e) {
        btn.disabled = false;
        btn.textContent = old;
        alert(e.message);
      });
  }

  function card(item) {
    var c = mk('div', 'review-card');
    var head = mk('div', 'audit-head');
    var title = mk('div', 'review-line');
    var a = mk('a', '', item.title);
    a.href = '/r/' + encodeURIComponent(item.id);
    title.appendChild(a);
    head.appendChild(title);
    head.appendChild(chip(item.status));
    c.appendChild(head);
    c.appendChild(macroLine(item));
    var issues = issuesList(item);
    if (issues) c.appendChild(issues);
    if (item.ai && item.ai.summary) c.appendChild(mk('div', 'review-note', 'AI: ' + item.ai.summary));
    var table = rowsTable(item);
    if (table) c.appendChild(table);
    if (item.was_verified) c.appendChild(mk('div', 'review-note', 'Var kontrollerat, men ingredienserna har ändrats sedan dess.'));

    var actions = mk('div', 'review-actions');
    if (state.data.ai_available) {
      var chk = mk('button', item.ai ? '' : 'primary', item.ai ? 'Kör AI-kontroll igen' : 'Kör AI-kontroll');
      chk.type = 'button';
      chk.disabled = state.running;
      chk.addEventListener('click', function() { act(item, 'check', chk); });
      actions.appendChild(chk);
    }
    var ver = mk('button', item.status === 'ok' ? 'primary' : '', 'Markera som kontrollerat');
    ver.type = 'button';
    ver.addEventListener('click', function() { act(item, 'verify', ver); });
    actions.appendChild(ver);
    var edit = mk('a', 'review-per100', 'Redigera recept');
    edit.href = '/add/redigera?edit=' + encodeURIComponent(item.id);
    actions.appendChild(edit);
    c.appendChild(actions);
    return c;
  }

  /** Kompakt lista: titel, kcal och en knapp per recept. */
  function compactBlock(label, items, btnLabel, action) {
    var wrap = mk('div', 'review-card');
    wrap.appendChild(mk('div', 'review-line', label + ' (' + items.length + ')'));
    var p = mk('div', 'audit-verified-list');
    items.forEach(function(it) {
      var line = mk('div', 'audit-compact-row');
      var left = mk('span');
      var a = mk('a', '', it.title);
      a.href = '/r/' + encodeURIComponent(it.id);
      left.appendChild(a);
      var extra = it.macros ? Math.round(it.macros.kcal) + ' kcal' : '';
      if (it.ai) extra += ' · AI ' + pct(it.ai.kcal_diff_pct);
      if (extra) left.appendChild(mk('span', 'review-per100', ' ' + extra));
      line.appendChild(left);
      var b = mk('button', 'audit-row-btn', btnLabel);
      b.type = 'button';
      b.disabled = state.running && action === 'check';
      b.addEventListener('click', function() { act(it, action, b); });
      line.appendChild(b);
      p.appendChild(line);
    });
    wrap.appendChild(p);
    return wrap;
  }

  function runAll() {
    var queue = state.data.recipes.filter(function(r) {
      return r.status === 'unchecked' || r.status === 'stale';
    });
    if (!queue.length) return;
    state.running = true;
    var done = 0;
    var failed = 0;
    function next() {
      if (!queue.length) {
        state.running = false;
        state.progress = 'Klart: ' + done + ' kontrollerade' + (failed ? ', ' + failed + ' misslyckades' : '') + '.';
        render();
        return;
      }
      var item = queue.shift();
      state.progress = 'Kontrollerar ' + (done + failed + 1) + ' av ' + (done + failed + queue.length + 1) + ': ' + item.title;
      render();
      api('POST', { action: 'check', recipe_id: item.id })
        .then(function(data) {
          done++;
          state.data.recipes = state.data.recipes.map(function(r) { return r.id === data.recipe.id ? data.recipe : r; });
          recount();
        })
        .catch(function() { failed++; })
        .then(next);
    }
    next();
  }

  function render() {
    var d = state.data;
    root.replaceChildren();
    var h = mk('h2', '', 'Kontroll av recept');
    h.id = 'audit-heading';
    root.appendChild(h);
    root.appendChild(mk('p', 'review-section-hint',
      'Regler plus en oberoende AI-bedömning som bara ser receptets text. Avvikelse = mer än 10 % i kcal eller 12 % i protein, eller rader som skiljer tydligt. ' +
      'Markera receptet som kontrollerat när du gått igenom det. Stämpeln släpper om ingredienserna ändras.'));

    var sum = mk('div', 'audit-summary');
    ['flagged', 'stale', 'unchecked', 'ok', 'verified'].forEach(function(s) {
      if (d.counts[s]) sum.appendChild(chip(s, STATUS_LABEL[s] + ': ' + d.counts[s]));
    });
    root.appendChild(sum);

    var toolbar = mk('div', 'audit-toolbar');
    var pending = (d.counts.unchecked || 0) + (d.counts.stale || 0);
    if (d.ai_available && pending) {
      var all = mk('button', 'primary', 'Kör AI-kontroll på ' + pending + ' recept');
      all.type = 'button';
      all.disabled = state.running;
      all.addEventListener('click', runAll);
      toolbar.appendChild(all);
    }
    if (state.progress) toolbar.appendChild(mk('span', 'audit-progress', state.progress));
    if (toolbar.childNodes.length) root.appendChild(toolbar);

    // Fulla kort bara där något behöver göras (avvikelse, ändrat, regelfel).
    var by = function(s) { return d.recipes.filter(function(r) { return r.status === s; }); };
    by('flagged').concat(by('stale')).forEach(function(it) { root.appendChild(card(it)); });
    var unchecked = by('unchecked');
    if (unchecked.length) {
      root.appendChild(compactBlock('Ej kontrollerade', unchecked, d.ai_available ? 'Kontrollera' : 'Markera som kontrollerat', d.ai_available ? 'check' : 'verify'));
    }
    var ok = by('ok');
    if (ok.length) root.appendChild(compactBlock('AI håller med — markera när du tittat', ok, 'Markera som kontrollerat', 'verify'));
    var verified = by('verified');
    if (verified.length) root.appendChild(compactBlock('Kontrollerade', verified, 'Ångra', 'unverify'));
  }

  function load() {
    return api('GET')
      .then(function(data) {
        state.data = data;
        render();
      })
      .catch(function(e) {
        if (/401/.test(e.message)) return;
        root.replaceChildren(mk('p', 'review-status err', 'Kontrollen kunde inte laddas: ' + e.message));
      });
  }

  var reloadTimer = null;
  window.addEventListener('review:changed', function() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function() { if (!state.running) load(); }, 300);
  });

  load();
})();
