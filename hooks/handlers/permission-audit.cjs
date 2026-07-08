const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');

const HANDLED_EVENTS = new Set(['PermissionRequest', 'PermissionDenied']);

function now() {
  return new Date().toISOString();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getProjectRoot(payload = {}) {
  return resolve(firstString(
    payload.projectRoot,
    payload.project_root,
    payload.cwd,
    payload.root,
    payload.workspaceFolder,
    payload.input?.projectRoot,
    payload.params?.projectRoot,
  ) || process.cwd());
}

function getSpecDir(payload = {}) {
  return firstString(payload.specDir, payload.spec_dir, payload.input?.specDir, payload.params?.specDir);
}

function getPermission(payload = {}) {
  const permission = payload.permission && typeof payload.permission === 'object' ? payload.permission : {};
  return {
    tool: firstString(payload.toolName, payload.tool, payload.name, permission.tool, payload.input?.tool, payload.params?.tool),
    action: firstString(payload.action, permission.action, payload.input?.action, payload.params?.action),
    resource: firstString(payload.resource, permission.resource, payload.path, payload.input?.resource, payload.params?.resource),
    reason: firstString(payload.reason, permission.reason, payload.message, payload.input?.reason, payload.params?.reason),
    requester: firstString(payload.requester, permission.requester, payload.agent, payload.sessionId, payload.session_id),
  };
}

function getDecision(event, payload = {}) {
  const raw = firstString(payload.decision, payload.status, payload.result, payload.permission?.decision);
  if (raw) return raw.toLowerCase();
  return event === 'PermissionDenied' ? 'denied' : 'requested';
}

function getRisk(event, payload = {}) {
  const explicit = firstString(payload.risk, payload.riskLevel, payload.permission?.risk, payload.policy?.risk);
  if (explicit) return explicit.toLowerCase();
  return event === 'PermissionDenied' ? 'medium' : 'low';
}

function loadHistory(historyPath) {
  if (!existsSync(historyPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(historyPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeComplianceRecord(projectRoot, record) {
  const dir = join(projectRoot, '.loom', 'compliance');
  const historyPath = join(dir, 'history.json');
  mkdirSync(dir, { recursive: true });
  const history = loadHistory(historyPath);
  history.push(record);
  if (history.length > 500) history.splice(0, history.length - 500);
  writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, 'utf-8');
  return historyPath;
}

function buildRecord(event, payload = {}, hook = {}) {
  const permission = getPermission(payload);
  const decision = getDecision(event, payload);
  const risk = getRisk(event, payload);
  const denied = event === 'PermissionDenied' || decision === 'denied' || decision === 'rejected';
  const reason = permission.reason || (denied ? 'Permission denied' : 'Permission requested');

  return {
    spec_dir: getSpecDir(payload) || null,
    timestamp: now(),
    stage: `hook:${event}`,
    skill: hook.id || 'permission-audit',
    passed: !denied,
    violations: denied ? [reason] : [],
    event,
    decision,
    risk,
    permission,
  };
}

function run({ event, payload = {}, hook = {} } = {}) {
  if (!HANDLED_EVENTS.has(event)) {
    return { status: 'skipped', message: `permission-audit only handles PermissionRequest/PermissionDenied, got ${event}` };
  }

  const projectRoot = getProjectRoot(payload);
  const record = buildRecord(event, payload, hook);
  const historyPath = writeComplianceRecord(projectRoot, record);
  const denied = record.passed === false;

  return {
    status: denied ? 'warned' : 'ok',
    message: denied ? 'Permission denial recorded in compliance history' : 'Permission request recorded in compliance history',
    historyPath,
    record,
  };
}

module.exports = run;
module.exports.run = run;
module.exports.buildRecord = buildRecord;
module.exports.writeComplianceRecord = writeComplianceRecord;
