const { Resend } = require("resend");
const axios = require("axios");

const resend = new Resend(process.env.RESEND_API_KEY);

const { readSettings } = require("./storage");
const { logger } = require("./logger");

async function sendTeamsNotification(incident, subject) {

  try {

    const webhook = process.env.TEAMS_WEBHOOK_URL;

    if (!webhook) {

      console.log("No Teams webhook found");

      return;

    }

    await axios.post(

      webhook,

      {

        type: "message",

        attachments: [

          {

            contentType:

              "application/vnd.microsoft.card.adaptive",

            content: {

              "$schema":

                "http://adaptivecards.io/schemas/adaptive-card.json",

              type: "AdaptiveCard",

              version: "1.5",

              body: [

                {

                  type: "TextBlock",

                  text: subject,

                  weight: "Bolder",

                  size: "Large",

                  wrap: true,

                  color: "Attention"

                },

                {

                  type: "FactSet",

                  facts: [

                    {

                      title:

                        "Affected Service",

                      value:

                        incident.title

                    },

                    {

                      title:

                        "ADO Workitem",

                      value:

                        incident.id

                    },

                    {

                      title:

                        "Severity",

                      value:

                        incident.severity

                    },

                    {

                      title:

                        "Status",

                      value:

                        incident.state

                    },

                    {

                      title:

                        "Incident Manager",

                      value:

                        incident.assignee ||

                        "EMS Operator"

                    },

                    {

                      title:

                        "Description",

                      value:

                        incident.incidentDescription ||

                        "-"

                    }

                  ]

                }

              ]

            }

          }

        ]

      }

    );

    console.log(

      "Teams notification sent successfully"

    );

  }

  catch(err) {

    console.log(

      "Teams notification failed",

      err.message

    );

  }

}

async function notifyIncident(incident, eventKind) {
  logger.info(
    `[mailer] notifyIncident -> ${eventKind} ${incident.id}`
  );

  try {
    const s = await readSettings();

    const email = s.email || {};

    if (!email.enabled) {
      return { ok: false, skipped: "disabled" };
    }

    if (!email.recipients || !email.recipients.length) {
      return { ok: false, skipped: "no-recipients" };
    }

   const allowed = true;
      //(eventKind === "created" &&
      //  email.triggers.onCreate !== false) ||

     // (eventKind === "stateChanged" &&
     //   email.triggers.onStateChange !== false) ||

     // (eventKind === "resolved" &&
       // email.triggers.onResolved !== false);

  //  if (!allowed) {
     // return {
      //  ok: false,
       // skipped: "trigger-off",
     // };
   // }

    // SUBJECT LINE
    const start =
incident.incidentDetails?.incidentStart
? new Date(incident.incidentDetails.incidentStart)
: null;

const end =
incident.incidentDetails?.incidentEnd
? new Date(incident.incidentDetails.incidentEnd)
: null;

let outageDuration = "N/A";

if (start && end) {

const diff =
Math.floor((end - start) / 1000);

const hrs =
Math.floor(diff / 3600);

const mins =
Math.floor((diff % 3600) / 60);

const secs =
diff % 60;

outageDuration =
`${hrs}h ${mins}m ${secs}s`;
}

    const subject =
      `OUTAGE | ${incident.severity} | ${incident.state} | ${incident.id} - ${incident.title}`;

    // HTML TEMPLATE
    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>

<body style="
font-family:Arial,sans-serif;
background:#f5f5f5;
padding:20px;
">

<div style="
max-width:900px;
margin:auto;
background:#ffffff;
border:1px solid #dcdcdc;
">

<!-- HEADER -->

<table width="100%"
style="
border-collapse:collapse;
">

<tr>

<td
colspan="4"

style="
background:#3f6ec4;
color:white;
font-size:28px;
font-weight:bold;
padding:18px;
">

IT Ops Major Outage Update

</td>

</tr>

<tr>

<td colspan="4"

style="
padding:15px;
font-size:14px;
">

<div>
▣ ${incident.severity} - Notification
</div>

<br>

<div style="color:red;">
❗ High importance
</div>

</td>

</tr>

</table>

<!-- MAIN TABLE -->

<table

width="100%"

style="
border-collapse:collapse;
font-size:16px;
">

<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
width:35%;
">

Affected Service(s):

</td>

<td colspan="3"

style="
border:1px solid #444;
padding:12px;
">

${incident.title}

</td>

</tr>


<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
">

ADO Workitem:

</td>

<td colspan="3"

style="
border:1px solid #444;
padding:12px;
font-weight:bold;
">

${incident.id}

</td>

</tr>


<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
">

Incident Start Date
<br>
& Time (EST):

</td>

<td style="
border:1px solid #444;
padding:12px;
">

<td>
${
incident.incidentDetails?.incidentStart
? new Date(
incident.incidentDetails.incidentStart
).toLocaleString("en-US", {
timeZone: "America/New_York"
})
: "-"
}
</td>

</td>


<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
">

Incident End Date
<br>
& Time (EST):

</td>

<td style="
border:1px solid #444;
padding:12px;
">

<td>
${
incident.incidentDetails?.incidentEnd
? new Date(
incident.incidentDetails.incidentEnd
).toLocaleString("en-US", {
timeZone: "America/New_York"
})
: "-"
}
</td>

</td>

</tr>


<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
">

Total Outage Duration:

</td>

<td colspan="3"

style="
border:1px solid #444;
padding:12px;
text-align:center;
">

${outageDuration}

</td>

</tr>


<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
">

Incident Description:

</td>

<td colspan="3"

style="
border:1px solid #444;
padding:12px;
">

${incident.incidentDescription || "-"}

</td>

</tr>


<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
">

Current Incident Manager:

</td>

<td colspan="3"

style="
border:1px solid #444;
padding:12px;
">

${incident.owner || "EMS Operator"}

</td>

</tr>


<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
">

Bridge Details:

</td>

<td colspan="3"

style="
border:1px solid #444;
padding:12px;
">

${
  incident.bridgeLink

    ? `<a href="${incident.bridgeLink}">
        Join the meeting
       </a>`

    : "Join the meeting"
}

</td>

</tr>

</table>


<!-- STATUS -->

<table

width="100%"

style="
margin-top:15px;
border-collapse:collapse;
">

<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
width:35%;
">

Current Status:

</td>

<td style="
border:1px solid #444;
padding:12px;
text-align:center;
font-weight:bold;
">

${incident.state}

</td>

</tr>

</table>


<!-- PROGRESS -->

<table

width="100%"

style="
margin-top:15px;
border-collapse:collapse;
">

<tr>

<td style="
border:1px solid #444;
padding:12px;
font-weight:bold;
width:35%;
vertical-align:top;
">

Steps taken/Progress
<br>
since last update:

</td>


<td

style="
border:1px solid #444;
padding:12px;
line-height:1.8;
">

<b>Following steps have been taken:</b>

<br><br>

<b>
${new Date(
incident.updatedAt
).toLocaleTimeString()}

EST /
${new Date(
incident.updatedAt
).toLocaleTimeString("en-IN")}
IST
</b>


<ul>
${
  (incident.stepsToResolve || [])
    .map(step => `<li>${step}</li>`)
    .join("")
}
</ul>



</td>

</tr>

</table>

</div>

</body>

</html>
`;

    const response = await resend.emails.send({
      from: email.from,
      to: email.recipients,
      subject,
      html,
    });

   logger.info("[mailer] Resend success", response);

// Send Teams notification
await sendTeamsNotification(
  incident,
  subject
);

logger.info(
  "[mailer] Teams notification attempted"
);

    return {
      ok: true,
      response,
    };
  } catch (err) {
    logger.error("[mailer ERROR]", err);

    return {
      ok: false,
      error: err.message,
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

    subject: "OpsPilot Test Email",

    html: `
      <h2>OpsPilot Email Test</h2>

      <p>
      Congratulations 🎉 Resend integration is working.
      </p>
    `

  });

  return {
   ok: true,
   to,
   response
};

}

module.exports = {
  notifyIncident,
  sendTestEmail,
};