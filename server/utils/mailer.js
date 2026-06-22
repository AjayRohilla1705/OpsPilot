const { Resend } = require('resend');

console.log("RESEND_API_KEY =", process.env.RESEND_API_KEY);

const resend = new Resend(process.env.RESEND_API_KEY);

const { readSettings } = require('./storage');
const { logger } = require('./logger');


async function notifyIncident(incident, eventKind) {

  logger.info(
    `[mailer] notifyIncident -> ${eventKind} ${incident.id}`
  );

  try {

    const s = await readSettings();

    console.log("FULL SETTINGS =", JSON.stringify(s, null, 2));

    const email = s.email || {};

    console.log("EMAIL =", email);
    console.log("RECIPIENTS =", email.recipients);

    if (!email.enabled) {

      return {

        ok: false,

        skipped: 'disabled'

      };

    }

    if (!email.recipients || !email.recipients.length) {

      return {

        ok: false,

        skipped: 'no-recipients'

      };

    }

    const triggers = email.triggers || {};

    const allowed =

      (eventKind === 'created' &&
       triggers.onCreate !== false)

      ||

      (eventKind === 'stateChanged' &&
       triggers.onStateChange !== false)

      ||

      (eventKind === 'resolved' &&
       triggers.onResolved !== false);


    if (!allowed) {

      return {

        ok: false,

        skipped: 'trigger-off'

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


    console.log("RESEND RESPONSE =", response);

    logger.info(
      '[mailer] Resend success',
      response
    );


    return {

      ok: true,

      response

    };

  }

  catch(err) {

    logger.error(
      '[mailer ERROR]',
      err
    );

    console.log("MAIL ERROR =", err);

    return {

      ok: false,

      error: err.message

    };

  }

}



async function sendTestEmail(toOverride) {

  const s = await readSettings();

  console.log(
    "FULL SETTINGS IN TEST =",
    JSON.stringify(s, null, 2)
  );

  const email = s.email || {};

  console.log("EMAIL =", email);

  console.log("RECIPIENTS =", email.recipients);

  const to =

    toOverride ||

    email.recipients;


  console.log("TO =", to);


  if (!to || (Array.isArray(to) && to.length === 0)) {

    throw new Error("No recipients configured");

  }


  const response = await resend.emails.send({

    from: email.from,

    to,

    subject: 'OpsPilot Test Email',

    html: `

      <h2>OpsPilot Email Test</h2>

      <p>

      Congratulations 🎉

      Resend integration is working.

      </p>

    `

  });


  console.log(
    "TEST EMAIL RESPONSE =",
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