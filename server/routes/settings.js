/**
 * GET  /api/settings        — return full settings object
 * PUT  /api/settings        — partial update (deep merge with validation)
 * POST /api/settings/reset  — restore DEFAULT_SETTINGS
 *
 * Settings shape:
 *   organization.name            string (1..120)
 *   notifications.emailDigest    boolean
 *   notifications.browserPush    boolean
 *   notifications.slackMentions  boolean
 *   sla.{P1,P2,P3,P4}            integer hours (0..9999)
 *   categories                   string[] (each 1..40 chars, deduped, max 30)
 */
const express = require('express');
const router = express.Router();
const { readSettings, writeSettings, DEFAULT_SETTINGS } = require('../utils/storage');
const { requireAdmin } = require('../middleware/requireAdmin');
const { sendTestEmail } = require('../utils/mailer');

const SLA_KEYS = ['P1', 'P2', 'P3', 'P4'];
const NTF_KEYS = ['emailDigest', 'browserPush', 'slackMentions', 'incidentEmails'];
const TRIGGER_KEYS = ['onCreate', 'onStateChange', 'onResolved'];
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mergeSettings(current, body) {
  const out = JSON.parse(JSON.stringify(current));

  if (body.organization && typeof body.organization === 'object') {
    if (typeof body.organization.name === 'string') {
      out.organization.name = body.organization.name.trim().slice(0, 120);
    }
  }

  if (body.notifications && typeof body.notifications === 'object') {
    for (const k of NTF_KEYS) {
      if (typeof body.notifications[k] === 'boolean') {
        out.notifications[k] = body.notifications[k];
      }
    }
  }

  if (body.sla && typeof body.sla === 'object') {
    for (const k of SLA_KEYS) {
      if (body.sla[k] === undefined || body.sla[k] === null || body.sla[k] === '') continue;
      const v = Number(body.sla[k]);
      if (Number.isFinite(v) && v >= 0 && v <= 9999) out.sla[k] = Math.round(v);
    }
  }

  if (body.email && typeof body.email === 'object') {
    if (typeof body.email.enabled === 'boolean') out.email.enabled = body.email.enabled;
    if (body.email.smtp && typeof body.email.smtp === 'object') {
      const s = body.email.smtp;
      if (typeof s.host === 'string')    out.email.smtp.host = s.host.trim().slice(0, 200);
      if (s.port !== undefined && s.port !== null && s.port !== '') {
        const p = Number(s.port);
        if (Number.isFinite(p) && p > 0 && p < 65536) out.email.smtp.port = Math.round(p);
      }
      if (typeof s.secure === 'boolean')  out.email.smtp.secure = s.secure;
      if (typeof s.user === 'string')     out.email.smtp.user = s.user.trim().slice(0, 200);
      // Empty-string pass means "don't change" — lets the UI omit the
      // password when echoing values back to the server.
      if (typeof s.pass === 'string' && s.pass.length) out.email.smtp.pass = s.pass.slice(0, 500);
    }
    if (typeof body.email.from === 'string') out.email.from = body.email.from.trim().slice(0, 200);
    if (Array.isArray(body.email.recipients)) {
      const seen = new Set();
      out.email.recipients = body.email.recipients
        .map((r) => (typeof r === 'string' ? r.trim() : ''))
        .filter((r) => EMAIL_RX.test(r))
        .filter((r) => {
          const k = r.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 50);
    }
    if (body.email.triggers && typeof body.email.triggers === 'object') {
      for (const k of TRIGGER_KEYS) {
        if (typeof body.email.triggers[k] === 'boolean') out.email.triggers[k] = body.email.triggers[k];
      }
    }
  }

  if (Array.isArray(body.categories)) {
    const seen = new Set();
    out.categories = body.categories
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter((c) => c.length >= 1 && c.length <= 40)
      .filter((c) => {
        const k = c.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 30);
  }

  return out;
}

function validate(s) {
  const errors = [];
  if (!s.organization || typeof s.organization.name !== 'string' || !s.organization.name.trim()) {
    errors.push('Organization name is required');
  }
  // SLA sanity: critical ≤ high ≤ medium ≤ low is desirable but not strictly
  // required, so we only validate hard bounds (already enforced in merge).
  return errors;
}

/** Strip the SMTP password before sending settings to any client. */
function redact(settings) {
  const s = JSON.parse(JSON.stringify(settings));
  if (s.email && s.email.smtp) {
    s.email.smtp.hasPassword = !!s.email.smtp.pass;
    s.email.smtp.pass = '';
  }
  return s;
}

router.get('/', async (_req, res, next) => {
  try {
    const settings = await readSettings();
    res.json({ ok: true, settings: redact(settings) });
  } catch (e) {
    next(e);
  }
});

router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const current = await readSettings();
    const merged = mergeSettings(current, req.body || {});
    const errors = validate(merged);
    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'ValidationError', message: errors.join('; ') });
    }
    merged.updatedAt = new Date().toISOString();
    merged.updatedBy = (req.body && typeof req.body.updatedBy === 'string' && req.body.updatedBy.trim()) || 'EMS';
    await writeSettings(merged);
    res.json({ ok: true, settings: redact(merged) });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/settings/test-email
 *   body: { to?: "addr@example.com" } — optional override; defaults to
 *   the configured recipients list.
 * Sends a synthetic test email using the saved SMTP credentials. Surfaces
 * the real error (auth failure, bad host, etc.) so the admin can fix it.
 */
router.post('/test-email', requireAdmin, async (req, res, next) => {
  try {
    const to = req.body && typeof req.body.to === 'string' ? req.body.to.trim() : '';
    const result = await sendTestEmail(to || null);
    res.json({ ok: true, ...result });
  } catch (e) {
    // Return 400 (not 500) — these are usually configuration errors the
    // admin needs to fix, not server bugs.
    res.status(400).json({ ok: false, error: 'EmailFailed', message: e.message });
  }
});

router.post('/reset', requireAdmin, async (_req, res, next) => {
  try {
    const reset = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    reset.updatedAt = new Date().toISOString();
    reset.updatedBy = 'EMS';
    await writeSettings(reset);
    res.json({ ok: true, settings: redact(reset) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
