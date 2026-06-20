#!/usr/bin/env node
/**
 * Pre-start helper — frees the port we're about to listen on by killing any
 * process currently bound to it. Runs automatically before `npm start` via
 * the `prestart` script in package.json.
 *
 * Why this exists: when a previous `npm start` session is closed without
 * Ctrl+C (e.g. closing the PowerShell window), the Node process can be
 * orphaned and keep the port busy. The next `npm start` then fails with
 * EADDRINUSE. This helper makes the boot resilient to that.
 */
const { execSync } = require('child_process');

const PORT = process.env.PORT || 4000;
const isWin = process.platform === 'win32';

function tryKill() {
  if (isWin) {
    // PowerShell one-liner — pipes any TCP connection on PORT into Stop-Process.
    // -ErrorAction SilentlyContinue means: if nothing is bound, just exit OK.
    execSync(
      `powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {} }"`,
      { stdio: 'pipe' }
    );
  } else {
    // POSIX (macOS, Linux) — `lsof -ti` lists PIDs holding the port; xargs -r
    // only runs kill if there's at least one PID, so an empty list is OK.
    execSync(`lsof -ti:${PORT} | xargs -r kill -9`, { stdio: 'pipe', shell: '/bin/sh' });
  }
}

try {
  tryKill();
  // Small grace so the OS finishes releasing the socket before listen() runs.
  setTimeout(() => process.exit(0), 200);
} catch (e) {
  // We don't actually care if nothing was bound — that's the happy case.
  process.exit(0);
}
