/**
 * GET /api/activity — full audit log with filtering.
 *
 * Query params:
 *   q       — text search across user / incidentId / title / details (case-insensitive)
 *   action  — one of CREATED, UPDATED, DELETED, ASSIGNED, RESOLVED, COMMENTED
 *             (also accepts "ALL" or empty to mean no filter)
 *   limit   — optional cap on returned entries (default: all)
 *
 * Each entry is returned with two derived fields the UI uses directly:
 *   action  — uppercase badge label (CREATED, RESOLVED, etc.)
 *   details — a human-friendly one-liner describing what happened
 */
const express = require('express');
const router = express.Router();
const { readActivity } = require('../utils/storage');

const CLOSED_STATES = new Set(['Resolved', 'RCA Not Required']);

function labelFor(entry) {
  switch (entry.kind) {
    case 'created':   return 'CREATED';
    case 'updated':   return 'UPDATED';
    case 'deleted':   return 'DELETED';
    case 'assigned':  return 'ASSIGNED';
    case 'commented': return 'COMMENTED';
    case 'state-changed':
      return CLOSED_STATES.has(entry.to) ? 'RESOLVED' : 'UPDATED';
    default:          return 'UPDATED';
  }
}

function detailsFor(entry) {
  const title = entry.title ? `"${entry.title}"` : `incident #${entry.incidentId || ''}`;
  switch (entry.kind) {
    case 'created':   return `Created incident ${title}`;
    case 'updated':   return `Updated ${title}`;
    case 'deleted':   return `Deleted ${title}`;
    case 'commented': return `Commented on ${title}`;
    case 'assigned':
      return entry.from
        ? `Reassigned from ${entry.from} to ${entry.to}`
        : `Assigned to ${entry.to || '—'}`;
    case 'state-changed':
      if (CLOSED_STATES.has(entry.to)) return `Marked ${entry.to}`;
      return `State changed from "${entry.from || '—'}" to "${entry.to || '—'}"`;
    default:          return `Updated ${title}`;
  }
}

router.get('/', async (req, res, next) => {
  try {
    const all = await readActivity();

    let items = all.map((e) => ({
      ...e,
      action: labelFor(e),
      details: detailsFor(e),
    }));

    const action = String(req.query.action || '').toUpperCase().trim();
    if (action && action !== 'ALL' && action !== 'ALL ACTIONS') {
      items = items.filter((i) => i.action === action);
    }

    const q = String(req.query.q || '').toLowerCase().trim();
    if (q) {
      items = items.filter((i) =>
        [i.by, i.incidentId, i.title, i.details].filter(Boolean).join(' ').toLowerCase().includes(q)
      );
    }

    const total = items.length;
    const limit = parseInt(req.query.limit, 10);
    if (Number.isFinite(limit) && limit > 0) items = items.slice(0, limit);

    res.json({ ok: true, count: items.length, total, items });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
