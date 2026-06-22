const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const { readSettings } = require('./storage');
const { logger } = require('./logger');

async function notifyIncident(incident, eventKind) {

  logger.info(
    `[mailer] notifyIncident -> ${eventKind} ${incident.id}`
  );

  try {

    const s = await readSettings();

    const email = s.email || {};

    if (!email.enabled) {
      return { ok: false, skipped: 'disabled' };
    }

    if (!email.recipients || !email.recipients.length) {
      return { ok: false, skipped: 'no-recipients' };
    }

    const triggers = email.triggers || {};

    const allowed =
      (eventKind === 'created' && triggers.onCreate !== false) ||
      (eventKind === 'stateChanged' && triggers.onStateChange !== false) ||
      (eventKind === 'resolved' && triggers.onResolved !== false);

    if (!allowed) {
      return { ok: false, skipped: 'trigger-off' };
    }

    const subject =
      `OUTAGE | ${incident.severity || '-'} | ${incident.state || '-'} | ${incident.id || '-'} - ${incident.title || '-'}`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:900px;margin:auto;">

        <table width="100%" cellpadding="10" cellspacing="0"
          style="border-collapse:collapse;border:1px solid #ccc;">

          <tr>
            <td colspan="2"
              style="
                background:#3f6ec4;
                color:white;
                font-size:24px;
                font-weight:bold;
              ">
              IT Ops Major Outage Update
            </td>
          </tr>

          <tr>
            <td style="font-weight:bold;border:1px solid #ccc;">
              Severity
            </td>

            <td style="border:1px solid #ccc;">
              ${incident.severity || '-'}
            </td>
          </tr>

          <tr>
            <td style="font-weight:bold;border:1px solid #ccc;">
              Incident ID
            </td>

            <td style="border:1px solid #ccc;">
              ${incident.id || '-'}
            </td>
          </tr>

          <tr>
            <td style="font-weight:bold;border:1px solid #ccc;">
              Affected Service
            </td>

            <td style="border:1px solid #ccc;">
              ${incident.title || '-'}
            </td>
          </tr>

          <tr>
            <td style="font-weight:bold;border:1px solid #ccc;">
              Status
            </td>

            <td style="border:1px solid #ccc;">
              ${incident.state || '-'}
            </td>
          </tr>

          <tr>
            <td style="font-weight:bold;border:1px solid #ccc;">
              Description
            </td>

            <td style="border:1px solid #ccc;">
              ${incident.incidentDescription || '-'}
            </td>
          </tr>

          <tr>
            <td style="font-weight:bold;border:1px solid #ccc;">
              Incident Manager
            </td>

            <td style="border:1px solid #ccc;">
              ${incident.assignee || 'Ajay Rohilla'}
            </td>
          </tr>

          <tr>
            <td style="font-weight:bold;border:1px solid #ccc;">
              Created At
            </td>

            <td style="border:1px solid #ccc;">
              ${incident.createdAt || '-'}
            </td>
          </tr>

        </table>

      </div>
    `;

    const response = await resend.emails.send({

      from: email.from,

      to: email.recipients,

      subject,

      html

    });

    logger.info(
      '[mailer] Resend success',
      response
    );

    return {

      ok: true,

      response

    };

  } catch (err) {

    logger.error(
      '[mailer ERROR]',
      err
    );

    return {

      ok: false,

      error: err.message

    };

  }

}

async function sendTestEmail(toOverride) {

  const s = await readSettings();

  const email = s.email || {};

  const to = toOverride || email.recipients;

  const response = await resend.emails.send({

    from: email.from,

    to,

    subject: 'OpsPilot Test Email',

    html: `
      <h2>OpsPilot Email Test</h2>

      <p>
        Congratulations 🎉
      </p>

      <p>
        Resend integration is working successfully.
      </p>
    `

  });

  logger.info(
    'TEST EMAIL RESPONSE =',
    response
  );

  return {

    ok: true,

    response

  };

}

module.exports = {

  notifyIncident,

  sendTestEmail

};

