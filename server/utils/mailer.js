const nodemailer = require('nodemailer');
const { readSettings } = require('./storage');
const { logger } = require('./logger');

const SEV_LABEL = { 'P1': 'Critical', 'P2': 'High', 'P2-Low': 'Elevated', 'P3': 'Medium' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Build SMTP transport from settings */
async function buildTransport() {
  const s = await readSettings();
  const e = s.email || {};

  logger.info('[mailer] buildTransport loaded settings');

  if (!e.smtp || !e.smtp.host || !e.smtp.port) {
    throw new Error('SMTP host/port not configured in Settings');
  }

  if (!e.smtp.user || !e.smtp.pass) {
    throw new Error('SMTP user/password not configured in Settings');
  }

  return {
    transporter: nodemailer.createTransport({
      host: e.smtp.host,
      port: e.smtp.port,
      secure: !!e.smtp.secure,
      auth: {
        user: e.smtp.user,
        pass: e.smtp.pass
      }
    }),
    from: e.from || e.smtp.user,
    recipients: e.recipients || [],
    enabled: !!e.enabled,
    triggers: e.triggers || {},
    incidentEmailsOn: !!(s.notifications && s.notifications.incidentEmails),
    orgName: (s.organization && s.organization.name) || 'OpsPilot EMS'
  };
}

/** MAIN MAIL FUNCTION */
async function notifyIncident(incident, eventKind) {
  logger.info(`[mailer] notifyIncident -> ${eventKind} ${incident.id}`);

  try {
    const cfg = await buildTransport();

    if (!cfg.enabled) return;
    if (!cfg.incidentEmailsOn) return;
    if (!cfg.recipients.length) return;

    const { transporter, from, recipients, orgName } = cfg;

    const subject = `Incident ${incident.id} - ${incident.title}`;

    await transporter.sendMail({
      from,
      to: recipients.join(','),
      subject,
      text: `Incident update: ${incident.id}`,
      html: `<h3>${esc(incident.title)}</h3>`
    });

    logger.info(`[mailer] sent email for ${incident.id}`);
  } catch (err) {
    logger.error(`[mailer] failed ${incident.id}`);
    logger.error(err);
  }
}

/** TEST EMAIL */
async function sendTestEmail(toOverride) {
  const cfg = await buildTransport();
  const to = toOverride || cfg.recipients.join(',');

  return cfg.transporter.sendMail({
    from: cfg.from,
    to,
    subject: 'SMTP Test Email',
    text: 'SMTP is working'
  });
}

module.exports = {
  notifyIncident,
  sendTestEmail,
  buildTransport
};