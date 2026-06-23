/* ============================================================
   Sentinel DateTime Picker
   ------------------------------------------------------------
   Drop-in replacement for `<input type="datetime-local">`.
   - Calendar grid (one month view) with prev/next nav, date only
   - Clear · Today shortcuts
   - Outputs back into the original input as a `YYYY-MM-DDTHH:mm`
     local string, identical to the native control — so any save()
     code that does `new Date(v).toISOString()` keeps working.

   Times are interpreted in the browser's local timezone (same as the
   native datetime-local control). No timezone toggles — keep it simple.
   ============================================================ */
(function () {
  if (window.dtp) return; // idempotent

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  /** Two-digit pad. */
  function pad(n) { return String(n).padStart(2, '0'); }

  /** "YYYY-MM-DDTHH:mm" → {y,m,d,h,mn} or null. */
  function parseLocal(str) {
    if (!str) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str);
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3], h: +m[4], mn: +m[5] };
  }
  function fmtLocal(parts) {
    if (!parts) return '';
    return `${parts.y}-${pad(parts.m + 1)}-${pad(parts.d)}T${pad(parts.h)}:${pad(parts.mn)}`;
  }
  /** Display string for the chip: "29-05-2026" */
  function fmtDisplay(parts) {

  if (!parts) return '';

  return `${pad(parts.d)}-${pad(parts.m + 1)}-${parts.y} ${pad(parts.h)}:${pad(parts.mn)}`;

}
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function firstWeekday(y, m) { return new Date(y, m, 1).getDay(); }

  /** "Now" in the browser's local timezone — used to highlight Today and seed view. */
  function currentDateLocal() {
    const now = new Date();
    return {
      y: now.getFullYear(),
      m: now.getMonth(),
      d: now.getDate(),
      h: now.getHours(),
      mn: now.getMinutes()
    };
  }

  /**
   * Wrap a `<input type="datetime-local">` in a picker. Returns the wrapper.
   */
  function attach(input) {
    if (!input || input.dataset.dtpInit) return;
    input.dataset.dtpInit = '1';

    /** Current draft. null = no value. */
    let draft = parseLocal(input.value);
    /** Calendar's viewed month — independent of draft so users can browse. */
    const today = currentDateLocal();
    let view = draft ? { y: draft.y, m: draft.m } : { y: today.y, m: today.m };

    // ----- DOM -----
    const wrap = document.createElement('div');
    wrap.className = 'dtp-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    // Hide the native picker chrome but keep the input as the storage layer.
    input.classList.add('dtp-native');
    input.type = 'text';
    input.readOnly = true;
    input.autocomplete = 'off';

    const display = document.createElement('button');
    display.type = 'button';
    display.className = 'dtp-display';
    display.innerHTML = `
      <span class="dtp-display-value">${fmtDisplay(draft) || 'Select date & time'}</span>
      <span class="dtp-cal-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </span>
    `;
    wrap.appendChild(display);

    const pop = document.createElement('div');
    pop.className = 'dtp-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Pick date and time');
    wrap.appendChild(pop);

    function setValue(parts) {
      draft = parts;
      const str = fmtLocal(parts);
      input.value = str;
      display.querySelector('.dtp-display-value').textContent = parts ? fmtDisplay(parts) : 'Select date & time';
      display.classList.toggle('dtp-empty', !parts);
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setValue(draft);

    function renderPop() {
      const t = currentDateLocal();
      const dim = daysInMonth(view.y, view.m);
      const firstDow = firstWeekday(view.y, view.m);
      const prevDim = daysInMonth(view.y, view.m - 1);

      // 6-row calendar (always 42 cells)
      const cells = [];
      for (let i = 0; i < firstDow; i++) {
        const day = prevDim - firstDow + i + 1;
        const mPrev = view.m === 0 ? 11 : view.m - 1;
        const yPrev = view.m === 0 ? view.y - 1 : view.y;
        cells.push({ d: day, m: mPrev, y: yPrev, out: true });
      }
      for (let d = 1; d <= dim; d++) cells.push({ d, m: view.m, y: view.y, out: false });
      while (cells.length < 42) {
        const idx = cells.length - (firstDow + dim);
        const day = idx + 1;
        const mNext = view.m === 11 ? 0 : view.m + 1;
        const yNext = view.m === 11 ? view.y + 1 : view.y;
        cells.push({ d: day, m: mNext, y: yNext, out: true });
      }

      const calCellsHtml = cells.map((c) => {
        const isSelected = draft && c.d === draft.d && c.m === draft.m && c.y === draft.y;
        const isToday    = c.d === t.d && c.m === t.m && c.y === t.y;
        const cls = [
          'dtp-day',
          c.out ? 'dtp-out' : '',
          isSelected ? 'dtp-sel' : '',
          isToday ? 'dtp-today' : ''
        ].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-y="${c.y}" data-m="${c.m}" data-d="${c.d}">${c.d}</button>`;
      }).join('');

      const dowHtml = DOW.map((d) => `<div class="dtp-dow">${d}</div>`).join('');

      pop.innerHTML = `
        <header class="dtp-head">
          <div class="dtp-month-block">
            <button type="button" class="dtp-month-btn" data-month-btn>
              <span>${MONTHS[view.m]}, ${view.y}</span>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4l4 4 4-4"/></svg>
            </button>
          </div>
          <div class="dtp-nav">
            <button type="button" class="dtp-nav-btn" data-prev aria-label="Previous month">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
            <button type="button" class="dtp-nav-btn" data-next aria-label="Next month">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
            </button>
          </div>
        </header>

        <div class="dtp-body">
          <div class="dtp-cal">
            <div class="dtp-dows">${dowHtml}</div>
            <div class="dtp-grid">${calCellsHtml}</div>
          </div>
        </div>

    <footer class="dtp-foot">

  <div style="
    display:flex;
    align-items:center;
    justify-content:center;
    gap:10px;
    margin-bottom:12px;
  ">

    <span style="font-size:12px;color:#999">HH</span>

    <input
      type="number"
      class="dtp-hour"
      min="0"
      max="23"
      value="${draft ? draft.h : 0}"
      style="
        width:60px;
        padding:8px;
        text-align:center;
        border-radius:8px;
        border:1px solid #444;
        background:#111;
        color:white;
      "
    >

    <span>:</span>

    <span style="font-size:12px;color:#999">MM</span>

    <input
      type="number"
      class="dtp-minute"
      min="0"
      max="59"
      value="${draft ? draft.mn : 0}"
      style="
        width:60px;
        padding:8px;
        text-align:center;
        border-radius:8px;
        border:1px solid #444;
        background:#111;
        color:white;
      "
    >

  </div>

  <button type="button" class="dtp-text-btn dtp-clear">
    Clear
  </button>

  <button type="button" class="dtp-text-btn dtp-today">
    Today
  </button>

</footer>
      `;

      bindPop();
    }

    function bindPop() {
      pop.querySelector('[data-prev]').addEventListener('click', () => {
        view.m--; if (view.m < 0) { view.m = 11; view.y--; }
        renderPop();
      });
      pop.querySelector('[data-next]').addEventListener('click', () => {
        view.m++; if (view.m > 11) { view.m = 0; view.y++; }
        renderPop();
      });
      pop.querySelectorAll('.dtp-day').forEach((b) => {
        b.addEventListener('click', () => {
          const y = +b.dataset.y, m = +b.dataset.m, d = +b.dataset.d;
          const cur = draft || { h: 0, mn: 0 };
          setValue({ y, m, d, h: cur.h ?? 0, mn: cur.mn ?? 0 });
          view = { y, m };
          renderPop();
        });
      });
      pop.querySelector('.dtp-clear').addEventListener('click', () => {
        setValue(null);
        renderPop();
      });
      pop.querySelector('.dtp-today').addEventListener('click', () => {
        const n = currentDateLocal();
        view = { y: n.y, m: n.m };
        setValue({ y: n.y, m: n.m, d: n.d, h: 0, mn: 0 });
        renderPop();
      });
      const hourInput = pop.querySelector('.dtp-hour');
const minuteInput = pop.querySelector('.dtp-minute');

if (hourInput) {

  hourInput.addEventListener('change', () => {

    const cur = draft || currentDateLocal();

    setValue({
      ...cur,
      h: parseInt(hourInput.value || 0)
    });

  });

}

if (minuteInput) {

  minuteInput.addEventListener('change', () => {

    const cur = draft || currentDateLocal();

    setValue({
      ...cur,
      mn: parseInt(minuteInput.value || 0)
    });

  });

}
    }

    function open() {
      if (pop.classList.contains('open')) return;
      renderPop();
      pop.classList.add('open');
      display.classList.add('open');
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKey);
    }
    function close() {
      pop.classList.remove('open');
      display.classList.remove('open');
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey);
    }
    function onDocClick(e) {
      if (!wrap.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    display.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pop.classList.contains('open')) close();
      else open();
    });

    // Keep the display in sync when the input is updated externally
    // (e.g. when hydrating from the server).
    let lastSeen = input.value;
    setInterval(() => {
      if (input.value !== lastSeen) {
        lastSeen = input.value;
        const fresh = parseLocal(input.value);
        draft = fresh;
        if (fresh) view = { y: fresh.y, m: fresh.m };
        display.querySelector('.dtp-display-value').textContent = draft ? fmtDisplay(draft) : 'Select date & time';
        display.classList.toggle('dtp-empty', !draft);
      }
    }, 400);

    return wrap;
  }

  /** Auto-attach to any <input type="datetime-local"> with `data-dtp`. */
  function autoInit(root) {
    (root || document).querySelectorAll('input[data-dtp]').forEach(attach);
  }

  window.dtp = { attach, autoInit };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => autoInit());
  } else {
    autoInit();
  }
})();
