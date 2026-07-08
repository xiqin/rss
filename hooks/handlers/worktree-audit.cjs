const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const HANDLED_EVENTS = new Set(['WorktreeCreate', 'WorktreeRemove']);
const FAILURE_STATUSES = new Set(['failed', 'failure', 'error', 'blocked', 'cancelled', 'canceled']);
const UNCLEAN_STATUSES = new Set(['dirty', 'unclean', 'leftover', 'leftovers', 'partial', 'skipped']);

function now() {
  return new Date().toISOString();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
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

function getWorktreeObject(payload = {}) {
  return payload.worktree && typeof payload.worktree === 'object' ? payload.worktree : {};
}

function getDecision(event, payload = {}) {
  const worktree = getWorktreeObject(payload);
  const explicit = firstString(
    payload.decision,
    payload.status,
    payload.outcome,
    payload.result,
    payload.cleanupStatus,
    payload.cleanup_status,
    worktree.decision,
    worktree.status,
    worktree.outcome,
    worktree.cleanupStatus,
    worktree.cleanup_status,
  );
  if (explicit) return explicit.toLowerCase();
  return event === 'WorktreeCreate' ? 'created' : 'removed';
}

function getWorktree(payload = {}) {
  const worktree = getWorktreeObject(payload);
  const path = firstString(payload.worktreePath, payload.worktree_path, payload.path, worktree.path, worktree.worktreePath, worktree.worktree_path);
  const residualRisks = asArray(payload.residualRisks ?? payload.residual_risks ?? worktree.residualRisks ?? worktree.residual_risks);
  const dirty = firstBoolean(payload.dirty, payload.hasChanges, payload.has_changes, worktree.dirty, worktree.hasChanges, worktree.has_changes);

  return {
    path,
    branch: firstString(payload.branch, payload.branchName, payload.branch_name, worktree.branch, worktree.branchName, worktree.branch_name),
    base_branch: firstString(payload.baseBranch, payload.base_branch, payload.base, worktree.baseBranch, worktree.base_branch, worktree.base),
    commit: firstString(payload.commit, payload.sha, payload.head, worktree.commit, worktree.sha, worktree.head),
    created_by: firstString(payload.createdBy, payload.created_by, payload.agent, payload.requester, worktree.createdBy, worktree.created_by),
    cleanup_status: firstString(payload.cleanupStatus, payload.cleanup_status, payload.status, worktree.cleanupStatus, worktree.cleanup_status, worktree.status),
    removed: firstBoolean(payload.removed, payload.cleaned, payload.deleted, worktree.removed, worktree.cleaned, worktree.deleted),
    dirty,
    residual_risks: residualRisks,
    summary: firstString(payload.summary, payload.message, worktree.summary, worktree.message),
  };
}

function hasCleanupRisk(event, decision, worktree) {
  if (FAILURE_STATUSES.has(decision)) return true;
  if (event !== 'WorktreeRemove') return false;
  if (worktree.removed === false) return true;
  if (worktree.dirty === true) return true;
  if (worktree.residual_risks.length > 0) return true;
  return UNCLEAN_STATUSES.has(String(worktree.cleanup_status || '').toLowerCase());
}

function getRisk(event, decision, payload = {}, worktree = getWorktree(payload)) {
  const explicit = firstString(payload.risk, payload.riskLevel, getWorktreeObject(payload).risk, payload.policy?.risk);
  if (explicit) return explicit.toLowerCase();
  return hasCleanupRisk(event, decision, worktree) ? 'medium' : 'low';
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
  const worktree = getWorktree(payload);
  const cleanupRisk = hasCleanupRisk(event, decision, worktree);
  const failed = FAILURE_STATUSES.has(decision) || cleanupRisk;
  const reason = worktree.summary
    || worktree.residual_risks[0]
    || (failed ? 'Worktree lifecycle completed with cleanup risk' : `Worktree ${decision}`);

  return {
    spec_dir: getSpecDir(payload) || null,
    timestamp: now(),
    stage: `hook:${event}`,
    skill: hook.id || 'worktree-audit',
    passed: !failed,
    violations: failed ? [reason] : [],
    event,
    decision,
    risk: getRisk(event, decision, payload, worktree),
    worktree,
  };
}

function run({ event, payload = {}, hook = {} } = {}) {
  if (!HANDLED_EVENTS.has(event)) {
    return { status: 'skipped', message: `worktree-audit only handles WorktreeCreate/WorktreeRemove, got ${event}` };
  }

  const projectRoot = getProjectRoot(payload);
  const record = buildRecord(event, payload, hook);
  const historyPath = writeComplianceRecord(projectRoot, record);
  const warned = record.passed === false || record.risk !== 'low';

  return {
    status: warned ? 'warned' : 'ok',
    message: warned ? 'Worktree lifecycle recorded with cleanup warnings' : 'Worktree lifecycle recorded in compliance history',
    historyPath,
    record,
  };
}

module.exports = run;
module.exports.run = run;
module.exports.buildRecord = buildRecord;
module.exports.writeComplianceRecord = writeComplianceRecord;
