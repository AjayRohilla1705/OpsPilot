/**
 * Postgres-backed storage. Each entity is stored as a JSONB document so the
 * existing flexible incident/team/settings shapes didn't need a relational
 * redesign — only the persistence layer changed. Every function below keeps
 * the exact same name/signature it had as a JSON-file store, so none of the
 * route files needed to change.
 */
const path = require('path');
const fs = require('fs');
const { pool, ensureSchema } = require('./db');
const { logger } = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const DEFAULT_SETTINGS = {
  organization: { name: 'Fareportal — Incident Management' },
  notifications: {
    emailDigest: true,
    browserPush: false,
    slackMentions: true,
    incidentEmails: false
  },
  email: {
    enabled: false,
    smtp: {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: '',
      pass: ''
    },
    from: '',
    recipients: [],
    triggers: {
      onCreate: true,
      onStateChange: true,
      onResolved: true
    }
  },
  sla: { P1: 2, P2: 8, P3: 24, P4: 72 },
  categories: ['Network', 'Hardware', 'Software', 'Security', 'Power', 'Other'],
  updatedAt: null,
  updatedBy: null
};

const SETTINGS_KEY = 'settings';
const ACTIVITY_CAP = 500;

async function ensureStorage() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  await ensureSchema();

  const { rows } = await pool.query('SELECT 1 FROM kv_store WHERE key = $1', [SETTINGS_KEY]);
  if (rows.length === 0) {
    await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2)', [SETTINGS_KEY, DEFAULT_SETTINGS]);
    logger.info('[storage] seeded settings');
  }
}

// ---------------- Incidents ----------------
async function readIncidents() {
  const { rows } = await pool.query('SELECT data FROM incidents ORDER BY updated_at DESC');
  return rows.map((r) => r.data);
}

// Single-row write used by create/update/delete so one request can never
// clobber another request's concurrent change to a *different* incident.
// (This used to read the whole incidents table, mutate it in memory, then
// TRUNCATE + rewrite everything — two requests racing each other would have
// the second one's stale in-memory snapshot overwrite the first one's
// change, silently dropping it. That's how created/edited incidents were
// vanishing under concurrent use.)
async function upsertIncident(item) {
  await pool.query(
    `INSERT INTO incidents (id, data, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [item.id, item, item.updatedAt || new Date().toISOString()]
  );
}

async function deleteIncidentById(id) {
  await pool.query('DELETE FROM incidents WHERE id = $1', [id]);
}

// ---------------- Activity ----------------
async function readActivity() {
  const { rows } = await pool.query('SELECT data FROM activity ORDER BY ts DESC LIMIT $1', [ACTIVITY_CAP]);
  return rows.map((r) => r.data);
}

async function appendActivity(entry) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const full = { id, ...entry };
  const ts = entry.ts || new Date().toISOString();
  await pool.query('INSERT INTO activity (id, data, ts) VALUES ($1, $2, $3)', [id, full, ts]);
  // Trim anything beyond the cap, oldest first.
  await pool.query(`
    DELETE FROM activity WHERE id IN (
      SELECT id FROM activity ORDER BY ts DESC OFFSET $1
    )
  `, [ACTIVITY_CAP]);
}

// ---------------- Settings ----------------
async function readSettings() {
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [SETTINGS_KEY]);
  const data = rows[0] ? rows[0].value : {};
  const d = DEFAULT_SETTINGS;
  return {
    organization:  { ...d.organization,  ...(data.organization  || {}) },
    notifications: { ...d.notifications, ...(data.notifications || {}) },
    email: {
      enabled:    typeof (data.email && data.email.enabled) === 'boolean' ? data.email.enabled : d.email.enabled,
      smtp:       { ...d.email.smtp, ...((data.email && data.email.smtp) || {}) },
      from:       (data.email && typeof data.email.from === 'string') ? data.email.from : d.email.from,
      recipients: Array.isArray(data.email && data.email.recipients) ? data.email.recipients.slice() : d.email.recipients.slice(),
      triggers:   { ...d.email.triggers, ...((data.email && data.email.triggers) || {}) }
    },
    sla:           { ...d.sla,           ...(data.sla           || {}) },
    categories:    Array.isArray(data.categories) ? data.categories.slice() : d.categories.slice(),
    updatedAt:     data.updatedAt || null,
    updatedBy:     data.updatedBy || null
  };
}

async function writeSettings(settings) {
  await pool.query(
    `INSERT INTO kv_store (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SETTINGS_KEY, settings]
  );
}

// ---------------- Team ----------------
async function readTeam() {
  const { rows } = await pool.query('SELECT data FROM team_members ORDER BY updated_at ASC');
  return rows.map((r) => r.data);
}

// Single-row write — see upsertIncident() above for why create/update/delete
// must not go through the read-all/truncate/write-all path.
async function upsertTeamMember(member) {
  await pool.query(
    `INSERT INTO team_members (id, data, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [member.id, member, member.updatedAt || new Date().toISOString()]
  );
}

async function deleteTeamMemberById(id) {
  await pool.query('DELETE FROM team_members WHERE id = $1', [id]);
}

module.exports = {
  ensureStorage,
  readIncidents,
  upsertIncident,
  deleteIncidentById,
  readActivity,
  appendActivity,
  readSettings,
  writeSettings,
  readTeam,
  upsertTeamMember,
  deleteTeamMemberById,
  DEFAULT_SETTINGS,
  paths: { DATA_DIR, UPLOADS_DIR }
};
