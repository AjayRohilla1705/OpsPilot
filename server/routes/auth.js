/**
 * Local-credentials auth. No JWT, no sessions.
 * Two hardcoded accounts:
 *   ADMIN / OnlyForAdmin@1331  — full access (Team CRUD, Settings, Activity Log)
 *   EMS   / Ems@1221           — restricted (no Team admin, no Activity Log,
 *                                 Settings view-only with locked admin sections)
 *
 * The login response includes the role; the frontend stores it in
 * `sentinel.session` and gates UI accordingly. Mutating API calls send
 * `x-user-role: <role>` so the backend can refuse non-admin writes.
 */
const express = require('express');
const router = express.Router();

const ACCOUNTS = {
  ADMIN: {
    username: 'ADMIN',
    password: 'OnlyForAdmin@1331',
    user: {
      username: 'ADMIN',
      displayName: 'Admin',
      role: 'admin',
      isAdmin: true,
      avatarInitials: 'A'
    }
  },
  EMS: {
    username: 'EMS',
    password: 'Ems@1221',
    user: {
      username: 'EMS',
      displayName: 'EMS Operator',
      role: 'user',
      isAdmin: false,
      avatarInitials: 'EM'
    }
  }
};

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }
  const acc = ACCOUNTS[username.trim().toUpperCase()];
  if (!acc || acc.password !== password) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }
  res.json({ ok: true, user: acc.user });
});

router.get('/me', (_req, res) => {
  res.json({ ok: true });
});

module.exports = router;
