/**
 * Sentinel EMS — Express server
 * Serves the static frontend and exposes a JSON-file-backed REST API.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');

const authRouter = require('./routes/auth');
const incidentsRouter = require('./routes/incidents');
const statsRouter = require('./routes/stats');
const teamRouter = require('./routes/team');
const activityRouter = require('./routes/activity');
const settingsRouter = require('./routes/settings');
const reportsRouter = require('./routes/reports');

const { logger } = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { ensureStorage } = require('./utils/storage');

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const UPLOADS_DIR = path.resolve(__dirname, 'data', 'uploads');

const app = express();

// Lightweight request logger
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Body parsing with generous limits to allow long RCA narratives
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

// Security headers — keep it simple, no auth library
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// API
app.use('/api/auth', authRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/team', teamRouter);
app.use('/api/activity', activityRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/reports', reportsRouter);

// Uploads (served read-only)
app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: true, maxAge: '1d' }));

// Static frontend
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// SPA-like fallback to login page for unknown HTML routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Walk every network interface and collect the IPv4 addresses we can advertise
 * — skipping anything internal (loopback) or non-IPv4. So when the server
 * boots, the operator sees the *exact* URLs other devices on the LAN should use.
 */
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push({ iface: name, address: net.address });
    }
  }
  return out;
}

/**
 * Storage must be ready (Postgres schema created/verified) before the server
 * accepts traffic, so this boots asynchronously rather than calling
 * app.listen() at module load time.
 */
async function main() {
  await ensureStorage();

  // Bind to 0.0.0.0 explicitly so the server is reachable from *every* network
  // interface (Wi-Fi, Ethernet, etc.), not just localhost. Without this on some
  // configurations Node will only listen on the loopback interface, and other
  // machines on the LAN can't connect.
  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    const lans = lanAddresses();
    logger.info(`╭───────────────────────────────────────────────────────────────╮`);
    logger.info(`│  OpsPilot EMS  ·  Incident Intelligence                       │`);
    logger.info(`│                                                               │`);
    logger.info(`│  Local:    http://localhost:${PORT}                              │`);
    if (lans.length === 0) {
      logger.info(`│  Network:  (no LAN interface detected — Wi-Fi disconnected?)  │`);
    } else {
      lans.forEach((lan, i) => {
        const label = i === 0 ? 'Network:  ' : '          ';
        logger.info(`│  ${label}http://${lan.address}:${PORT}   (${lan.iface})`);
      });
    }
    logger.info(`│                                                               │`);
    logger.info(`│  Login:    EMS  /  Ems@1221                                   │`);
    logger.info(`╰───────────────────────────────────────────────────────────────╯`);
    if (lans.length > 0) {
      logger.info(`Open one of the "Network" URLs above from any other device on the same Wi-Fi.`);
      logger.info(`If it doesn't load, the Windows Firewall is most likely blocking inbound port ${PORT}.`);
      logger.info(`See README.md > "Sharing the server on your LAN" for the one-line firewall fix.`);
    }
  });

  /**
   * Friendlier failure handling. If `prestart` couldn't free the port (e.g. the
   * blocker is a non-Node process or PowerShell is restricted), Express bubbles
   * up an EADDRINUSE error. The default stack trace is intimidating — replace
   * it with a clear, actionable message.
   */
  httpServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      logger.error('');
      logger.error(`  Port ${PORT} is already in use by another program.`);
      logger.error('');
      logger.error('  Free it and try again:');
      logger.error('');
      logger.error('    Get-NetTCPConnection -LocalPort ' + PORT + ' -ErrorAction SilentlyContinue |');
      logger.error('      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }');
      logger.error('');
      logger.error(`  Or run on a different port:    $env:PORT = "4001"; npm start`);
      logger.error('');
      process.exit(1);
    }
    logger.error('[server.error]', err);
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error('[server] failed to start:', err.message);
  process.exit(1);
});
