const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const HANDLED_EVENTS = new Set(['TaskCreated', 'TaskCompleted']);
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

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
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

function getTaskObject(payload = {}) {
  return payload.task && typeof payload.task === 'object' ? payload.task : {};
}

function getTaskId(payload = {}) {
  const task = getTaskObject(payload);
  return firstString(
    payload.taskId,
    payload.task_id,
    task.id,
    task.taskId,
    task.task_id,
    payload.input?.taskId,
    payload.params?.taskId,
  );
}

function getDecision(event, payload = {}) {
  const task = getTaskObject(payload);
  const explicit = firstString(
    payload.decision,
    payload.status,
    payload.outcome,
    payload.result,
    task.decision,
    task.status,
    task.outcome,
  );
  if (explicit) return explicit.toLowerCase();
  return event === 'TaskCreated' ? 'created' : 'completed';
}

function defaultTaskPath(taskId) {
  return taskId ? `tasks/${taskId}.md` : '';
}

function defaultTaskStatePath(taskId) {
  return taskId ? `task-states/${taskId}.state.json` : '';
}

function defaultHandoffPath(taskId) {
  return taskId ? `handoffs/${taskId}.json` : '';
}

function getTask(payload = {}) {
  const task = getTaskObject(payload);
  const taskId = getTaskId(payload);

  return {
    id: taskId,
    title: firstString(payload.title, payload.name, task.title, task.name),
    status: getDecision(payload.event || 'TaskCompleted', payload),
    owner: firstString(payload.owner, payload.assignee, task.owner, task.assignee, payload.agent, task.agent),
    complexity: firstString(payload.complexity, task.complexity),
    depends_on: asArray(payload.dependsOn ?? payload.depends_on ?? task.dependsOn ?? task.depends_on),
    owns: asArray(payload.owns ?? task.owns),
    reads: asArray(payload.reads ?? task.reads),
    task_path: firstString(payload.taskPath, payload.task_path, task.taskPath, task.task_path) || defaultTaskPath(taskId),
    task_state_path: firstString(payload.taskStatePath, payload.task_state_path, task.taskStatePath, task.task_state_path) || defaultTaskStatePath(taskId),
    handoff_path: firstString(payload.handoffPath, payload.handoff_path, task.handoffPath, task.handoff_path) || defaultHandoffPath(taskId),
    artifacts: asArray(payload.artifacts ?? task.artifacts ?? payload.outputs ?? task.outputs),
    summary: firstString(payload.summary, payload.message, task.summary, task.message),
    duration_ms: firstNumber(payload.durationMs, payload.duration_ms, task.durationMs, task.duration_ms),
  };
}

function getRisk(event, decision, payload = {}) {
  const task = getTaskObject(payload);
  const explicit = firstString(payload.risk, payload.riskLevel, task.risk, payload.policy?.risk);
  if (explicit) return explicit.toLowerCase();
  return event === 'TaskCompleted' && FAILURE_STATUSES.has(decision) ? 'medium' : 'low';
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
  const task = getTask({ ...payload, event });
  const failed = event === 'TaskCompleted' && FAILURE_STATUSES.has(decision);
  const reason = task.summary || (failed ? 'Task completed with failure' : `Task ${decision}`);

  return {
    spec_dir: getSpecDir(payload) || null,
    timestamp: now(),
    stage: `hook:${event}`,
    skill: hook.id || 'task-audit',
    passed: !failed,
    violations: failed ? [reason] : [],
    event,
    decision,
    risk: getRisk(event, decision, payload),
    task,
  };
}

function run({ event, payload = {}, hook = {} } = {}) {
  if (!HANDLED_EVENTS.has(event)) {
    return { status: 'skipped', message: `task-audit only handles TaskCreated/TaskCompleted, got ${event}` };
  }

  const projectRoot = getProjectRoot(payload);
  const record = buildRecord(event, payload, hook);
  const historyPath = writeComplianceRecord(projectRoot, record);
  const failed = record.passed === false;

  return {
    status: failed ? 'warned' : 'ok',
    message: failed ? 'Task failure recorded in compliance history' : 'Task lifecycle recorded in compliance history',
    historyPath,
    record,
  };
}

module.exports = run;
module.exports.run = run;
module.exports.buildRecord = buildRecord;
module.exports.writeComplianceRecord = writeComplianceRecord;
