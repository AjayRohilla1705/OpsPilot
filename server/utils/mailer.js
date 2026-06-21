const { Resend } = require('resend');
const { readSettings } = require('./storage');
const { logger } = require('./logger');

const resend = new Resend(process.env.RESEND_API_KEY);

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
      `[Incident] ${incident.id} - ${incident.title}`;


    const html = `

      <h2>Incident Notification</h2>

      <p><b>ID:</b> ${incident.id}</p>

      <p><b>Title:</b> ${incident.title}</p>

      <p><b>Severity:</b> ${incident.severity}</p>

      <p><b>Status:</b> ${incident.state}</p>

      <p><b>Description:</b></p>

      <p>${incident.incidentDescription || '-'}</p>

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