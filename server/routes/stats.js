/**
 * GET /api/stats — dashboard headline metrics.
 *
 * The 12-week trend is broken down per-week into:
 *   - total       : count of incidents created that week
 *   - bySeverity  : { P1, P2, P2-Low, P3 } counts (for the stacked bar chart)
 *   - resolved    : count of incidents marked Resolved / RCA Not Required
 *                   that week (derived from activity log state-changes)
 *   - weekStart   : ISO date (YYYY-MM-DD)
 *   - label       : short human label (e.g. "Apr 14") for the X-axis
 */
const express = require('express');
const router = express.Router();
const { readIncidents, readActivity } = require('../utils/storage');

const CLOSED_STATES = new Set(['Resolved', 'RCA Not Required']);
const SEVERITIES = ['P1', 'P2', 'P2-Low', 'P3'];

router.get('/', async (_req, res, next) => {
  try {
    const list = await readIncidents();
    const activity = await readActivity();

    const bySeverity = list.reduce((acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1; return acc;
    }, {});
    const byState = list.reduce((acc, i) => {
      acc[i.state] = (acc[i.state] || 0) + 1; return acc;
    }, {});

    const open = list.filter((i) => !CLOSED_STATES.has(i.state)).length;
    const live = list.filter((i) => i.state === 'Live').length;
    const inRca = list.filter((i) => i.state === 'RCA in Progress' || i.state === 'RCA Submitted').length;
    const resolved = list.filter((i) => CLOSED_STATES.has(i.state)).length;

    // ---- Trend buckets (12 weekly windows) ----
    const now = new Date();
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(start.getDate() - i * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      weeks.push({
        weekStart: start.toISOString().slice(0, 10),
        label: start.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
        startTs: start.getTime(),
        endTs: end.getTime(),
        count: 0,
        bySeverity: { P1: 0, P2: 0, 'P2-Low': 0, P3: 0 },
        resolved: 0
      });
    }

    /** Locate the week bucket for a timestamp, or null if outside the window. */
    function bucketFor(ts) {
      if (ts == null || isNaN(ts)) return null;
      for (let i = 0; i < weeks.length; i++) {
        if (ts >= weeks[i].startTs && ts < weeks[i].endTs) return weeks[i];
      }
      return null;
    }

    // Created counts (by severity) per week
    for (const inc of list) {
      const t = new Date(inc.createdAt).getTime();
      const b = bucketFor(t);
      if (!b) continue;
      b.count++;
      if (SEVERITIES.includes(inc.severity)) b.bySeverity[inc.severity]++;
    }

    // Resolved counts per week — derived from activity log entries that
    // transitioned the incident into a CLOSED state. This is more accurate
    // than checking the current state (which says nothing about WHEN it
    // was resolved).
    for (const ev of activity) {
      if (ev.kind !== 'state-changed') continue;
      if (!CLOSED_STATES.has(ev.to)) continue;
      const t = new Date(ev.ts).getTime();
      const b = bucketFor(t);
      if (b) b.resolved++;
    }

    // Strip internal-only fields (startTs/endTs) before sending.
    const trend = weeks.map(({ startTs, endTs, ...rest }) => rest);

    // ---- Mean time to resolve ----
    const durations = list
      .map((i) => {
        const s = i.incidentDetails && i.incidentDetails.incidentStart ? new Date(i.incidentDetails.incidentStart) : null;
        const e = i.incidentDetails && i.incidentDetails.incidentEnd ? new Date(i.incidentDetails.incidentEnd) : null;
        if (!s || !e || isNaN(s) || isNaN(e)) return null;
        return (e - s) / 60000;
      })
      .filter((n) => n != null && n >= 0);
    const mttr = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    res.json({
      ok: true,
      totals: { total: list.length, open, live, inRca, resolved },
      bySeverity,
      byState,
      trend,
      mttrMinutes: mttr,
      activity: activity.slice(0, 25)
    });
  } catch (e) { next(e); }
});

module.exports = router;
