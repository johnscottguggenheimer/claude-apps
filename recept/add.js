(function() {
  function mk(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  var currentRecipe = null;
  var editingRecipeId = null;
  var editMode = false;
  var pendingImageBase64 = null;
  var pendingMimeType = null;
  var mergeImageBase64 = null;
  var mergeMimeType = null;
  var createSubMode = 'text';
  var ADD_BASE = (function() {
    var p = location.pathname.replace(/\/$/, '');
    var m = p.match(/^(.*\/add)(?:\/(?:text|url|bild|redigera))?$/);
    if (m) return m[1];
    if (/\/add\.html$/i.test(p)) return p.replace(/\/add\.html$/i, '/add');
    var idx = p.indexOf('/recept');
    if (idx !== -1) return p.slice(0, idx + 7) + '/add';
    return '/add';
  })();
  var ROUTE_TO_MODE = { text: 'text', url: 'url', bild: 'image' };
  var MODE_TO_ROUTE = { text: 'text', url: 'url', image: 'bild' };

  var statusEl = document.getElementById('status');
  var saveStatusEl = document.getElementById('save-status');
  var previewEl = document.getElementById('preview');
  var previewTitle = document.getElementById('preview-title');
  var previewHint = document.getElementById('preview-hint');
  var previewImg = document.getElementById('preview-img');
  var previewImageWrap = document.getElementById('preview-image-wrap');
  var previewImageActions = document.getElementById('preview-image-actions');
  var previewPlaceholderActions = document.getElementById('preview-placeholder-actions');
  var btnUploadImage = document.getElementById('btn-upload-image');
  var previewUploadWrap = document.getElementById('preview-upload-wrap');
  var previewUploadMenu = document.getElementById('preview-upload-menu');
  var btnUploadPaste = document.getElementById('btn-upload-paste');
  var filePreviewInput = document.getElementById('file-preview');
  var uploadMenuOpen = false;
  var awaitingPreviewPaste = false;
  var pasteShortcutHint = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? '⌘V' : 'Ctrl+V';
  var btnGenerateImage = document.getElementById('btn-generate-image');
  var btnEnhanceImage = document.getElementById('btn-enhance-image');
  var btnGeneratePlaceholder = document.getElementById('btn-generate-placeholder');
  var btnImagePromptExtra = document.getElementById('btn-image-prompt-extra');
  var btnImagePromptExtraOverlay = document.getElementById('btn-image-prompt-extra-overlay');
  var imagePromptExtraPanel = document.getElementById('image-prompt-extra');
  var imagePromptExtraText = document.getElementById('image-prompt-extra-text');
  var regenProgressTimer = null;
  var regenUndoSnapshot = null;
  var regenRedoSnapshot = null;
  var savedImageLoadFailed = false;
  var editSelect = document.getElementById('edit-select');
  var recipeList = [];
  var VISIT_COOKIE_NAME = 'recept_seen_new';
  var VISIT_COOKIE_MAX_AGE = String(365 * 24 * 60 * 60);
  var previewForm = document.getElementById('preview-form');
  previewForm.addEventListener('click', function(ev) {
    previewForm.querySelectorAll('.ing-suggest.is-open').forEach(function(el) {
      var row = el.closest('.ing-edit-row');
      if (row && !row.contains(ev.target)) el.classList.remove('is-open');
    });
  });
  var previewMetaFields = document.getElementById('preview-meta-fields');

  var CATEGORY_ORDER = ['frukost', 'lunch', 'middag', 'tillbehor', 'fika'];
  var CATEGORY_LABELS = {
    frukost: 'Frukost', lunch: 'Lunch', middag: 'Middag', tillbehor: 'Tillbehör', fika: 'Fika & bakning'
  };
  var TAG_FILTER_ORDER = [
    'kyckling', 'notkott', 'flask', 'fisk', 'skaldjur', 'vegetarisk', 'vegan'
  ];
  var TAG_LABELS = {
    kyckling: 'Kyckling', notkott: 'Nötkött', flask: 'Fläsk',
    fisk: 'Fisk', skaldjur: 'Skaldjur', vegetarisk: 'Vegetariskt', vegan: 'Veganskt'
  };
  var VALID_UNITS = ['g', 'msk', 'tsk', 'st', 'pinch', 'näve', 'strimlor'];

  function slugifyTitle(title) {
    return String(title || 'recept')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'recept';
  }

  var reviewActive = false;

  function isMergeMoreOpen() {
    var body = document.getElementById('merge-more-body');
    return !!(body && !body.classList.contains('hidden'));
  }

  function setMergeMoreOpen(open) {
    var mergePanel = document.getElementById('panel-merge-more');
    var body = document.getElementById('merge-more-body');
    var toggle = document.getElementById('btn-merge-more-toggle');
    if (body) body.classList.toggle('hidden', !open);
    if (mergePanel) mergePanel.classList.toggle('is-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function syncInputPanels() {
    var hideInputs = reviewActive && previewEl.classList.contains('visible');
    document.getElementById('panel-create').classList.toggle('hidden', hideInputs || editMode);
    var panelEdit = document.getElementById('panel-edit');
    if (panelEdit) panelEdit.classList.toggle('hidden', hideInputs || !editMode);
    var mergePanel = document.getElementById('panel-merge-more');
    if (mergePanel) {
      var show = hideInputs && currentRecipe;
      mergePanel.classList.toggle('hidden', !show);
      if (!show) setMergeMoreOpen(false);
    }
  }

  function clearMergeInputs() {
    mergeImageBase64 = null;
    mergeMimeType = null;
    var textEl = document.getElementById('merge-text');
    if (textEl) textEl.value = '';
    clearImageDrop('drop-merge', 'thumb-merge', 'file-merge');
  }

  function setMergeImage(data, mime) {
    mergeImageBase64 = data;
    mergeMimeType = mime;
    var thumb = document.getElementById('thumb-merge');
    var drop = document.getElementById('drop-merge');
    if (thumb) {
      thumb.src = 'data:' + mime + ';base64,' + data;
      thumb.classList.remove('hidden');
    }
    if (drop) drop.classList.add('has-image');
  }

  function fieldInput(id, label, value, type) {
    var wrap = mk('div', 'field');
    var lbl = mk('label');
    lbl.textContent = label;
    lbl.htmlFor = id;
    var input = document.createElement('input');
    input.id = id;
    input.type = type || 'text';
    input.autocomplete = 'off';
    input.value = value != null ? String(value) : '';
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    return wrap;
  }

  function ensureRecipeTitle(recipe) {
    if (!recipe) return recipe;
    if (recipe.title && String(recipe.title).trim()) {
      recipe.title = String(recipe.title).trim();
      return recipe;
    }
    var alt = recipe.name || recipe.titel || recipe.Title || recipe.Name;
    if (alt && String(alt).trim()) {
      recipe.title = String(alt).trim();
      return recipe;
    }
    if (recipe.id && recipe.id !== 'recept') {
      recipe.title = String(recipe.id)
        .split('-')
        .filter(Boolean)
        .map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); })
        .join(' ');
    }
    return recipe;
  }

  function clearRegenProgress() {
    if (regenProgressTimer) {
      clearInterval(regenProgressTimer);
      regenProgressTimer = null;
    }
  }

  function renderStatusBusy(msg, pct) {
    statusEl.className = 'status status-busy';
    statusEl.replaceChildren();
    var spinner = mk('span', 'status-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    var text = mk('span', 'status-busy-text');
    text.textContent = msg;
    var pctEl = mk('span', 'status-pct');
    pctEl.textContent = Math.round(pct) + '%';
    statusEl.appendChild(spinner);
    statusEl.appendChild(text);
    statusEl.appendChild(pctEl);
  }

  function setStatusBusy(msg, pct) {
    clearRegenProgress();
    renderStatusBusy(msg, pct);
  }

  function startRegenProgress(mode) {
    clearRegenProgress();
    var label = mode === 'generate' ? 'Genererar bild med AI…' : 'Förbättrar bild med AI…';
    var pct = 0;
    renderStatusBusy(label, pct);
    regenProgressTimer = setInterval(function() {
      if (pct < 55) pct += 2;
      else if (pct < 82) pct += 1;
      else if (pct < 92) pct += 0.35;
      renderStatusBusy(label, pct);
    }, 450);
  }

  function finishRegenProgress(mode) {
    clearRegenProgress();
    var label = mode === 'generate' ? 'Genererar bild med AI…' : 'Förbättrar bild med AI…';
    renderStatusBusy(label, 100);
  }

  function setStatusWithUndo(msg, onUndo, isErr) {
    clearRegenProgress();
    statusEl.className = 'status' + (isErr ? ' err' : '');
    statusEl.replaceChildren();
    statusEl.appendChild(document.createTextNode(msg + ' '));
    var link = mk('button', 'status-undo-link');
    link.type = 'button';
    link.textContent = 'Ångra';
    link.addEventListener('click', onUndo);
    statusEl.appendChild(link);
  }

  function setStatusWithRedo(msg, onRedo, isErr) {
    clearRegenProgress();
    statusEl.className = 'status' + (isErr ? ' err' : '');
    statusEl.replaceChildren();
    statusEl.appendChild(document.createTextNode(msg + ' '));
    var link = mk('button', 'status-undo-link');
    link.type = 'button';
    link.textContent = 'Ångra tillbaka';
    link.addEventListener('click', onRedo);
    statusEl.appendChild(link);
  }

  function clearRegenHistory() {
    regenUndoSnapshot = null;
    regenRedoSnapshot = null;
  }

  function setSaveStatus(msg, isErr) {
    if (!saveStatusEl) return;
    saveStatusEl.textContent = msg || '';
    saveStatusEl.className = 'status' + (isErr ? ' err' : '');
  }

  function setStatus(msg, isErr) {
    clearRegenProgress();
    clearRegenHistory();
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isErr ? ' err' : '');
    if (isErr) setSaveStatus(msg, true);
    else setSaveStatus('');
  }

  function setStatusTransient(msg, isErr) {
    clearRegenProgress();
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isErr ? ' err' : '');
  }

  function fetchImageAsBase64(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function(res) {
      if (!res.ok) throw new Error('Kunde inte läsa bild');
      return res.blob();
    }).then(function(blob) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() {
          var dataUrl = String(reader.result || '');
          var m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!m) {
            reject(new Error('Kunde inte läsa bild'));
            return;
          }
          resolve({ mimeType: m[1], data: m[2] });
        };
        reader.onerror = function() { reject(new Error('Kunde inte läsa bild')); };
        reader.readAsDataURL(blob);
      });
    });
  }

  function fetchImageAsBase64Optional(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function(res) {
      if (!res.ok) return null;
      return res.blob();
    }).then(function(blob) {
      if (!blob) return null;
      return new Promise(function(resolve) {
        var reader = new FileReader();
        reader.onload = function() {
          var dataUrl = String(reader.result || '');
          var m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          resolve(m ? { mimeType: m[1], data: m[2] } : null);
        };
        reader.onerror = function() { resolve(null); };
        reader.readAsDataURL(blob);
      });
    }).catch(function() { return null; });
  }

  function putRecipeUpdate(recipe, extra) {
    var body = { recipe: recipe, featuredNew: document.getElementById('featured-new').checked };
    if (extra) {
      Object.keys(extra).forEach(function(k) { body[k] = extra[k]; });
    }
    return fetch('/api/recipes/' + encodeURIComponent(recipe.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) {
          throw new Error((data.details && data.details.join(' · ')) || data.error || 'Uppdatering misslyckades');
        }
        return data;
      });
    });
  }

  function captureCurrentImageSnapshot(recipe) {
    if (pendingImageBase64 && pendingMimeType) {
      return Promise.resolve({ mimeType: pendingMimeType, data: pendingImageBase64, empty: false });
    }
    if (recipe.image && !savedImageLoadFailed) {
      return fetchImageAsBase64Optional(imageSrcForRecipe(recipe, true)).then(function(snapshot) {
        if (snapshot) return { mimeType: snapshot.mimeType, data: snapshot.data, empty: false };
        return { empty: true };
      });
    }
    return Promise.resolve({ empty: true });
  }

  function applyImageSnapshot(snapshot) {
    if (snapshot.empty) {
      clearPendingImage();
      return;
    }
    pendingImageBase64 = snapshot.data;
    pendingMimeType = snapshot.mimeType;
  }

  function storeRedoFromPending() {
    if (pendingImageBase64 && pendingMimeType) {
      regenRedoSnapshot = { mimeType: pendingMimeType, data: pendingImageBase64, empty: false };
      return;
    }
    regenRedoSnapshot = { empty: true };
  }

  function storeUndoFromPending() {
    if (pendingImageBase64 && pendingMimeType) {
      regenUndoSnapshot = { mimeType: pendingMimeType, data: pendingImageBase64, empty: false };
      return;
    }
    regenUndoSnapshot = { empty: true };
  }

  function undoRegenLocalImage() {
    if (!regenUndoSnapshot) return;
    storeRedoFromPending();
    applyImageSnapshot(regenUndoSnapshot);
    regenUndoSnapshot = null;
    if (currentRecipe) {
      showPreview(readRecipeFromForm());
    }
    setStatusWithRedo('Tidigare bild återställd.', redoRegenLocalImage);
  }

  function redoRegenLocalImage() {
    if (!regenRedoSnapshot) return;
    storeUndoFromPending();
    applyImageSnapshot(regenRedoSnapshot);
    regenRedoSnapshot = null;
    if (currentRecipe) {
      showPreview(readRecipeFromForm());
    }
    setStatusWithUndo('Bild återställd.', undoRegenLocalImage);
  }

  function putRecipeImageSnapshot(recipe, snapshot) {
    if (snapshot.empty) return putRecipeUpdate(recipe, { clearImage: true });
    return putRecipeUpdate(recipe, {
      uploadImage: true,
      imageBase64: snapshot.data,
      mimeType: snapshot.mimeType
    });
  }

  function undoRegenImage() {
    if (!regenUndoSnapshot || !currentRecipe || !currentRecipe.id) return;
    if (!recipeExistsInDb(currentRecipe.id)) {
      undoRegenLocalImage();
      return;
    }
    var snapshot = regenUndoSnapshot;
    var undoBtn = statusEl.querySelector('.status-undo-link');
    if (undoBtn) undoBtn.disabled = true;
    setImageAiButtonsDisabled(true);
    setStatusTransient('Återställer bild…');
    var recipe = readRecipeFromForm();
    captureCurrentImageSnapshot(recipe).then(function(redo) {
      regenRedoSnapshot = redo;
      return putRecipeImageSnapshot(recipe, snapshot);
    }).then(function(data) {
      editMode = true;
      clearPendingImage();
      regenUndoSnapshot = null;
      showPreview(data.recipe);
      if (data.recipe.image) {
        previewImg.src = imageSrcForRecipe(data.recipe, true);
      }
      setStatusWithRedo('Tidigare bild återställd.', redoRegenImage);
    }).catch(function(ex) {
      regenUndoSnapshot = snapshot;
      regenRedoSnapshot = null;
      setStatusWithUndo(ex.message, undoRegenImage, true);
    }).finally(function() { setImageAiButtonsDisabled(false); });
  }

  function redoRegenImage() {
    if (!regenRedoSnapshot || !currentRecipe || !currentRecipe.id) return;
    if (!recipeExistsInDb(currentRecipe.id)) {
      redoRegenLocalImage();
      return;
    }
    var snapshot = regenRedoSnapshot;
    var redoBtn = statusEl.querySelector('.status-undo-link');
    if (redoBtn) redoBtn.disabled = true;
    setImageAiButtonsDisabled(true);
    setStatusTransient('Återställer bild…');
    var recipe = readRecipeFromForm();
    captureCurrentImageSnapshot(recipe).then(function(undo) {
      regenUndoSnapshot = undo;
      return putRecipeImageSnapshot(recipe, snapshot);
    }).then(function(data) {
      editMode = true;
      clearPendingImage();
      regenRedoSnapshot = null;
      showPreview(data.recipe);
      if (data.recipe.image) {
        previewImg.src = imageSrcForRecipe(data.recipe, true);
      }
      setStatusWithUndo('Bild återställd.', undoRegenImage);
    }).catch(function(ex) {
      regenRedoSnapshot = snapshot;
      regenUndoSnapshot = null;
      setStatusWithRedo(ex.message, redoRegenImage, true);
    }).finally(function() { setImageAiButtonsDisabled(false); });
  }

  function setImageAiButtonsDisabled(disabled) {
    if (btnGenerateImage) btnGenerateImage.disabled = disabled;
    if (btnEnhanceImage) btnEnhanceImage.disabled = disabled;
    if (btnGeneratePlaceholder) btnGeneratePlaceholder.disabled = disabled;
    if (btnImagePromptExtra) btnImagePromptExtra.disabled = disabled;
    if (btnImagePromptExtraOverlay) btnImagePromptExtraOverlay.disabled = disabled;
  }

  function getImageInstructions() {
    if (!imagePromptExtraText) return '';
    return String(imagePromptExtraText.value || '').trim().slice(0, 1000);
  }

  function syncImagePromptExtraButtons(open) {
    [btnImagePromptExtra, btnImagePromptExtraOverlay].forEach(function(btn) {
      if (!btn) return;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.classList.toggle('preview-image-btn--active', open);
    });
  }

  function setImagePromptExtraOpen(open) {
    if (!imagePromptExtraPanel) return;
    imagePromptExtraPanel.classList.toggle('hidden', !open);
    syncImagePromptExtraButtons(open);
    if (open && imagePromptExtraText) {
      imagePromptExtraText.focus();
    }
  }

  function toggleImagePromptExtra() {
    if (!imagePromptExtraPanel) return;
    setImagePromptExtraOpen(imagePromptExtraPanel.classList.contains('hidden'));
  }

  function clearPendingImage() {
    pendingImageBase64 = null;
    pendingMimeType = null;
  }

  function clearImageDrop(dropId, thumbId, fileId) {
    var drop = document.getElementById(dropId);
    var thumb = document.getElementById(thumbId);
    var file = document.getElementById(fileId);
    if (thumb) {
      thumb.removeAttribute('src');
      thumb.classList.add('hidden');
    }
    if (drop) drop.classList.remove('has-image');
    if (file) file.value = '';
  }

  function setPendingImage(data, mime, dropId, thumbId) {
    pendingImageBase64 = data;
    pendingMimeType = mime;
    var thumb = document.getElementById(thumbId);
    var drop = document.getElementById(dropId);
    thumb.src = 'data:' + mime + ';base64,' + data;
    thumb.classList.remove('hidden');
    drop.classList.add('has-image');
  }

  function readFileAsBase64(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        var result = reader.result;
        if (typeof result !== 'string') return reject(new Error('Kunde inte läsa fil'));
        var comma = result.indexOf(',');
        resolve({ data: result.slice(comma + 1), mimeType: file.type || 'image/jpeg' });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function isLikelyImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('image/') === 0) return true;
    var name = String(file.name || '').toLowerCase();
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/.test(name);
  }

  function extractImageFromClipboard(e) {
    var cd = e.clipboardData;
    if (!cd) return null;
    if (cd.files && cd.files.length) {
      for (var j = 0; j < cd.files.length; j++) {
        if (isLikelyImageFile(cd.files[j])) return cd.files[j];
      }
    }
    var items = cd.items;
    if (!items) return null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        var file = items[i].getAsFile();
        if (isLikelyImageFile(file)) return file;
      }
    }
    return null;
  }

  function applyPreviewImageFromFile(file) {
    if (!isLikelyImageFile(file)) {
      setStatus('Ogiltig bildfil.', true);
      return Promise.resolve(false);
    }
    return readFileAsBase64(file).then(function(r) {
      pendingImageBase64 = r.data;
      pendingMimeType = r.mimeType;
      savedImageLoadFailed = false;
      awaitingPreviewPaste = false;
      var recipe = currentRecipe || (previewEl.classList.contains('visible') ? readRecipeFromForm() : null);
      if (recipe) updatePreviewImage(recipe);
      setStatus('Bild vald — sparas vid Spara recept.');
      return true;
    });
  }

  function armPreviewPaste() {
    awaitingPreviewPaste = true;
    if (previewImageWrap) {
      previewImageWrap.setAttribute('tabindex', '-1');
      try { previewImageWrap.focus({ preventScroll: true }); } catch (err) { previewImageWrap.focus(); }
    }
    setStatus('Tryck ' + pasteShortcutHint + ' för att klistra in bilden.');
  }

  function closeUploadMenu() {
    uploadMenuOpen = false;
    if (previewUploadMenu) previewUploadMenu.classList.add('hidden');
    if (btnUploadImage) btnUploadImage.setAttribute('aria-expanded', 'false');
  }

  function openUploadMenu() {
    uploadMenuOpen = true;
    if (previewUploadMenu) previewUploadMenu.classList.remove('hidden');
    if (btnUploadImage) btnUploadImage.setAttribute('aria-expanded', 'true');
  }

  function toggleUploadMenu() {
    if (uploadMenuOpen) closeUploadMenu();
    else openUploadMenu();
  }

  function pastePreviewImageFromClipboard() {
    closeUploadMenu();
    if (!navigator.clipboard || !navigator.clipboard.read) {
      armPreviewPaste();
      return;
    }
    navigator.clipboard.read().then(function(items) {
      var types = [];
      items.forEach(function(item) {
        item.types.forEach(function(type) {
          if (type.indexOf('image/') === 0) types.push({ item: item, type: type });
        });
      });
      if (!types.length) return false;
      return types[0].item.getType(types[0].type).then(function(blob) {
        var file = new File([blob], 'clipboard.png', { type: blob.type || types[0].type });
        return applyPreviewImageFromFile(file);
      });
    }).then(function(ok) {
      if (ok === false) {
        setStatus('Ingen bild i urklipp — kopiera en bild och försök igen.', true);
      }
    }).catch(function() {
      armPreviewPaste();
    });
  }

  function getActiveImageDropTarget() {
    var mergePanel = document.getElementById('panel-merge-more');
    if (mergePanel && !mergePanel.classList.contains('hidden') && isMergeMoreOpen()) {
      if (document.activeElement === document.getElementById('merge-text')) return null;
      return { dropId: 'drop-merge', thumbId: 'thumb-merge', merge: true };
    }
    if (document.getElementById('panel-create').classList.contains('hidden')) return null;
    var fromImage = document.getElementById('panel-from-image');
    if (fromImage && !fromImage.classList.contains('hidden')) {
      return { dropId: 'drop-image', thumbId: 'thumb-image' };
    }
    var panelText = document.getElementById('panel-text');
    if (panelText && !panelText.classList.contains('hidden')) {
      if (document.activeElement === document.getElementById('text')) return null;
      return { dropId: 'drop-text', thumbId: 'thumb-text' };
    }
    return null;
  }

  function pasteImageToDrop(e, dropId, thumbId, asMerge) {
    var file = extractImageFromClipboard(e);
    if (!file) return false;
    e.preventDefault();
    readFileAsBase64(file).then(function(r) {
      if (asMerge) setMergeImage(r.data, r.mimeType);
      else setPendingImage(r.data, r.mimeType, dropId, thumbId);
    }).catch(function() { setStatus('Kunde inte läsa bilden', true); });
    return true;
  }

  function bindImageDrop(dropId, fileId, thumbId, asMerge) {
    var drop = document.getElementById(dropId);
    var file = document.getElementById(fileId);
    var thumb = document.getElementById(thumbId);
    if (!drop || !file) return;

    function applyFile(f) {
      if (!isLikelyImageFile(f)) return;
      readFileAsBase64(f).then(function(r) {
        if (asMerge) setMergeImage(r.data, r.mimeType);
        else setPendingImage(r.data, r.mimeType, dropId, thumbId);
      }).catch(function() { setStatus('Kunde inte läsa bilden', true); });
    }

    drop.addEventListener('click', function() { file.click(); });
    file.addEventListener('change', function(e) {
      var f = e.target.files && e.target.files[0];
      if (f) applyFile(f);
    });
    drop.addEventListener('dragover', function(e) {
      e.preventDefault();
      drop.style.borderColor = 'var(--info)';
    });
    drop.addEventListener('dragleave', function() {
      drop.style.borderColor = '';
    });
    drop.addEventListener('drop', function(e) {
      e.preventDefault();
      drop.style.borderColor = '';
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) applyFile(f);
    });
  }

  document.addEventListener('paste', function(e) {
    if (previewEl && previewEl.classList.contains('visible')) {
      var mergePanel = document.getElementById('panel-merge-more');
      var ae = document.activeElement;
      var inMerge = mergePanel
        && !mergePanel.classList.contains('hidden')
        && isMergeMoreOpen()
        && ae
        && mergePanel.contains(ae);
      if (inMerge) {
        if (ae === document.getElementById('merge-text')) return;
        pasteImageToDrop(e, 'drop-merge', 'thumb-merge', true);
        return;
      }
      var file = extractImageFromClipboard(e);
      if (file) {
        e.preventDefault();
        closeUploadMenu();
        awaitingPreviewPaste = false;
        applyPreviewImageFromFile(file).catch(function() {
          setStatus('Kunde inte läsa bilden', true);
        });
        return;
      }
      if (awaitingPreviewPaste) {
        setStatus('Ingen bild i urklipp — kopiera en bild och försök igen.', true);
        awaitingPreviewPaste = false;
        return;
      }
    }
    var target = getActiveImageDropTarget();
    if (!target) return;
    pasteImageToDrop(e, target.dropId, target.thumbId, !!target.merge);
  });

  bindImageDrop('drop-text', 'file-text', 'thumb-text');
  bindImageDrop('drop-image', 'file-image', 'thumb-image');
  bindImageDrop('drop-merge', 'file-merge', 'thumb-merge', true);

  if (btnUploadPaste) {
    btnUploadPaste.textContent = 'Klistra in (' + pasteShortcutHint + ')';
  }

  if (btnUploadImage) {
    btnUploadImage.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleUploadMenu();
    });
  }

  if (previewUploadMenu) {
    previewUploadMenu.addEventListener('click', function(e) {
      var item = e.target.closest('[data-upload-action]');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      if (item.getAttribute('data-upload-action') === 'file') {
        if (filePreviewInput) filePreviewInput.click();
        closeUploadMenu();
        return;
      }
      pastePreviewImageFromClipboard();
    });
  }

  document.addEventListener('click', function(e) {
    if (!uploadMenuOpen || !previewUploadWrap) return;
    if (!previewUploadWrap.contains(e.target)) closeUploadMenu();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeUploadMenu();
  });

  if (filePreviewInput) {
    filePreviewInput.addEventListener('change', function(e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      applyPreviewImageFromFile(f).catch(function() {
        setStatus('Kunde inte läsa bilden', true);
      });
    });
  }

  if (previewImageWrap) {
    previewImageWrap.addEventListener('dragover', function(e) {
      if (!previewEl.classList.contains('visible')) return;
      if (!e.dataTransfer || !e.dataTransfer.types || !Array.prototype.some.call(e.dataTransfer.types, function(t) {
        return t === 'Files' || t.indexOf('image/') === 0;
      })) return;
      e.preventDefault();
    });
    previewImageWrap.addEventListener('drop', function(e) {
      if (!previewEl.classList.contains('visible')) return;
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      applyPreviewImageFromFile(f).catch(function() {
        setStatus('Kunde inte läsa bilden', true);
      });
    });
  }

  function updatePageHeading() {
    var heading = document.getElementById('page-heading');
    if (!heading) return;
    heading.textContent = editMode ? 'Redigera recept' : 'Lägg till recept';
    document.title = (editMode ? 'Redigera recept' : 'Lägg till recept') + ' — Macro-friendly recipes';
    updateDeleteButton();
  }

  function updateDeleteButton() {
    var btn = document.getElementById('btn-delete-recipe');
    if (!btn) return;
    var show = editMode && currentRecipe && currentRecipe.id && recipeExistsInDb(currentRecipe.id);
    btn.classList.toggle('hidden', !show);
  }

  function deleteCurrentRecipe() {
    if (!currentRecipe || !currentRecipe.id || !recipeExistsInDb(currentRecipe.id)) return;
    var title = currentRecipe.title || currentRecipe.id;
    if (!confirm('Ta bort «' + title + '» permanent? Detta går inte att ångra.')) return;
    var id = currentRecipe.id;
    var btn = document.getElementById('btn-delete-recipe');
    if (btn) btn.disabled = true;
    setStatus('Tar bort…');
    fetch('/api/recipes/' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'same-origin'
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Kunde inte ta bort');
        return data;
      });
    }).then(function() {
      recipeList = recipeList.filter(function(r) { return r.id !== id; });
      editingRecipeId = null;
      currentRecipe = null;
      previewEl.classList.remove('visible');
      reviewActive = false;
      clearPendingImage();
      clearMergeInputs();
      populateEditSelect();
      editSelect.value = '';
      updateDeleteButton();
      setStatus('Recept borttaget.');
      history.replaceState(null, '', ADD_BASE + '/redigera');
      syncInputPanels();
    }).catch(function(ex) {
      setStatus(ex.message, true);
    }).finally(function() {
      if (btn) btn.disabled = false;
    });
  }

  var pendingEditIdFromSession = null;

  function editIdFromUrl() {
    return new URLSearchParams(location.search).get('edit');
  }

  function consumeSessionEditId() {
    if (pendingEditIdFromSession) return pendingEditIdFromSession;
    try {
      var stored = sessionStorage.getItem('recept_edit_id');
      if (stored) {
        pendingEditIdFromSession = stored;
        sessionStorage.removeItem('recept_edit_id');
        return stored;
      }
    } catch (e) {}
    return null;
  }

  function resolveEditId() {
    return editIdFromUrl() || consumeSessionEditId();
  }

  function addRouteUrl(route, editId) {
    if (route === 'redigera') {
      var id = editId || resolveEditId();
      return id
        ? ADD_BASE + '/redigera?edit=' + encodeURIComponent(id)
        : ADD_BASE + '/redigera';
    }
    return ADD_BASE + '/' + route;
  }

  function parseAddRoute() {
    var p = location.pathname.replace(/\/$/, '');
    if (editIdFromUrl() || p.endsWith('/redigera')) return 'redigera';
    if (p.endsWith('/bild')) return 'bild';
    if (p.endsWith('/url')) return 'url';
    if (p.endsWith('/text')) return 'text';
    if (/\/add(\.html)?$/i.test(p)) return 'text';
    return 'text';
  }

  function syncTabLinks() {
    var editId = editIdFromUrl();
    document.querySelectorAll('[data-add-route]').forEach(function(el) {
      var route = el.getAttribute('data-add-route');
      if (!route) return;
      el.href = addRouteUrl(route, editId);
    });
  }

  function syncTabActive(route) {
    var isEdit = route === 'redigera';
    document.getElementById('tab-create').classList.toggle('active', !isEdit);
    document.getElementById('tab-edit').classList.toggle('active', isEdit);
    ['text', 'url', 'bild'].forEach(function(r) {
      var el = document.querySelector('[data-add-route="' + r + '"]');
      if (el && el.id !== 'tab-create') el.classList.toggle('active', !isEdit && route === r);
    });
  }

  function applyAddRoute(route, options) {
    options = options || {};
    syncTabActive(route);
    if (route === 'redigera') {
      showEditPanel();
      return;
    }
    showCreatePanel();
    var mode = ROUTE_TO_MODE[route] || 'text';
    setCreateSubMode(mode, options.skipFocus);
  }

  function navigateAddRoute(route, replace, editId) {
    if (route === 'text' || route === 'url' || route === 'bild') {
      reviewActive = false;
      clearMergeInputs();
    }
    var url = addRouteUrl(route, editId);
    applyAddRoute(route);
    syncTabLinks();
    var state = { addRoute: route };
    if (editId) state.editId = editId;
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
  }

  function bindAddTabNav() {
    syncTabLinks();
    document.querySelectorAll('[data-add-route]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigateAddRoute(el.getAttribute('data-add-route'));
      });
    });
    window.addEventListener('popstate', function() {
      initAddPage();
    });
  }

  function bootAddRoute() {
    var route = parseAddRoute();
    var p = location.pathname.replace(/\/$/, '');

    if (/\/add(\.html)?$/i.test(p)) {
      navigateAddRoute(route, true);
      return route;
    }
    applyAddRoute(route);
    syncTabLinks();
    return route;
  }

  function bootEditMode(editId) {
    if (!editId) return;
    var canonical = addRouteUrl('redigera', editId);
    if (location.pathname + location.search !== canonical) {
      history.replaceState({ addRoute: 'redigera', editId: editId }, '', canonical);
    }
    showEditPanel();
    syncTabActive('redigera');
    syncTabLinks();
    populateEditSelect(editId);
    editSelect.value = editId;
    loadRecipeById(editId);
  }

  function initAddPage() {
    var editId = resolveEditId();
    if (editId) {
      bootEditMode(editId);
      return;
    }
    bootAddRoute();
  }

  function showCreatePanel() {
    editMode = false;
    document.getElementById('tab-create').classList.add('active');
    document.getElementById('tab-edit').classList.remove('active');
    document.getElementById('panel-edit').classList.add('hidden');
    updatePageHeading();
    syncInputPanels();
  }

  function showEditPanel() {
    editMode = true;
    document.getElementById('tab-edit').classList.add('active');
    document.getElementById('tab-create').classList.remove('active');
    updatePageHeading();
    syncInputPanels();
  }

  function setCreateSubMode(mode, skipFocus) {
    createSubMode = mode;
    document.getElementById('tab-text').classList.toggle('active', mode === 'text');
    document.getElementById('tab-url').classList.toggle('active', mode === 'url');
    document.getElementById('tab-from-image').classList.toggle('active', mode === 'image');
    document.getElementById('panel-text').classList.toggle('hidden', mode !== 'text');
    document.getElementById('panel-url').classList.toggle('hidden', mode !== 'url');
    document.getElementById('panel-from-image').classList.toggle('hidden', mode !== 'image');
    if (mode === 'image' && !skipFocus) {
      var drop = document.getElementById('drop-image');
      if (drop) drop.focus();
    }
  }

  function populateEditSelect(selectedId) {
    editSelect.replaceChildren();
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Välj recept…';
    editSelect.appendChild(placeholder);
    recipeList.sort(function(a, b) {
      return (a.title || a.id).localeCompare(b.title || b.id, 'sv');
    }).forEach(function(r) {
      var opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.title || r.id;
      editSelect.appendChild(opt);
    });
    if (selectedId) editSelect.value = selectedId;
  }

  function loadRecipeById(id) {
    if (!id) return;
    editingRecipeId = id;
    setStatus('Hämtar…');
    clearPendingImage();
    fetch('/api/recipes/' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function(res) {
        return res.json().then(function(data) {
          if (!res.ok) throw new Error(data.error || 'Hittades inte');
          return data;
        });
      })
      .then(function(data) {
        var recipe = data.recipe;
        if (!recipe) throw new Error('Hittades inte');
        if (data.featuredNew !== undefined) recipe.featuredNew = !!data.featuredNew;
        savedImageLoadFailed = false;
        var done = function() {
          editMode = true;
          showPreview(recipe);
          setStatus('Redigera och spara, eller uppdatera bild.');
        };
        if (!recipe.image) {
          done();
          return;
        }
        fetchImageAsBase64Optional(imageSrcForRecipe(recipe)).then(function(snapshot) {
          if (!snapshot) savedImageLoadFailed = true;
          done();
        });
      })
      .catch(function(ex) { setStatus(ex.message, true); });
  }

  editSelect.addEventListener('change', function() {
    var id = editSelect.value;
    if (!id) {
      editingRecipeId = null;
      previewEl.classList.remove('visible');
      currentRecipe = null;
      updateDeleteButton();
      setStatus('');
      return;
    }
    loadRecipeById(id);
  });

  var btnDeleteRecipe = document.getElementById('btn-delete-recipe');
  if (btnDeleteRecipe) {
    btnDeleteRecipe.addEventListener('click', deleteCurrentRecipe);
  }

  function recipeExistsInDb(id) {
    for (var i = 0; i < recipeList.length; i++) {
      if (recipeList[i].id === id) return true;
    }
    return false;
  }

  function receptCookiePath() {
    var path = location.pathname;
    var idx = path.indexOf('/recept');
    if (idx <= 0) return '/';
    return path.slice(0, idx) || '/';
  }

  function readSeenRecipeIds() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + VISIT_COOKIE_NAME + '=([^;]*)'));
    if (!m) return {};
    try { return JSON.parse(decodeURIComponent(m[1])) || {}; } catch (e) { return {}; }
  }

  function clearFeaturedSeen(id) {
    if (!id) return;
    var seen = readSeenRecipeIds();
    delete seen[id];
    document.cookie = VISIT_COOKIE_NAME + '=' + encodeURIComponent(JSON.stringify(seen))
      + ';path=' + receptCookiePath() + ';max-age=' + VISIT_COOKIE_MAX_AGE + ';SameSite=Lax';
  }

  function syncFeaturedNewCheckbox(recipe) {
    var cb = document.getElementById('featured-new');
    if (!cb || !recipe) return;
    if (recipe.featuredNew !== undefined) {
      cb.checked = !!recipe.featuredNew;
      return;
    }
    if (!recipe.id || !recipeExistsInDb(recipe.id)) {
      cb.checked = true;
    }
  }

  function applyRecipeMeta(recipe, data) {
    if (data && data.featuredNew !== undefined) recipe.featuredNew = !!data.featuredNew;
    return recipe;
  }

  function imageSrcForRecipe(recipe, bust) {
    if (!recipe.image) return '';
    var src;
    if (recipe.image.indexOf('/api/') === 0) src = recipe.image;
    else if (recipe.image.indexOf('http') === 0) src = recipe.image;
    else src = '/' + recipe.image.replace(/^\//, '');
    if (bust) src += (src.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
    return src;
  }

  function readRecipeFromForm() {
    var idEl = document.getElementById('edit-id');
    var titleEl = document.getElementById('edit-title');
    if (!idEl || !titleEl) {
      throw new Error('Granskningsformuläret saknas — granska receptet igen.');
    }
    var recipe = {
      id: idEl.value.trim(),
      title: titleEl.value.trim(),
      category: document.getElementById('edit-category').value,
      baseServings: parseInt(document.getElementById('edit-servings').value, 10) || 1,
      source: document.getElementById('edit-source').value.trim(),
      sourceUrl: document.getElementById('edit-source-url').value.trim(),
      tags: [],
      macros: {
        kcal: parseFloat(document.getElementById('edit-kcal').value) || 0,
        prot: parseFloat(document.getElementById('edit-prot').value) || 0,
        carb: parseFloat(document.getElementById('edit-carb').value) || 0,
        fat: parseFloat(document.getElementById('edit-fat').value) || 0
      },
      groups: [],
      steps: [],
      tips: []
    };
    if (currentRecipe && currentRecipe.image && !savedImageLoadFailed) recipe.image = currentRecipe.image;
    previewForm.querySelectorAll('input[data-tag]:checked').forEach(function(cb) {
      recipe.tags.push(cb.getAttribute('data-tag'));
    });
    previewForm.querySelectorAll('.ing-grp').forEach(function(grpEl) {
      var groupName = grpEl.querySelector('.ing-grp-name-input').value.trim() || 'Ingredienser';
      var ingredients = [];
      grpEl.querySelectorAll('.ing-edit-row').forEach(function(row) {
        var name = row.querySelector('.ing-name').value.trim();
        if (!name) return;
        ingredients.push({
          name: name,
          amount: parseFloat(row.querySelector('.ing-amount').value) || 0,
          unit: row.querySelector('.ing-unit').value
        });
      });
      if (ingredients.length) recipe.groups.push({ name: groupName, ingredients: ingredients });
    });
    previewForm.querySelectorAll('.step-edit').forEach(function(stepEl) {
      var title = stepEl.querySelector('.step-title-input').value.trim();
      var text = stepEl.querySelector('.step-text-input').value.trim();
      if (title || text) recipe.steps.push({ title: title || 'Steg', text: text });
    });
    previewForm.querySelectorAll('.tip-edit').forEach(function(tipEl, idx) {
      var title = tipEl.querySelector('.tip-title-input').value.trim();
      if (idx === 0 && /^för barn$/i.test(title)) title = 'Seattle';
      recipe.tips.push({
        title: title,
        text: tipEl.querySelector('.tip-text-input').value.trim()
      });
    });
    while (recipe.tips.length < 4) {
      recipe.tips.push({ title: recipe.tips.length === 0 ? 'Seattle' : '', text: '' });
    }
    recipe.tips = recipe.tips.slice(0, 4);
    if (!/^seattle$/i.test(recipe.tips[0].title)) {
      if (/^för barn$/i.test(recipe.tips[0].title) || !recipe.tips[0].title) {
        recipe.tips[0].title = 'Seattle';
      }
    }
    if (!recipe.source) recipe.source = 'Okänd källa';
    if ((!recipe.id || recipe.id === 'recept') && recipe.title) {
      recipe.id = slugifyTitle(recipe.title);
      idEl.value = recipe.id;
    }
    if ((!recipe.title || !recipe.title.trim()) && currentRecipe && currentRecipe.title) {
      recipe.title = currentRecipe.title;
      titleEl.value = recipe.title;
    }
    ensureRecipeTitle(recipe);
    if (currentRecipe && currentRecipe.badges) recipe.badges = currentRecipe.badges;
    return recipe;
  }

  function buildIngRow(ing) {
    var row = mk('div', 'ing-edit-row');
    var nameIn = document.createElement('input');
    nameIn.className = 'ing-name';
    nameIn.placeholder = 'ingrediens';
    nameIn.autocomplete = 'off';
    nameIn.value = ing && ing.name ? ing.name : '';
    var amtIn = document.createElement('input');
    amtIn.className = 'ing-amount';
    amtIn.type = 'number';
    amtIn.step = 'any';
    amtIn.value = ing && ing.amount != null ? String(ing.amount) : '';
    var unitSel = document.createElement('select');
    unitSel.className = 'ing-unit';
    VALID_UNITS.forEach(function(u) {
      var opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if (ing && ing.unit === u) opt.selected = true;
      unitSel.appendChild(opt);
    });
    var delBtn = mk('button', 'btn-ghost');
    delBtn.type = 'button';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', function() { row.remove(); });
    var errEl = mk('div', 'ing-edit-err');
    errEl.setAttribute('role', 'alert');
    var suggestEl = mk('div', 'ing-suggest');
    suggestEl.setAttribute('role', 'listbox');

    function clearRowError() {
      row.classList.remove('ing-edit-row--invalid');
      errEl.textContent = '';
      suggestEl.classList.remove('is-open');
      suggestEl.replaceChildren();
    }

    function openSuggestions(query) {
      var q = String(query || nameIn.value || '').trim();
      if (q.length < 2) {
        suggestEl.classList.remove('is-open');
        suggestEl.replaceChildren();
        return;
      }
      fetch('/api/ingredients/search?q=' + encodeURIComponent(q) + '&limit=10', {
        credentials: 'same-origin'
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          suggestEl.replaceChildren();
          var results = (data && data.results) || [];
          if (!results.length) {
            suggestEl.classList.remove('is-open');
            return;
          }
          results.forEach(function(item) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ing-suggest-item';
            btn.setAttribute('role', 'option');
            var label = item.alias || item.canonical_name;
            btn.appendChild(document.createTextNode(label));
            var meta = mk('span', 'ing-suggest-meta');
            var bits = [item.canonical_name];
            if (item.kcal_per_100g != null) bits.push(Math.round(item.kcal_per_100g) + ' kcal/100g');
            if (item.piece_weight_g) bits.push('styck ≈ ' + item.piece_weight_g + 'g');
            meta.textContent = bits.join(' · ');
            btn.appendChild(meta);
            btn.addEventListener('click', function() {
              nameIn.value = label;
              clearRowError();
              nameIn.focus();
            });
            suggestEl.appendChild(btn);
          });
          suggestEl.classList.add('is-open');
        })
        .catch(function() {
          suggestEl.classList.remove('is-open');
        });
    }

    nameIn.addEventListener('input', function() {
      if (row.classList.contains('ing-edit-row--invalid')) openSuggestions(nameIn.value);
      else clearRowError();
    });
    nameIn.addEventListener('focus', function() {
      if (row.classList.contains('ing-edit-row--invalid')) openSuggestions(nameIn.value);
    });
    nameIn.addEventListener('click', function() {
      if (row.classList.contains('ing-edit-row--invalid')) openSuggestions(nameIn.value);
    });

    row.appendChild(nameIn);
    row.appendChild(amtIn);
    row.appendChild(unitSel);
    row.appendChild(delBtn);
    row.appendChild(errEl);
    row.appendChild(suggestEl);
    row._setNutritionError = function(status) {
      row.classList.add('ing-edit-row--invalid');
      errEl.textContent =
        status === 'needs_piece_weight'
          ? 'Saknar styckvikt — byt till g, välj ett förslag nedan eller ange vikt under Granska.'
          : 'Saknar näringsdata — välj ett förslag nedan, eller spara och välj livsmedel under Granska.';
      openSuggestions(nameIn.value);
    };
    row._clearNutritionError = clearRowError;
    return row;
  }

  function clearAllIngNutritionErrors() {
    previewForm.querySelectorAll('.ing-edit-row').forEach(function(row) {
      if (row._clearNutritionError) row._clearNutritionError();
    });
  }

  function markUnresolvedOnForm(unresolved) {
    clearAllIngNutritionErrors();
    var list = unresolved || [];
    if (!list.length) return null;
    var first = null;
    var groups = previewForm.querySelectorAll('.ing-grp');
    list.forEach(function(u) {
      var grp = groups[u.group_index];
      if (!grp) return;
      var rows = [];
      grp.querySelectorAll('.ing-edit-row').forEach(function(row) {
        var name = row.querySelector('.ing-name');
        if (name && name.value.trim()) rows.push(row);
      });
      var row = rows[u.ingredient_index];
      if (!row) {
        // fallback: match by name
        rows.forEach(function(r) {
          var n = r.querySelector('.ing-name');
          if (n && n.value.trim() === u.name) row = r;
        });
      }
      if (!row) return;
      if (row._setNutritionError) row._setNutritionError(u.match_status);
      if (!first) first = row;
    });
    return first;
  }

  function scrollToIngError(row) {
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var nameIn = row.querySelector('.ing-name');
    if (nameIn) {
      try { nameIn.focus({ preventScroll: true }); } catch (e) { nameIn.focus(); }
    }
  }

  function buildIngGroup(group) {
    var grp = mk('div', 'ing-grp');
    var head = mk('div', 'ing-grp-head');
    var nameIn = document.createElement('input');
    nameIn.className = 'ing-grp-name-input';
    nameIn.placeholder = 'Sektionsnamn';
    nameIn.value = group && group.name ? group.name : '';
    head.appendChild(nameIn);
    var addIngBtn = mk('button', 'btn-ghost');
    addIngBtn.type = 'button';
    addIngBtn.textContent = '+ rad';
    addIngBtn.addEventListener('click', function() {
      grp.appendChild(buildIngRow(null));
    });
    head.appendChild(addIngBtn);
    grp.appendChild(head);
    var ings = group && group.ingredients ? group.ingredients : [];
    if (!ings.length) ings = [{ name: '', amount: 0, unit: 'g' }];
    ings.forEach(function(ing) { grp.appendChild(buildIngRow(ing)); });
    return grp;
  }

  function renderPreviewForm(recipe) {
    previewMetaFields.replaceChildren();
    var idField = fieldInput('edit-id', 'Id', recipe.id);
    var titleField = fieldInput('edit-title', 'Titel', recipe.title);
    previewMetaFields.appendChild(idField);
    previewMetaFields.appendChild(titleField);
    var catWrap = mk('div', 'field');
    var catLbl = mk('label');
    catLbl.textContent = 'Måltid';
    catLbl.htmlFor = 'edit-category';
    var catSel = document.createElement('select');
    catSel.id = 'edit-category';
    CATEGORY_ORDER.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = CATEGORY_LABELS[c] || c;
      if (recipe.category === c) opt.selected = true;
      catSel.appendChild(opt);
    });
    catWrap.appendChild(catLbl);
    catWrap.appendChild(catSel);
    previewMetaFields.appendChild(catWrap);
    previewMetaFields.appendChild(fieldInput('edit-servings', 'Portioner', recipe.baseServings || 1, 'number'));
    previewMetaFields.appendChild(fieldInput('edit-source', 'Källa', recipe.source || 'Okänd källa'));
    previewMetaFields.appendChild(fieldInput('edit-source-url', 'Källa-URL', recipe.sourceUrl || ''));

    previewForm.replaceChildren();

    var tagsTitle = mk('div', 'sec-title');
    tagsTitle.textContent = 'Taggar';
    previewForm.appendChild(tagsTitle);
    var tagsWrap = mk('div', 'recipe-edit-tags');
    TAG_FILTER_ORDER.forEach(function(tagId) {
      var lab = mk('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-tag', tagId);
      if (recipe.tags && recipe.tags.indexOf(tagId) !== -1) cb.checked = true;
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(TAG_LABELS[tagId] || tagId));
      tagsWrap.appendChild(lab);
    });
    previewForm.appendChild(tagsWrap);

    var macrosTitle = mk('div', 'sec-title');
    macrosTitle.textContent = 'Makron (hela receptet — beräknas automatiskt)';
    previewForm.appendChild(macrosTitle);
    var macrosHint = mk('p', 'field-hint');
    macrosHint.textContent = 'Summa av matchade ingredienser. Redigera inte manuellt — använd «Räkna om makron».';
    previewForm.appendChild(macrosHint);
    var macrosDiv = mk('div', 'macros');
    [
      { id: 'edit-kcal', key: 'kcal', lbl: 'kcal' },
      { id: 'edit-prot', key: 'prot', lbl: 'protein (g)' },
      { id: 'edit-carb', key: 'carb', lbl: 'kolhydrater (g)' },
      { id: 'edit-fat', key: 'fat', lbl: 'fett (g)' }
    ].forEach(function(m) {
      var mac = mk('div', 'mac');
      var inp = document.createElement('input');
      inp.id = m.id;
      inp.type = 'number';
      inp.step = 'any';
      inp.readOnly = true;
      inp.value = recipe.macros && recipe.macros[m.key] != null ? String(recipe.macros[m.key]) : '0';
      var lbl = mk('span', 'mac-lbl');
      lbl.textContent = m.lbl;
      mac.appendChild(inp);
      mac.appendChild(lbl);
      macrosDiv.appendChild(mac);
    });
    previewForm.appendChild(macrosDiv);

    var twoCol = mk('div', 'two-col');
    var ingCol = mk('div');
    var ingTitle = mk('div', 'sec-title');
    ingTitle.textContent = 'Ingredienser';
    ingCol.appendChild(ingTitle);
    var groupsWrap = mk('div', 'ing-groups');
    var groups = recipe.groups && recipe.groups.length ? recipe.groups : [{ name: 'Ingredienser', ingredients: [] }];
    groups.forEach(function(g) { groupsWrap.appendChild(buildIngGroup(g)); });
    ingCol.appendChild(groupsWrap);
    var addGrpBtn = mk('button', 'btn-ghost');
    addGrpBtn.type = 'button';
    addGrpBtn.textContent = '+ ingrediensgrupp';
    addGrpBtn.addEventListener('click', function() {
      groupsWrap.appendChild(buildIngGroup({ name: 'Ny sektion', ingredients: [] }));
    });
    ingCol.appendChild(addGrpBtn);
    twoCol.appendChild(ingCol);

    var stepsCol = mk('div');
    var stepsTitle = mk('div', 'sec-title');
    stepsTitle.textContent = 'Gör så här';
    stepsCol.appendChild(stepsTitle);
    var stepsWrap = mk('div', 'steps-wrap');
    var steps = recipe.steps && recipe.steps.length ? recipe.steps : [{ title: '', text: '' }];
    steps.forEach(function(s) {
      var stepEl = mk('div', 'step-edit');
      var stIn = document.createElement('input');
      stIn.className = 'step-title-input';
      stIn.placeholder = 'Stegnamn';
      stIn.value = s.title || '';
      var stText = document.createElement('textarea');
      stText.className = 'step-text-input';
      stText.placeholder = 'Beskrivning';
      stText.value = s.text || '';
      stepEl.appendChild(stIn);
      stepEl.appendChild(stText);
      stepsWrap.appendChild(stepEl);
    });
    stepsCol.appendChild(stepsWrap);
    var addStepBtn = mk('button', 'btn-ghost');
    addStepBtn.type = 'button';
    addStepBtn.textContent = '+ steg';
    addStepBtn.addEventListener('click', function() {
      var stepEl = mk('div', 'step-edit');
      var stIn = document.createElement('input');
      stIn.className = 'step-title-input';
      stIn.placeholder = 'Stegnamn';
      var stText = document.createElement('textarea');
      stText.className = 'step-text-input';
      stText.placeholder = 'Beskrivning';
      stepEl.appendChild(stIn);
      stepEl.appendChild(stText);
      stepsWrap.appendChild(stepEl);
    });
    stepsCol.appendChild(addStepBtn);
    twoCol.appendChild(stepsCol);
    previewForm.appendChild(twoCol);

    var tipsTitle = mk('div', 'sec-title');
    tipsTitle.textContent = 'Tips & variationer';
    previewForm.appendChild(tipsTitle);
    var tipsGrid = mk('div', 'tips-grid');
    var tips = recipe.tips && recipe.tips.length ? recipe.tips.slice(0, 4) : [];
    while (tips.length < 4) tips.push({ title: '', text: '' });
    tips.forEach(function(t) {
      var tipEl = mk('div', 'tip-edit');
      var ttIn = document.createElement('input');
      ttIn.className = 'tip-title-input';
      ttIn.placeholder = 'Rubrik';
      ttIn.value = (/^seattle$/i.test(String(t.title || '').trim()) ? 'För barn' : t.title) || '';
      var ttText = document.createElement('textarea');
      ttText.className = 'tip-text-input';
      ttText.placeholder = 'Text';
      ttText.value = t.text || '';
      tipEl.appendChild(ttIn);
      tipEl.appendChild(ttText);
      tipsGrid.appendChild(tipEl);
    });
    previewForm.appendChild(tipsGrid);
  }

  function previewHasImage(recipe) {
    if (pendingImageBase64 && pendingMimeType) return true;
    var img = recipe && recipe.image;
    if (!img || !String(img).trim() || savedImageLoadFailed) return false;
    return true;
  }

  function captureUndoSnapshot(recipe) {
    if (pendingImageBase64 && pendingMimeType) {
      return Promise.resolve({ mimeType: pendingMimeType, data: pendingImageBase64, empty: false });
    }
    if (recipe.image && !savedImageLoadFailed) {
      return fetchImageAsBase64Optional(imageSrcForRecipe(recipe)).then(function(snapshot) {
        if (snapshot) return { mimeType: snapshot.mimeType, data: snapshot.data, empty: false };
        return { empty: true };
      });
    }
    return Promise.resolve({ empty: true });
  }

  function getPreviewImageSnapshot(recipe) {
    if (pendingImageBase64 && pendingMimeType) {
      return Promise.resolve({ mimeType: pendingMimeType, data: pendingImageBase64 });
    }
    if (recipe.image && !savedImageLoadFailed) {
      return fetchImageAsBase64Optional(imageSrcForRecipe(recipe)).then(function(snapshot) {
        if (snapshot) return snapshot;
        return Promise.reject(new Error('Bilden kunde inte laddas — generera en ny eller ladda upp.'));
      });
    }
    return Promise.reject(new Error('Receptet saknar bild att förbättra.'));
  }

  function referenceImageForGenerate() {
    if (pendingImageBase64 && pendingMimeType) {
      return Promise.resolve({ mimeType: pendingMimeType, data: pendingImageBase64 });
    }
    return Promise.resolve(null);
  }

  function enhancePreviewImageClient(recipe, snapshot) {
    return fetch('/api/enhance-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        imageBase64: snapshot.data,
        mimeType: snapshot.mimeType,
        title: recipe.title || 'Recept'
      })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Bildförbättring misslyckades');
        return data;
      });
    });
  }

  function generatePreviewImageClient(recipe, snapshot) {
    var body = { recipe: recipe };
    var instructions = getImageInstructions();
    if (instructions) body.imageInstructions = instructions;
    if (snapshot) {
      body.imageBase64 = snapshot.data;
      body.mimeType = snapshot.mimeType;
    }
    return fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Bildgenerering misslyckades');
        return data;
      });
    });
  }

  function enhanceSavedRecipeImage(recipe, snapshot) {
    return fetch('/api/recipes/' + encodeURIComponent(recipe.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        recipe: recipe,
        enhanceImage: true,
        featuredNew: document.getElementById('featured-new').checked,
        imageBase64: snapshot.data,
        mimeType: snapshot.mimeType
      })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) {
          throw new Error((data.details && data.details.join(' · ')) || data.error || 'Bildförbättring misslyckades');
        }
        return data;
      });
    });
  }

  function generateAndUploadSavedRecipeImage(recipe, snapshot) {
    return generatePreviewImageClient(recipe, snapshot).then(function(data) {
      return putRecipeUpdate(recipe, {
        uploadImage: true,
        imageBase64: data.imageBase64,
        mimeType: data.mimeType
      });
    });
  }

  function generateSavedRecipeImage(recipe, snapshot) {
    var body = {
      recipe: recipe,
      generateImage: true,
      featuredNew: document.getElementById('featured-new').checked
    };
    var instructions = getImageInstructions();
    if (instructions) body.imageInstructions = instructions;
    if (snapshot) {
      body.imageBase64 = snapshot.data;
      body.mimeType = snapshot.mimeType;
    }
    return fetch('/api/recipes/' + encodeURIComponent(recipe.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) {
          throw new Error((data.details && data.details.join(' · ')) || data.error || 'Bildgenerering misslyckades');
        }
        return data;
      });
    });
  }

  function applyPreviewImageResult(data, mode, savedInDb) {
    finishRegenProgress(mode);
    var successMsg = mode === 'generate'
      ? (savedInDb ? 'Bild genererad och sparad.' : 'Bild genererad — sparas vid Spara recept.')
      : (savedInDb ? 'Bild förbättrad och sparad.' : 'Bild förbättrad — sparas vid Spara recept.');
    if (savedInDb) {
      editMode = true;
      clearPendingImage();
      savedImageLoadFailed = false;
      applyRecipeMeta(data.recipe, data);
      showPreview(data.recipe);
      if (data.recipe.image) {
        previewImg.src = imageSrcForRecipe(data.recipe, true);
      }
      setTimeout(function() {
        setStatusWithUndo(successMsg, undoRegenImage);
      }, 250);
      return;
    }
    pendingImageBase64 = data.imageBase64;
    pendingMimeType = data.mimeType;
    showPreview(readRecipeFromForm());
    setTimeout(function() {
      setStatusWithUndo(successMsg, undoRegenLocalImage);
    }, 250);
  }

  function runImageAi(mode) {
    var recipe = readRecipeFromForm();
    if (!recipe.id) {
      setStatus('Receptet saknar id.', true);
      return;
    }
    if (mode === 'enhance' && !previewHasImage(recipe)) {
      setStatus('Receptet saknar bild att förbättra.', true);
      return;
    }
    setImageAiButtonsDisabled(true);
    clearRegenHistory();
    var savedInDb = recipeExistsInDb(recipe.id);

    var work = mode === 'enhance'
      ? captureUndoSnapshot(recipe).then(function(undo) {
          regenUndoSnapshot = undo;
          startRegenProgress(mode);
          return getPreviewImageSnapshot(recipe).then(function(snapshot) {
            if (savedInDb) return enhanceSavedRecipeImage(recipe, snapshot);
            return enhancePreviewImageClient(recipe, snapshot);
          });
        })
      : captureUndoSnapshot(recipe).then(function(undo) {
          regenUndoSnapshot = undo;
          startRegenProgress(mode);
          return referenceImageForGenerate(recipe).then(function(snapshot) {
            if (savedInDb && !previewHasImage(recipe)) {
              return generateAndUploadSavedRecipeImage(recipe, snapshot);
            }
            if (savedInDb) return generateSavedRecipeImage(recipe, snapshot);
            return generatePreviewImageClient(recipe, snapshot);
          });
        });

    work.then(function(data) {
      applyPreviewImageResult(data, mode, savedInDb);
    }).catch(function(ex) {
      clearRegenHistory();
      setStatus(ex.message, true);
    }).finally(function() { setImageAiButtonsDisabled(false); });
  }

  function updatePreviewImage(recipe) {
    var hasPending = pendingImageBase64 && pendingMimeType;
    var hasSaved = !!(recipe.image && String(recipe.image).trim()) && !hasPending && !savedImageLoadFailed;
    previewImg.onerror = function() {
      savedImageLoadFailed = true;
      updatePreviewImage(recipe);
    };
    if (hasPending) {
      savedImageLoadFailed = false;
      previewImg.src = 'data:' + pendingMimeType + ';base64,' + pendingImageBase64;
      previewImg.classList.remove('hidden');
      previewImageWrap.classList.remove('no-image');
    } else if (hasSaved) {
      previewImg.src = imageSrcForRecipe(recipe);
      previewImg.classList.remove('hidden');
      previewImageWrap.classList.remove('no-image');
    } else {
      previewImg.classList.add('hidden');
      previewImg.removeAttribute('src');
      previewImageWrap.classList.add('no-image');
    }
    var hasImage = previewHasImage(recipe);
    if (hasImage) {
      if (previewUploadWrap && previewImageActions && previewUploadWrap.parentNode !== previewImageActions) {
        previewImageActions.insertBefore(previewUploadWrap, previewImageActions.firstChild);
      }
    } else if (previewUploadWrap && previewPlaceholderActions && previewUploadWrap.parentNode !== previewPlaceholderActions) {
      previewPlaceholderActions.appendChild(previewUploadWrap);
    }
    if (btnGenerateImage) btnGenerateImage.classList.remove('hidden');
    if (btnImagePromptExtraOverlay) btnImagePromptExtraOverlay.classList.remove('hidden');
    if (btnEnhanceImage) btnEnhanceImage.classList.toggle('hidden', !hasImage);
    if (btnGeneratePlaceholder) btnGeneratePlaceholder.classList.toggle('hidden', hasImage);
    if (btnImagePromptExtra) btnImagePromptExtra.classList.toggle('hidden', hasImage);
  }

  function showPreview(recipe) {
    ensureRecipeTitle(recipe);
    if ((!recipe.id || recipe.id === 'recept') && recipe.title) {
      recipe.id = slugifyTitle(recipe.title);
    }
    currentRecipe = recipe;
    savedImageLoadFailed = false;
    reviewActive = true;
    previewTitle.textContent = recipe.title || 'Granska recept';
    renderPreviewForm(recipe);
    syncFeaturedNewCheckbox(recipe);
    updatePreviewImage(recipe);
    previewEl.classList.add('visible');
    syncInputPanels();
    previewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (pendingImageBase64 && pendingMimeType) {
      previewHint.textContent = 'Uppladdad bild sparas vid Spara. Generera eller förbättra med AI, eller redigera fält nedan.';
    } else if (recipe.image && recipeExistsInDb(recipe.id)) {
      previewHint.textContent = 'Generera ny bild, förbättra befintlig, eller ladda upp en annan.';
    } else if (recipe.image) {
      previewHint.textContent = 'Redigera och spara receptet.';
    } else {
      previewHint.textContent = 'Ingen bild — generera med AI, ladda upp manuellt eller spara utan.';
    }
    updateDeleteButton();
  }

  btnGenerateImage.addEventListener('click', function() { runImageAi('generate'); });
  btnEnhanceImage.addEventListener('click', function() { runImageAi('enhance'); });
  btnGeneratePlaceholder.addEventListener('click', function() { runImageAi('generate'); });
  if (btnImagePromptExtra) btnImagePromptExtra.addEventListener('click', toggleImagePromptExtra);
  if (btnImagePromptExtraOverlay) btnImagePromptExtraOverlay.addEventListener('click', toggleImagePromptExtra);

  document.getElementById('btn-parse-text').addEventListener('click', function() {
    var btn = document.getElementById('btn-parse-text');
    var text = document.getElementById('text').value.trim();
    var sourceHint = document.getElementById('source-hint').value.trim();
    if (!text && !pendingImageBase64) {
      setStatus('Klistra in text eller lägg till en bild.', true);
      return;
    }
    if (sourceHint) {
      text = (text ? text + '\n\n' : '') + 'Synlig originalkälla i caption/bild: ' + sourceHint;
    }
    btn.disabled = true;
    setStatus('Bygger recept…');
    fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        text: text,
        imageBase64: pendingImageBase64,
        mimeType: pendingMimeType
      })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Parse misslyckades');
        return data;
      });
    }).then(function(data) {
      editMode = false;
      showPreview(data.recipe);
      setStatus('Granska receptet och spara när du är nöjd.');
    }).catch(function(ex) {
      setStatus(ex.message, true);
    }).finally(function() { btn.disabled = false; });
  });

  document.getElementById('btn-parse-url').addEventListener('click', function() {
    var btn = document.getElementById('btn-parse-url');
    var url = document.getElementById('recipe-url').value.trim();
    if (!url) {
      setStatus('Ange en URL.', true);
      return;
    }
    btn.disabled = true;
    clearPendingImage();
    setStatus('Hämtar sida och tolkar…');
    fetch('/api/parse-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ url: url })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'URL-tolkning misslyckades');
        return data;
      });
    }).then(function(data) {
      editMode = false;
      if (data.imageBase64 && data.mimeType) {
        setPendingImage(data.imageBase64, data.mimeType, 'drop-text', 'thumb-text');
      }
      showPreview(data.recipe);
      setStatus(
        data.imageFromUrl
          ? 'Matfoto från sidan ingår vid sparning. Granska och spara.'
          : 'Ingen matfoto på sidan — recept utan bild tills du lägger till en i Redigera.'
      );
    }).catch(function(ex) {
      setStatus(ex.message, true);
    }).finally(function() { btn.disabled = false; });
  });

  document.getElementById('btn-parse-image').addEventListener('click', function() {
    var btn = document.getElementById('btn-parse-image');
    if (!pendingImageBase64) {
      setStatus('Lägg till en bild först.', true);
      return;
    }
    btn.disabled = true;
    setStatus('Tolkar bild med Gemini…');
    fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        text: '',
        imageBase64: pendingImageBase64,
        mimeType: pendingMimeType
      })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Parse misslyckades');
        return data;
      });
    }).then(function(data) {
      editMode = false;
      if (!data.saveImage) {
        clearPendingImage();
        clearImageDrop('drop-image', 'thumb-image', 'file-image');
      }
      showPreview(data.recipe);
      setStatus(
        data.saveImage
          ? 'Granska och spara — matfotot sparas med receptet.'
          : 'Recept tolkat från bilden, men ingen matfoto sparas (lägg till i Redigera vid behov).'
      );
    }).catch(function(ex) {
      setStatus(ex.message, true);
    }).finally(function() { btn.disabled = false; });
  });

  var btnMergeMoreToggle = document.getElementById('btn-merge-more-toggle');
  if (btnMergeMoreToggle) {
    btnMergeMoreToggle.addEventListener('click', function() {
      setMergeMoreOpen(!isMergeMoreOpen());
    });
  }

  document.getElementById('btn-merge-ai').addEventListener('click', function() {
    if (!currentRecipe || !previewEl.classList.contains('visible')) {
      setStatus('Granska ett recept först.', true);
      return;
    }
    var btn = document.getElementById('btn-merge-ai');
    var text = (document.getElementById('merge-text').value || '').trim();
    if (!text && !mergeImageBase64) {
      setStatus('Ange fritext eller en bild att slå ihop.', true);
      return;
    }
    var existing;
    try {
      existing = readRecipeFromForm();
    } catch (ex) {
      setStatus(ex.message, true);
      return;
    }
    var keepId = editingRecipeId || existing.id || (currentRecipe && currentRecipe.id) || null;
    var keepImage = existing.image || (currentRecipe && currentRecipe.image) || null;

    btn.disabled = true;
    setStatus('Slår ihop tillägg med receptet…');
    fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        recipe: existing,
        text: text,
        imageBase64: mergeImageBase64,
        mimeType: mergeMimeType
      })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Sammanslagning misslyckades');
        return data;
      });
    }).then(function(data) {
      var merged = data.recipe;
      if (keepId) merged.id = keepId;
      if (keepImage && !merged.image) merged.image = keepImage;
      // Do not clear recipe food photo pending state — merge image is separate
      clearMergeInputs();
      showPreview(merged);
      setStatus('Tillägg sammanslaget — granska och spara när du är nöjd.');
    }).catch(function(ex) {
      setStatus(ex.message, true);
    }).finally(function() { btn.disabled = false; });
  });

  function goToRecipe(id) {
    location.href = '/r/' + encodeURIComponent(id);
  }

  function applyMacrosToForm(macros) {
    if (!macros) return;
    [
      ['edit-kcal', 'kcal'],
      ['edit-prot', 'prot'],
      ['edit-carb', 'carb'],
      ['edit-fat', 'fat']
    ].forEach(function(pair) {
      var el = document.getElementById(pair[0]);
      if (el && macros[pair[1]] != null) el.value = String(macros[pair[1]]);
    });
    if (currentRecipe) currentRecipe.macros = {
      kcal: macros.kcal,
      prot: macros.prot,
      carb: macros.carb,
      fat: macros.fat
    };
  }

  document.getElementById('btn-recalc-macros').addEventListener('click', function() {
    if (!currentRecipe) return;
    var btn = document.getElementById('btn-recalc-macros');
    var recipe;
    try {
      recipe = readRecipeFromForm();
    } catch (ex) {
      setStatus(ex.message, true);
      return;
    }
    if (!recipe.groups || !recipe.groups.length) {
      setStatus('Lägg till ingredienser innan du räknar om makron.', true);
      return;
    }
    btn.disabled = true;
    setStatus('Räknar om makron…');
    fetch('/api/estimate-macros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ recipe: recipe })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Makroberäkning misslyckades');
        return data;
      });
    }).then(function(data) {
      applyMacrosToForm(data.macros);
      if (data.recipe) {
        currentRecipe = data.recipe;
      }
      var unresolved = data.unresolved || [];
      if (unresolved.length || data.unmatchedCount || data.needsPieceWeightCount) {
        var first = markUnresolvedOnForm(unresolved);
        scrollToIngError(first);
        var n = unresolved.length || (data.unmatchedCount || 0) + (data.needsPieceWeightCount || 0);
        setStatus(
          'Makron uppdaterade, men ' + n + (n === 1 ? ' rad saknar' : ' rader saknar') +
          ' näringsdata och räknas inte med. Du kan spara ändå och rätta senare under Granska.',
          true
        );
      } else {
        clearAllIngNutritionErrors();
        setStatus(
          'Makron uppdaterade: ' +
          data.macros.kcal + ' kcal · ' +
          data.macros.prot + 'g prot · ' +
          data.macros.carb + 'g kh · ' +
          data.macros.fat + 'g fett'
        );
      }
      var macrosSec = previewForm.querySelector('.macros');
      if (macrosSec && !(unresolved.length || data.unmatchedCount || data.needsPieceWeightCount)) {
        macrosSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }).catch(function(ex) {
      setStatus(ex.message, true);
    }).finally(function() { btn.disabled = false; });
  });

  document.getElementById('btn-save').addEventListener('click', function() {
    if (!currentRecipe) return;
    var btn = document.getElementById('btn-save');
    btn.disabled = true;

    var recipe;
    try {
      recipe = readRecipeFromForm();
    } catch (ex) {
      setStatus(ex.message, true);
      btn.disabled = false;
      return;
    }
    if (!recipe.id || !recipe.title) {
      setStatus('Id och titel krävs — fyll i titel i granskningsformuläret.', true);
      btn.disabled = false;
      return;
    }
    if (!recipe.groups || !recipe.groups.length) {
      setStatus('Lägg till minst en ingrediensgrupp med ingredienser.', true);
      var ingSec = previewForm.querySelector('.ing-groups');
      if (ingSec) ingSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.disabled = false;
      return;
    }

    var saveId = editingRecipeId;
    clearAllIngNutritionErrors();
    Promise.resolve()
      .then(function() {
        var url = saveId
          ? '/api/recipes/' + encodeURIComponent(saveId)
          : '/api/recipes';
        var method = saveId ? 'PUT' : 'POST';

        var body = {
          recipe: recipe,
          featuredNew: document.getElementById('featured-new').checked
        };

        if (saveId) {
          setStatus('Sparar…');
          if (pendingImageBase64 && pendingMimeType) {
            body.uploadImage = true;
            body.imageBase64 = pendingImageBase64;
            body.mimeType = pendingMimeType;
          }
        } else {
          setStatus('Sparar recept…');
          body.skipImageGeneration = true;
          if (pendingImageBase64 && pendingMimeType) {
            body.uploadImage = true;
            body.imageBase64 = pendingImageBase64;
            body.mimeType = pendingMimeType;
          }
        }

        return fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        }).then(function(res) {
          return res.json().then(function(data) {
            if (!res.ok) {
              throw new Error((data.details && data.details.join(' · ')) || data.error || 'Sparning misslyckades');
            }
            data._featuredNew = !!body.featuredNew;
            return data;
          });
        });
      })
      .then(function(data) {
        var saved = data.recipe;
        if (data._featuredNew) {
          clearFeaturedSeen(saved.id);
          try { sessionStorage.setItem('recept_skip_visit_' + saved.id, '1'); } catch (e) {}
        }
        if (saveId) {
          recipeList = recipeList.filter(function(r) { return r.id !== saveId; });
        }
        recipeList.push({ id: saved.id, title: saved.title });
        editingRecipeId = saved.id;
        currentRecipe = saved;
        populateEditSelect(saved.id);
        editSelect.value = saved.id;
        if (saved.id !== saveId) {
          history.replaceState(null, '', ADD_BASE + '/redigera?edit=' + encodeURIComponent(saved.id));
        }
        goToRecipe(saved.id);
      })
      .catch(function(ex) {
        setStatus(ex.message, true);
      })
      .finally(function() { btn.disabled = false; });
  });

  syncInputPanels();

  bindAddTabNav();

  fetch('/api/auth/check', { credentials: 'same-origin' })
    .then(function(res) { return res.json(); })
    .then(function(d) {
      if (!d.ok) {
        var next = encodeURIComponent(location.pathname + location.search);
        location.href = '/login.html?next=' + next;
        return;
      }
      return fetch('/api/recipes', { credentials: 'same-origin' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          recipeList = (data.recipes || []).map(function(r) { return { id: r.id, title: r.title }; });
          initAddPage();
        })
        .catch(function() {
          initAddPage();
        });
    })
    .catch(function() {
      var next = encodeURIComponent(location.pathname + location.search);
      location.href = '/login.html?next=' + next;
    });
})();
