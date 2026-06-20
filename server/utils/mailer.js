const nodemailer = require('nodemailer');
const { readSettings } = require('./storage');
const { logger } = require('./logger');

async function buildTransport() {
  logger.info('[mailer] buildTransport called');

  const s = await readSettings();
  const e = s.email || {};

  logger.info('[mailer] email config loaded');

  if (!e.smtp) {
    throw new Error('SMTP not configured');
  }

  const { host, port, user, pass, secure } = e.smtp;

  if (!host || !port) {
    throw new Error('SMTP host/port missing');
  }

  if (!user || !pass) {
    throw new Error('SMTP user/password missing');
  }

  logger.info(`[mailer] connecting to ${host}:${port} as ${user}`);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: !!secure,
    auth: {
      user,
      pass
    }
  });

  // IMPORTANT: verify connection early
  await transporter.verify()
    .then(() => logger.info('[mailer] SMTP verified successfully'))
    .catch(err => {
      logger.error('[mailer] SMTP verify failed', err);
      throw err;
    });

  return {
    transporter,
    from: e.from || user,
    recipients: e.recipients || [],
    enabled: !!e.enabled,
    triggers: e.triggers || {},
    incidentEmailsOn: !!(s.notifications && s.notifications.incidentEmails),
    orgName: (s.organization && s.organization.name) || 'OpsPilot EMS'
  };
}

// ---------------- EMAIL SEND ----------------
async function notifyIncident(incident, eventKind) {
  logger.info(`[mailer] notifyIncident -> ${eventKind} ${incident.id}`);

  try {
    const cfg = await buildTransport();

    if (!cfg.enabled) return { ok: false, skipped: 'disabled' };
    if (!cfg.recipients.length) return { ok: false, skipped: 'no-recipients' };

    const allowed =
      (eventKind === 'created' && cfg.triggers.onCreate !== false) ||
      (eventKind === 'stateChanged' && cfg.triggers.onStateChange !== false) ||
      (eventKind === 'resolved' && cfg.triggers.onResolved !== false);

    if (!allowed) return { ok: false, skipped: 'trigger-off' };

    const subject = `Incident ${incident.id} - ${incident.title}`;

    const info = await cfg.transporter.sendMail({
      from: cfg.from,
      to: cfg.recipients.join(','),
      subject,
      text: `Incident Update: ${incident.title}`,
      priority: 'high'
    });

    logger.info('[mailer] sent mail success', info.messageId);

    return { ok: true, messageId: info.messageId };

  } catch (err) {
    logger.error('[mailer ERROR]', err);
    return { ok: false, error: err.message };
  }
}

// ---------------- TEST EMAIL ----------------
async function sendTestEmail(toOverride) {
  const cfg = await buildTransport();

  const to = toOverride || cfg.recipients.join(',');
  if (!to) throw new Error('No recipient found');

  const info = await cfg.transporter.sendMail({
    from: cfg.from,
    to,
    subject: 'SMTP Test Email',
    text: 'SMTP working correctly',
    priority: 'high'
  });

  return { ok: true, messageId: info.messageId };
}

module.exports = {
  notifyIncident,
  sendTestEmail,
  buildTransport
};