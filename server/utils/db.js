/**
 * Postgres connection pool + schema bootstrap.
 *
 * Storage moved off local JSON files (server/data/*.json) because hosts like
 * Replit Autoscale deployments reset the filesystem to the published image
 * whenever an idle instance spins down — anything written after the last
 * deploy (new incidents, team members, settings) was silently lost. Postgres
 * is a managed, persistent service the app talks to over the network, so
 * data survives restarts/redeploys/instance churn regardless of host.
 *
 * Requires DATABASE_URL (standard Postgres connection string). On Replit,
 * enable the "Database" pane — it sets DATABASE_URL automatically. On other
 * hosts (Render, Railway, Fly, Supabase, Neon, etc.) provision a Postgres
 * instance and set the same env var.
 */
const { Pool } = require('pg');
const { logger } = require('./logger');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. OpsPilot requires a Postgres database — ' +
    'see README.md > "Database setup" for how to provision one (Replit\'s ' +
    'Database pane sets this automatically; on other hosts, create a ' +
    'Postgres instance and set DATABASE_URL).'
  );
}

// Most managed Postgres providers (including Replit, Render, Railway, Neon)
// require SSL and present a cert that the default Node CA bundle won't
// chain to. Allow opting out for a local/self-hosted Postgres without SSL.
const useSsl = process.env.PGSSL !== 'disable';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  logger.error('[db] idle client error:', err.message);
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
  );
`;

let initPromise = null;

function ensureSchema() {
  if (!initPromise) {
    initPromise = pool.query(SCHEMA).then(() => {
      logger.info('[db] schema ready');
    });
  }
  return initPromise;
}

module.exports = { pool, ensureSchema };
