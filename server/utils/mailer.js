/**
 * Sentinel EMS mailer.
 *
 * Sends full-detail incident emails via SMTP using nodemailer. The
 * template intentionally mirrors the production "IT Ops Major Outage
 * Update" notification format — fixed subject pattern, structured
 * table body with EST timestamps + IST cross-reference, high-importance
 * flag — so recipients see the same shape regardless of which system
 * fired the alert.
 *
 * Subject:  {OUTAGE_TYPE} | {SEV}-{LABEL} | {STATE} | {ID} - {TITLE}
 *
 * Sending is always fire-and-forget from the caller's perspective:
 * `notifyIncident(...)` resolves after attempting delivery, but the
 * incident routes that call it do NOT await it — a slow or broken
 * mail server must never block incident creation.
 */
const nodemailer = require('nodemailer');
const { readSettings } = require('./storage');
const { logger } = require('./logger');

const SEV_LABEL = { 'P1': 'Critical', 'P2': 'High', 'P2-Low': 'Elevated', 'P3': 'Medium' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function escNl(s) { return esc(s).replace(/\n/g, '<br/>'); }
function pad(n) { return String(n).padStart(2, '0'); }

/** Format an ISO date as "DD-MM-YYYY HH:MM" in EST (fixed UTC-5, no DST). */
function fmtDateEST(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const est = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return `${pad(est.getUTCDate())}-${pad(est.getUTCMonth() + 1)}-${est.getUTCFullYear()} ${pad(est.getUTCHours())}:${pad(est.getUTCMinutes())}`;
}

/** "{h}.{mm} {AM/PM} EST /{h}.{mm} {AM/PM} IST" — used as the steps-progress timestamp header. */
function fmtTimeBothZones(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const est = new Date(d.getTime() - 5 * 60 * 60 * 1000);          // UTC-5
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);   // UTC+5:30
  const h12 = (date) => {
    const h = date.getUTCHours();
    const m = date.getUTCMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 || 12;
    return `${hh}.${pad(m)} ${ampm}`;
  };
  return `${h12(est)} EST /${h12(ist)} IST`;
}

/** Total elapsed time between two ISO timestamps as HH:MM:SS. Empty if undefined / inverted. */
function totalDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const s = new Date(startIso), e = new Date(endIso);
  if (isNaN(s) || isNaN(e) || e < s) return '';
  let secs = Math.floor((e - s) / 1000);
  const hh = Math.floor(secs / 3600); secs -= hh * 3600;
  const mm = Math.floor(secs / 60);  secs -= mm * 60;
  return `${pad(hh)}:${pad(mm)}:${pad(secs)}`;
}

/** Detect a hyperlink-ish value (full URL or scheme-prefixed) for Bridge Details. */
function looksLikeUrl(s) { return /^https?:\/\//i.test(String(s || '').trim()); }

/** Build the structured HTML body — mirrors the production screenshot
 *  layout: blue title bar → category/importance → main details table →
 *  status table → steps/progress table. Inline styles only (Outlook). */
function buildIncidentEmail(incident, orgName, eventKind) {
  const sev      = incident.severity || 'P3';
  const sevLabel = SEV_LABEL[sev] || 'Medium';
  const type     = (incident.outageType || 'IT EVENT').toUpperCase();
  const state    = incident.state || 'Live';
  const title    = incident.title || '(untitled)';

  // --- Strict subject format (matches the production screenshot) ---
  const subject = `${type} | ${sev}-${sevLabel} | ${state} | ${incident.id} - ${title}`
    .slice(0, 250);

  // --- Body fields ---
  const services    = (incident.affectedServices || []).join(', ') || '—';
  const det         = incident.incidentDetails || {};
  const startEst    = fmtDateEST(det.incidentStart) || '—';
  const endEst      = fmtDateEST(det.incidentEnd)   || '—';
  const duration    = totalDuration(det.incidentStart, det.incidentEnd) || '00:00:00';
  const description = incident.incidentDescription || '—';
  const manager     = incident.owner || incident.updatedBy || '—';
  const bridgeRaw   = incident.bridgeDetails || '';
  const bridgeHtml  = !bridgeRaw
    ? '—'
    : looksLikeUrl(bridgeRaw)
      ? `<a href="${esc(bridgeRaw)}" style="color:#0563C1;text-decoration:underline;">Join the meeting</a>`
      : escNl(bridgeRaw);
  const adoIdHtml = `<span style="font-weight:bold;">${esc(incident.id)}</span>`;

  // --- Steps / progress ---
  const stepArr = (incident.stepsToResolve || []).filter((s) => s && String(s).trim());
  const progressHeader = fmtTimeBothZones(incident.updatedAt || incident.createdAt || new Date().toISOString());
  const stepsHtml = stepArr.length
    ? `<ul style="margin:6px 0 0 18px; padding:0; color:#000;">${
        stepArr.map((s) => `<li style="margin:0 0 4px;">${escNl(s)}</li>`).join('')
      }</ul>`
    : '<div style="color:#777; font-style:normal;">No steps recorded yet.</div>';

  // --- Event-aware top-bar title ---
  const TITLE_BY_KIND = {
    created:      'IT Ops Major Outage Update',
    stateChanged: 'IT Ops Major Outage Update',
    resolved:     'IT Ops Major Outage Update'
  };
  const heading = TITLE_BY_KIND[eventKind] || 'IT Ops Major Outage Update';

  // --- Constants for table styling (inline) ---
  const TABLE = 'border-collapse:collapse; border:1px solid #000; width:100%; font-size:13px; color:#000;';
  const TD    = 'border:1px solid #000; padding:6px 8px; vertical-align:top;';
  const LABEL = `${TD} background:#f0f0f0; font-weight:bold; width:200px;`;
  const FONT  = 'font-family:\'Segoe UI\',Calibri,Arial,sans-serif;';

  const html = `<!doctype html>
<html>
<body style="margin:0; padding:0; background:#f4f4f4; ${FONT} color:#000;">
  <div style="max-width:720px; margin:18px auto; background:#ffffff; border:1px solid #d0d0d0; padding:0;">

    <!-- Blue header bar -->
    <div style="background:#4472C4; color:#ffffff; padding:10px 14px; font-weight:bold; font-size:14px;">
      ${esc(heading)}
    </div>

    <!-- Category / importance lines (Outlook-style labels) -->
    <div style="padding:8px 14px 2px; font-size:11px; color:#444;">
      <span style="color:#7e6a00;">▣</span>
      <span style="margin-left:4px;">${esc(sevLabel)}, ${esc(sev)} - Notification</span>
    </div>
    <div style="padding:2px 14px 12px; font-size:11px;">
      <span style="color:#cc0000; font-weight:bold;">!</span>
      <span style="color:#777; margin-left:4px;">High importance</span>
    </div>

    <!-- ===== Main details table ===== -->
    <div style="padding:0 14px 14px;">
      <table cellpadding="0" cellspacing="0" border="0" style="${TABLE} ${FONT}">
        <tr>
          <td style="${LABEL}">Affected Service(s):</td>
          <td style="${TD}" colspan="3">${esc(services)}</td>
        </tr>
        <tr>
          <td style="${LABEL}">ADO Workitem:</td>
          <td style="${TD}" colspan="3">${adoIdHtml}</td>
        </tr>
        <tr>
          <td style="${LABEL}">Incident Start Date<br/>&amp; Time (EST):</td>
          <td style="${TD}">${esc(startEst)}</td>
          <td style="${LABEL}">Incident End Date<br/>&amp; Time (EST):</td>
          <td style="${TD}">${esc(endEst)}</td>
        </tr>
        <tr>
          <td style="${LABEL}">Total Outage Duration:</td>
          <td style="${TD} text-align:center;" colspan="3">${esc(duration)}</td>
        </tr>
        <tr>
          <td style="${LABEL}">Incident Description:</td>
          <td style="${TD}" colspan="3">${escNl(description)}</td>
        </tr>
        <tr>
          <td style="${LABEL}">Current Incident Manager:</td>
          <td style="${TD}" colspan="3">${esc(manager)}</td>
        </tr>
        <tr>
          <td style="${LABEL}">Bridge Details:</td>
          <td style="${TD}" colspan="3">${bridgeHtml}</td>
        </tr>
      </table>
    </div>

    <!-- ===== Current status ===== -->
    <div style="padding:0 14px 14px;">
      <table cellpadding="0" cellspacing="0" border="0" style="${TABLE} ${FONT}">
        <tr>
          <td style="${LABEL}">Current Status:</td>
          <td style="${TD} text-align:center; font-weight:bold;">${esc(state)}</td>
        </tr>
      </table>
    </div>

    <!-- ===== Steps taken / progress ===== -->
    <div style="padding:0 14px 14px;">
      <table cellpadding="0" cellspacing="0" border="0" style="${TABLE} ${FONT}">
        <tr>
          <td style="${LABEL}">Steps taken/Progress<br/>since last update:</td>
          <td style="${TD}">
            <p style="margin:0 0 8px; font-weight:bold;">Following steps have been taken:</p>
            <p style="margin:0 0 4px; font-weight:bold;">${esc(progressHeader)}</p>
            ${stepsHtml}
          </td>
        </tr>
      </table>
    </div>

  </div>

  <div style="max-width:720px; margin:0 auto; padding:6px 14px 16px; font-size:10px; color:#999; text-align:center;">
    Sent automatically by ${esc(orgName)} · OpsPilot EMS · ${esc(new Date().toISOString())}
  </div>
</body>
</html>`;

  // --- Plaintext fallback (clients that don't render HTML) ---
  const text = [
    subject,
    '',
    `Affected Service(s):           ${services}`,
    `ADO Workitem:                  ${incident.id}`,
    `Incident Start (EST):          ${startEst}`,
    `Incident End (EST):            ${endEst}`,
    `Total Outage Duration:         ${duration}`,
    `Incident Description:          ${description}`,
    `Current Incident Manager:      ${manager}`,
    `Bridge Details:                ${bridgeRaw || '—'}`,
    '',
    `Current Status:                ${state}`,
    '',
    'Steps taken / Progress since last update:',
    `  ${progressHeader}`,
    ...(stepArr.length ? stepArr.map((s) => `   • ${s}`) : ['   (No steps recorded yet.)']),
    '',
    `— OpsPilot EMS`
  ].join('\n');

  return { subject, html, text };
}

/**
 * Build the nodemailer transporter from the current settings.email block.
 * Throws a clear error if anything is missing — caller decides whether
 * to surface or swallow.
 */
async function buildTransport() {
 async function buildTransport() {

  console.log("STEP 1 - Entered buildTransport");

  const s = await readSettings();

  console.log("STEP 2 - Settings loaded");
  console.log(JSON.stringify(s.email, null, 2));

  const e = s.email || {};

  console.log("STEP 3 - Email object created");

  if (!e.smtp || !e.smtp.host || !e.smtp.port) {
    throw new Error('SMTP host/port not configured in Settings → Email Delivery.');
  }

  console.log("STEP 4 - SMTP config OK");

  if (!e.smtp.user || !e.smtp.pass) {
    throw new Error(
      'SMTP user/password not configured in Settings → Email Delivery.'
    );
  }

  console.log("STEP 5 - Username and password OK");

  return {
    transporter: nodemailer.createTransport({
      host: e.smtp.host,
      port: e.smtp.port,
      secure: !!e.smtp.secure,

      auth: {
        user: e.smtp.user,
        pass: e.smtp.pass
      },

      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    }),

    from: e.from || e.smtp.user,
    recipients: e.recipients || [],
    enabled: !!e.enabled,
    triggers: e.triggers || {},
    incidentEmailsOn: !!(
      s.notifications &&
      s.notifications.incidentEmails
    ),

    orgName:
      (s.organization && s.organization.name) ||
      'OpsPilot EMS'
  };
}
  return {
    transporter: nodemailer.createTransport({
      host: e.smtp.host,
      port: e.smtp.port,
      secure: !!e.smtp.secure,
      auth: { user: e.smtp.user, pass: e.smtp.pass }
    }),
    from: e.from || e.smtp.user,
    recipients: e.recipients || [],
    enabled: !!e.enabled,
    triggers: e.triggers || {},
    incidentEmailsOn: !!(s.notifications && s.notifications.incidentEmails),
    orgName: (s.organization && s.organization.name) || 'OpsPilot EMS'
  };
}

/**
 * Fire-and-forget: never rejects to the caller. Logs failures clearly.
 * Sets `priority: 'high'` on the outgoing message so Outlook flags it
 * with the "! High importance" indicator — matching the production
 * notification format.
 */
async function notifyIncident(incident, eventKind) {
  logger.info(
  `[mailer] notifyIncident called -> ${eventKind} ${incident.id}`
);
  try {
    const cfg = await buildTransport();
    if (!cfg.enabled)           { logger.info('[mailer] skip — email.enabled=false');            return { ok: false, skipped: 'disabled' }; }
    if (!cfg.incidentEmailsOn)  { logger.info('[mailer] skip — incidentEmails toggle off');      return { ok: false, skipped: 'toggle-off' }; }
    if (!cfg.recipients.length) { logger.info('[mailer] skip — no recipients configured');      return { ok: false, skipped: 'no-recipients' }; }

    const triggerOk =
      (eventKind === 'created'      && cfg.triggers.onCreate      !== false) ||
      (eventKind === 'stateChanged' && cfg.triggers.onStateChange !== false) ||
      (eventKind === 'resolved'     && cfg.triggers.onResolved    !== false);
    if (!triggerOk) { logger.info(`[mailer] skip — trigger "${eventKind}" disabled`); return { ok: false, skipped: 'trigger-off' }; }

    const { subject, html, text } = buildIncidentEmail(incident, cfg.orgName, eventKind);
    const info = await cfg.transporter.sendMail({
      from: cfg.from,
      to: cfg.recipients.join(', '),
      subject,
      html,
      text,
      priority: 'high'
    });
    logger.info(`[mailer] sent "${eventKind}" #${incident.id} → ${cfg.recipients.length} recipient(s) · messageId=${info.messageId}`);
    return { ok: true, messageId: info.messageId, recipients: cfg.recipients };
  } catch (err) {
    logger.error(
    `[mailer] failed to send "${eventKind}" #${incident && incident.id}`
  );

  logger.error('[mailer full error]', err);

  return {
    ok: false,
    error: err.message };
  }
}

/**
 * Send a synthetic test email to confirm SMTP config works. Surfaces
 * errors to the caller — unlike notifyIncident which always resolves.
 */
async function sendTestEmail(toOverride) {
  const cfg = await buildTransport();
  const to = toOverride || cfg.recipients.join(', ');
  if (!to) throw new Error('Add at least one recipient (or pass a "to" address) before sending a test.');

  const info = await cfg.transporter.sendMail({
    from: cfg.from,
    to,
    subject: `[OpsPilot · test] ${cfg.orgName} — email delivery is working`,
    html: `<div style="font-family:'Segoe UI',Calibri,Arial,sans-serif; padding:24px; background:#f4f4f4;">
      <div style="max-width:560px; margin:0 auto; background:#fff; border:1px solid #d0d0d0; padding:0;">
        <div style="background:#4472C4; color:#fff; padding:10px 14px; font-weight:bold;">OpsPilot EMS · Test email</div>
        <div style="padding:18px 14px;">
          <p style="margin:0 0 10px;">If you're seeing this, the SMTP configuration works and incident notifications will arrive at this address whenever they're triggered.</p>
          <p style="margin:0; color:#777; font-size:12px;">Sent at ${esc(new Date().toISOString())}</p>
        </div>
      </div>
    </div>`,
    text: `OpsPilot EMS — email delivery is working. Sent at ${new Date().toISOString()}.`,
    priority: 'high'
  });
  return { ok: true, messageId: info.messageId, to };
}

module.exports = { notifyIncident, sendTestEmail, buildIncidentEmail };
