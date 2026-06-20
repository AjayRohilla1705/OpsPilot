/* Dashboard logic — KPIs, charts (vanilla SVG), table, filters, activity. */
(function () {
  if (!ui.requireAuthOrRedirect()) return;
  ui.mountSidebar('dashboard');
  ui.mountThemeToggle();

  document.getElementById('now-line').textContent =
    new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Search keyboard shortcut
  const searchInput = document.getElementById('searchInput');
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault(); searchInput.focus();
    }
  });

  let allIncidents = [];
  let stats = null;
  let filters = { state: '', severity: '', q: '' };

  async function loadAll() {
    try {
      const [listRes, statRes] = await Promise.all([
        api.listIncidents({ sort: 'updatedAt', dir: 'desc' }),
        api.stats()
      ]);
      allIncidents = listRes.items || [];
      stats = statRes;
      renderKPI();
      renderTrend();
      renderSeverityBreakdown();
      renderTable();
      renderActivity();

      // Refresh spotlight target list (newly-rendered cards)
      window.motion?.refreshSpotlightEls();
    } catch (err) {
      ui.toast('Failed to load dashboard: ' + (err.message || 'error'), 'error');
    }
  }

  function renderKPI() {
    if (!stats) return;
    const { total, open, live, inRca, resolved } = stats.totals;
    const mttr = stats.mttrMinutes;
    const trendLastWeek = stats.trend.at(-1)?.count || 0;
    const grid = document.getElementById('kpiGrid');
    grid.innerHTML = `
      <div class="kpi spotlight hoverable" style="--spot-size: 340px;">
        <div class="label"><span class="icon-chip"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span> Total tracked</div>
        <div class="value gradient tabular" data-count="${total}">0</div>
        <div class="delta"><span style="color: var(--mint);">+${trendLastWeek}</span> this week</div>
        ${miniSpark()}
      </div>
      <div class="kpi spotlight hoverable ${live ? 'pulse-ring live' : ''}" style="--spot-color: rgba(255,90,95,0.25); --spot-size: 340px;">
        <div class="label"><span class="icon-chip" style="background: rgba(255,90,95,0.08); color: #FF8A8E; border-color: rgba(255,90,95,0.22);"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span> Live now</div>
        <div class="value gradient tabular" data-count="${live}">0</div>
        <div class="delta">${live ? 'War-room engaged' : 'No active bridges'}</div>
      </div>
      <div class="kpi spotlight hoverable" style="--spot-color: rgba(255,181,71,0.22); --spot-size: 340px;">
        <div class="label"><span class="icon-chip" style="background: rgba(255,181,71,0.08); color: #FFB547; border-color: rgba(255,181,71,0.22);"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span> In RCA / Submitted</div>
        <div class="value gradient tabular" data-count="${inRca}">0</div>
        <div class="delta">RCA pipeline</div>
      </div>
      <div class="kpi spotlight hoverable" style="--spot-color: rgba(91,208,255,0.22); --spot-size: 340px;">
        <div class="label"><span class="icon-chip" style="background: rgba(91,208,255,0.08); color: #5BD0FF; border-color: rgba(91,208,255,0.22);"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></span> Mean Time to Resolve</div>
        <div class="value gradient tabular" id="mttrValue">—</div>
        <div class="delta">${resolved} resolved · ${open} open</div>
      </div>
    `;

    // count-up the headline numbers
    document.querySelectorAll('.kpi .value[data-count]').forEach((el) => {
      const to = parseFloat(el.dataset.count);
      window.motion?.countUp(el, to, { duration: 1200 });
    });

    // MTTR uses a different format
    const mttrEl = document.getElementById('mttrValue');
    if (mttrEl) {
      const target = mttr || 0;
      if (!target) { mttrEl.textContent = '—'; }
      else {
        const start = performance.now();
        const dur = 1300;
        function frame(now) {
          const t = Math.min(1, (now - start) / dur);
          const v = target * (1 - Math.pow(1 - t, 3));
          mttrEl.textContent = formatMins(Math.round(v));
          if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }
    }

    // refresh spotlight targets for the new KPI cards
    window.motion?.refreshSpotlightEls();

    if (window.gsap && !window.motion?.reduced) {
      gsap.from('.kpi.spotlight', { y: 14, opacity: 0, duration: 0.65, stagger: 0.07, ease: 'power3.out' });
    }
  }

  function formatMins(m) {
    if (!m) return '—';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  function miniSpark() {
    const trend = stats?.trend || [];
    if (!trend.length) return '';
    const max = Math.max(1, ...trend.map(t => t.count));
    const w = 200, h = 36, pad = 2;
    const step = (w - pad * 2) / Math.max(1, trend.length - 1);
    const points = trend.map((t, i) => {
      const x = pad + i * step;
      const y = h - pad - (t.count / max) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `
      <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="sp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#FF7A47" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#FF7A47" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polyline points="${points}" fill="none" stroke="#FF7A47" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <polygon points="${points} ${w-pad},${h-pad} ${pad},${h-pad}" fill="url(#sp)"/>
      </svg>
    `;
  }

  /**
   * Stacked-bar chart with severity breakdown + resolved overlay line.
   * Y-axis: integer count ticks. X-axis: week-start labels.
   * Hover: vertical crosshair + tooltip with per-severity counts.
   */
  function renderTrend() {
    const trend = stats?.trend || [];
    const total = trend.reduce((s, t) => s + t.count, 0);
    const totalResolved = trend.reduce((s, t) => s + (t.resolved || 0), 0);
    document.getElementById('trendTotal').textContent = `${total} created · ${totalResolved} resolved · 12 wks`;

    // Stat strip — peak week, weekly average, active weeks
    const peak = trend.reduce((m, t) => (t.count > m.count ? t : m), { count: -1 });
    const avg = trend.length ? (total / trend.length) : 0;
    const activeWeeks = trend.filter((t) => t.count > 0).length;
    const stripEl = document.getElementById('trendStrip');
    if (stripEl) {
      stripEl.innerHTML = `
        <div class="trend-stat"><span class="ts-label">Peak</span><span class="ts-val">${peak.count > 0 ? `${peak.count} · ${ui.escapeHtml(peak.label)}` : '—'}</span></div>
        <div class="trend-stat"><span class="ts-label">Avg / wk</span><span class="ts-val">${avg.toFixed(1)}</span></div>
        <div class="trend-stat"><span class="ts-label">Active weeks</span><span class="ts-val">${activeWeeks} / ${trend.length}</span></div>
        <div class="trend-stat"><span class="ts-label">Resolved</span><span class="ts-val">${totalResolved}</span></div>
      `;
    }

    // Geometry — coordinates in SVG viewBox units, scaled by preserveAspectRatio
    const w = 760, h = 240;
    const padL = 38, padR = 14, padT = 18, padB = 38;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const n = trend.length;
    const slotW = innerW / Math.max(1, n);
    const barW = Math.min(28, slotW * 0.62);

    // Y-axis scale: include max(created stack, resolved line) so neither clips
    const rawMax = Math.max(
      1,
      ...trend.map((t) => t.count),
      ...trend.map((t) => t.resolved || 0)
    );
    // Round max up to a nice integer tick (1, 2, 3, 5, 10, ...)
    const niceMax = niceCeil(rawMax);
    const ticks = ticksFor(niceMax);
    const yOf = (v) => padT + innerH - (v / niceMax) * innerH;
    const xOf = (i) => padL + slotW * i + slotW / 2;

    // ---- Gridlines + Y labels ----
    const gridHtml = ticks.map((v) => {
      const y = yOf(v);
      return `
        <line x1="${padL}" x2="${w - padR}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="${v === 0 ? '0' : '2 4'}"/>
        <text x="${padL - 8}" y="${y + 3}" text-anchor="end" class="t-axis">${v}</text>
      `;
    }).join('');

    // ---- X-axis labels (show every Nth to avoid crowding on narrow widths) ----
    const everyN = n > 8 ? 2 : 1;
    const xLabels = trend.map((t, i) => {
      if (i % everyN !== 0 && i !== n - 1) return '';
      return `<text x="${xOf(i)}" y="${h - 14}" text-anchor="middle" class="t-axis">${ui.escapeHtml(t.label || '')}</text>`;
    }).join('');

    // ---- Stacked bars (P3 bottom → P1 top so the most severe is on top) ----
    const severityOrder = ['P3', 'P2-Low', 'P2', 'P1'];
    const bars = trend.map((t, i) => {
      const cx = xOf(i);
      let cursor = padT + innerH;
      const parts = severityOrder.map((sev) => {
        const v = (t.bySeverity && t.bySeverity[sev]) || 0;
        if (!v) return '';
        const segH = (v / niceMax) * innerH;
        cursor -= segH;
        return `<rect class="t-bar t-bar-${sev.toLowerCase()}"
          x="${cx - barW / 2}" y="${cursor}" width="${barW}" height="${segH}"
          rx="3" style="--bar-delay: ${i * 35}ms;"></rect>`;
      }).join('');
      return parts;
    }).join('');

    // ---- Resolved overlay line ----
    const resPts = trend.map((t, i) => ({ x: xOf(i), y: yOf(t.resolved || 0), v: t.resolved || 0 }));
    const resPath = pointsToSmoothPath(resPts);
    const resDots = resPts.map((p) =>
      p.v > 0 ? `<circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--mint)" stroke="var(--bg-1)" stroke-width="1.5"/>` : ''
    ).join('');

    // ---- Hover hot-zones + crosshair (one transparent rect per week) ----
    const hotZones = trend.map((t, i) => {
      const cx = xOf(i);
      const total = t.count;
      const breakdown = severityOrder.map((sev) => {
        const v = (t.bySeverity && t.bySeverity[sev]) || 0;
        return v ? `<div class="tt-row"><span class="tt-sev tt-sev-${sev.toLowerCase()}"></span><span>${sev}</span><span class="tt-val">${v}</span></div>` : '';
      }).join('');
      const tooltip = `
        <div class="tt-head">Week of <strong>${ui.escapeHtml(t.label || '')}</strong></div>
        <div class="tt-total">${total} created${t.resolved ? ` · ${t.resolved} resolved` : ''}</div>
        ${total ? `<div class="tt-list">${breakdown}</div>` : '<div class="tt-empty">No incidents this week.</div>'}
      `;
      return `<rect class="t-hot" data-i="${i}" data-tt="${encodeURIComponent(tooltip)}"
        x="${padL + slotW * i}" y="${padT}" width="${slotW}" height="${innerH}" fill="transparent"></rect>`;
    }).join('');

    // ---- Compose SVG ----
    const chart = document.getElementById('trendChart');
    chart.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label="12-week incident trend chart">
        <defs>
          <linearGradient id="bar-p1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF8A8E"/><stop offset="100%" stop-color="#FF5A5F"/></linearGradient>
          <linearGradient id="bar-p2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFCE6B"/><stop offset="100%" stop-color="#FF9D45"/></linearGradient>
          <linearGradient id="bar-p2-low" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFE08A"/><stop offset="100%" stop-color="#E5C46B"/></linearGradient>
          <linearGradient id="bar-p3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7AC7FF"/><stop offset="100%" stop-color="#0078D4"/></linearGradient>
          <linearGradient id="bar-p4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7AC7FF"/><stop offset="100%" stop-color="#0078D4"/></linearGradient>
        </defs>
        ${gridHtml}
        ${bars}
        <path d="${resPath}" fill="none" stroke="var(--mint)" stroke-width="1.6" stroke-dasharray="4 4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
        ${resDots}
        ${xLabels}
        <line id="trendCrosshair" x1="0" x2="0" y1="${padT}" y2="${padT + innerH}" stroke="rgba(255,255,255,0.18)" stroke-width="1" opacity="0"/>
        ${hotZones}
      </svg>
      <div id="trendTooltip" class="t-tooltip" role="tooltip" aria-hidden="true"></div>
    `;

    // Animate bars in (CSS handles the grow-up, we just trigger by toggling class)
    requestAnimationFrame(() => {
      chart.querySelectorAll('.t-bar').forEach((b) => b.classList.add('in'));
    });

    // Hover behavior
    const tooltip = chart.querySelector('#trendTooltip');
    const crosshair = chart.querySelector('#trendCrosshair');
    chart.querySelectorAll('.t-hot').forEach((zone) => {
      zone.addEventListener('mouseenter', (e) => {
        const i = parseInt(zone.dataset.i, 10);
        const cx = xOf(i);
        crosshair.setAttribute('x1', cx);
        crosshair.setAttribute('x2', cx);
        crosshair.setAttribute('opacity', '1');
        tooltip.innerHTML = decodeURIComponent(zone.dataset.tt);
        tooltip.classList.add('show');
      });
      zone.addEventListener('mousemove', (e) => {
        const rect = chart.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Keep tooltip on screen — flip to the left if we're past 70% width
        const ttW = tooltip.offsetWidth || 180;
        const ttX = (x + ttW + 14 < rect.width) ? x + 14 : x - ttW - 14;
        tooltip.style.left = `${Math.max(0, ttX)}px`;
        tooltip.style.top  = `${Math.max(0, y - 8)}px`;
      });
      zone.addEventListener('mouseleave', () => {
        crosshair.setAttribute('opacity', '0');
        tooltip.classList.remove('show');
      });
    });
  }

  /** Round up to a "nice" axis ceiling — keeps the y-scale legible. */
  function niceCeil(n) {
    if (n <= 1) return 1;
    if (n <= 2) return 2;
    if (n <= 3) return 3;
    if (n <= 5) return 5;
    if (n <= 10) return 10;
    const mag = Math.pow(10, Math.floor(Math.log10(n)));
    const norm = n / mag;
    if (norm <= 2) return 2 * mag;
    if (norm <= 5) return 5 * mag;
    return 10 * mag;
  }
  /** Generate up to 5 integer ticks between 0 and max, inclusive. */
  function ticksFor(max) {
    if (max <= 5) return Array.from({ length: max + 1 }, (_, i) => i);
    const stepCandidates = [1, 2, 5, 10, 20, 25, 50, 100];
    const step = stepCandidates.find((s) => max / s <= 5) || Math.ceil(max / 5);
    const out = [];
    for (let v = 0; v <= max; v += step) out.push(v);
    return out;
  }

  // Smooth path through points using simple cubic Bezier with mid-points
  function pointsToSmoothPath(pts) {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x},${p2.y}`;
    }
    return d;
  }

  function renderSeverityBreakdown() {
    const counts = stats?.bySeverity || {};
    const order = ['P1', 'P2', 'P2-Low', 'P3'];
    const total = order.reduce((s, k) => s + (counts[k] || 0), 0);
    document.getElementById('severityTotal').textContent = `${total} total`;
    const html = order.map(k => {
      const v = counts[k] || 0;
      const pct = total ? Math.round((v / total) * 100) : 0;
      return `
        <div class="sev-row">
          <div>${ui.severityChip(k)}</div>
          <div class="sev-track"><div class="sev-fill" data-pct="${pct}" style="background: var(--${k.toLowerCase()});"></div></div>
          <div class="mono dim tabular" style="text-align:right;" data-count="${v}">0</div>
        </div>
      `;
    }).join('');
    document.getElementById('severityRows').innerHTML = html;
    // animate counts
    document.querySelectorAll('#severityRows [data-count]').forEach((el) => {
      window.motion?.countUp(el, parseFloat(el.dataset.count), { duration: 900 });
    });
    // animate fills (delayed so the bar reveal is visible)
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('#severityRows .sev-fill').forEach(el => { el.style.width = el.dataset.pct + '%'; });
      }, 200);
    });
  }

  function applyFilters() {
    let list = allIncidents.slice();
    if (filters.state) list = list.filter(i => i.state === filters.state);
    if (filters.severity) list = list.filter(i => i.severity === filters.severity);
    if (filters.q) {
      const q = filters.q.toLowerCase();
      list = list.filter(i => [i.id, i.title, i.owner, i.area, ...(i.tags || []), ...(i.affectedServices || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    return list;
  }

  function renderTable() {
    const list = applyFilters();
    const tbody = document.getElementById('incidentsBody');
    if (!list.length) {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="empty">
            <div class="iconring"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
            <div style="font-family: var(--font-display); font-size: 1.25rem; color: var(--text);">Nothing matches that filter.</div>
            <div class="dim" style="margin-top:0.25rem;">Try a different state or severity, or clear the search.</div>
          </div>
        </td></tr>
      `;
      return;
    }
    tbody.innerHTML = list.map(i => `
      <tr data-id="${ui.escapeHtml(i.id)}" tabindex="0">
        <td class="id-cell">#${ui.escapeHtml(i.id)}</td>
        <td>
          <div class="title-cell">${ui.escapeHtml(i.title)}</div>
          <div class="sub">${(i.affectedServices || []).map(ui.escapeHtml).join(' · ') || '—'}</div>
        </td>
        <td>${ui.severityChip(i.severity)}</td>
        <td>${ui.stateChip(i.state)}</td>
        <td><div class="row gap-2"><div class="avatar" style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#3B3F55,#1E2030);display:grid;place-items:center;font-family:var(--font-mono);font-size:0.62rem;border:1px solid var(--border-strong);">${ui.escapeHtml(initials(i.owner))}</div><span>${ui.escapeHtml(i.owner || 'Unassigned')}</span></div></td>
        <td class="mono dim">${ui.fmtRelative(i.updatedAt)}</td>
      </tr>
    `).join('');

    // Staggered row reveal
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((tr, i) => {
      setTimeout(() => tr.classList.add('row-in'), 40 + i * 38);
      tr.addEventListener('click', () => navigateToIncident(tr.dataset.id));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigateToIncident(tr.dataset.id); });
    });
  }

  function navigateToIncident(id) {
    // Direct navigation — fading the body before navigating left it at
    // opacity 0 inside the browser's back-forward cache, so pressing
    // BACK from the detail page showed a black screen until the next
    // interaction. The new page already does its own entrance animation,
    // so direct navigation feels snappier AND fixes the back-button bug.
    window.location.href = `/incident.html?id=${id}`;
  }

  function initials(name) {
    if (!name) return '—';
    return name.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  }

  function renderActivity() {
    const list = stats?.activity || [];
    const el = document.getElementById('activityList');
    if (!list.length) {
      el.innerHTML = `<div class="dim">No activity yet. Create or update an incident to see history here.</div>`;
      return;
    }
    el.innerHTML = list.slice(0, 12).map(a => `
      <div class="ev">
        <div class="ts">${ui.fmtRelative(a.ts)} · <span class="muted">${ui.escapeHtml(a.by || 'system')}</span></div>
        <div class="ev-body">
          ${labelFor(a)} <a href="/incident.html?id=${ui.escapeHtml(a.incidentId)}" style="color: var(--text); text-decoration: none; border-bottom: 1px dashed var(--border-strong);">#${ui.escapeHtml(a.incidentId)} · ${ui.escapeHtml(a.title)}</a>
        </div>
      </div>
    `).join('');
  }

  function labelFor(a) {
    if (a.kind === 'created') return '<span style="color: var(--mint);">created</span>';
    if (a.kind === 'deleted') return '<span style="color: var(--rose);">deleted</span>';
    if (a.kind === 'commented') return '<span style="color: var(--cyan);">commented on</span>';
    if (a.kind === 'state-changed') return `<span style="color: var(--ember);">${ui.escapeHtml(a.from || '?')} → ${ui.escapeHtml(a.to || '?')}</span>`;
    return '<span style="color: var(--text-muted);">updated</span>';
  }

  // ----- Filter handling with smooth re-render -----
  document.getElementById('filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-pill');
    if (!btn) return;
    const f = btn.dataset.filter;
    const v = btn.dataset.value;
    document.querySelectorAll(`.filter-pill[data-filter="${f}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filters[f] = v;
    fadeRerenderTable();
  });

  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = e.target.value.trim();
      fadeRerenderTable();
    }, 120);
  });

  function fadeRerenderTable() {
    const wrap = document.querySelector('.table-wrap');
    if (window.motion?.reduced) { renderTable(); return; }
    wrap.animate([{ opacity: 1 }, { opacity: 0.4 }], { duration: 140, fill: 'forwards', easing: 'ease-out' });
    setTimeout(() => {
      renderTable();
      wrap.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 260, fill: 'forwards', easing: 'ease-out' });
    }, 130);
  }

  // Export
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(allIncidents, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sentinel-incidents-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    ui.toast('Exported ' + allIncidents.length + ' incidents.', 'success');
  });

  loadAll();
})();
