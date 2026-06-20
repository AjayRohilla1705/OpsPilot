/* ============================================================
   activity.js — Activity Log page.

   Fetches the audit trail from /api/activity and renders it as a
   single table with action badges. Live search + action filter
   re-query the backend so we never have to keep the whole log
   in memory client-side.
   ============================================================ */
(function () {
  if (!ui.requireAdminOrRedirect()) return;
  ui.mountSidebar('activity');
  ui.mountThemeToggle();

  const tbody       = document.getElementById('actBody');
  const searchInput = document.getElementById('actSearch');
  const actionSel   = document.getElementById('actActionFilter');
  const countLabel  = document.getElementById('actCountLabel');

  /* "/" focuses the search box, matching the dashboard shortcut. */
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  /* ---------- Action badge mapping ---------- */
  const BADGE_ICONS = {
    CREATED:   'bi-stars',
    UPDATED:   'bi-pencil-fill',
    DELETED:   'bi-trash3-fill',
    ASSIGNED:  'bi-person-fill-up',
    RESOLVED:  'bi-patch-check-fill',
    COMMENTED: 'bi-chat-left-text-fill',
  };
  function badgeHtml(action) {
    const cls = (action || 'UPDATED').toLowerCase();
    const icon = BADGE_ICONS[action] || 'bi-pencil-fill';
    return `<span class="act-badge ${cls}"><i class="bi ${icon}"></i>${ui.escapeHtml(action || '—')}</span>`;
  }

  /* ---------- Date formatting ---------- */
  function fmtAbsolute(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const date = d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  }

  /* ---------- Render the table ---------- */
  function renderRows(items) {
    if (!items.length) {
      tbody.innerHTML = `
        <tr><td colspan="5">
          <div class="audit-empty">
            <div class="iconring">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <div class="serif" style="font-size:1.25rem; color:var(--text);">No events match.</div>
            <div class="dim" style="margin-top:0.25rem;">Try a different search term or action filter.</div>
          </div>
        </td></tr>
      `;
      return;
    }

    tbody.innerHTML = items.map((e) => {
      const incidentCell = e.incidentId
        ? `<a href="/incident.html?id=${ui.escapeHtml(e.incidentId)}" title="Open incident">INC-${ui.escapeHtml(e.incidentId)}</a>`
        : '<span class="id-none">—</span>';

      return `
        <tr>
          <td class="col-ts">
            <div class="ts-primary">${ui.escapeHtml(fmtAbsolute(e.ts))}</div>
            <div class="ts-relative">${ui.escapeHtml(ui.fmtRelative(e.ts))}</div>
          </td>
          <td class="col-user">${ui.escapeHtml(e.by || 'System')}</td>
          <td class="col-action">${badgeHtml(e.action)}</td>
          <td class="col-incident">${incidentCell}</td>
          <td class="col-details">${ui.escapeHtml(e.details || '')}</td>
        </tr>
      `;
    }).join('');

    /* Staggered reveal */
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((tr, i) => {
      setTimeout(() => tr.classList.add('row-in'), 20 + i * 22);
    });
  }

  /* ---------- Fetch with current filter state ---------- */
  let fetchToken = 0;
  async function load() {
    const myToken = ++fetchToken;
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (actionSel.value)          params.set('action', actionSel.value);

    try {
      const res = await fetch('/api/activity' + (params.toString() ? '?' + params.toString() : ''));
      if (!res.ok) throw new Error('status ' + res.status);
      const json = await res.json();
      if (myToken !== fetchToken) return; // ignore stale responses

      if (countLabel) countLabel.textContent = json.total ?? json.count ?? 0;
      renderRows(json.items || []);
    } catch (err) {
      if (myToken !== fetchToken) return;
      tbody.innerHTML = `
        <tr><td colspan="5">
          <div class="audit-empty">
            <div class="iconring"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
            <div class="serif" style="font-size:1.25rem; color:var(--text);">Could not load the audit trail.</div>
            <div class="dim" style="margin-top:0.25rem;">${ui.escapeHtml(err.message || 'Network error')}</div>
          </div>
        </td></tr>
      `;
    }
  }

  /* Debounced search (re-queries the backend) */
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 160);
  });
  actionSel.addEventListener('change', load);

  load();
})();
