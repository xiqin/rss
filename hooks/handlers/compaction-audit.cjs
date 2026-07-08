const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');

const HANDLED_EVENTS = new Set(['PreCompact', 'PostCompact']);
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

function getDecision(event, payload = {}) {
  const compaction = payload.compaction && typeof payload.compaction === 'object' ? payload.compaction : {};
  const explicit = firstString(
    payload.decision,
    payload.status,
    payload.outcome,
    payload.result,
    compaction.decision,
    compaction.status,
    compaction.outcome,
  );
  if (explicit) return explicit.toLowerCase();
  return event === 'PreCompact' ? 'preparing' : 'completed';
}

function getCompaction(event, payload = {}) {
  const compaction = payload.compaction && typeof payload.compaction === 'object' ? payload.compaction : {};
  const specDir = getSpecDir(payload);
  const suffix = event === 'PreCompact' ? 'pre' : 'post';

  return {
    id: firstString(payload.compactId, payload.compact_id, compaction.id, compaction.compactId),
    session_id: firstString(payload.sessionId, payload.session_id, compaction.sessionId, compaction.session_id),
    reason: firstString(payload.reason, payload.trigger, compaction.reason, compaction.trigger),
    summary: firstString(payload.summary, payload.contextSummary, payload.context_summary, payload.message, compaction.summary),
    before_tokens: firstNumber(payload.beforeTokens, payload.before_tokens, payload.tokensBefore, compaction.beforeTokens, compaction.before_tokens),
    after_tokens: firstNumber(payload.afterTokens, payload.after_tokens, payload.tokensAfter, compaction.afterTokens, compaction.after_tokens),
    handoff_path: firstString(payload.handoffPath, payload.handoff_path, compaction.handoffPath, compaction.handoff_path)
      || (specDir ? `handoffs/compact-${suffix}.json` : ''),
  };
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

function resolveSpecRoot(projectRoot, specDir) {
  const specRoot = isAbsolute(specDir) ? resolve(specDir) : resolve(projectRoot, specDir);
  const rel = relative(projectRoot, specRoot);
  if (rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`))) return specRoot;
  throw new Error(`Spec directory escapes project root: ${specDir}`);
}

function writeCompactionHandoff(projectRoot, specDir, record) {
  if (!specDir || !record.compaction?.handoff_path) return null;
  const specRoot = resolveSpecRoot(projectRoot, specDir);
  const handoffPath = resolve(specRoot, record.compaction.handoff_path);
  const rel = relative(specRoot, handoffPath);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error(`Handoff path escapes spec directory: ${record.compaction.handoff_path}`);
  }

  mkdirSync(dirname(handoffPath), { recursive: true });
  writeFileSync(handoffPath, `${JSON.stringify({
    status: record.event === 'PreCompact' ? 'pending' : 'done',
    event: record.event,
    decision: record.decision,
    summary: record.compaction.summary || record.compaction.reason || `Context ${record.decision}`,
    compaction: record.compaction,
    compliance_stage: record.stage,
    written_at: record.timestamp,
  }, null, 2)}\n`, 'utf-8');
  return handoffPath;
}

function buildRecord(event, payload = {}, hook = {}) {
  const decision = getDecision(event, payload);
  const failed = FAILURE_STATUSES.has(decision);
  const compaction = getCompaction(event, payload);
  const reason = compaction.summary || compaction.reason || (failed ? 'Context compaction failed' : `Context compaction ${decision}`);

  return {
    spec_dir: getSpecDir(payload) || null,
    timestamp: now(),
    stage: `hook:${event}`,
    skill: hook.id || 'compaction-audit',
    passed: !failed,
    violations: failed ? [reason] : [],
    event,
    decision,
    risk: failed ? 'medium' : 'low',
    compaction,
  };
}

function run({ event, payload = {}, hook = {} } = {}) {
  if (!HANDLED_EVENTS.has(event)) {
    return { status: 'skipped', message: `compaction-audit only handles PreCompact/PostCompact, got ${event}` };
  }

  const projectRoot = getProjectRoot(payload);
  const record = buildRecord(event, payload, hook);
  let handoffPath = null;

  try {
    handoffPath = writeCompactionHandoff(projectRoot, record.spec_dir, record);
  } catch (err) {
    record.passed = false;
    record.risk = 'medium';
    record.violations = [err.message];
  }

  const historyPath = writeComplianceRecord(projectRoot, record);
  const failed = record.passed === false;

  return {
    status: failed ? 'warned' : 'ok',
    message: failed ? 'Compaction audit recorded with warnings' : 'Compaction lifecycle recorded in compliance history',
    historyPath,
    handoffPath,
    record,
  };
}

module.exports = run;
module.exports.run = run;
module.exports.buildRecord = buildRecord;
module.exports.writeComplianceRecord = writeComplianceRecord;
module.exports.writeCompactionHandoff = writeCompactionHandoff;
