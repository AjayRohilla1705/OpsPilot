const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuid } = require('uuid');

const router = express.Router();

const { readIncidents, upsertIncident, deleteIncidentById, appendActivity, paths } = require('../utils/storage');
const { validateIncidentBody } = require('../middleware/validation');
const { HttpError } = require('../middleware/errorHandler');
const { requireAdmin } = require('../middleware/requireAdmin');
const { notifyIncident } = require('../utils/mailer');

const CLOSED_STATES = new Set(['Resolved', 'RCA Not Required']);

// ---- Multer for file uploads ----
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, paths.UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}-${uuid().slice(0, 8)}-${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(png|jpe?g|gif|svg|webp|pdf|txt|log|json|csv|md|docx?|xlsx?)$/i;
    cb(null, allowed.test(file.originalname));
  }
});

// ---- Helpers ----
/**
 * Sequential ticket ids: INC-01, INC-02, … (zero-padded to 2, then grows
 * naturally to 3+ digits). The number is parsed from the trailing digits of
 * existing ids, so the next id is always (highest so far) + 1. On an empty
 * list the first incident is INC-01.
 *
 * This same id is what the incident email prints as its "ADO Workitem", so
 * the ticket number and the ADO number always match.
 */
function nextId(list) {
  let max = 0;
  for (const x of list) {
    const m = /(\d+)\s*$/.exec(String(x.id || ''));
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return 'INC-' + String(max + 1).padStart(2, '0');
}

function nowIso() { return new Date().toISOString(); }

// ---- LIST ----
router.get('/', async (req, res, next) => {
  try {
    const list = await readIncidents();
    const { q, state, severity, sort = 'updatedAt', dir = 'desc', limit } = req.query;
    let filtered = list;

    if (q) {
      const needle = String(q).toLowerCase();
      filtered = filtered.filter((i) =>
        [i.id, i.title, i.owner, i.area, ...(i.tags || []), ...(i.affectedServices || [])]
          .filter(Boolean).join(' ').toLowerCase().includes(needle)
      );
    }
    if (state) filtered = filtered.filter((i) => i.state === state);
    if (severity) filtered = filtered.filter((i) => i.severity === severity);

    filtered.sort((a, b) => {
      const av = a[sort] || ''; const bv = b[sort] || '';
      return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

    if (limit) filtered = filtered.slice(0, parseInt(limit, 10) || 50);

    res.json({ ok: true, count: filtered.length, total: list.length, items: filtered });
  } catch (e) { next(e); }
});

// ---- GET ONE ----
router.get('/:id', async (req, res, next) => {
  try {
    const list = await readIncidents();
    const item = list.find((i) => i.id === req.params.id);
    if (!item) throw new HttpError(404, 'Incident not found');
    res.json({ ok: true, item });
  } catch (e) { next(e); }
});

// ---- CREATE ----
router.post('/', async (req, res, next) => {
  try {
    const data = validateIncidentBody(req.body);
    const list = await readIncidents();
    const now = nowIso();
    const item = {
      id: nextId(list),
      title: data.title,
      state: data.state || 'Live',
      reason: data.reason || '',
      area: data.area || 'Engineering\\PMO',
      iteration: data.iteration || 'Engineering\\2025-Sprints',
      owner: data.owner || 'Unassigned',
      severity: data.severity,
      outageType: data.outageType || 'IT EVENT',
      affectedServices: data.affectedServices || [],
      incidentDescription: data.incidentDescription || '',
      bridgeDetails: data.bridgeDetails || '',
      stepsToResolve: data.stepsToResolve || [],
      nextSteps: data.nextSteps || '',
      rootCauseAnalysis: data.rootCauseAnalysis || '',
      businessImpact: data.businessImpact || '',
      learnings: data.learnings || '',
      correctiveActionPlan: data.correctiveActionPlan || '',
      outageTimeline: data.outageTimeline || '',
      incidentTeam: data.incidentTeam || [],
      rcaTeam: data.rcaTeam || [],
      emsFields: data.emsFields || {},
      incidentDetails: data.incidentDetails || {},
      sendNotifications: data.sendNotifications || false,
      emsEvents: data.emsEvents || [],
      approvals: data.approvals || { cio: false },
      relatedWork: data.relatedWork || [],
      tags: data.tags || [],
      comments: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
      updatedBy: data.updatedBy || 'EMS Operator'
    };
    await upsertIncident(item);
    await appendActivity({ kind: 'created', incidentId: item.id, title: item.title, ts: now, by: item.updatedBy });
    // If the new incident was created with an owner, log an 'assigned' event
    // so the Activity Log shows the initial assignment.
    if (item.owner && item.owner !== 'Unassigned') {
      await appendActivity({
        kind: 'assigned',
        incidentId: item.id,
        title: item.title,
        from: '',
        to: item.owner,
        ts: now,
        by: 'System',
      });
    }
    res.status(201).json({ ok: true, item });

console.log("=== MAIL FUNCTION CALLED ===");
notifyIncident(item, 'created');
  } catch (e) { next(e); }
});

// ---- UPDATE ----
router.put('/:id', async (req, res, next) => {
  try {
    const data = validateIncidentBody(req.body, { partial: true });
    const list = await readIncidents();
    const idx = list.findIndex((i) => i.id === req.params.id);
    if (idx === -1) throw new HttpError(404, 'Incident not found');
    const prevState = list[idx].state;
    const prevOwner = list[idx].owner;
    const merged = { ...list[idx], ...data, updatedAt: nowIso() };
    if (data.updatedBy) merged.updatedBy = data.updatedBy;
    await upsertIncident(merged);
    // If the owner changed, log a separate 'assigned' event so the audit
    // trail shows the reassignment as its own line.
    if (data.owner !== undefined && data.owner !== prevOwner && data.owner) {
      await appendActivity({
        kind: 'assigned',
        incidentId: merged.id,
        title: merged.title,
        from: prevOwner || '',
        to: data.owner,
        ts: merged.updatedAt,
        by: merged.updatedBy,
      });
    }
    await appendActivity({
      kind: prevState !== merged.state ? 'state-changed' : 'updated',
      incidentId: merged.id,
      title: merged.title,
      from: prevState,
      to: merged.state,
      ts: merged.updatedAt,
      by: merged.updatedBy
    });
   res.json({ ok: true, item: merged });

console.log("=== INCIDENT UPDATED ===");
console.log("Owner:", merged.owner);
console.log("Assignee:", merged.assignee);
console.log("Steps:", merged.stepsToResolve);
console.log("Description:", merged.incidentDescription);

// Send mail on EVERY update
notifyIncident(merged, "updated");
  } catch (e) { next(e); }
});

// ---- DELETE ----
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const list = await readIncidents();
    const idx = list.findIndex((i) => i.id === req.params.id);
    if (idx === -1) throw new HttpError(404, 'Incident not found');
    const removed = list[idx];
    await deleteIncidentById(removed.id);
    await appendActivity({ kind: 'deleted', incidentId: removed.id, title: removed.title, ts: nowIso(), by: 'EMS Operator' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- COMMENTS ----
router.post('/:id/comments', async (req, res, next) => {
  try {
    const { author, body } = req.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) throw new HttpError(400, 'comment body is required');
    const list = await readIncidents();
    const idx = list.findIndex((i) => i.id === req.params.id);
    if (idx === -1) throw new HttpError(404, 'Incident not found');
    const comment = {
      id: 'c-' + uuid().slice(0, 8),
      author: author || 'EMS Operator',
      body: body.trim(),
      ts: nowIso()
    };
    list[idx].comments = list[idx].comments || [];
    list[idx].comments.unshift(comment);
    list[idx].updatedAt = comment.ts;
    await upsertIncident(list[idx]);
    await appendActivity({ kind: 'commented', incidentId: list[idx].id, title: list[idx].title, ts: comment.ts, by: comment.author });
    res.status(201).json({ ok: true, comment });
  } catch (e) { next(e); }
});

// ---- ATTACHMENTS ----
router.post('/:id/attachments', upload.array('files', 8), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) throw new HttpError(400, 'no files uploaded or unsupported format');
    const list = await readIncidents();
    const idx = list.findIndex((i) => i.id === req.params.id);
    if (idx === -1) {
      // remove uploaded files to avoid orphans
      req.files.forEach((f) => fs.unlink(f.path, () => {}));
      throw new HttpError(404, 'Incident not found');
    }
    const attachments = req.files.map((f) => ({
      id: 'a-' + uuid().slice(0, 8),
      name: f.originalname,
      size: f.size,
      stored: path.basename(f.path),
      url: `/uploads/${path.basename(f.path)}`,
      uploadedAt: nowIso()
    }));
    list[idx].attachments = (list[idx].attachments || []).concat(attachments);
    list[idx].updatedAt = nowIso();
    await upsertIncident(list[idx]);
    res.status(201).json({ ok: true, attachments });
  } catch (e) { next(e); }
});

router.delete('/:id/attachments/:attachId', async (req, res, next) => {
  try {
    const list = await readIncidents();
    const idx = list.findIndex((i) => i.id === req.params.id);
    if (idx === -1) throw new HttpError(404, 'Incident not found');
    const before = (list[idx].attachments || []).length;
    const removed = (list[idx].attachments || []).find((a) => a.id === req.params.attachId);
    list[idx].attachments = (list[idx].attachments || []).filter((a) => a.id !== req.params.attachId);
    if (list[idx].attachments.length === before) throw new HttpError(404, 'Attachment not found');
    if (removed && removed.stored) {
      fs.unlink(path.join(paths.UPLOADS_DIR, removed.stored), () => {});
    }
    list[idx].updatedAt = nowIso();
    await upsertIncident(list[idx]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
