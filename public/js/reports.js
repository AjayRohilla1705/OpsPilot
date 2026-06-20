/* Reports page: pulls /api/reports and renders KPIs, distribution bars,
 * monthly buckets, top owners, and a "recent activity" table. Export
 * buttons download the report payload as JSON or a flattened CSV.
 */
(function () {
  if (!ui.requireAuthOrRedirect()) return;
  ui.mountSidebar('reports');
  ui.mountThemeToggle();

  const $ = (id) => document.getElementById(id);
  const refs = {
    kTotal:  $('kTotal'),  kOpen:   $('kOpen'),
    kClosed: $('kClosed'), kMttr:   $('kMttr'),
    sevBars: $('sevBars'), stateBars: $('stateBars'),
    monthly: $('monthly'), owners:    $('owners'),
    recent:  $('recentBody'), meta:   $('repMeta'),
    exportJson: $('exportJsonBtn'),
    exportCsv:  $('exportCsvBtn')
  };

  let report = null;

  function fmtHours(h) {
    if (h == null) return '—';
    if (h < 1) return Math.round(h * 60) + 'm';
    if (h < 10) return h.toFixed(1) + 'h';
    return Math.round(h) + 'h';
  }

  function bar(label, count, max, accentClass) {
    const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
    return `
      <div class="sev-bar-row">
        <div class="sev-bar-label">${ui.escapeHtml(label)}</div>
        <div class="sev-bar-track"><div class="sev-bar-fill ${accentClass}" style="width:0;" data-pct="${pct}"></div></div>
        <div class="sev-bar-count tabular">${count}</div>
      </div>`;
  }

  function paintSeverity() {
    const sev = report.totals.bySeverity || {};
    const max = Math.max(1, ...Object.values(sev));
    const accentByKey = { 'P1': 'fill-p1', 'P2': 'fill-p2', 'P2-Low': 'fill-p2-low', 'P3': 'fill-p3' };
    refs.sevBars.innerHTML = ['P1','P2','P2-Low','P3']
      .map((k) => bar(k, sev[k] || 0, max, accentByKey[k]))
      .join('');
  }

  function paintState() {
    const by = report.totals.byState || {};
    const entries = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([,v]) => v));
    refs.stateBars.innerHTML = entries.map(([k, v]) => bar(k, v, max, 'fill-ember')).join('')
      || '<p class="dim">No incidents yet.</p>';
  }

  function paintMonthly() {
    const months = report.monthly || [];
    const max = Math.max(1, ...months.map((m) => m.count));
    refs.monthly.innerHTML = months.map((m) => `
      <div class="rep-month">
        <div class="rep-month-bar"><div class="rep-month-fill" style="height:0;" data-h="${Math.max(4, Math.round((m.count / max) * 100))}"></div></div>
        <div class="rep-month-count tabular">${m.count}</div>
        <div class="rep-month-label">${ui.escapeHtml(m.label)}</div>
      </div>`).join('');
  }

  function paintOwners() {
    const list = report.topOwners || [];
    if (!list.length) {
      refs.owners.innerHTML = '<p class="dim">No assignments yet.</p>';
      return;
    }
    const max = list[0].count;
    refs.owners.innerHTML = list.map((o) => `
      <div class="rep-owner">
        <div class="rep-owner-name">${ui.escapeHtml(o.owner)}</div>
        <div class="sev-bar-track"><div class="sev-bar-fill fill-violet" style="width:0;" data-pct="${Math.max(4, Math.round((o.count / max) * 100))}"></div></div>
        <div class="rep-owner-count tabular">${o.count}</div>
      </div>`).join('');
  }

  function paintRecent() {
    const list = report.recent || [];
    if (!list.length) { refs.recent.innerHTML = '<tr><td colspan="6" class="dim">No recent activity.</td></tr>'; return; }
    refs.recent.innerHTML = list.map((r) => `
      <tr>
        <td><a href="/incident.html?id=${encodeURIComponent(r.id)}" class="link-mono">#${ui.escapeHtml(r.id)}</a></td>
        <td>${ui.escapeHtml(r.title || '—')}</td>
        <td>${ui.severityChip(r.severity || 'P3')}</td>
        <td>${ui.stateChip(r.state || '—')}</td>
        <td>${ui.escapeHtml(r.owner || '—')}</td>
        <td class="mono dim">${ui.fmtRelative(r.updatedAt)}</td>
      </tr>`).join('');
  }

  /** Trigger the staggered bar/fill animations after the markup is in. */
  function animateBars() {
    requestAnimationFrame(() => setTimeout(() => {
      document.querySelectorAll('.sev-bar-fill').forEach((el) => {
        el.style.width = (el.dataset.pct || 0) + '%';
      });
      document.querySelectorAll('.rep-month-fill').forEach((el) => {
        el.style.height = (el.dataset.h || 0) + '%';
      });
    }, 80));
  }

  function paintAll() {
    refs.kTotal.textContent  = report.totals.all;
    refs.kOpen.textContent   = report.totals.open;
    refs.kClosed.textContent = report.totals.closed;
    refs.kMttr.textContent   = fmtHours(report.mttrHours);
    paintSeverity();
    paintState();
    paintMonthly();
    paintOwners();
    paintRecent();
    refs.meta.textContent = `Generated ${ui.fmtRelative(report.generatedAt)}`;
    animateBars();
  }

  // ----- Exports -----
  refs.exportJson.addEventListener('click', () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    download(blob, `sentinel-report-${todayStamp()}.json`);
  });

  refs.exportCsv.addEventListener('click', () => {
    if (!report) return;
    const lines = ['metric,value'];
    lines.push(`total,${report.totals.all}`);
    lines.push(`open,${report.totals.open}`);
    lines.push(`closed,${report.totals.closed}`);
    lines.push(`mttrHours,${report.mttrHours == null ? '' : report.mttrHours}`);
    Object.entries(report.totals.bySeverity).forEach(([k, v]) => lines.push(`severity_${k},${v}`));
    Object.entries(report.totals.byState).forEach(([k, v]) => lines.push(`state_${csvSafe(k)},${v}`));
    report.topOwners.forEach((o) => lines.push(`owner_${csvSafe(o.owner)},${o.count}`));
    report.monthly.forEach((m) => lines.push(`month_${m.key},${m.count}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    download(blob, `sentinel-report-${todayStamp()}.csv`);
  });

  function csvSafe(s) { return String(s).replace(/[,\n\r]/g, ' '); }
  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 200);
  }

  async function load() {
    try {
      report = await api.reports();
      paintAll();
    } catch (err) {
      refs.meta.textContent = `Couldn't load report: ${err.message}`;
    }
  }

  load();
})();
