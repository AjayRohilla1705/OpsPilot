const { HttpError } = require('./errorHandler');

const STATES = ['Live', 'On Hold', 'Resolved', 'RCA in Progress', 'RCA Submitted', 'RCA Review-Issues', 'RCA Not Required', 'CA In Progress'];
const SEVERITIES = ['P1', 'P2', 'P2-Low', 'P3'];

function validateIncidentBody(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be a JSON object');

  const out = {};
  const setIf = (k, validator) => {
    if (body[k] !== undefined) out[k] = validator(body[k]);
  };

  const requireString = (v, field) => {
    if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} is required`);
    return v.trim();
  };
  const optString = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
  const arrOf = (v) => Array.isArray(v) ? v : [];

  if (!partial) {
    out.title = requireString(body.title, 'title');
    out.severity = requireString(body.severity, 'severity');
    if (!SEVERITIES.includes(out.severity)) throw new HttpError(400, `severity must be one of ${SEVERITIES.join(', ')}`);
    out.state = body.state && STATES.includes(body.state) ? body.state : 'Live';
  } else {
    setIf('title', (v) => requireString(v, 'title'));
    setIf('severity', (v) => {
      if (!SEVERITIES.includes(v)) throw new HttpError(400, `severity must be one of ${SEVERITIES.join(', ')}`);
      return v;
    });
    setIf('state', (v) => {
      if (!STATES.includes(v)) throw new HttpError(400, `state must be one of ${STATES.join(', ')}`);
      return v;
    });
  }

  // free-text / structured passthroughs
  [
    'reason', 'area', 'iteration', 'owner', 'outageType',
    'incidentDescription', 'bridgeDetails', 'nextSteps',
    'rootCauseAnalysis', 'businessImpact', 'learnings',
    'correctiveActionPlan', 'outageTimeline', 'updatedBy'
  ].forEach((k) => setIf(k, optString));

  ['affectedServices', 'stepsToResolve', 'incidentTeam', 'rcaTeam', 'tags'].forEach((k) => setIf(k, arrOf));

  if (body.emsFields !== undefined) {
    if (typeof body.emsFields !== 'object' || Array.isArray(body.emsFields)) throw new HttpError(400, 'emsFields must be an object');
    out.emsFields = body.emsFields;
  }
  if (body.incidentDetails !== undefined) {
    if (typeof body.incidentDetails !== 'object' || Array.isArray(body.incidentDetails)) throw new HttpError(400, 'incidentDetails must be an object');
    out.incidentDetails = body.incidentDetails;
  }
  if (body.approvals !== undefined) {
    if (typeof body.approvals !== 'object' || Array.isArray(body.approvals)) throw new HttpError(400, 'approvals must be an object');
    out.approvals = body.approvals;
  }
  if (body.sendNotifications !== undefined) out.sendNotifications = Boolean(body.sendNotifications);
  if (body.emsEvents !== undefined) out.emsEvents = arrOf(body.emsEvents);
  if (body.relatedWork !== undefined) out.relatedWork = arrOf(body.relatedWork);

  return out;
}

module.exports = { validateIncidentBody, STATES, SEVERITIES };
