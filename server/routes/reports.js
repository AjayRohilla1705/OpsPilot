/**
 * GET /api/reports — derived analytics for the Reports page.
 *
 * Returns:
 *   totals       — { all, open, closed, byState, bySeverity }
 *   mttrHours    — mean time-to-resolve across resolved incidents (null if none)
 *   topOwners    — owners ranked by number of incidents they handled
 *   recent       — last 10 incidents, lean projection (id, title, state, severity, owner, updatedAt)
 *   monthly      — last 6 months of incident counts (by createdAt month)
 *
 * Read-only for both roles. Designed to power the Reports page UI without
 * pulling the full incident list to the browser.
 */
const express = require('express');
const router = express.Router();
const { readIncidents } = require('../utils/storage');

const CLOSED_STATES = new Set(['Resolved', 'RCA Not Required']);
const SEVERITIES = ['P1', 'P2', 'P2-Low', 'P3'];

function durationHours(i) {
  const s = i.incidentDetails && i.incidentDetails.incidentStart;
  const e = i.incidentDetails && i.incidentDetails.incidentEnd;
  if (!s || !e) return null;
  const ds = new Date(s), de = new Date(e);
  if (isNaN(ds) || isNaN(de)) return null;
  const h = (de - ds) / 3_600_000;
  return h > 0 ? h : null;
}

function monthKey(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

router.get('/', async (_req, res, next) => {
  try {
    const incidents = await readIncidents();

    // ---- Totals + breakdowns ----
    const byState = {};
    const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
    let open = 0, closed = 0;

    for (const i of incidents) {
      byState[i.state] = (byState[i.state] || 0) + 1;
      if (CLOSED_STATES.has(i.state)) closed++; else open++;
      if (bySeverity[i.severity] !== undefined) bySeverity[i.severity]++;
    }

    // ---- MTTR (resolved incidents only) ----
    const closedHours = incidents
      .filter((i) => CLOSED_STATES.has(i.state))
      .map(durationHours)
      .filter((h) => h != null);
    const mttrHours = closedHours.length
      ? Math.round((closedHours.reduce((a, b) => a + b, 0) / closedHours.length) * 10) / 10
      : null;

    // ---- Top owners (by count) ----
    const ownerCount = new Map();
    for (const i of incidents) {
      if (!i.owner) continue;
      ownerCount.set(i.owner, (ownerCount.get(i.owner) || 0) + 1);
    }
    const topOwners = [...ownerCount.entries()]
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ---- Monthly buckets (last 6 months) ----
    const now = new Date();
    const months = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
      months.push({ key: monthKey(d), label: d.toLocaleString('en', { month: 'short' }), count: 0 });
    }
    const monthIdx = Object.fromEntries(months.map((m, i) => [m.key, i]));
    for (const i of incidents) {
      const k = monthKey(i.createdAt);
      if (k && monthIdx[k] !== undefined) months[monthIdx[k]].count++;
    }

    // ---- Recent (last 10 by updatedAt) ----
    const recent = [...incidents]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
      .slice(0, 10)
      .map((i) => ({
        id: i.id,
        title: i.title,
        state: i.state,
        severity: i.severity,
        owner: i.owner,
        updatedAt: i.updatedAt || i.createdAt
      }));

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      totals: {
        all: incidents.length,
        open,
        closed,
        byState,
        bySeverity
      },
      mttrHours,
      topOwners,
      monthly: months,
      recent
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
