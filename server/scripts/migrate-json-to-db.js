/**
 * One-time import of the legacy server/data/*.json files into Postgres.
 *
 * Run this once, after setting DATABASE_URL, if you have an existing
 * deployment whose server/data folder still holds real incidents/team/
 * settings data you want to keep. Safe to re-run: it upserts by id/key
 * and won't duplicate rows.
 *
 *   npm run migrate-json-to-db
 */
const fs = require('fs');
const path = require('path');
const { pool, ensureSchema } = require('../utils/db');
const { logger } = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');

function readJsonIfExists(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    logger.warn(`[migrate] could not parse ${file}: ${e.message}`);
    return null;
  }
}

async function migrateIncidents() {
  const list = readJsonIfExists('incidents.json');
  if (!Array.isArray(list) || list.length === 0) {
    logger.info('[migrate] incidents.json: nothing to import');
    return;
  }
  for (const item of list) {
    await pool.query(
      `INSERT INTO incidents (id, data, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [item.id, item, item.updatedAt || new Date().toISOString()]
    );
  }
  logger.info(`[migrate] imported ${list.length} incident(s)`);
}

async function migrateActivity() {
  const list = readJsonIfExists('activity.json');
  if (!Array.isArray(list) || list.length === 0) {
    logger.info('[migrate] activity.json: nothing to import');
    return;
  }
  for (const entry of list) {
    const id = entry.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    await pool.query(
      `INSERT INTO activity (id, data, ts) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, ts = EXCLUDED.ts`,
      [id, entry, entry.ts || new Date().toISOString()]
    );
  }
  logger.info(`[migrate] imported ${list.length} activity entr${list.length === 1 ? 'y' : 'ies'}`);
}

async function migrateTeam() {
  const list = readJsonIfExists('team.json');
  if (!Array.isArray(list) || list.length === 0) {
    logger.info('[migrate] team.json: nothing to import');
    return;
  }
  for (const member of list) {
    await pool.query(
      `INSERT INTO team_members (id, data, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [member.id, member, member.updatedAt || new Date().toISOString()]
    );
  }
  logger.info(`[migrate] imported ${list.length} team member(s)`);
}

async function migrateSettings() {
  const settings = readJsonIfExists('settings.json');
  if (!settings) {
    logger.info('[migrate] settings.json: nothing to import');
    return;
  }
  await pool.query(
    `INSERT INTO kv_store (key, value) VALUES ('settings', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [settings]
  );
  logger.info('[migrate] imported settings');
}

async function main() {
  await ensureSchema();
  await migrateIncidents();
  await migrateActivity();
  await migrateTeam();
  await migrateSettings();
  await pool.end();
  logger.info('[migrate] done');
}

main().catch((err) => {
  logger.error('[migrate] failed:', err.message);
  process.exit(1);
});
