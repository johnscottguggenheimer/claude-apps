(function() {
  window.ReceptAdmin = { isAdmin: false };

  function syncThemeToggle() {
    var label = document.getElementById('theme-toggle-label');
    if (!label) return;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    label.textContent = dark ? 'Ljust' : 'Mörkt';
  }

  var themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function() {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (window.ReceptTheme) ReceptTheme.set(dark ? 'light' : 'dark');
      syncThemeToggle();
    });
    syncThemeToggle();
  }

  function adminLink(href, text, extraClass) {
    var a = document.createElement('a');
    a.href = href;
    a.className = 'admin-bar-link' + (extraClass ? ' ' + extraClass : '');
    a.textContent = text;
    return a;
  }

  function adminButton(text, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-bar-btn';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function setAdminState(isAdmin) {
    window.ReceptAdmin.isAdmin = isAdmin;
    document.documentElement.classList.toggle('is-admin', isAdmin);
    window.dispatchEvent(new CustomEvent('recept-auth', { detail: { ok: isAdmin } }));
  }

  function renderAdminBar(bar, isAdmin) {
    bar.replaceChildren();
    if (isAdmin) {
      var page = document.body.getAttribute('data-page') || 'home';
      bar.appendChild(adminLink('/granska', 'Granska', page === 'review' ? 'is-current' : ''));
      bar.appendChild(adminLink('/add/text', 'Lägg till +', page === 'add' ? 'is-current' : ''));
      bar.appendChild(adminButton('Logga ut', function() {
        fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
          .then(function() {
            setAdminState(false);
            renderAdminBar(bar, false);
            var pg = document.body.getAttribute('data-page');
            if (pg === 'add' || pg === 'review') {
              location.href = '/';
            }
          });
      }));
    } else {
      var next = encodeURIComponent(location.pathname + location.search);
      bar.appendChild(adminLink('/login.html?next=' + next, 'Logga in'));
    }
  }

  function initAdminBar() {
    var bar = document.querySelector('.admin-bar-inner');
    if (!bar) return;
    fetch('/api/auth/check', { credentials: 'same-origin' })
      .then(function(res) { return res.json(); })
      .then(function(d) {
        setAdminState(!!d.ok);
        renderAdminBar(bar, !!d.ok);
      })
      .catch(function() {
        setAdminState(false);
        renderAdminBar(bar, false);
      });
  }

  initAdminBar();

  var page = document.body.getAttribute('data-page') || 'home';

  if (page === 'add' || page === 'review') {
    function homeBasePath() {
      var path = location.pathname;
      var idx = path.indexOf('/recept');
      if (idx !== -1) return path.slice(0, idx + 7) + '/';
      return '/';
    }
    var home = homeBasePath();

    var favBtn = document.getElementById('favorites-toggle-btn');
    if (favBtn) {
      favBtn.addEventListener('click', function() {
        if (window.ReceptBrowseNav && ReceptBrowseNav.buildListUrl) {
          location.href = ReceptBrowseNav.buildListUrl(home, { favorites: true });
          return;
        }
        location.href = home + '?favoriter=1';
      });
    }

    var search = document.getElementById('recipe-search');
    if (search) {
      search.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var q = search.value.trim();
        if (window.ReceptBrowseNav && ReceptBrowseNav.buildListUrl) {
          location.href = ReceptBrowseNav.buildListUrl(home, { search: q });
          return;
        }
        location.href = q ? home + '?q=' + encodeURIComponent(q) : home;
      });
    }

    var nav = document.getElementById('browse-nav');
    if (nav && window.ReceptBrowseNav && !nav.childNodes.length) {
      ReceptBrowseNav.render(nav, {
        linkMode: true,
        getFilterUrl: function(filter) {
          return ReceptBrowseNav.urlForFilter(home, {}, filter);
        }
      });
    }
  }
})();
