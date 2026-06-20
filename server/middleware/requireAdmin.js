/**
 * Honor-system admin guard. There is no real backend auth (per project
 * constraints) — the frontend sends `x-user-role` from the logged-in
 * session and we reject mutating requests when it's missing or not "admin".
 *
 * This is *not* security in the cryptographic sense; it's an integrity
 * check that complements the frontend gating. A determined caller can
 * forge the header with curl. The product is single-tenant + local, so
 * this trade-off matches the project's documented stance on auth.
 */
function requireAdmin(req, res, next) {
  const role = String(req.header('x-user-role') || '').toLowerCase();
  if (role !== 'admin') {
    return res.status(403).json({
      ok: false,
      error: 'Forbidden',
      message: 'Admin role required for this action.'
    });
  }
  next();
}

module.exports = { requireAdmin };
