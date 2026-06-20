/* ============================================================
   team.js — admin-only page (gated in ui.requireAdminOrRedirect).
   Renders the member-card grid, opens an edit modal on card click,
   and handles create / update / delete via /api/team.
   ============================================================ */
(function () {
  if (!ui.requireAdminOrRedirect()) return;
  ui.mountSidebar('team');
  ui.mountThemeToggle();

  const isAdmin = ui.Session.isAdmin();

  const $ = (id) => document.getElementById(id);
  const grid           = $('teamGrid');
  const searchInput    = $('teamSearch');
  const addBtn         = $('addMemberBtn');
  const modalBackdrop  = $('memberModalBackdrop');
  const modalForm      = $('memberForm');
  const modalTitle     = $('memberModalTitle');
  const modalClose     = $('memberModalClose');
  const fId    = $('mfId');
  const fName  = $('mfName');
  const fRole  = $('mfRole');
  const fDept  = $('mfDept');
  const fEmail = $('mfEmail');
  const fPhone = $('mfPhone');
  const fAccent = $('mfAccent');
  const fDelete = $('mfDelete');
  const fCancel = $('mfCancel');
  const fSave   = $('mfSave');

  let members = [];
  /** Accent currently selected in the modal. */
  let pickedAccent = 'ember';

  if (isAdmin) addBtn.style.display = '';

  /* "/" focuses the search box (matches dashboard). */
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput && !modalBackdrop.classList.contains('open')) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape' && modalBackdrop.classList.contains('open')) closeModal();
  });

  function initialsOf(name) {
    if (!name) return '—';
    return name.split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  }
  function fmtHours(h) {
    if (h == null) return '—';
    if (h < 1) return Math.round(h * 60) + 'm';
    if (h < 10) return h.toFixed(1) + 'h';
    return Math.round(h) + 'h';
  }
  function workloadPct(active) {
    return Math.min(100, Math.max(active > 0 ? 8 : 0, (active / 8) * 100));
  }

  function renderCards(list) {
    if (!list.length) {
      grid.innerHTML = `
        <div class="team-empty">
          <div class="iconring">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div class="serif" style="font-size:1.25rem; color:var(--text);">No matches.</div>
          <div class="dim" style="margin-top:0.25rem;">Try a different name, role, or department.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = list.map((m, i) => {
      const safeName  = ui.escapeHtml(m.name);
      const safeRole  = ui.escapeHtml(m.role || '');
      const safeDept  = ui.escapeHtml(m.dept || '');
      const safeEmail = ui.escapeHtml(m.email || '');
      const safePhone = ui.escapeHtml(m.phone || '');
      const accent    = ['ember','mint','cyan','violet','rose','amber','gold','sky'].includes(m.accent) ? m.accent : 'ember';

      return `
        <article class="member-card" data-id="${ui.escapeHtml(m.id)}" data-name="${safeName.toLowerCase()}" data-role="${safeRole.toLowerCase()}" data-dept="${safeDept.toLowerCase()}" data-email="${safeEmail.toLowerCase()}" style="animation-delay:${Math.min(i, 8) * 50}ms;">
          ${isAdmin ? `
            <button type="button" class="mc-edit" data-edit="${ui.escapeHtml(m.id)}" aria-label="Edit ${safeName}" title="Edit member">
              <i class="bi bi-pencil-square"></i>
            </button>` : ''}
          <div class="mc-head">
            <div class="mc-avatar acc-${accent}" aria-hidden="true">
              ${ui.escapeHtml(initialsOf(m.name))}
              <span class="mc-status-dot"></span>
            </div>
            <div class="mc-id">
              <div class="mc-name">${safeName}</div>
              <div class="mc-role">${safeRole}</div>
              ${safeDept ? `<span class="mc-dept">${safeDept}</span>` : ''}
            </div>
          </div>

          <div class="mc-contact">
            ${safeEmail ? `
              <div class="row" title="${safeEmail}">
                <i class="bi bi-envelope"></i>
                <span><a href="mailto:${safeEmail}">${safeEmail}</a></span>
              </div>` : ''}
            ${safePhone ? `
              <div class="row" title="${safePhone}">
                <i class="bi bi-telephone"></i>
                <span><a href="tel:${safePhone.replace(/\s+/g, '')}">${safePhone}</a></span>
              </div>` : ''}
          </div>

          <div>
            <div class="mc-workload-head">
              <span>Active workload</span>
              <span class="count tabular">${m.active}</span>
            </div>
            <div class="mc-workload-track">
              <div class="mc-workload-fill acc-${accent}" data-pct="${workloadPct(m.active)}" style="width:0;"></div>
            </div>
          </div>

          <div class="mc-metrics">
            <div class="mc-metric">
              <div class="label"><i class="bi bi-check2-circle" style="color:var(--mint);"></i> Resolved</div>
              <div class="value tabular">${m.resolved}</div>
            </div>
            <div class="mc-metric">
              <div class="label"><i class="bi bi-clock-history" style="color:var(--ember);"></i> Avg time</div>
              <div class="value tabular">${fmtHours(m.avgHours)}</div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Animate workload bars after the cards land.
    requestAnimationFrame(() => {
      setTimeout(() => {
        grid.querySelectorAll('.mc-workload-fill').forEach((el) => {
          el.style.width = (el.dataset.pct || 0) + '%';
        });
      }, 120);
    });

    // Wire edit buttons (admin only).
    if (isAdmin) {
      grid.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-edit');
          const m = members.find((x) => x.id === id);
          if (m) openModal(m);
        });
      });
    }
  }

  function applySearch() {
    const q = (searchInput.value || '').trim().toLowerCase();
    if (!q) { renderCards(members); return; }
    const filtered = members.filter((m) => {
      return [m.name, m.role, m.dept, m.email]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(q));
    });
    renderCards(filtered);
  }

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 120);
  });

  // ----- Modal -----
  function pickAccent(value) {
    pickedAccent = value;
    fAccent.querySelectorAll('.accent-swatch').forEach((s) => {
      s.classList.toggle('selected', s.dataset.value === value);
    });
  }
  fAccent.addEventListener('click', (e) => {
    const sw = e.target.closest('.accent-swatch');
    if (sw) pickAccent(sw.dataset.value);
  });

  function openModal(member) {
    const editing = !!member;
    modalTitle.textContent = editing ? `Edit ${member.name}` : 'New member';
    fId.value    = editing ? member.id : '';
    fName.value  = editing ? (member.name || '') : '';
    fRole.value  = editing ? (member.role || '') : '';
    fDept.value  = editing ? (member.dept || '') : '';
    fEmail.value = editing ? (member.email || '') : '';
    fPhone.value = editing ? (member.phone || '') : '';
    pickAccent(editing ? (member.accent || 'ember') : 'ember');
    fDelete.style.display = editing ? '' : 'none';
    fSave.innerHTML = editing
      ? '<i class="bi bi-check2-circle"></i> Save changes'
      : '<i class="bi bi-person-plus-fill"></i> Create member';
    modalBackdrop.classList.add('open');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => fName.focus(), 60);
  }
  function closeModal() {
    modalBackdrop.classList.remove('open');
    modalBackdrop.setAttribute('aria-hidden', 'true');
  }
  modalClose.addEventListener('click', closeModal);
  fCancel.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  modalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name:   fName.value.trim(),
      role:   fRole.value.trim(),
      dept:   fDept.value.trim(),
      email:  fEmail.value.trim(),
      phone:  fPhone.value.trim(),
      accent: pickedAccent
    };
    if (!payload.name)  { ui.toast('Name is required',  'error', 2400); fName.focus(); return; }
    if (!payload.role)  { ui.toast('Role is required',  'error', 2400); fRole.focus(); return; }

    fSave.disabled = true;
    try {
      if (fId.value) {
        await api.updateMember(fId.value, payload);
        ui.toast('Member updated.', 'success', 1800);
      } else {
        await api.createMember(payload);
        ui.toast('Member added.', 'success', 1800);
      }
      closeModal();
      await load();
    } catch (err) {
      ui.toast(`Save failed: ${err.message}`, 'error', 4000);
    } finally {
      fSave.disabled = false;
    }
  });

  fDelete.addEventListener('click', async () => {
    const id = fId.value;
    if (!id) return;
    const m = members.find((x) => x.id === id);
    if (!confirm(`Remove ${m ? m.name : 'this member'} from the team? This cannot be undone.`)) return;
    fDelete.disabled = true;
    try {
      await api.deleteMember(id);
      ui.toast('Member removed.', 'info', 1800);
      closeModal();
      await load();
    } catch (err) {
      ui.toast(`Remove failed: ${err.message}`, 'error', 4000);
    } finally {
      fDelete.disabled = false;
    }
  });

  if (addBtn) addBtn.addEventListener('click', () => openModal(null));

  async function load() {
    try {
      const json = await api.listTeam();
      members = json.items || [];
      renderCards(members);
    } catch (err) {
      grid.innerHTML = `
        <div class="team-empty">
          <div class="iconring"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
          <div class="serif" style="font-size:1.25rem; color:var(--text);">Could not load the team.</div>
          <div class="dim" style="margin-top:0.25rem;">${ui.escapeHtml(err.message || 'Network error')}</div>
        </div>
      `;
    }
  }

  load();
})();
