const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { isAbsolute, join, relative, resolve, sep } = require('node:path');

const HANDLED_EVENTS = new Set(['FileChanged']);
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

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value];
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

function getDecision(payload = {}) {
  const fileChange = payload.fileChange && typeof payload.fileChange === 'object' ? payload.fileChange : {};
  const explicit = firstString(payload.decision, payload.status, payload.outcome, payload.result, fileChange.status, fileChange.outcome);
  return explicit ? explicit.toLowerCase() : 'changed';
}

function normalizePath(projectRoot, filePath) {
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(projectRoot, filePath);
  const rel = relative(projectRoot, absolutePath);
  const inProject = rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
  return {
    path: inProject ? rel.replaceAll('\\', '/') : filePath.replaceAll('\\', '/'),
    absolute_path: absolutePath,
    in_project: inProject,
  };
}

function collectChangedFiles(payload = {}, projectRoot = process.cwd()) {
  const source = payload.files
    ?? payload.paths
    ?? payload.changedFiles
    ?? payload.changed_files
    ?? payload.fileChanges
    ?? payload.file_changes
    ?? payload.changes
    ?? payload.input?.files
    ?? payload.params?.files
    ?? payload.path
    ?? payload.file
    ?? payload.filePath;

  return asArray(source)
    .map(item => {
      if (typeof item === 'string') {
        return {
          ...normalizePath(projectRoot, item),
          change_type: firstString(payload.changeType, payload.change_type, payload.operation, 'modified'),
        };
      }
      if (!item || typeof item !== 'object') return null;
      const filePath = firstString(item.path, item.file, item.filePath, item.filename, item.name);
      if (!filePath) return null;
      return {
        ...normalizePath(projectRoot, filePath),
        change_type: firstString(item.changeType, item.change_type, item.operation, item.status, payload.changeType, 'modified'),
      };
    })
    .filter(Boolean);
}

function classifyPath(file) {
  const path = file.path.replaceAll('\\', '/');
  const lower = path.toLowerCase();
  const name = lower.split('/').pop() || lower;

  if (!file.in_project) return { risk: 'medium', reason: 'changed-path-outside-project' };
  if (name === '.env' || name.startsWith('.env.') || lower.includes('/.env.') || lower.includes('/secret') || lower.endsWith('.pem') || lower.endsWith('.key') || lower.endsWith('.p12') || lower.endsWith('.pfx')) {
    return { risk: 'high', reason: 'sensitive-path' };
  }
  if (path.startsWith('.loom/rules/') || path.startsWith('.loom/memory/') || ['LOOM.md', 'AGENTS.md', 'CLAUDE.md'].includes(path)) {
    return { risk: 'medium', reason: 'context-path' };
  }
  if (path.startsWith('specs/')) return { risk: 'medium', reason: 'spec-artifact' };
  if (path.startsWith('src/generated/') || path.startsWith('docs/generated/') || ['memory.md', 'progress.md'].includes(name)) {
    return { risk: 'medium', reason: 'generated-artifact' };
  }
  return { risk: 'low', reason: 'source-change' };
}

function riskRank(risk) {
  return { low: 0, medium: 1, high: 2 }[risk] ?? 0;
}

function maxRisk(items) {
  return items.reduce((current, item) => riskRank(item.risk) > riskRank(current) ? item.risk : current, 'low');
}

function buildSyncSuggestions(files, classifications) {
  const reasons = new Set(classifications.map(item => item.reason));
  const suggestions = [];
  if (files.length > 0) suggestions.push('review-changed-files');
  if (reasons.has('context-path')) suggestions.push('refresh-loom-context');
  if (reasons.has('spec-artifact')) suggestions.push('review-pipeline-progress');
  if (reasons.has('generated-artifact')) suggestions.push('run-generate-check');
  if (reasons.has('source-change')) suggestions.push('consider-codegraph-sync');
  if (reasons.has('sensitive-path')) suggestions.push('run-secret-scan');
  return suggestions;
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
  const projectRoot = getProjectRoot(payload);
  const files = collectChangedFiles(payload, projectRoot);
  const classifications = files.map(file => ({ ...file, ...classifyPath(file) }));
  const decision = getDecision(payload);
  const failed = FAILURE_STATUSES.has(decision);
  const risk = failed ? 'medium' : maxRisk(classifications);
  const sensitiveFiles = classifications.filter(file => file.reason === 'sensitive-path').map(file => file.path);

  return {
    spec_dir: getSpecDir(payload) || null,
    timestamp: now(),
    stage: `hook:${event}`,
    skill: hook.id || 'file-changed-audit',
    passed: !failed,
    violations: failed ? [firstString(payload.summary, payload.message, 'File change event failed')] : [],
    event,
    decision,
    risk,
    file_change: {
      files: classifications,
      changed_count: classifications.length,
      sensitive_files: sensitiveFiles,
      sync_suggestions: buildSyncSuggestions(files, classifications),
    },
  };
}

function run({ event, payload = {}, hook = {} } = {}) {
  if (!HANDLED_EVENTS.has(event)) {
    return { status: 'skipped', message: `file-changed-audit only handles FileChanged, got ${event}` };
  }

  const projectRoot = getProjectRoot(payload);
  const record = buildRecord(event, payload, hook);
  const historyPath = writeComplianceRecord(projectRoot, record);
  const warned = record.passed === false || record.risk !== 'low';

  return {
    status: warned ? 'warned' : 'ok',
    message: warned ? 'File change audit recorded with sync or risk warnings' : 'File change recorded in compliance history',
    historyPath,
    record,
  };
}

module.exports = run;
module.exports.run = run;
module.exports.buildRecord = buildRecord;
module.exports.writeComplianceRecord = writeComplianceRecord;
module.exports.collectChangedFiles = collectChangedFiles;
module.exports.classifyPath = classifyPath;
