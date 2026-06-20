/**
 * Team roster + metrics.
 *
 * GET    /api/team        — list members enriched with live workload metrics
 * GET    /api/team/:id    — single member (no metrics)
 * POST   /api/team        — create (admin only)
 * PUT    /api/team/:id    — update (admin only)
 * DELETE /api/team/:id    — delete (admin only)
 *
 * Members are persisted in `server/data/team.json`, seeded on first boot
 * from `server/utils/teamRoster.js`. Each record carries an id, name, role,
 * dept, email, phone, accent, status — created/updatedAt timestamps are
 * added on write.
 */
const express = require('express');
const router = express.Router();
const { readTeam, upsertTeamMember, deleteTeamMemberById, readIncidents } = require('../utils/storage');
const { requireAdmin } = require('../middleware/requireAdmin');

const CLOSED_STATES = new Set(['Resolved', 'RCA Not Required']);
const ALLOWED_ACCENTS = new Set(['ember', 'mint', 'cyan', 'violet', 'rose', 'amber', 'gold', 'sky']);

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function namesOf(incident) {
  const set = new Set();
  if (incident.owner) set.add(incident.owner.trim());
  if (incident.updatedBy) set.add(incident.updatedBy.trim());
  (incident.incidentTeam || []).forEach((n) => n && set.add(n.trim()));
  (incident.rcaTeam || []).forEach((n) => n && set.add(n.trim()));
  return set;
}

function durationHours(incident) {
  const s = incident.incidentDetails && incident.incidentDetails.incidentStart;
  const e = incident.incidentDetails && incident.incidentDetails.incidentEnd;
  if (!s || !e) return null;
  const ds = new Date(s);
  const de = new Date(e);
  if (isNaN(ds) || isNaN(de)) return null;
  const h = (de - ds) / 3_600_000;
  return h > 0 ? h : null;
}

function sanitize(body, existing) {
  const out = existing ? { ...existing } : {};
  if (typeof body.name === 'string')   out.name   = body.name.trim().slice(0, 80);
  if (typeof body.role === 'string')   out.role   = body.role.trim().slice(0, 80);
  if (typeof body.dept === 'string')   out.dept   = body.dept.trim().slice(0, 80);
  if (typeof body.email === 'string')  out.email  = body.email.trim().slice(0, 120);
  if (typeof body.phone === 'string')  out.phone  = body.phone.trim().slice(0, 40);
  if (typeof body.status === 'string') out.status = ['online','away','offline'].includes(body.status) ? body.status : (out.status || 'online');
  if (typeof body.accent === 'string') out.accent = ALLOWED_ACCENTS.has(body.accent) ? body.accent : (out.accent || 'ember');
  return out;
}

function validate(member, list, existingId) {
  const errors = [];
  if (!member.name) errors.push('Name is required');
  if (!member.role) errors.push('Role is required');
  if (member.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email)) {
    errors.push('Email is not a valid address');
  }
  // Email uniqueness (case-insensitive).
  if (member.email) {
    const dupe = list.find((m) => m.email && m.email.toLowerCase() === member.email.toLowerCase() && m.id !== existingId);
    if (dupe) errors.push(`Email "${member.email}" is already used by ${dupe.name}`);
  }
  return errors;
}

async function uniqueId(base, list) {
  let id = base || ('member-' + Date.now().toString(36));
  let n = 2;
  const taken = new Set(list.map((m) => m.id));
  while (taken.has(id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

// ---------------- GET /api/team (with metrics) ----------------
router.get('/', async (_req, res, next) => {
  try {
    const [members, incidents] = await Promise.all([readTeam(), readIncidents()]);
    const indexed = incidents.map((i) => ({ i, people: namesOf(i), hours: durationHours(i) }));

    const items = members.map((m) => {
      const involved = indexed.filter((x) => x.people.has(m.name));
      const active = involved.filter((x) => !CLOSED_STATES.has(x.i.state)).length;
      const resolved = involved.filter((x) => CLOSED_STATES.has(x.i.state)).length;
      const durations = involved.map((x) => x.hours).filter((h) => h != null);
      const avgHours = durations.length
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : null;
      return { ...m, active, resolved, avgHours };
    });

    items.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    next(e);
  }
});

// ---------------- GET /api/team/:id ----------------
router.get('/:id', async (req, res, next) => {
  try {
    const list = await readTeam();
    const m = list.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ ok: false, error: 'NotFound', message: 'Member not found' });
    res.json({ ok: true, member: m });
  } catch (e) {
    next(e);
  }
});

// ---------------- POST /api/team ----------------
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const list = await readTeam();
    const draft = sanitize(req.body || {}, null);
    if (!draft.accent) draft.accent = 'ember';
    if (!draft.status) draft.status = 'online';
    const errors = validate(draft, list, null);
    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'ValidationError', message: errors.join('; ') });
    }
    draft.id = await uniqueId(slug(draft.name), list);
    draft.createdAt = new Date().toISOString();
    draft.updatedAt = draft.createdAt;
    await upsertTeamMember(draft);
    res.status(201).json({ ok: true, member: draft });
  } catch (e) {
    next(e);
  }
});

// ---------------- PUT /api/team/:id ----------------
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const list = await readTeam();
    const idx = list.findIndex((m) => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'NotFound', message: 'Member not found' });
    const updated = sanitize(req.body || {}, list[idx]);
    const errors = validate(updated, list, list[idx].id);
    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'ValidationError', message: errors.join('; ') });
    }
    updated.id = list[idx].id;
    updated.createdAt = list[idx].createdAt || new Date().toISOString();
    updated.updatedAt = new Date().toISOString();
    await upsertTeamMember(updated);
    res.json({ ok: true, member: updated });
  } catch (e) {
    next(e);
  }
});

// ---------------- DELETE /api/team/:id ----------------
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const list = await readTeam();
    const idx = list.findIndex((m) => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'NotFound', message: 'Member not found' });
    const removed = list[idx];
    await deleteTeamMemberById(removed.id);
    res.json({ ok: true, removed });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
