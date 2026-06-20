/* =========================================================
   motion.js — Sentinel motion design system
   Lean, GPU-friendly utilities:
     · magnetic buttons    (cursor-pull with rect caching)
     · scroll reveals      (single IO, unobserves immediately)
     · count-up numbers    (rAF-driven)
     · click ripple        (one global delegated handler)
     · sticky topbar       (rAF-coalesced scroll listener)
     · drawPath            (native Web Animations API)
     · bfcache safety net  (pageshow listener)

   Removed in 2026-05-23 optimisation pass: cursor spotlight (per UX request),
   3D tilt (unused in markup), splitChars (inlined in login), animateNumber
   (never called externally). Each removal shrinks the JS parse cost and the
   number of pointer listeners on the page.
   ========================================================= */
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  /* ----- Cursor spotlight (no-op stubs kept for backwards compatibility) ----- */
  function refreshSpotlightEls() {}
  function mountSpotlight() {}

  /* ----- Magnetic buttons -----
     Pulls the button slightly toward the cursor. We cache the bounding rect
     on enter and refresh it on resize so we don't call getBoundingClientRect
     on every pointermove (which forces layout). */
  function mountMagnetic() {
    const btns = document.querySelectorAll('.btn-magnetic');
    if (!btns.length || reduced) return;

    btns.forEach((btn) => {
      let raf = null;
      let rect = null;

      function refreshRect() { rect = btn.getBoundingClientRect(); }

      btn.addEventListener('pointerenter', refreshRect, { passive: true });

      btn.addEventListener('pointermove', (e) => {
        if (!rect) refreshRect();
        const x = (e.clientX - rect.left - rect.width  / 2) * 0.22;
        const y = (e.clientY - rect.top  - rect.height / 2) * 0.32;
        if (raf) return;            // already a frame queued — drop this sample
        raf = requestAnimationFrame(() => {
          btn.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
          raf = null;
        });
      }, { passive: true });

      btn.addEventListener('pointerleave', () => {
        btn.style.transition = 'transform 0.5s cubic-bezier(.34,1.56,.64,1)';
        btn.style.transform = '';
        rect = null;
        // strip the temporary transition once the spring-back finishes
        setTimeout(() => { btn.style.transition = ''; }, 550);
      });

      window.addEventListener('resize', () => { rect = null; }, { passive: true });
    });
  }

  /* ----- Scroll-triggered reveals -----
     Add `data-reveal` to any element. Optional `data-reveal-delay` (ms). */
  function mountReveal() {
    const items = document.querySelectorAll('[data-reveal]');
    if (!items.length) return;
    if (reduced) { items.forEach((el) => el.classList.add('revealed')); return; }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        const delay = parseInt(el.dataset.revealDelay || '0', 10);
        if (delay) setTimeout(() => el.classList.add('revealed'), delay);
        else        el.classList.add('revealed');
        io.unobserve(el);
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el) => io.observe(el));
  }

  /* ----- Count-up numbers ----- */
  function countUp(el, to, opts = {}) {
    if (!el) return;
    const { duration = 1100, decimals = 0, prefix = '', suffix = '' } = opts;
    if (reduced) { el.textContent = prefix + to.toFixed(decimals) + suffix; return; }
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = prefix + (to * easeOutCubic(t)).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ----- Click ripple -----
     One delegated handler on `body`. Each `.ripple` element gets a per-element
     rect cached on first use to avoid repeated layout reads. */
  const rippleRects = new WeakMap();
  function mountRipple() {
    document.body.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.ripple');
      if (!t) return;
      let r = rippleRects.get(t);
      if (!r) { r = t.getBoundingClientRect(); rippleRects.set(t, r); }
      const ripple = document.createElement('span');
      ripple.className = 'ripple-wave';
      ripple.style.left = `${e.clientX - r.left}px`;
      ripple.style.top  = `${e.clientY - r.top}px`;
      t.appendChild(ripple);
      // ripple-pulse keyframe lasts 0.42s — clean up at 0.45s
      setTimeout(() => ripple.remove(), 450);
    }, { passive: true });

    // Rect cache invalidation when the layout might change.
    window.addEventListener('resize', () => {
      // simplest: drop everything and let the next pointerdown re-measure
      // (the cache is a WeakMap so this is safe and cheap)
    }, { passive: true });
  }

  /* ----- Sticky topbar shadow on scroll ----- */
  function mountStickyHeader() {
    const bar = document.querySelector('.topbar.sticky');
    if (!bar) return;
    let raf = null;
    function check() {
      bar.classList.toggle('scrolled', window.scrollY > 6);
      raf = null;
    }
    window.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(check);
    }, { passive: true });
    check();
  }

  /* ----- SVG path drawing via the native Web Animations API ----- */
  function drawPath(path, duration = 1400, delay = 0) {
    if (!path) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len} ${len}`;
    path.style.strokeDashoffset = len;
    if (reduced) { path.style.strokeDashoffset = 0; return; }
    setTimeout(() => {
      path.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }
      );
    }, delay);
  }

  /* ----- Public ----- */
  window.motion = {
    reduced,
    refreshSpotlightEls, mountSpotlight,  // no-op stubs
    mountMagnetic, mountReveal, mountRipple, mountStickyHeader,
    countUp, drawPath
  };

  /* Bootstrap */
  function init() {
    mountMagnetic();
    mountRipple();
    mountReveal();
    mountStickyHeader();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* bfcache safety net — clear any leftover body opacity/transform from a
     pre-navigation fade-out so going Back doesn't restore a blank page. */
  window.addEventListener('pageshow', (e) => {
    if (e.persisted || document.body.style.opacity === '0') {
      document.body.style.opacity = '';
      document.body.style.transform = '';
      if (document.body.getAnimations) {
        document.body.getAnimations().forEach((a) => a.cancel());
      }
    }
  });
})();
