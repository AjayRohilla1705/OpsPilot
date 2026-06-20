/* Settings page: load settings from /api/settings, bind UI, track dirty state,
 * save deltas via PUT. Theme uses ui.Theme so it stays in lockstep with the
 * topbar toggle and persists across pages.
 */
(function () {
  if (!ui.requireAuthOrRedirect()) return;
  ui.mountSidebar('settings');
  ui.mountThemeToggle();

  const isAdmin = ui.Session.isAdmin();
  // Non-admins see the page but can't save server-side settings (every
  // settings.json write requires admin on the backend). The Appearance
  // card is still interactive because theme is stored in localStorage.
  if (!isAdmin) {
    document.body.classList.add('non-admin');
    document.querySelectorAll('.set-admin-only').forEach((section) => {
      section.classList.add('locked');
      // Tuck a small lock badge into the card header (next to the title)
      // instead of a full-width "Admin access required" banner — the ADMIN
      // chip already says that in words, the icon just reinforces it.
      const head = section.querySelector('.set-head');
      if (head && !head.querySelector('.locked-icon')) {
        const lock = document.createElement('span');
        lock.className = 'locked-icon';
        lock.title = 'Admin access required';
        lock.setAttribute('aria-label', 'Admin access required');
        lock.innerHTML = '<i class="bi bi-lock-fill" aria-hidden="true"></i>';
        head.appendChild(lock);
      }
    });
    // Disable every form control on the page except the Appearance card
    // (theme toggle) and the topbar theme toggle.
    document.querySelectorAll('.set-card input, .set-card button:not(#themeSwitchBtn), .set-card select, .set-card textarea').forEach((el) => {
      if (el.id === 'saveBtn') return;
      el.disabled = true;
      el.tabIndex = -1;
    });
  }

  // ----- DOM refs -----
  const $ = (id) => document.getElementById(id);
  const refs = {
    saveBtn:        $('saveBtn'),
    profDisplayName:$('profDisplayName'),
    profRole:       $('profRole'),
    profOrg:        $('profOrg'),
    themeCurrent:   $('themeCurrent'),
    themeSwitchBtn: $('themeSwitchBtn'),
    themeSwitchLabel: $('themeSwitchLabel'),
    ntfEmail:       $('ntfEmail'),
    ntfPush:        $('ntfPush'),
    ntfSlack:       $('ntfSlack'),
    ntfIncidentEmails: $('ntfIncidentEmails'),
    slaP1:          $('slaP1'),
    slaP2:          $('slaP2'),
    slaP3:          $('slaP3'),
    slaP4:          $('slaP4'),
    catWrap:        $('catWrap'),
    orgName:        $('orgName'),
    setMeta:        $('setMeta'),
    // Email Delivery (admin only)
    emailEnabled:   $('emailEnabled'),
    smtpHost:       $('smtpHost'),
    smtpPort:       $('smtpPort'),
    smtpSecure:     $('smtpSecure'),
    smtpUser:       $('smtpUser'),
    smtpPass:       $('smtpPass'),
    smtpPassHint:   $('smtpPassHint'),
    emailFrom:      $('emailFrom'),
    rcptWrap:       $('rcptWrap'),
    trigOnCreate:   $('trigOnCreate'),
    trigOnState:    $('trigOnState'),
    trigOnResolved: $('trigOnResolved'),
    emailStatus:    $('emailStatus'),
    testEmailBtn:   $('testEmailBtn')
  };

  // ----- State -----
  /** Server snapshot — used to compute the diff payload on Save. */
  let baseline = null;
  /** Live draft the user is editing. */
  let draft = null;

  // ----- Profile (read-only from session) -----
  const session = ui.Session.get() || {};
  refs.profDisplayName.textContent = session.displayName || session.username || 'EMS Operator';
  refs.profRole.textContent = session.role || 'Administrator';

  // ----- Theme card -----
  function syncThemeCard() {
    const t = ui.Theme.get();
    const isDark = t === 'dark';
    refs.themeCurrent.textContent = isDark ? 'Dark' : 'Light';
    refs.themeSwitchLabel.textContent = isDark ? 'Switch to Light' : 'Switch to Dark';
    // Swap the icon to reflect the *target* theme
    const icon = refs.themeSwitchBtn.querySelector('i');
    if (icon) icon.className = isDark ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
  }
  refs.themeSwitchBtn.addEventListener('click', () => {
    ui.Theme.toggle();
    syncThemeCard();
  });
  // Keep card in sync if user uses the topbar toggle.
  window.addEventListener('storage', (e) => {
    if (e.key === 'sentinel.theme') syncThemeCard();
  });
  syncThemeCard();

  // ----- Recipients (Email Delivery card) -----
  /** Live reference to the trailing "add recipient" input, so a typed-but-
   *  not-yet-committed address can be flushed into the list on Save. This is
   *  the fix for recipients silently vanishing: previously, an address that
   *  was typed but never committed (Enter/blur) looked added but was never
   *  persisted, so it "disappeared" on the next load. */
  let rcptInput = null;

  const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Add a recipient to the draft. Returns true if it was added. */
  function addRecipient(raw) {
    const v = (raw || '').trim();
    if (!v) return false;
    if (!draft.email) draft.email = { smtp: {}, triggers: {}, recipients: [] };
    if (!Array.isArray(draft.email.recipients)) draft.email.recipients = [];
    if (!EMAIL_RX.test(v)) { ui.toast(`"${v}" is not a valid email address`, 'error', 2400); return false; }
    const exists = draft.email.recipients.some((r) => r.toLowerCase() === v.toLowerCase());
    if (exists) { ui.toast(`${v} already added`, 'info', 1800); return false; }
    if (draft.email.recipients.length >= 50) { ui.toast('Maximum 50 recipients', 'error', 2200); return false; }
    draft.email.recipients = [...draft.email.recipients, v];
    return true;
  }

  /** Commit whatever is currently typed in the recipient input (used on Save). */
  function flushPendingRecipient() {
    if (!rcptInput) return;
    const v = rcptInput.value.trim();
    if (!v) return;
    if (addRecipient(v)) {
      rcptInput.value = '';
      renderRecipients(draft.email.recipients);
      recomputeDirty();
    }
  }

  function renderRecipients(list) {
    refs.rcptWrap.innerHTML = '';
    list.forEach((addr) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cat-chip rcpt-chip';
      chip.setAttribute('role', 'listitem');
      const iconHtml = isAdmin ? '<i class="bi bi-x-lg" aria-hidden="true"></i>' : '';
      chip.innerHTML = `<span>${ui.escapeHtml(addr)}</span>${iconHtml}`;
      if (isAdmin) {
        chip.title = `Remove "${addr}"`;
        chip.addEventListener('click', () => {
          draft.email.recipients = draft.email.recipients.filter((r) => r !== addr);
          renderRecipients(draft.email.recipients);
          recomputeDirty();
        });
      } else {
        chip.disabled = true; chip.classList.add('read-only');
      }
      refs.rcptWrap.appendChild(chip);
    });

    if (isAdmin) {
      const input = document.createElement('input');
      input.type = 'email';
      input.className = 'rcpt-input';
      input.placeholder = 'Add a recipient email — Enter to add';
      input.autocomplete = 'off';
      input.maxLength = 120;
      rcptInput = input;
      const commit = () => {
        if (addRecipient(input.value)) {
          input.value = '';
          renderRecipients(draft.email.recipients);
          recomputeDirty();
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      });
      input.addEventListener('blur', commit);
      // Typing a recipient should make the form savable even before the
      // address is committed as a chip — so clicking Save never silently
      // drops what's in the box.
      input.addEventListener('input', () => {
        if (input.value.trim()) {
          refs.saveBtn.disabled = false;
          refs.saveBtn.classList.add('is-dirty');
        } else {
          recomputeDirty();
        }
      });
      refs.rcptWrap.appendChild(input);
    }
  }

  // ----- Categories -----
  function renderCategories() {
    const list = (draft && draft.categories) || [];
    refs.catWrap.innerHTML = '';
    list.forEach((name) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cat-chip';
      chip.setAttribute('role', 'listitem');
      const iconHtml = isAdmin ? '<i class="bi bi-x-lg" aria-hidden="true"></i>' : '';
      chip.innerHTML = `<span>${ui.escapeHtml(name)}</span>${iconHtml}`;
      if (isAdmin) {
        chip.title = `Remove "${name}"`;
        chip.addEventListener('click', () => {
          draft.categories = draft.categories.filter((c) => c !== name);
          renderCategories();
          recomputeDirty();
        });
      } else {
        chip.disabled = true;
        chip.classList.add('read-only');
      }
      refs.catWrap.appendChild(chip);
    });

    // Trailing "+ Add" chip — admin only.
    if (isAdmin) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'cat-chip cat-add';
      addBtn.innerHTML = `<i class="bi bi-plus-lg" aria-hidden="true"></i><span>Add</span>`;
      addBtn.addEventListener('click', () => promoteAddToInput(addBtn));
      refs.catWrap.appendChild(addBtn);
    }
  }

  function promoteAddToInput(replaceEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cat-input';
    input.maxLength = 40;
    input.placeholder = 'New category';
    input.autocomplete = 'off';
    replaceEl.replaceWith(input);
    input.focus();

    const commit = () => {
      const v = input.value.trim();
      if (v) {
        const exists = draft.categories.some((c) => c.toLowerCase() === v.toLowerCase());
        if (exists) {
          ui.toast(`"${v}" already exists`, 'info', 1800);
        } else if (draft.categories.length >= 30) {
          ui.toast('Maximum 30 categories', 'error', 2000);
        } else {
          draft.categories.push(v);
          recomputeDirty();
        }
      }
      renderCategories();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { renderCategories(); }
    });
    input.addEventListener('blur', commit);
  }

  // ----- Dirty tracking -----
  function recomputeDirty() {
    // Non-admins can't save anything (backend rejects PUT for them) — bail
    // early so the button stays disabled regardless of input nudges.
    if (!isAdmin) {
      refs.saveBtn.disabled = true;
      refs.saveBtn.classList.remove('is-dirty');
      return;
    }
    draft.organization.name = refs.orgName.value.trim();
    draft.notifications.emailDigest    = refs.ntfEmail.checked;
    draft.notifications.browserPush    = refs.ntfPush.checked;
    draft.notifications.slackMentions  = refs.ntfSlack.checked;
    draft.notifications.incidentEmails = refs.ntfIncidentEmails.checked;
    draft.sla.P1 = sanitizeHours(refs.slaP1.value);
    draft.sla.P2 = sanitizeHours(refs.slaP2.value);
    draft.sla.P3 = sanitizeHours(refs.slaP3.value);
    draft.sla.P4 = sanitizeHours(refs.slaP4.value);

    if (!draft.email) draft.email = { smtp: {}, triggers: {}, recipients: [] };
    if (!draft.email.smtp) draft.email.smtp = {};
    if (!draft.email.triggers) draft.email.triggers = {};
    draft.email.enabled         = refs.emailEnabled.checked;
    draft.email.smtp.host       = refs.smtpHost.value.trim();
    draft.email.smtp.port       = Number(refs.smtpPort.value) || 0;
    draft.email.smtp.secure     = refs.smtpSecure.checked;
    draft.email.smtp.user       = refs.smtpUser.value.trim();
    // Only carry pass if the user typed something this session. Empty
    // means "don't change" — the baseline's hasPassword stays as-is.
    draft.email.smtp._passDraft = refs.smtpPass.value;
    draft.email.from            = refs.emailFrom.value.trim();
    draft.email.triggers.onCreate      = refs.trigOnCreate.checked;
    draft.email.triggers.onStateChange = refs.trigOnState.checked;
    draft.email.triggers.onResolved    = refs.trigOnResolved.checked;
    // Recipients are mutated directly by addRecipient/removeRecipient.

    const dirty = !shallowEqualSettings(baseline, draft);
    refs.saveBtn.disabled = !dirty;
    refs.saveBtn.classList.toggle('is-dirty', dirty);
  }

  function sanitizeHours(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(9999, Math.round(n)));
  }

  function shallowEqualSettings(a, b) {
    if (!a || !b) return false;
    if (a.organization.name !== b.organization.name) return false;
    for (const k of ['emailDigest', 'browserPush', 'slackMentions', 'incidentEmails']) {
      if (a.notifications[k] !== b.notifications[k]) return false;
    }
    for (const k of ['P1', 'P2', 'P3', 'P4']) {
      if (a.sla[k] !== b.sla[k]) return false;
    }
    if (a.categories.length !== b.categories.length) return false;
    for (let i = 0; i < a.categories.length; i++) {
      if (a.categories[i] !== b.categories[i]) return false;
    }
    // ---- email block ----
    const ae = a.email || {}, be = b.email || {};
    if (!!ae.enabled !== !!be.enabled) return false;
    if ((ae.from || '') !== (be.from || '')) return false;
    const as = ae.smtp || {}, bs = be.smtp || {};
    if ((as.host || '') !== (bs.host || '')) return false;
    if ((as.port || 0)  !== (bs.port || 0))  return false;
    if (!!as.secure   !== !!bs.secure)       return false;
    if ((as.user || '') !== (bs.user || '')) return false;
    if ((bs._passDraft || '') !== '') return false; // any typed password = dirty
    const at = ae.triggers || {}, bt = be.triggers || {};
    for (const k of ['onCreate', 'onStateChange', 'onResolved']) {
      if ((at[k] !== false) !== (bt[k] !== false)) return false;
    }
    const ar = ae.recipients || [], br = be.recipients || [];
    if (ar.length !== br.length) return false;
    for (let i = 0; i < ar.length; i++) if (ar[i] !== br[i]) return false;
    return true;
  }

  function renderMeta() {
    if (!baseline || !baseline.updatedAt) {
      refs.setMeta.textContent = '';
      return;
    }
    refs.setMeta.textContent = `Last updated ${ui.fmtRelative(baseline.updatedAt)} by ${baseline.updatedBy || 'EMS'}`;
  }

  // ----- Apply server settings to UI -----
  function applyToForm(s) {
    refs.profOrg.textContent = s.organization.name;
    refs.orgName.value       = s.organization.name;

    refs.ntfEmail.checked = !!s.notifications.emailDigest;
    refs.ntfPush.checked  = !!s.notifications.browserPush;
    refs.ntfSlack.checked = !!s.notifications.slackMentions;
    refs.ntfIncidentEmails.checked = !!s.notifications.incidentEmails;

    refs.slaP1.value = s.sla.P1;
    refs.slaP2.value = s.sla.P2;
    refs.slaP3.value = s.sla.P3;
    refs.slaP4.value = s.sla.P4;

    // Email delivery
    const e = s.email || {};
    const smtp = e.smtp || {};
    refs.emailEnabled.checked = !!e.enabled;
    refs.smtpHost.value       = smtp.host || '';
    refs.smtpPort.value       = smtp.port || '';
    refs.smtpSecure.checked   = !!smtp.secure;
    refs.smtpUser.value       = smtp.user || '';
    // Password is redacted by the server. Show a placeholder only.
    refs.smtpPass.value = '';
    refs.smtpPass.placeholder = smtp.hasPassword ? '•••••••• (saved — type to replace)' : '••••••••••••••••';
    refs.emailFrom.value = e.from || '';
    refs.trigOnCreate.checked   = (e.triggers && e.triggers.onCreate) !== false;
    refs.trigOnState.checked    = (e.triggers && e.triggers.onStateChange) !== false;
    refs.trigOnResolved.checked = (e.triggers && e.triggers.onResolved) !== false;

    renderRecipients(e.recipients || []);
    updateEmailStatus(s);
  }

  function updateEmailStatus(s) {
    const e = s.email || {};
    const on = !!(e.enabled && s.notifications && s.notifications.incidentEmails);
    const haveCreds = !!(e.smtp && e.smtp.host && e.smtp.port && e.smtp.user && e.smtp.hasPassword);
    const haveRcpts = (e.recipients || []).length > 0;
    let msg;
    if (!on)                  msg = 'Off · enable both the master switch and "Incident emails" to send.';
    else if (!haveCreds)      msg = 'Missing SMTP credentials (host/port/user/pass).';
    else if (!haveRcpts)      msg = 'No recipients configured.';
    else                      msg = `Live · ${(e.recipients || []).length} recipient(s)`;
    refs.emailStatus.textContent = msg;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ----- Load -----
  async function load() {
    try {
      const data = await api.getSettings();
      baseline = data.settings;
      draft    = clone(baseline);
      applyToForm(draft);
      renderCategories();
      renderMeta();
      refs.saveBtn.disabled = true;
    } catch (e) {
      ui.toast(`Couldn't load settings: ${e.message}`, 'error', 4000);
    }
  }

  // ----- Save -----
  async function save() {
    if (refs.saveBtn.disabled) return;
    // Commit any address still sitting in the recipient input before we read
    // the draft — otherwise a typed-but-uncommitted recipient is lost on save.
    flushPendingRecipient();
    refs.saveBtn.disabled = true;
    refs.saveBtn.classList.add('is-loading');
    try {
      const emailPayload = {
        enabled:    !!draft.email.enabled,
        smtp: {
          host:   draft.email.smtp.host,
          port:   draft.email.smtp.port,
          secure: !!draft.email.smtp.secure,
          user:   draft.email.smtp.user,
          // Send pass ONLY if the user typed one (empty string means "leave saved password alone")
          pass:   draft.email.smtp._passDraft || ''
        },
        from:       draft.email.from,
        recipients: draft.email.recipients || [],
        triggers:   draft.email.triggers
      };
      const payload = {
        organization:  draft.organization,
        notifications: draft.notifications,
        email:         emailPayload,
        sla:           draft.sla,
        categories:    draft.categories,
        updatedBy:     (ui.Session.get() && ui.Session.get().username) || 'EMS'
      };
      const data = await api.updateSettings(payload);
      baseline = data.settings;
      draft    = clone(baseline);
      applyToForm(draft);
      renderCategories();
      renderMeta();
      ui.toast('Settings saved.', 'success', 2000);
      refs.saveBtn.classList.remove('is-dirty');
    } catch (e) {
      ui.toast(`Save failed: ${e.message}`, 'error', 4200);
      // Re-enable so the user can retry.
      refs.saveBtn.disabled = false;
    } finally {
      refs.saveBtn.classList.remove('is-loading');
    }
  }

  // ----- Wire inputs -----
  [refs.orgName, refs.slaP1, refs.slaP2, refs.slaP3, refs.slaP4,
   refs.smtpHost, refs.smtpPort, refs.smtpUser, refs.smtpPass, refs.emailFrom].forEach((el) => {
    el.addEventListener('input', recomputeDirty);
    el.addEventListener('change', recomputeDirty);
  });
  [refs.ntfEmail, refs.ntfPush, refs.ntfSlack, refs.ntfIncidentEmails,
   refs.emailEnabled, refs.smtpSecure,
   refs.trigOnCreate, refs.trigOnState, refs.trigOnResolved].forEach((el) => {
    el.addEventListener('change', recomputeDirty);
  });
  refs.saveBtn.addEventListener('click', save);

  // ----- Test email -----
  refs.testEmailBtn.addEventListener('click', async () => {
    if (!isAdmin) return;
    if (!refs.saveBtn.disabled) {
      ui.toast('Save your changes first, then send a test.', 'error', 3000);
      return;
    }
    const orig = refs.testEmailBtn.innerHTML;
    refs.testEmailBtn.disabled = true;
    refs.testEmailBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Sending…';
    try {
      const res = await api.testEmail();
      ui.toast(`Test email sent to ${res.to}. Check the inbox.`, 'success', 4200);
    } catch (err) {
      ui.toast(`Test failed: ${err.message}`, 'error', 6000);
    } finally {
      refs.testEmailBtn.disabled = false;
      refs.testEmailBtn.innerHTML = orig;
    }
  });

  // Cmd/Ctrl+S — save shortcut.
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });

  // Warn on navigation away with unsaved edits.
  window.addEventListener('beforeunload', (e) => {
    if (!refs.saveBtn.disabled) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  load();
})();
