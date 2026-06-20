/* Incident detail / edit view. */
(function () {
  if (!ui.requireAuthOrRedirect()) return;
  ui.mountSidebar('incidents');
  ui.mountThemeToggle();

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) {
    window.location.replace('/dashboard.html');
    return;
  }

  let incident = null;
  let dirty = false;
  let savingTimer = null;

  /**
   * Staged-but-not-persisted edits. These are flushed in `save()` after the
   * main PUT succeeds and discarded on navigation/back. This is what makes
   * "Save changes" actually save and "back" actually discard — without
   * this, file uploads, attachment removals, and comments hit the API the
   * moment the user clicked, so back/forward effectively confirmed the
   * change.
   */
  let pendingUploads = [];          // File[] — to upload on save
  let pendingRemovals = new Set();  // attachment ids — to delete on save
  let pendingComments = [];         // {author, body, _localId} — to post on save

  // ----- Tabs with animated indicator -----
  const tabsEl = document.getElementById('tabs');
  const indicator = document.getElementById('tabIndicator');

  function moveIndicatorTo(btn) {
    if (!btn || !indicator) return;
    const rect = btn.getBoundingClientRect();
    const parentRect = tabsEl.getBoundingClientRect();
    indicator.style.left = `${rect.left - parentRect.left}px`;
    indicator.style.width = `${rect.width}px`;
  }
  // initialize indicator after layout
  requestAnimationFrame(() => moveIndicatorTo(tabsEl.querySelector('.tab.active')));
  window.addEventListener('resize', () => moveIndicatorTo(tabsEl.querySelector('.tab.active')));

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    moveIndicatorTo(btn);
    const pane = btn.dataset.tab;
    document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== pane));
    if (window.gsap && !window.motion?.reduced) {
      gsap.from(`[data-pane="${pane}"] .section`, { y: 10, opacity: 0, duration: 0.45, stagger: 0.05, ease: 'power3.out' });
    }
  });

  // ----- Markdirty + autosave hint -----
  function markDirty() {
    dirty = true;
    const lbl = document.getElementById('saveLabel');
    lbl.textContent = 'Save changes •';
  }

  // ----- Load -----
  async function load() {
    try {
      const res = await api.getIncident(id);
      incident = res.item;
      hydrate();
      if (window.gsap) {
        gsap.from('#incidentHeader', { y: 8, opacity: 0, duration: 0.4, ease: 'power3.out' });
        gsap.from('.section', { y: 10, opacity: 0, duration: 0.45, stagger: 0.05, ease: 'power3.out' });
      }
    } catch (err) {
      ui.toast('Failed to load incident: ' + (err.message || 'error'), 'error');
      setTimeout(() => window.location.replace('/dashboard.html'), 1500);
    }
  }

  // ----- Hydrate the form from the incident -----
  function hydrate() {
    document.getElementById('crumbId').textContent = `#${incident.id}`;
    document.getElementById('incidentId').textContent = `#${incident.id}`;
    document.getElementById('severityChip').innerHTML = ui.severityChip(incident.severity);
    document.getElementById('stateChip').innerHTML = ui.stateChip(incident.state);
    document.getElementById('updatedAt').textContent = `Updated ${ui.fmtRelative(incident.updatedAt)} · by ${incident.updatedBy || '—'}`;
    document.getElementById('incidentTitle').textContent = incident.title;
    document.getElementById('incidentTitle').setAttribute('contenteditable', 'true');
    document.getElementById('incidentTitle').addEventListener('input', markDirty);

    document.getElementById('metaLine').innerHTML = `
      <span>Area · <strong>${ui.escapeHtml(incident.area || '—')}</strong></span>
      <span>Iteration · <strong>${ui.escapeHtml(incident.iteration || '—')}</strong></span>
      <span>Created · <strong>${ui.fmtDateTime(incident.createdAt)}</strong></span>
    `;

    renderServices();
    document.getElementById('incidentDescription').value = incident.incidentDescription || '';
    document.getElementById('bridgeDetails').value = incident.bridgeDetails || '';
    document.getElementById('nextSteps').value = incident.nextSteps || '';
    document.getElementById('rootCauseAnalysis').value = incident.rootCauseAnalysis || '';
    document.getElementById('businessImpact').value = incident.businessImpact || '';
    document.getElementById('learnings').value = incident.learnings || '';
    document.getElementById('correctiveActionPlan').value = incident.correctiveActionPlan || '';
    document.getElementById('outageTimeline').value = incident.outageTimeline || '';

    document.getElementById('stateSelect').value = incident.state;
    document.getElementById('reasonInput').value = incident.reason || '';
    document.getElementById('outageType').value = incident.outageType || 'IT EVENT';
    document.getElementById('severitySelect').value = incident.severity;
    document.getElementById('ownerInput').value = incident.owner || '';
    document.getElementById('areaInput').value = incident.area || '';
    document.getElementById('iterationInput').value = incident.iteration || '';

    const det = incident.incidentDetails || {};
    document.getElementById('incidentStart').value = toLocalDt(det.incidentStart);
    document.getElementById('incidentEnd').value = toLocalDt(det.incidentEnd);
    document.getElementById('revenueImpact').value = det.revenueImpact || '';
    document.getElementById('functionImpacted').value = det.functionImpacted || '';
    document.getElementById('locationImpacted').value = det.locationImpacted || '';
    document.getElementById('techAreaImpacted').value = det.techAreaImpacted || '';
    document.getElementById('rcaCompletedDate').value = det.rcaCompletedDate || '';

    renderSteps();
    renderEmsFields();
    renderEvents();
    renderComments();
    renderAttachments();
    renderTags();
    renderRelated();

    setToggle('notifToggle', !!incident.sendNotifications);
    setToggle('cioToggle', !!(incident.approvals && incident.approvals.cio));

    refreshCounts();

    // wire up "dirty" tracking
    document.querySelectorAll('input, textarea, select').forEach(el => {
      ['input', 'change'].forEach(ev => el.addEventListener(ev, markDirty));
    });
  }

  function toLocalDt(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalDt(v) {
    if (!v) return '';
    return new Date(v).toISOString();
  }

  function setToggle(elId, on) {
    const el = document.getElementById(elId);
    el.classList.toggle('on', !!on);
    el.setAttribute('aria-checked', String(!!on));
  }
  document.getElementById('notifToggle').addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('on');
    markDirty();
  });
  document.getElementById('cioToggle').addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('on');
    markDirty();
  });

  // ----- Affected services -----
  function renderServices() {
    const container = document.getElementById('affectedServicesView');
    const items = (incident.affectedServices || []).map(s => `
      <span class="tag">${ui.escapeHtml(s)} <button data-remove-service="${ui.escapeHtml(s)}" aria-label="Remove">×</button></span>
    `).join('');
    container.innerHTML = `
      <div class="tag-input">
        ${items}
        <input type="text" id="serviceInput" placeholder="Add service…" />
      </div>
    `;
    const input = document.getElementById('serviceInput');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = input.value.trim().replace(/,$/, '');
        if (v) {
          incident.affectedServices = [...(incident.affectedServices || []), v];
          renderServices(); markDirty();
        }
      } else if (e.key === 'Backspace' && !input.value) {
        incident.affectedServices = (incident.affectedServices || []).slice(0, -1);
        renderServices(); markDirty();
      }
    });
    container.querySelectorAll('[data-remove-service]').forEach(b => {
      b.addEventListener('click', () => {
        incident.affectedServices = (incident.affectedServices || []).filter(s => s !== b.dataset.removeService);
        renderServices(); markDirty();
      });
    });
  }

  // ----- Steps to resolve (line editor) -----
  function renderSteps() {
    const root = document.getElementById('stepsEditor');
    const steps = incident.stepsToResolve || [];
    root.innerHTML = steps.map((s, i) => `
      <div class="row gap-2 mb-1" data-step="${i}">
        <div style="margin-top: 0.75rem; font-family: var(--font-mono); color: var(--text-dim); font-size: 0.75rem; width: 22px; text-align: right;">${String(i+1).padStart(2,'0')}</div>
        <input type="text" class="input" value="${ui.escapeHtml(s)}" />
        <button class="btn btn-icon btn-sm" data-remove-step="${i}" aria-label="Remove step">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');
    root.querySelectorAll('[data-step]').forEach(row => {
      const i = parseInt(row.dataset.step, 10);
      const inp = row.querySelector('input');
      inp.addEventListener('input', () => { incident.stepsToResolve[i] = inp.value; markDirty(); });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          incident.stepsToResolve.splice(i+1, 0, '');
          renderSteps();
          // Focus new row
          const next = document.querySelector(`[data-step="${i+1}"] input`);
          if (next) next.focus();
        }
      });
    });
    root.querySelectorAll('[data-remove-step]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.removeStep, 10);
        incident.stepsToResolve.splice(i, 1);
        renderSteps(); markDirty();
      });
    });
  }
  document.getElementById('addStepBtn').addEventListener('click', () => {
    incident.stepsToResolve = incident.stepsToResolve || [];
    incident.stepsToResolve.push('');
    renderSteps(); markDirty();
    const last = document.querySelector(`[data-step="${incident.stepsToResolve.length-1}"] input`);
    if (last) last.focus();
  });

  // ----- EMS fields -----
  function renderEmsFields() {
    const fields = [
      { k: 'incidentInitiation', label: 'Incident Initiation', placeholder: 'How the incident was initiated' },
      { k: 'monitoringDetectedEvents', label: 'Monitoring Detected Events', placeholder: 'Monitoring tools that detected the event' },
      { k: 'originatingRootCause', label: 'Originating Root Cause', placeholder: 'Short, blameless cause statement' },
      { k: 'changeId', label: 'Change ID / Release ID', placeholder: 'Change or release identifier' },
      { k: 'incidentDetectedTime', label: 'Incident Detected Time', placeholder: '' },
      { k: 'durationRootCause', label: 'Duration of Root Cause', placeholder: 'Duration of root cause' },
      { k: 'revenueImpact', label: 'Fareportal Revenue Impact', placeholder: '$ value or "indirect"' }
    ];
    const v = incident.emsFields || {};
    document.getElementById('emsFieldsList').innerHTML = fields.map(f => `
      <div class="kv">
        <div class="k">${ui.escapeHtml(f.label)}</div>
        <div class="v"><input type="text" class="input" data-ems="${f.k}" value="${ui.escapeHtml(v[f.k] || '')}" placeholder="${ui.escapeHtml(f.placeholder)}" /></div>
      </div>
    `).join('');
    document.querySelectorAll('[data-ems]').forEach(el => {
      el.addEventListener('input', () => {
        incident.emsFields = incident.emsFields || {};
        incident.emsFields[el.dataset.ems] = el.value;
        markDirty();
      });
    });
  }

  // ----- EMS events -----
  function renderEvents() {
    const list = document.getElementById('emsEventsList');
    const events = incident.emsEvents || [];
    if (!events.length) {
      list.innerHTML = `<div class="dim">No events captured yet.</div>`;
      return;
    }
    list.innerHTML = events.map((e, i) => `
      <div class="ev">
        <div class="ts">${ui.fmtDateTime(e.ts)}</div>
        <div class="ev-body">${ui.escapeHtml(e.event)} <button class="btn btn-sm btn-ghost" data-remove-ev="${i}" style="margin-left: 0.5rem; padding: 0.2rem 0.4rem;">remove</button></div>
      </div>
    `).join('');
    list.querySelectorAll('[data-remove-ev]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.removeEv, 10);
        incident.emsEvents.splice(i, 1);
        renderEvents(); markDirty();
      });
    });
  }
  document.getElementById('addEventBtn').addEventListener('click', () => {
    const ts = document.getElementById('newEventTs').value;
    const body = document.getElementById('newEventBody').value.trim();
    if (!body) { ui.toast('Add a short event description.', 'error'); return; }
    incident.emsEvents = incident.emsEvents || [];
    incident.emsEvents.push({ ts: ts ? new Date(ts).toISOString() : new Date().toISOString(), event: body });
    document.getElementById('newEventTs').value = '';
    document.getElementById('newEventBody').value = '';
    renderEvents(); markDirty();
  });

  // ----- Comments (with pending staging) -----
  function renderComments() {
    const list = document.getElementById('commentsList');
    const comments = incident.comments || [];
    const pendingHtml = pendingComments.map((c) => `
      <div class="comment pending" data-pending-comment="${ui.escapeHtml(c._localId)}">
        <div class="avatar">${ui.escapeHtml(initials(c.author))}</div>
        <div>
          <div class="head">
            <span class="name">${ui.escapeHtml(c.author)}</span>
            <span class="pending-tag">Pending · save to post</span>
            <button type="button" class="pending-discard" data-discard-comment="${ui.escapeHtml(c._localId)}" title="Discard">×</button>
          </div>
          <div class="body">${ui.escapeHtml(c.body).replace(/\n/g, '<br/>')}</div>
        </div>
      </div>
    `).join('');
    if (!comments.length && !pendingComments.length) {
      list.innerHTML = `<div class="dim" style="padding: 1rem 0;">Be the first to comment.</div>`;
      return;
    }
    const savedHtml = comments.map((c) => `
      <div class="comment">
        <div class="avatar">${ui.escapeHtml(initials(c.author))}</div>
        <div>
          <div class="head"><span class="name">${ui.escapeHtml(c.author)}</span><span class="ts">${ui.fmtRelative(c.ts)}</span></div>
          <div class="body">${ui.escapeHtml(c.body).replace(/\n/g, '<br/>')}</div>
        </div>
      </div>
    `).join('');
    list.innerHTML = pendingHtml + savedHtml;
    list.querySelectorAll('[data-discard-comment]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.discardComment;
        pendingComments = pendingComments.filter((c) => c._localId !== id);
        renderComments();
        refreshCounts();
        if (!hasPendingChanges() && !dirtyFieldsTouched()) maybeClearDirty();
      });
    });
  }

  /** Total saved + pending counts shown in the tab pills. */
  function refreshCounts() {
    const commentTotal = (incident.comments || []).length + pendingComments.length;
    const attachTotal  = (incident.attachments || []).filter((a) => !pendingRemovals.has(a.id)).length + pendingUploads.length;
    document.getElementById('commentCount').textContent = `(${commentTotal})`;
    document.getElementById('attachCount').textContent  = `(${attachTotal})`;
  }
  function hasPendingChanges() {
    return pendingUploads.length > 0 || pendingRemovals.size > 0 || pendingComments.length > 0;
  }
  // Conservative: only the explicit `markDirty()` path tracks form field
  // edits, so we never *clear* the dirty flag from here — but we want the
  // helper available for symmetry.
  function dirtyFieldsTouched() { return dirty; }
  function maybeClearDirty() { /* no-op — Save is the authoritative reset */ }
  function initials(name) {
    if (!name) return 'EM';
    return name.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  }
  document.getElementById('addCommentBtn').addEventListener('click', () => {
    const body = document.getElementById('commentBody').value.trim();
    if (!body) { ui.toast('Write something first.', 'error'); return; }
    const s = ui.Session.get();
    pendingComments.push({
      author: (s && s.displayName) || 'EMS Operator',
      body,
      _localId: 'pc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    });
    document.getElementById('commentBody').value = '';
    renderComments();
    refreshCounts();
    markDirty();
    ui.toast('Comment staged — click Save changes to post.', 'info', 2400);
  });

  // ----- Attachments (with pending staging) -----
  /**
   * The list shows:
   *   1. pendingUploads (File objects) — chips marked "Pending · save to upload"
   *   2. existing attachments — clicking Remove flags them in pendingRemovals
   *      (struck-through, with Undo). Nothing actually persists until save().
   */
  function renderAttachments() {
    const list = document.getElementById('attachmentsList');
    const existing = incident.attachments || [];
    if (!existing.length && !pendingUploads.length) {
      list.innerHTML = `<div class="dim mt-2">No attachments yet.</div>`;
      return;
    }

    const pendingHtml = pendingUploads.map((f, i) => `
      <div class="row attach-row attach-pending-row" data-pending-upload="${i}" style="justify-content: space-between; padding: 0.7rem 0.9rem; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 0.5rem; background: rgba(255,255,255,0.02);">
        <div class="row gap-2" style="min-width:0; flex:1;">
          <div class="attach-icon attach-icon-pending">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div style="min-width:0;">
            <div style="color: var(--text); font-weight: 500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${ui.escapeHtml(f.name)}</div>
            <div class="dim mono" style="font-size: 0.74rem;">${ui.fmtBytes(f.size)} · <span class="pending-tag">Pending · save to upload</span></div>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" data-discard-upload="${i}" title="Discard staged upload">Discard</button>
      </div>
    `).join('');

    const existingHtml = existing.map((a) => {
      const removing = pendingRemovals.has(a.id);
      return `
        <div class="row attach-row${removing ? ' attach-removing' : ''}" data-attach="${ui.escapeHtml(a.id)}" style="justify-content: space-between; padding: 0.7rem 0.9rem; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 0.5rem; background: rgba(255,255,255,0.02);">
          <div class="row gap-2" style="min-width:0; flex:1;">
            <div class="attach-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div style="min-width:0;">
              <a href="${ui.escapeHtml(a.url)}" target="_blank" rel="noopener" class="attach-name">${ui.escapeHtml(a.name)}</a>
              <div class="dim mono" style="font-size: 0.74rem;">
                ${ui.fmtBytes(a.size)} · ${ui.fmtRelative(a.uploadedAt)}
                ${removing ? '<span class="pending-tag pending-tag-rose">Will be removed on save</span>' : ''}
              </div>
            </div>
          </div>
          ${removing
            ? `<button class="btn btn-sm" data-unremove-attach="${ui.escapeHtml(a.id)}">Undo</button>`
            : `<button class="btn btn-sm btn-ghost" data-remove-attach="${ui.escapeHtml(a.id)}">Remove</button>`}
        </div>
      `;
    }).join('');

    list.innerHTML = pendingHtml + existingHtml;

    list.querySelectorAll('[data-discard-upload]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.discardUpload, 10);
        pendingUploads.splice(i, 1);
        renderAttachments();
        refreshCounts();
      });
    });
    list.querySelectorAll('[data-remove-attach]').forEach((b) => {
      b.addEventListener('click', () => {
        pendingRemovals.add(b.dataset.removeAttach);
        renderAttachments();
        refreshCounts();
        markDirty();
      });
    });
    list.querySelectorAll('[data-unremove-attach]').forEach((b) => {
      b.addEventListener('click', () => {
        pendingRemovals.delete(b.dataset.unremoveAttach);
        renderAttachments();
        refreshCounts();
      });
    });
  }
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  ['dragover', 'dragenter'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('over'); }));
  dropzone.addEventListener('drop', (e) => { stageFiles(e.dataTransfer.files); });
  fileInput.addEventListener('change', (e) => { stageFiles(e.target.files); fileInput.value = ''; });
  /**
   * Stage files for upload (do NOT call the API yet). Files are only sent
   * to the backend after the user clicks "Save changes".
   */
  function stageFiles(files) {
    if (!files || !files.length) return;
    const ALLOWED = /\.(png|jpe?g|gif|svg|webp|pdf|txt|log|json|csv|md|docx?|xlsx?)$/i;
    const MAX = 25 * 1024 * 1024;
    let staged = 0, rejected = 0;
    for (const f of files) {
      if (!ALLOWED.test(f.name)) { rejected++; continue; }
      if (f.size > MAX)        { rejected++; continue; }
      pendingUploads.push(f);
      staged++;
    }
    renderAttachments();
    refreshCounts();
    if (staged) {
      markDirty();
      ui.toast(`Staged ${staged} file${staged === 1 ? '' : 's'} — click Save changes to upload.`, 'info', 2600);
    }
    if (rejected) {
      ui.toast(`${rejected} file${rejected === 1 ? '' : 's'} skipped (type or size).`, 'error', 3200);
    }
  }

  // ----- Tags -----
  function renderTags() {
    const wrap = document.getElementById('tagInput');
    const existing = wrap.querySelectorAll('.tag');
    existing.forEach(t => t.remove());
    const tags = incident.tags || [];
    const fragment = document.createDocumentFragment();
    tags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.innerHTML = `${ui.escapeHtml(t)} <button aria-label="Remove">×</button>`;
      span.querySelector('button').addEventListener('click', () => {
        incident.tags = (incident.tags || []).filter(x => x !== t);
        renderTags(); markDirty();
      });
      fragment.appendChild(span);
    });
    wrap.insertBefore(fragment, document.getElementById('tagField'));
  }
  document.getElementById('tagField').addEventListener('keydown', (e) => {
    const inp = e.currentTarget;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = inp.value.trim().replace(/,$/, '');
      if (v) {
        incident.tags = [...(incident.tags || []), v];
        inp.value = '';
        renderTags(); markDirty();
      }
    } else if (e.key === 'Backspace' && !inp.value) {
      incident.tags = (incident.tags || []).slice(0, -1);
      renderTags(); markDirty();
    }
  });

  // ----- Related work -----
  function renderRelated() {
    const list = document.getElementById('relatedList');
    const items = incident.relatedWork || [];
    if (!items.length) {
      list.innerHTML = `<div class="dim" style="font-size:0.85rem;">No related work yet.</div>`;
      return;
    }
    list.innerHTML = items.map((r, i) => `
      <div class="kv">
        <div class="k">${ui.escapeHtml(r.type || 'Linked')}</div>
        <div class="v">
          <div>${r.id ? `<span class="mono dim">#${ui.escapeHtml(r.id)}</span> · ` : ''}${ui.escapeHtml(r.title || '')}</div>
          ${r.state ? `<div class="dim mono" style="font-size:0.74rem;">${ui.escapeHtml(r.state)}</div>` : ''}
        </div>
      </div>
    `).join('');
  }
  document.getElementById('addRelatedBtn').addEventListener('click', () => {
    const title = document.getElementById('relatedTitle').value.trim();
    if (!title) return;
    incident.relatedWork = incident.relatedWork || [];
    incident.relatedWork.push({ type: 'Linked', title });
    document.getElementById('relatedTitle').value = '';
    renderRelated(); markDirty();
  });

  // ----- Save -----
  async function save() {
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    document.getElementById('saveLabel').classList.add('hidden');
    document.getElementById('saveSpinner').classList.remove('hidden');

    const me = ui.Session.get();
    const payload = {
      title: document.getElementById('incidentTitle').textContent.trim(),
      state: document.getElementById('stateSelect').value,
      reason: document.getElementById('reasonInput').value,
      severity: document.getElementById('severitySelect').value,
      outageType: document.getElementById('outageType').value,
      owner: document.getElementById('ownerInput').value,
      area: document.getElementById('areaInput').value,
      iteration: document.getElementById('iterationInput').value,
      affectedServices: incident.affectedServices || [],
      incidentDescription: document.getElementById('incidentDescription').value,
      bridgeDetails: document.getElementById('bridgeDetails').value,
      stepsToResolve: (incident.stepsToResolve || []).filter(s => s && s.trim()),
      nextSteps: document.getElementById('nextSteps').value,
      rootCauseAnalysis: document.getElementById('rootCauseAnalysis').value,
      businessImpact: document.getElementById('businessImpact').value,
      learnings: document.getElementById('learnings').value,
      correctiveActionPlan: document.getElementById('correctiveActionPlan').value,
      outageTimeline: document.getElementById('outageTimeline').value,
      emsFields: incident.emsFields || {},
      incidentDetails: {
        incidentStart: fromLocalDt(document.getElementById('incidentStart').value),
        incidentEnd: fromLocalDt(document.getElementById('incidentEnd').value),
        revenueImpact: document.getElementById('revenueImpact').value,
        functionImpacted: document.getElementById('functionImpacted').value,
        locationImpacted: document.getElementById('locationImpacted').value,
        techAreaImpacted: document.getElementById('techAreaImpacted').value,
        rcaCompletedDate: document.getElementById('rcaCompletedDate').value
      },
      sendNotifications: document.getElementById('notifToggle').classList.contains('on'),
      approvals: { cio: document.getElementById('cioToggle').classList.contains('on') },
      emsEvents: incident.emsEvents || [],
      relatedWork: incident.relatedWork || [],
      tags: incident.tags || [],
      updatedBy: (me && me.displayName) || 'EMS Operator'
    };

    try {
      // 1) Main PUT — must succeed before any side-channel writes.
      await api.updateIncident(incident.id, payload);

      // 2) Flush staged attachment removals (parallel — each is independent).
      const removalIds = [...pendingRemovals];
      if (removalIds.length) {
        await Promise.all(removalIds.map((rid) =>
          api.deleteAttachment(incident.id, rid).catch((e) => {
            // Surface the failure but keep going — we'll refetch fresh state at the end.
            ui.toast(`Couldn't remove attachment: ${e.message}`, 'error', 3600);
            throw e;
          })
        ));
      }

      // 3) Flush staged uploads (single multipart request).
      if (pendingUploads.length) {
        await api.uploadAttachments(incident.id, pendingUploads).catch((e) => {
          ui.toast(`Upload failed: ${e.message}`, 'error', 4200);
          throw e;
        });
      }

      // 4) Flush staged comments (sequential — preserves visible order).
      for (const c of pendingComments) {
        try {
          await api.addComment(incident.id, { author: c.author, body: c.body });
        } catch (e) {
          ui.toast(`Comment post failed: ${e.message}`, 'error', 4200);
          throw e;
        }
      }

      // 5) Re-fetch the authoritative incident state (covers all four flushes).
      const fresh = await api.getIncident(incident.id);
      incident = fresh.item;
      pendingUploads = [];
      pendingRemovals = new Set();
      pendingComments = [];
      hydrate();
      dirty = false;
      ui.toast('Changes saved.', 'success');
      btn.classList.add('saved');
      document.getElementById('saveLabel').textContent = 'Saved';
      setTimeout(() => {
        btn.classList.remove('saved');
        document.getElementById('saveLabel').textContent = 'Save changes';
      }, 1400);
    } catch (err) {
      // PUT succeeded but a follow-up failed → we leave pending arrays in
      // place so the user can retry. If PUT itself failed, same outcome.
      if (!String(err && err.message || '').match(/attachment|upload|comment/i)) {
        ui.toast(err.message || 'Save failed', 'error');
      }
    } finally {
      btn.disabled = false;
      document.getElementById('saveLabel').classList.remove('hidden');
      document.getElementById('saveSpinner').classList.add('hidden');
    }
  }
  document.getElementById('saveBtn').addEventListener('click', save);

  // Cmd/Ctrl + S
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); save();
    }
  });

  // ----- Delete -----
  const modal = document.getElementById('confirmModal');
  document.getElementById('deleteBtn').addEventListener('click', () => {
    document.getElementById('modalId').textContent = `#${incident.id}`;
    modal.classList.remove('hidden');
  });
  document.getElementById('cancelDelete').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('confirmDelete').addEventListener('click', async () => {
    try {
      await api.deleteIncident(incident.id);
      ui.toast('Incident deleted.', 'info');
      setTimeout(() => window.location.replace('/dashboard.html'), 600);
    } catch (err) { ui.toast(err.message || 'Failed to delete', 'error'); }
  });

  // ----- Print -----
  document.getElementById('printBtn').addEventListener('click', () => window.print());

  // Warn on unload if anything is unsaved (form fields OR staged attachments/comments).
  window.addEventListener('beforeunload', (e) => {
    if (dirty || hasPendingChanges()) { e.preventDefault(); e.returnValue = ''; }
  });

  load();
})();
