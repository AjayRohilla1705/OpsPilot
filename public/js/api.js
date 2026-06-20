/* Lightweight fetch wrapper for the Sentinel backend.
 *
 * Every request carries an `x-user-role` header derived from the
 * logged-in session, so the backend's `requireAdmin` middleware can
 * refuse mutating actions for non-admin users. This is honor-system
 * auth (matches the project's "no JWT, no sessions" stance), but
 * keeps backend / frontend gating in sync.
 */
(function () {
  const BASE = '';

  function currentRole() {
    try {
      const s = JSON.parse(localStorage.getItem('sentinel.session') || 'null');
      return (s && s.role) || 'guest';
    } catch {
      return 'guest';
    }
  }

  async function call(method, path, body, opts = {}) {
    const headers = {
      Accept: 'application/json',
      'X-User-Role': currentRole()
    };
    const init = { method, headers };
    if (body !== undefined) {
      if (body instanceof FormData) {
        init.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }
    Object.assign(init, opts);
    // Merge user-supplied headers (rare) without losing the role header.
    if (opts.headers) init.headers = { ...headers, ...opts.headers };
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: 'BadJSON', message: text }; }
    if (!res.ok) {
      const err = new Error(data && data.message ? data.message : 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.api = {
    login: (username, password) => call('POST', '/api/auth/login', { username, password }),

    listIncidents: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return call('GET', '/api/incidents' + (qs ? `?${qs}` : ''));
    },
    getIncident:    (id)         => call('GET', `/api/incidents/${id}`),
    createIncident: (data)       => call('POST', '/api/incidents', data),
    updateIncident: (id, data)   => call('PUT', `/api/incidents/${id}`, data),
    deleteIncident: (id)         => call('DELETE', `/api/incidents/${id}`),
    addComment:     (id, payload)=> call('POST', `/api/incidents/${id}/comments`, payload),
    uploadAttachments: (id, files) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      return call('POST', `/api/incidents/${id}/attachments`, fd);
    },
    deleteAttachment: (id, attachId) => call('DELETE', `/api/incidents/${id}/attachments/${attachId}`),

    stats:   () => call('GET',  '/api/stats'),
    reports: () => call('GET',  '/api/reports'),

    // Team
    listTeam:     ()             => call('GET',    '/api/team'),
    getMember:    (id)           => call('GET',    `/api/team/${id}`),
    createMember: (data)         => call('POST',   '/api/team', data),
    updateMember: (id, data)     => call('PUT',    `/api/team/${id}`, data),
    deleteMember: (id)           => call('DELETE', `/api/team/${id}`),

    // Settings
    getSettings:    () => call('GET',  '/api/settings'),
    updateSettings: (patch) => call('PUT',  '/api/settings', patch),
    resetSettings:  () => call('POST', '/api/settings/reset'),
    testEmail:      (to) => call('POST', '/api/settings/test-email', to ? { to } : {})
  };
})();
