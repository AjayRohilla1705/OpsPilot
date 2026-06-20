/* UI helpers: toasts, formatting, chips, auth-guard, sidebar bootstrapping. */
(function () {
  const STORAGE_KEY = 'sentinel.session';
  const THEME_KEY = 'sentinel.theme';

  // ----- Theme -----
  const Theme = {
    get() {
      try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
    },
    set(t) {
      try { localStorage.setItem(THEME_KEY, t); } catch {}
      this.apply(t);
    },
    toggle() {
      const next = this.get() === 'dark' ? 'light' : 'dark';
      this.set(next);
      return next;
    },
    apply(t) {
      const theme = t || this.get();
      if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
    }
  };
  // Apply ASAP (in case the FOUC-prevention inline script in HTML didn't run)
  Theme.apply();

  function themeIconSvg() {
    return `
      <svg class="t-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
      <svg class="t-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>`;
  }

  /**
   * Inject the theme-toggle button into every `.topbar`. Idempotent: safe to
   * call multiple times. Positioned at the START of the topbar's `.actions`
   * row (i.e., immediately to the LEFT of the search bar / primary actions).
   */
  function mountThemeToggle() {
    document.querySelectorAll('.topbar').forEach((bar) => {
      if (bar.querySelector('.theme-toggle')) return;
      let actions = bar.querySelector('.actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'actions';
        bar.appendChild(actions);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-toggle btn btn-icon ripple';
      btn.setAttribute('aria-label', 'Toggle theme');
      btn.title = 'Toggle theme';
      btn.innerHTML = themeIconSvg();
      btn.addEventListener('click', () => {
        const next = Theme.toggle();
        btn.classList.remove('flip');
        // force reflow so the animation re-triggers on rapid clicks
        void btn.offsetWidth;
        btn.classList.add('flip');
        btn.setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} theme`);
      });
      actions.insertBefore(btn, actions.firstChild);
    });
  }

  // ----- Session -----
  const Session = {
    get() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
    },
    set(v) { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); },
    clear() { localStorage.removeItem(STORAGE_KEY); },
    isAuthed() { return !!(this.get() && this.get().username); },
    /** Treats `role === 'admin'` (or legacy `isAdmin === true`) as admin. */
    isAdmin() {
      const s = this.get();
      if (!s) return false;
      if (s.role === 'admin') return true;
      if (s.isAdmin === true) return true;
      return false;
    }
  };

  /**
   * Hard gate for admin-only pages. Call from settings.js / team.js / etc.
   * Non-admins are bounced to the dashboard with a friendly toast.
   */
  function requireAdminOrRedirect() {
    if (!Session.isAuthed()) { window.location.replace('/'); return false; }
    if (!Session.isAdmin()) {
      try {
        // Defer toast so the dashboard mounts the toast stack first.
        sessionStorage.setItem('sentinel.flash', JSON.stringify({
          message: 'Admin access required for that page.',
          kind: 'error'
        }));
      } catch {}
      window.location.replace('/dashboard.html');
      return false;
    }
    return true;
  }

  function requireAuthOrRedirect() {
    if (!Session.isAuthed()) {
      window.location.replace('/');
      return false;
    }
    return true;
  }

  function logout() {
    Session.clear();
    window.location.replace('/');
  }

  // ----- Toasts -----
  function ensureToastStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }
  function toast(message, kind = 'info', ttl = 3200) {
    const stack = ensureToastStack();
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = `<span>${iconFor(kind)}</span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'toast-in 0.3s var(--easing) reverse';
      setTimeout(() => t.remove(), 280);
    }, ttl);
  }
  function iconFor(kind) {
    if (kind === 'success') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    if (kind === 'error') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ----- Formatting -----
  function fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  }
  function fmtRelative(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    if (diff < 86400 * 30) return `${Math.floor(diff/86400)}d ago`;
    return fmtDate(s);
  }
  function fmtBytes(b) {
    if (!b && b !== 0) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/(1024*1024)).toFixed(1)} MB`;
  }

  // ----- Chips -----
  function severityChip(sev) {
    const s = (sev || 'P3').toLowerCase();
    return `<span class="chip ${s}">${escapeHtml(sev)}</span>`;
  }
  function stateChip(state) {
    const map = {
      'Live': 'state-live',
      'On Hold': 'state-hold',
      'Resolved': 'state-resolved',
      'RCA in Progress': 'state-rca',
      'RCA Submitted': 'state-submitted',
      'RCA Review-Issues': 'state-progress',
      'RCA Not Required': 'state-rcanotreq',
      'CA In Progress': 'state-progress'
    };
    const cls = map[state] || 'state-hold';
    return `<span class="chip ${cls}">${escapeHtml(state || '—')}</span>`;
  }
  function severityBars(sev) {
    const order = ['P3', 'P2-Low', 'P2', 'P1'];
    const idx = order.indexOf(sev);
    const cls = (sev || 'p3').toLowerCase();
    let html = '<span class="sev-bars" aria-label="Severity ' + escapeHtml(sev) + '">';
    for (let i = 0; i < 4; i++) {
      const on = i <= idx ? `on ${cls}` : '';
      const h = 12 + i * 5;
      html += `<span class="${on}" style="height:${h}px"></span>`;
    }
    html += '</span>';
    return html;
  }

  // ----- Sidebar (rendered on every authed page) -----
  function renderSidebar() {
    const s = Session.get() || {};
    const isAdmin = Session.isAdmin();
    const initials = s.avatarInitials || (isAdmin ? 'A' : 'EM');
    const name = s.displayName || (isAdmin ? 'Admin' : 'EMS Operator');
    const roleLabel = isAdmin ? 'ADMIN' : 'OPERATOR';

    // Nav items in display order. Items with `admin: true` only render for
    // the admin role. `badge` adds an inline ADMIN chip to the row.
    const items = [
      { key: 'dashboard', label: 'Dashboard', href: '/dashboard.html',
        svg: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>' },
      { key: 'incidents', label: 'Incidents', href: '/dashboard.html#incidents-table',
        svg: '<path d="M12 2 2 22h20L12 2z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="18" x2="12.01" y2="18"/>' },
      { key: 'new', label: 'New Incident', href: '/new.html',
        svg: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>' },
      { key: 'reports', label: 'Reports', href: '/reports.html',
        svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>' },
      { key: 'team', label: 'Team', href: '/team.html', badge: true, admin: true,
        svg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
      { key: 'activity', label: 'Activity Log', href: '/activity.html', badge: true, admin: true,
        svg: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' },
      { key: 'analytics', label: 'Analytics', href: '/dashboard.html#analytics',
        svg: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
      { key: 'settings', label: 'Settings', href: '/settings.html',
        svg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' }
    ];

    const navHtml = items
      .filter((it) => isAdmin || !it.admin)
      .map((it) => `
        <a href="${it.href}" data-nav="${it.key}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${it.svg}</svg>
          <span class="nav-label">${escapeHtml(it.label)}</span>
          ${it.badge && isAdmin ? '<span class="nav-badge">ADMIN</span>' : ''}
        </a>
      `).join('');

    return `
      <div class="sidebar v2" id="sidebar">
        <a href="/dashboard.html" class="brand" aria-label="OpsPilot home">
          <span class="mark"></span>
          <span class="brand-text">
            <span class="word">OpsPilot</span>
            <span class="brand-sub">INCIDENT MANAGER</span>
          </span>
          <span class="brand-dot" aria-hidden="true"></span>
        </a>

        <div class="me-card ${isAdmin ? 'is-admin' : ''}" id="meCard">
          <div class="avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="me-id">
            <div class="me-name">
              ${escapeHtml(name)}
              ${isAdmin ? '<i class="bi bi-trophy-fill me-crown" aria-hidden="true" title="Administrator"></i>' : ''}
            </div>
            <div class="me-role">
              ${isAdmin ? '<span class="role-pill role-admin"><i class="bi bi-shield-fill-check"></i> ADMIN</span>'
                        : `<span class="role-pill role-user">${escapeHtml(roleLabel)}</span>`}
            </div>
          </div>
          <button class="logout" id="logoutBtn" title="Sign out" aria-label="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>

        <nav>${navHtml}</nav>
      </div>

      <button class="btn btn-icon menu-btn" id="menuBtn" aria-label="Toggle menu">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>

      <div class="sidebar-backdrop" id="sidebarBackdrop" aria-hidden="true"></div>
    `;
  }

  /**
   * Compute which sidebar item should be active based on the current URL.
   * On dashboard.html the same page hosts Dashboard / Incidents / Activity
   * / Analytics under hash anchors, so we read the hash too.
   * On incident.html the active item is always "incidents".
   * On new.html the active item is always "new".
   */
  function computeActiveKey(fallback) {
    const path = window.location.pathname;
    const hash = window.location.hash;
    if (/team\.html$/.test(path))        return 'team';
    if (/activity\.html$/.test(path))    return 'activity';
    if (/settings\.html$/.test(path))    return 'settings';
    if (/reports\.html$/.test(path))     return 'reports';
    if (/incident\.html$/.test(path))    return 'incidents';
    if (/new\.html$/.test(path))         return 'new';
    if (/dashboard\.html$/.test(path) || path === '/' ) {
      if (hash === '#incidents-table') return 'incidents';
      if (hash === '#activity')        return 'activity';
      if (hash === '#analytics')       return 'analytics';
      return 'dashboard';
    }
    return fallback || 'dashboard';
  }

  function applyActiveSidebar(forceKey) {
    const key = forceKey || computeActiveKey();
    document.querySelectorAll('.sidebar a[data-nav]').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === key);
    });
  }

  function mountSidebar(initialActive) {
    const root = document.getElementById('sidebar-root');
    if (!root) return;
    root.innerHTML = renderSidebar();

    // Initial active state — ALWAYS prefer the URL (path + hash) so that
    // e.g. landing on `/dashboard.html#incidents-table` highlights
    // "Incidents", not "Dashboard". The `initialActive` arg is treated as
    // a fallback only (used for unknown paths).
    applyActiveSidebar(computeActiveKey(initialActive));

    // Live update on browser back/forward + hash change + direct clicks.
    window.addEventListener('hashchange', () => applyActiveSidebar());
    window.addEventListener('popstate',   () => applyActiveSidebar());

    // Mobile drawer open/close — keeps the sidebar and its backdrop in sync.
    const sidebarEl = document.getElementById('sidebar');
    const backdropEl = document.getElementById('sidebarBackdrop');
    function setDrawer(open) {
      if (sidebarEl) sidebarEl.classList.toggle('open', open);
      if (backdropEl) backdropEl.classList.toggle('show', open);
      // Lock body scroll while the drawer is open so the page behind doesn't move.
      document.body.style.overflow = open ? 'hidden' : '';
    }

    // Snappy click feedback — set active immediately instead of waiting for
    // the (possibly hash-only) navigation to register.
    document.querySelectorAll('.sidebar a[data-nav]').forEach((link) => {
      link.addEventListener('click', () => {
        applyActiveSidebar(link.dataset.nav);
        setDrawer(false); // close mobile drawer after navigating
      });
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      ui.toast('Signed out — see you soon.', 'info', 1600);
      setTimeout(logout, 350);
    });
    document.getElementById('menuBtn')?.addEventListener('click', () => {
      setDrawer(!(sidebarEl && sidebarEl.classList.contains('open')));
    });
    backdropEl?.addEventListener('click', () => setDrawer(false));
    // Escape closes the drawer.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebarEl && sidebarEl.classList.contains('open')) setDrawer(false);
    });
  }

  // Show any deferred flash message left by requireAdminOrRedirect().
  function consumeFlash() {
    try {
      const raw = sessionStorage.getItem('sentinel.flash');
      if (!raw) return;
      sessionStorage.removeItem('sentinel.flash');
      const f = JSON.parse(raw);
      if (f && f.message) toast(f.message, f.kind || 'info', 3600);
    } catch {}
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', consumeFlash);
  }

  // expose
  window.ui = {
    Session, Theme,
    requireAuthOrRedirect, requireAdminOrRedirect, logout,
    toast, escapeHtml, fmtDateTime, fmtDate, fmtRelative, fmtBytes,
    severityChip, stateChip, severityBars,
    mountSidebar, mountThemeToggle
  };
})();
