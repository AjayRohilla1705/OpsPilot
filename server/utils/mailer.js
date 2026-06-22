```javascript
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
      return { ok:false, skipped:'disabled' };
    }

    if (!email.recipients || !email.recipients.length) {
      return { ok:false, skipped:'no-recipients' };
    }

    const allowed =

      (eventKind === 'created' &&
       email.triggers.onCreate !== false)

      ||

      (eventKind === 'stateChanged' &&
       email.triggers.onStateChange !== false)

      ||

      (eventKind === 'resolved' &&
       email.triggers.onResolved !== false);


    if (!allowed) {

      return {

        ok:false,

        skipped:'trigger-off'

      };

    }


    const subject =
      `OUTAGE | ${incident.severity} | ${incident.state} | ${incident.id} - ${incident.title}`;


    const html = `

    <div style="font-family:Arial,sans-serif;width:900px;margin:auto;">

      <table width="100%"
             cellspacing="0"
             cellpadding="12"
             style="border-collapse:collapse;border:1px solid #ccc;">

        <tr>

          <td colspan="4"
              style="
              background:#3f6ec4;
              color:white;
              font-size:22px;
              font-weight:bold;">

            IT Ops Major Outage Update

          </td>

        </tr>

        <tr>

          <td colspan="4">

            ▣ ${incident.severity} - Notification

            <br><br>

            ❗ High Importance

          </td>

        </tr>


        <tr>

          <td style="font-weight:bold;border:1px solid #ccc;">

            Affected Service(s):

          </td>

          <td colspan="3"
              style="border:1px solid #ccc;">

            ${incident.title}

          </td>

        </tr>


        <tr>

          <td style="font-weight:bold;border:1px solid #ccc;">

            ADO Workitem:

          </td>

          <td colspan="3"
              style="border:1px solid #ccc;font-weight:bold;">

            ${incident.id}

          </td>

        </tr>


        <tr>

          <td style="font-weight:bold;border:1px solid #ccc;">

            Incident Start Date & Time

          </td>

          <td style="border:1px solid #ccc;">

            ${incident.createdAt || '-'}

          </td>


          <td style="font-weight:bold;border:1px solid #ccc;">

            Incident End Date & Time

          </td>

          <td style="border:1px solid #ccc;">

            ${incident.resolvedAt || '-'}

          </td>

        </tr>


        <tr>

          <td style="font-weight:bold;border:1px solid #ccc;">

            Total Outage Duration:

          </td>

          <td colspan="3"
              style="
              border:1px solid #ccc;
              text-align:center;">

            ${incident.duration || '-'}

          </td>

        </tr>


        <tr>

          <td style="font-weight:bold;border:1px solid #ccc;">

            Incident Description:

          </td>

          <td colspan="3"
              style="border:1px solid #ccc;">

            ${incident.incidentDescription || '-'}

          </td>

        </tr>


        <tr>

          <td style="font-weight:bold;border:1px solid #ccc;">

            Current Incident Manager:

          </td>

          <td colspan="3"
              style="border:1px solid #ccc;">

            ${incident.assignee || 'Ajay Rohilla'}

          </td>

        </tr>


        <tr>

          <td style="font-weight:bold;border:1px solid #ccc;">

            Bridge Details:

          </td>

          <td colspan="3"
              style="border:1px solid #ccc;">

            ${
              incident.bridgeLink
              ? `<a href="${incident.bridgeLink}">
                    Join the meeting
                 </a>`
              : '-'
            }

          </td>

        </tr>


        <tr>

          <td style="font-weight:bold;border:1px solid #ccc;">

            Current Status:

          </td>

          <td colspan="3"
              style="
              border:1px solid #ccc;
              text-align:center;
              font-weight:bold;">

            ${incident.state}

          </td>

        </tr>


        <tr>

          <td style="
              font-weight:bold;
              border:1px solid #ccc;
              vertical-align:top;">

            Steps taken/Progress since last update:

          </td>


          <td colspan="3"
              style="
              border:1px solid #ccc;
              line-height:1.8;">

            ${
              incident.rca ||

              `

              <b>Following steps have been taken:</b>

              <ul>

                <li>
                  EMS received alerts indicating the issue.
                </li>

                <li>
                  Incident bridge opened and stakeholders invited.
                </li>

                <li>
                  Investigation is ongoing.
                </li>

                <li>
                  Further updates will be shared shortly.
                </li>

              </ul>

              `
            }

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

      ok:true,

      response

    };

  }

  catch(err) {

    logger.error(

      '[mailer ERROR]',

      err

    );


    return {

      ok:false,

      error: err.message

    };

  }

}



async function sendTestEmail(toOverride) {

  const s = await readSettings();

  const email = s.email || {};

  const to =

    toOverride ||

    email.recipients;


  const response = await resend.emails.send({

    from: email.from,

    to,

    subject:'OpsPilot Test Email',

    html:`

      <h2>OpsPilot Email Test</h2>

      <p>

      Congratulations 🎉

      Resend integration is working.

      </p>

    `

  });


  return {

    ok:true,

    response

  };

}


module.exports = {

  notifyIncident,

  sendTestEmail

};
```
