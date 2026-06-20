/**
 * Derive a realistic initial activity log from the seed incidents.
 * Without this, the Activity Log page starts empty on a fresh install.
 *
 * For each seed incident we synthesise:
 *   1) a `created` entry at incident.createdAt by incident.updatedBy
 *   2) an `assigned` entry (one minute later) if it has an owner
 *   3) a `state-changed` entry at incident.updatedAt if state changed
 *      from the implicit creation state "Live" to anything else
 *   4) a `commented` entry per comment in incident.comments
 *
 * Entries come back newest-first (matching the running log order used
 * by appendActivity, which unshifts).
 */
const seedIncidents = require('./seed');

function id(prefix) {
  return prefix + Math.random().toString(36).slice(2, 10);
}

function plusMinutes(iso, mins) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}

function entriesFor(inc) {
  const out = [];
  const createdAt = inc.createdAt || inc.updatedAt;
  const updatedAt = inc.updatedAt || createdAt;
  const by = inc.updatedBy || inc.owner || 'EMS Operator';

  out.push({
    id: id('a-'),
    kind: 'created',
    incidentId: inc.id,
    title: inc.title,
    ts: createdAt,
    by,
  });

  if (inc.owner) {
    out.push({
      id: id('a-'),
      kind: 'assigned',
      incidentId: inc.id,
      title: inc.title,
      from: '',
      to: inc.owner,
      ts: plusMinutes(createdAt, 1),
      by: 'System',
    });
  }

  if (inc.state && inc.state !== 'Live') {
    out.push({
      id: id('a-'),
      kind: 'state-changed',
      incidentId: inc.id,
      title: inc.title,
      from: 'Live',
      to: inc.state,
      ts: updatedAt,
      by,
    });
  }

  (inc.comments || []).forEach((c) => {
    out.push({
      id: id('a-'),
      kind: 'commented',
      incidentId: inc.id,
      title: inc.title,
      ts: c.ts || updatedAt,
      by: c.author || by,
    });
  });

  return out;
}

const all = seedIncidents.flatMap(entriesFor);
// Newest-first so the page lands on the most-recent action.
all.sort((a, b) => new Date(b.ts) - new Date(a.ts));

module.exports = all;
