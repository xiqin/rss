const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const HANDLED_EVENTS = new Set(['SubagentStart', 'SubagentStop']);
const FAILURE_STATUSES = new Set(['failed', 'failure', 'error', 'blocked', 'cancelled', 'canceled']);

function now() {
  return new Date().toISOString();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
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

function getTaskId(payload = {}) {
  const task = payload.task && typeof payload.task === 'object' ? payload.task : {};
  const subagent = payload.subagent && typeof payload.subagent === 'object' ? payload.subagent : {};
  const agent = payload.agent && typeof payload.agent === 'object' ? payload.agent : {};
  return firstString(
    payload.taskId,
    payload.task_id,
    task.id,
    task.task_id,
    subagent.taskId,
    subagent.task_id,
    agent.taskId,
    agent.task_id,
    payload.input?.taskId,
    payload.params?.taskId,
  );
}

function getSubagent(payload = {}) {
  const subagent = payload.subagent && typeof payload.subagent === 'object' ? payload.subagent : {};
  const agent = payload.agent && typeof payload.agent === 'object' ? payload.agent : {};
  const taskId = getTaskId(payload);

  return {
    id: firstString(payload.subagentId, payload.subagent_id, subagent.id, subagent.subagent_id, agent.id),
    session_id: firstString(payload.sessionId, payload.session_id, subagent.sessionId, subagent.session_id, agent.sessionId, agent.session_id),
    parent_session_id: firstString(payload.parentSessionId, payload.parent_session_id, subagent.parentSessionId, subagent.parent_session_id),
    task_id: taskId,
    role: firstString(payload.role, subagent.role, agent.role, payload.agentType, payload.agent_type),
    model: firstString(payload.model, subagent.model, agent.model),
    status: getStatus(payload),
    task_state_path: firstString(payload.taskStatePath, payload.task_state_path, subagent.taskStatePath, subagent.task_state_path)
      || (taskId ? `task-states/${taskId}.state.json` : ''),
    handoff_path: firstString(payload.handoffPath, payload.handoff_path, subagent.handoffPath, subagent.handoff_path)
      || (taskId ? `handoffs/${taskId}.json` : ''),
    summary: firstString(payload.summary, payload.message, subagent.summary, agent.summary),
    duration_ms: firstNumber(payload.durationMs, payload.duration_ms, subagent.durationMs, subagent.duration_ms),
  };
}

function getStatus(payload = {}) {
  const subagent = payload.subagent && typeof payload.subagent === 'object' ? payload.subagent : {};
  const agent = payload.agent && typeof payload.agent === 'object' ? payload.agent : {};
  return firstString(payload.status, payload.outcome, payload.result, subagent.status, subagent.outcome, agent.status, agent.outcome).toLowerCase();
}

function getDecision(event, payload = {}) {
  const explicit = firstString(
    payload.decision,
    payload.status,
    payload.outcome,
    payload.result,
    payload.subagent?.decision,
    payload.subagent?.status,
    payload.subagent?.outcome,
    payload.agent?.status,
    payload.agent?.outcome,
  );
  if (explicit) return explicit.toLowerCase();
  return event === 'SubagentStart' ? 'started' : 'stopped';
}

function getRisk(event, payload = {}) {
  const explicit = firstString(payload.risk, payload.riskLevel, payload.subagent?.risk, payload.policy?.risk);
  if (explicit) return explicit.toLowerCase();
  const decision = getDecision(event, payload);
  return event === 'SubagentStop' && FAILURE_STATUSES.has(decision) ? 'medium' : 'low';
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
  const decision = getDecision(event, payload);
  const failed = event === 'SubagentStop' && FAILURE_STATUSES.has(decision);
  const subagent = getSubagent(payload);
  const reason = subagent.summary || (failed ? 'Subagent stopped with failure' : `Subagent ${decision}`);

  return {
    spec_dir: getSpecDir(payload) || null,
    timestamp: now(),
    stage: `hook:${event}`,
    skill: hook.id || 'subagent-audit',
    passed: !failed,
    violations: failed ? [reason] : [],
    event,
    decision,
    risk: getRisk(event, payload),
    subagent,
  };
}

function run({ event, payload = {}, hook = {} } = {}) {
  if (!HANDLED_EVENTS.has(event)) {
    return { status: 'skipped', message: `subagent-audit only handles SubagentStart/SubagentStop, got ${event}` };
  }

  const projectRoot = getProjectRoot(payload);
  const record = buildRecord(event, payload, hook);
  const historyPath = writeComplianceRecord(projectRoot, record);
  const failed = record.passed === false;

  return {
    status: failed ? 'warned' : 'ok',
    message: failed ? 'Subagent failure recorded in compliance history' : 'Subagent lifecycle recorded in compliance history',
    historyPath,
    record,
  };
}

module.exports = run;
module.exports.run = run;
module.exports.buildRecord = buildRecord;
module.exports.writeComplianceRecord = writeComplianceRecord;
