/* ============================================================
   new.js — Wires the IMS-style "New Incident" page to the
   Sentinel Express backend (POST /api/incidents).

   Field mapping (IMS form → backend incident schema):
     .incident-title-text   → title (required)
     #eng-select            → owner
     #affected-services     → affectedServices[] (split on newlines)
     #incident-desc         → incidentDescription
     #bridge-details        → bridgeDetails
     #steps-resolve         → stepsToResolve[] (split on newlines)
     #rca-text              → rootCauseAnalysis
     #incident-team chips   → incidentTeam[]
     #rca-team chips        → rcaTeam[]
     #inc-initiation        → emsFields.incidentInitiation
     #monitoring-events     → emsFields.monitoringDetectedEvents
     #root-cause            → emsFields.originatingRootCause
     #change-id             → emsFields.changeId
     #detected-time         → emsFields.incidentDetectedTime
     #duration              → emsFields.durationRootCause
     #send-notification     → sendNotifications
     #outage-type           → outageType
     #sev-select            → severity (P1, P2, P2-Low, P3) [required]
     #start-time            → incidentDetails.incidentStart [required]
     #end-time              → incidentDetails.incidentEnd
     #revenue-impact        → incidentDetails.revenueImpact
     #func-impacted         → incidentDetails.functionImpacted
     #location              → incidentDetails.locationImpacted
     #tech-area             → incidentDetails.techAreaImpacted
     #quick-remarks         → incidentDetails.quickRemarks
     Metabar State / Reason / Area / Iteration → state, reason, area, iteration
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Auth guard ---------- */
  if (!ui.requireAuthOrRedirect()) return;

  /* ---------- Tiny helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function val(id) { var el = $(id); return el ? el.value.trim() : ''; }
  function chk(id) { var el = $(id); return el ? el.checked : false; }
  function lines(str) {
    return (str || '')
      .split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* ---------- Bridge Details helpers (links only) ---------- */
  function wordTokens(str) {
    return (str || '').trim().split(/\s+/).filter(Boolean);
  }
  /* A token counts as a "link" if it's a full http(s) URL, a www. address,
     or a bare domain (optionally with a path). Anything else is rejected. */
  function isLink(tok) {
    return /^https?:\/\/\S+$/i.test(tok)
        || /^www\.\S+$/i.test(tok)
        || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(tok);
  }

  /* ---------- Session display ---------- */
  var session = (function () {
    try { return JSON.parse(localStorage.getItem('sentinel.session') || '{}') || {}; }
    catch (e) { return {}; }
  })();
  var userLabel = $('hdr-username-label');
  if (userLabel) userLabel.textContent = session.displayName || 'EMS Operator';
  // Update the assignee/discussion avatars with the user's initials.
  function initialsOf(name) {
    if (!name) return 'EM';
    return name.split(/\s+/).slice(0, 2).map(function (s) { return s[0]; }).join('').toUpperCase();
  }
  var sessionInitials = initialsOf(session.displayName || session.username);
  var avatarEl = $('wi-avatar-initials');
  if (avatarEl) avatarEl.textContent = sessionInitials;
  var discAvatarEl = $('wi-disc-avatar');
  if (discAvatarEl) discAvatarEl.textContent = sessionInitials;
  var metaUpdatedBy = $('meta-updated-by');
  if (metaUpdatedBy) metaUpdatedBy.textContent = session.displayName || 'EMS Operator';
  var roleLabel = $('ims-role-label');
  if (roleLabel) roleLabel.textContent = session.role === 'Incident Manager' ? 'Operator' : (session.role || 'Operator');

  /* ---------- Assignee dropdown — populated from the team roster ----------
     Whenever an admin adds a member on the Team page, that name shows up
     here (and anywhere else the roster is consumed). The list is fetched
     live from /api/team so it always reflects the current roster. */
  (function populateAssignees() {
    var sel = $('eng-select');
    if (!sel) return;
    api.listTeam().then(function (json) {
      var items = (json && json.items) || [];
      items
        .map(function (m) { return m && m.name ? String(m.name).trim() : ''; })
        .filter(Boolean)
        .forEach(function (name) {
          var opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          sel.appendChild(opt);
        });
    }).catch(function () {
      /* If the roster can't load, the placeholder option remains usable. */
    });
  })();

  /* ---------- Pending ticket ID ---------- */
  /* The backend assigns the real sequential id on save (INC-01, INC-02, …).
     We preview the next number here so the header reads "RCA INC-01" before
     the incident is even saved. It's fetched from the current list so it
     matches what the server will assign; the redirect after save still uses
     the authoritative id returned by the API. */
  var idLabel = $('incident-id-label');
  var wiIdHeader = $('wi-id-header');
  var pendingId = 'INC-01';
  function setPendingId(id) {
    pendingId = id;
    if (idLabel) idLabel.textContent = id;
    if (wiIdHeader) wiIdHeader.textContent = id;
  }
  setPendingId(pendingId);
  (function previewNextId() {
    api.listIncidents().then(function (res) {
      var items = (res && res.items) || [];
      var max = 0;
      items.forEach(function (i) {
        var m = /(\d+)\s*$/.exec(String(i.id || ''));
        if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
      });
      setPendingId('INC-' + String(max + 1).padStart(2, '0'));
    }).catch(function () { /* keep the INC-01 fallback */ });
  })();

  /* ---------- Theme toggle ---------- */
  /* Page has no Sentinel sidebar (IMS layout owns the header), so we wire
     the in-header theme toggle directly to ui.Theme.toggle(). */
  var themeBtn = $('hdrThemeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = ui.Theme.toggle();
      themeBtn.classList.remove('flip');
      void themeBtn.offsetWidth;
      themeBtn.classList.add('flip');
      themeBtn.setAttribute('aria-label', 'Switch to ' + (next === 'dark' ? 'light' : 'dark') + ' theme');
    });
  }

  /* ---------- Sign out ---------- */
  var signoutLink = $('hdr-signout');
  if (signoutLink) {
    signoutLink.addEventListener('click', function (e) {
      e.preventDefault();
      ui.toast('Signed out — see you soon.', 'info', 1400);
      setTimeout(ui.logout, 350);
    });
  }

  /* ---------- Backend connection indicator ---------- */
  (function checkConnection() {
    var pill = $('ims-connection-pill');
    if (!pill) return;
    pill.dataset.state = 'checking';
    pill.textContent = '● Checking…';
    fetch('/api/stats', { method: 'GET' })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        pill.textContent = '● Connected';
        pill.style.color = 'var(--mint)';
        pill.title = 'Backend reachable';
        pill.dataset.state = 'connected';
      })
      .catch(function () {
        pill.textContent = '● Offline';
        pill.style.color = '#FF6B8B';
        pill.title = 'Cannot reach backend';
        pill.dataset.state = 'offline';
      });
  })();

  /* ---------- Validation alert bar ---------- */
  function showAlert(msg) {
    var bar = $('ims-alert');
    $('ims-alert-msg').textContent = msg;
    bar.classList.add('visible');
  }
  function hideAlert() {
    var bar = $('ims-alert');
    bar.classList.remove('visible');
  }
  var alertClose = $('ims-alert-close');
  if (alertClose) alertClose.addEventListener('click', hideAlert);

  function markError(id) {
    var el = $(id);
    if (!el) return;
    // If the field lives inside a collapsed section, open it so the error is visible.
    var det = el.closest ? el.closest('details') : null;
    if (det && !det.open) det.open = true;
    el.classList.remove('field-error');
    void el.offsetWidth; // restart shake
    el.classList.add('field-error');
  }
  function clearErrors() {
    document.querySelectorAll('.field-error').forEach(function (el) { el.classList.remove('field-error'); });
    hideAlert();
  }

  /* ---------- Saved banner ---------- */
  function showSavedBanner(msg) {
    var bar = $('ims-saved-banner');
    if (msg) $('ims-saved-banner-msg').textContent = msg;
    bar.classList.add('visible');
  }

  /* ---------- Chip helpers (team members) ---------- */
  function readTeamChips(containerId) {
    var chips = document.querySelectorAll('#' + containerId + ' .tag-chip');
    return Array.from(chips).map(function (c) {
      // chip text is "Name <span>×</span>" — text node is the name
      return (c.childNodes[0] && c.childNodes[0].textContent || '').trim();
    });
  }
  function getExistingNames(containerId) {
    return readTeamChips(containerId).map(function (s) { return s.toLowerCase(); });
  }
  function showTeamErr(errId, msg) {
    var el = $(errId);
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
  }
  function clearTeamErr(errId) {
    var el = $(errId);
    if (!el) return;
    el.textContent = '';
    el.classList.remove('visible');
  }
  function addMember(containerId, inputId) {
    var input = $(inputId);
    var container = $(containerId);
    var errId = containerId + '-err';
    if (!input || !container) return;
    var name = input.value.trim();
    clearTeamErr(errId);

    if (!name) {
      showTeamErr(errId, 'Name cannot be empty.');
      input.focus();
      return;
    }
    var existing = getExistingNames(containerId);
    if (existing.indexOf(name.toLowerCase()) !== -1) {
      showTeamErr(errId, '"' + name + '" is already in the list.');
      input.focus();
      return;
    }

    var chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = escHtml(name) + ' <span class="chip-remove" aria-label="Remove">&#x2715;</span>';
    container.appendChild(chip);
    input.value = '';
    input.focus();
  }

  // Wire chip-remove globally (works for chips added later too)
  document.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('chip-remove')) {
      e.target.closest('.tag-chip').remove();
    }
  });
  // Wire Add buttons
  document.querySelectorAll('.btn-add-member').forEach(function (btn) {
    btn.addEventListener('click', function () { addMember(btn.dataset.target, btn.dataset.input); });
  });
  // Enter inside team-input adds
  document.querySelectorAll('.team-input').forEach(function (inp) {
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var btn = inp.closest('.team-add-row').querySelector('.btn-add-member');
        if (btn) btn.click();
      }
    });
    inp.addEventListener('input', function () {
      var containerId = inp.closest('.team-add-row').dataset.target;
      clearTeamErr(containerId + '-err');
    });
  });

  /* ---------- Header "Add Tag" link → quick prompt that adds an
                informal tag to the incident-team list as a stand-in.
                Tags proper become editable on the incident-detail page. */
  var addTagLink = $('meta-link-add-tag');
  if (addTagLink) {
    addTagLink.addEventListener('click', function (e) {
      e.preventDefault();
      var name = (window.prompt('Add tag') || '').trim();
      if (!name) return;
      // For now, route tags through the form-level tag store; on save we
      // pass them through to the backend's `tags` array.
      _ephemeralTags.push(name);
      ui.toast('Tag added: ' + name, 'success', 1600);
    });
  }
  var _ephemeralTags = [];

  /* ---------- Comments link (no comments until incident exists) ---------- */
  var commentsLink = $('meta-link-comments');
  if (commentsLink) {
    commentsLink.addEventListener('click', function (e) {
      e.preventDefault();
      ui.toast('Comments are available once the incident is saved.', 'info', 2200);
    });
  }

  /* ---------- Header toolbar buttons ---------- */
  $('btn-follow')?.addEventListener('click', function () {
    var b = $('btn-follow');
    var on = b.classList.toggle('following');
    b.innerHTML = on ? '<i class="bi bi-bell-fill"></i> Following' : '<i class="bi bi-bell"></i> Follow';
    ui.toast(on ? 'Following this incident.' : 'Unfollowed.', on ? 'success' : 'info', 1600);
  });
  $('btn-settings')?.addEventListener('click', function () {
    ui.toast('Settings are managed from your profile (placeholder).', 'info', 2200);
  });
  $('btn-refresh')?.addEventListener('click', function () { window.location.reload(); });
  $('btn-undo')?.addEventListener('click', function () {
    if (!confirm('Reset all fields? Unsaved changes will be lost.')) return;
    resetForm();
    ui.toast('Form reset.', 'info', 1400);
  });
  $('btn-more')?.addEventListener('click', function () {
    window.location.href = '/dashboard.html';
  });

  /* ---------- Ticket switcher bar ---------- */
  $('btn-new-ticket')?.addEventListener('click', function () {
    if (confirm('Discard current draft and start over?')) {
      resetForm();
      setPendingId(pendingId);
    }
  });
  $('btn-delete-ticket')?.addEventListener('click', function () {
    if (confirm('Discard this draft and return to dashboard?')) {
      window.location.href = '/dashboard.html';
    }
  });

  /* ---------- Metabar refresh + tabs ---------- */
  $('metabar-refresh')?.addEventListener('click', function () {
    var btn = $('metabar-refresh');
    btn.disabled = true;
    btn.style.opacity = '0.6';
    setTimeout(function () { btn.disabled = false; btn.style.opacity = ''; ui.toast('Form refreshed.', 'info', 1400); }, 400);
  });
  // Tab click: only Details has real content on this page.
  // Selector covers both legacy `.metabar-tab` and the new `.wi-tab`.
  document.querySelectorAll('.wi-tab, .metabar-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.wi-tab, .metabar-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      if (tab.id === 'tab-similar') {
        var spinner = $('tab-similar-spinner');
        if (spinner) {
          spinner.style.display = 'inline';
          setTimeout(function () {
            spinner.style.display = 'none';
            ui.toast('Similar work items are surfaced from the dashboard.', 'info', 2400);
            document.querySelectorAll('.wi-tab, .metabar-tab').forEach(function (t) { t.classList.remove('active'); });
            $('tab-details').classList.add('active');
          }, 900);
        }
      }
    });
  });

  /* ---------- Attach file (decorative on the new-incident page) ---------- */
  $('metabar-attach')?.addEventListener('click', function () {
    var fi = $('metabar-file-input');
    if (fi) fi.click();
  });
  $('metabar-file-input')?.addEventListener('change', function (e) {
    var files = Array.from(e.target.files || []);
    if (!files.length) return;
    var strip = $('metabar-files-strip');
    var list = $('metabar-files-list');
    if (list) list.textContent = files.map(function (f) { return f.name + ' (' + (f.size / 1024).toFixed(1) + ' KB)'; }).join(' · ');
    if (strip) strip.classList.add('visible');
    ui.toast('Files will be attached after the incident is saved.', 'info', 2600);
    // store for later attach call
    _pendingFiles = files;
  });
  var _pendingFiles = [];

  /* ---------- "Send Notification" toggle preview + True/False label ---------- */
  var notifToggle = $('send-notification');
  var notifBanner = $('notif-banner');
  var notifLabel  = $('send-notification-label');
  function syncNotifLabel() {
    if (notifLabel) notifLabel.textContent = notifToggle && notifToggle.checked ? 'True' : 'False';
    if (notifBanner) notifBanner.style.display = notifToggle && notifToggle.checked ? 'flex' : 'none';
  }
  if (notifToggle) notifToggle.addEventListener('change', syncNotifLabel);
  syncNotifLabel();

  /* ---------- Set sensible defaults ---------- */
  (function setDefaults() {
    // Default start time = now (local)
    var st = $('start-time');
    if (st && !st.value) {
      var d = new Date();
      var pad = function (n) { return String(n).padStart(2, '0'); };
      st.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
  })();

  /* ---------- Bridge Details: live character counter ---------- */
  (function wireBridgeDetails() {
    var bridgeEl = $('bridge-details');
    var countEl = $('bridge-wordcount');
    if (!bridgeEl) return;
    function refreshCount() {
      if (countEl) countEl.textContent = bridgeEl.value.length;
    }
    bridgeEl.addEventListener('input', refreshCount);
    refreshCount();
  })();

  /* ---------- Reset form ---------- */
  function resetForm() {
    document.querySelectorAll('#ims-body input, #ims-body textarea, #ims-body select').forEach(function (el) {
      if (el.type === 'checkbox') el.checked = false;
      else el.value = '';
    });
    $('incident-team').innerHTML = '';
    $('rca-team').innerHTML = '';
    var title = document.querySelector('.incident-title-text');
    if (title) title.textContent = '';
    if (notifBanner) notifBanner.style.display = 'none';
    _ephemeralTags.length = 0;
    _pendingFiles = [];
    var strip = $('metabar-files-strip');
    if (strip) strip.classList.remove('visible');
    clearErrors();
  }

  /* ---------- Collect form data into backend-shaped payload ---------- */
  function collectFormData() {
    var titleEl = document.querySelector('.incident-title-text');
    var title = titleEl ? titleEl.textContent.trim() : '';

    // The select values are already canonical severity codes (P1, P2, P2-Low, P3).
    var sev = val('sev-select');

    function isoOrEmpty(dtLocal) {
      if (!dtLocal) return '';
      // datetime-local is "YYYY-MM-DDTHH:mm"; treat as local time → ISO
      var d = new Date(dtLocal);
      return isNaN(d) ? '' : d.toISOString();
    }

    return {
      // Top-level
      title: title,
      severity: sev,
      state: $('meta-state-value') ? $('meta-state-value').textContent.trim() : 'Live',
      reason: $('meta-reason-value') ? $('meta-reason-value').textContent.trim() : 'New',
      area: $('meta-area-value') ? $('meta-area-value').textContent.trim() : 'Engineering\\Platform',
      iteration: $('meta-iteration-value') ? $('meta-iteration-value').textContent.trim() : 'Engineering\\2025-Sprints',
      owner: val('eng-select') || (session.displayName || 'EMS Operator'),
      outageType: val('outage-type'),

      affectedServices: lines(val('affected-services')),
      incidentDescription: val('incident-desc'),
      bridgeDetails: val('bridge-details'),
      stepsToResolve: lines(val('steps-resolve')),
      nextSteps: val('next-steps'),
      rootCauseAnalysis: val('rca-text'),
      businessImpact: val('business-impact'),
      learnings: val('learnings'),
      correctiveActionPlan: val('corrective-action-plan'),
      outageTimeline: val('outage-timeline'),

      incidentTeam: readTeamChips('incident-team'),
      rcaTeam: readTeamChips('rca-team'),

      emsFields: {
        incidentInitiation: val('inc-initiation'),
        monitoringDetectedEvents: val('monitoring-events'),
        originatingRootCause: val('root-cause'),
        changeId: val('change-id'),
        incidentDetectedTime: isoOrEmpty(val('detected-time')),
        durationRootCause: val('duration'),
        revenueImpact: val('revenue-impact'),
      },

      incidentDetails: {
        incidentStart: isoOrEmpty(val('start-time')),
        incidentEnd: isoOrEmpty(val('end-time')),
        // Right-column "Revenue Impact" has its own input distinct from the
        // EMS-facing "Fareportal Revenue Impact" in the middle column.
        revenueImpact: val('revenue-impact-details') || val('revenue-impact'),
        functionImpacted: val('func-impacted'),
        locationImpacted: val('location'),
        techAreaImpacted: val('tech-area'),
        quickRemarks: val('quick-remarks'),
        quickRemarks2: val('quick-remarks-2'),
        rcaCompletedDate: val('rca-completed-date'),
      },

      approvals: { cio: chk('cio-approval') },
      sendNotifications: chk('send-notification'),
      tags: _ephemeralTags.slice(),
      updatedBy: session.displayName || 'EMS Operator',
    };
  }

  /* ---------- Validation ---------- */
  function validate(data) {
    var errors = [];

    if (!data.title) {
      errors.push('Incident title is required.');
      var titleEl = document.querySelector('.incident-title-text');
      if (titleEl) {
        titleEl.classList.remove('field-error');
        void titleEl.offsetWidth;
        titleEl.classList.add('field-error');
        titleEl.focus();
      }
    }
    if (!data.severity || ['P1','P2','P2-Low','P3'].indexOf(data.severity) === -1) {
      errors.push('Severity is required.');
      markError('sev-select');
    }
    if (!data.incidentDetails.incidentStart) {
      errors.push('Start Time is required.');
      markError('start-time');
    }
    // End time, if provided, must be after start time
    if (data.incidentDetails.incidentEnd && data.incidentDetails.incidentStart) {
      var a = new Date(data.incidentDetails.incidentStart);
      var b = new Date(data.incidentDetails.incidentEnd);
      if (b < a) {
        errors.push('End Time must be after Start Time.');
        markError('end-time');
      }
    }

    // Bridge Details: required · links only.
    if (!data.bridgeDetails) {
      errors.push('Bridge Details is required.');
      markError('bridge-details');
    } else {
      if (!wordTokens(data.bridgeDetails).every(isLink)) {
        errors.push('Bridge Details accepts links only — remove anything that is not a URL.');
        markError('bridge-details');
      }
    }

    // Other mandatory fields.
    if (!data.outageType) {
      errors.push('Outage Type is required.');
      markError('outage-type');
    }
    if (!data.incidentDescription) {
      errors.push('Incident Description is required.');
      markError('incident-desc');
    }
    if (!data.affectedServices.length) {
      errors.push('Affected Services is required.');
      markError('affected-services');
    }
    if (!data.stepsToResolve.length) {
      errors.push('Steps to Resolve is required.');
      markError('steps-resolve');
    }

    return errors;
  }

  /* ---------- Save handler ---------- */
  var saveBtn = $('btn-save-close');
  var saveLabel = $('btn-save-close-label');

  async function handleSave() {
    clearErrors();
    var data = collectFormData();
    var errors = validate(data);
    if (errors.length) {
      showAlert(errors.join('  ·  '));
      return;
    }

    saveBtn.disabled = true;
    if (saveLabel) saveLabel.textContent = 'Saving…';

    try {
      var res = await api.createIncident(data);
      if (!res || !res.ok || !res.item) {
        throw new Error(res && res.message ? res.message : 'Server did not return the new incident');
      }

      // Optional: upload attached files now that we have an ID
      if (_pendingFiles && _pendingFiles.length) {
        try { await api.uploadAttachments(res.item.id, _pendingFiles); }
        catch (e) { /* non-fatal — surface a toast but don't block redirect */
          ui.toast('Saved, but file upload failed: ' + (e.message || 'error'), 'error', 3200);
        }
      }

      // Optional: post the draft discussion comment now that we have an ID.
      var discussionBody = (val('discussion-comment') || '').trim();
      if (discussionBody) {
        try {
          await api.addComment(res.item.id, {
            author: session.displayName || 'EMS Operator',
            body: discussionBody
          });
        } catch (e) {
          ui.toast('Saved, but comment post failed: ' + (e.message || 'error'), 'error', 3200);
        }
      }

      showSavedBanner('Incident #' + res.item.id + ' created.');
      if (saveLabel) saveLabel.textContent = 'Saved';
      setTimeout(function () {
        window.location.href = '/incident.html?id=' + encodeURIComponent(res.item.id);
      }, 900);
    } catch (err) {
      saveBtn.disabled = false;
      if (saveLabel) saveLabel.textContent = 'Save and Close';
      showAlert('Could not save: ' + (err.message || 'unknown error'));
    }
  }

  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  // Cmd / Ctrl + S to save
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSave();
    }
  });

  /* ---------- Live-clear errors as the user edits ---------- */
  ['incident-desc', 'sev-select', 'start-time', 'end-time', 'affected-services', 'bridge-details', 'outage-type', 'steps-resolve']
    .forEach(function (id) {
      var el = $(id);
      if (!el) return;
      ['input', 'change'].forEach(function (ev) {
        el.addEventListener(ev, function () { el.classList.remove('field-error'); hideAlert(); });
      });
    });
  // Title (contenteditable)
  var titleEditable = document.querySelector('.incident-title-text');
  if (titleEditable) {
    titleEditable.addEventListener('input', function () { titleEditable.classList.remove('field-error'); hideAlert(); });
  }

  /* ---------- Warn on unload if any field has been edited ---------- */
  var _dirty = false;
  document.querySelectorAll('#ims-body input, #ims-body textarea, #ims-body select').forEach(function (el) {
    el.addEventListener('input', function () { _dirty = true; });
    el.addEventListener('change', function () { _dirty = true; });
  });
  if (titleEditable) titleEditable.addEventListener('input', function () { _dirty = true; });
  window.addEventListener('beforeunload', function (e) {
    if (_dirty && !_saving) { e.preventDefault(); e.returnValue = ''; }
  });
  var _saving = false;
  if (saveBtn) saveBtn.addEventListener('click', function () { _saving = true; });

})();
