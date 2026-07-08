const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const HANDLED_EVENTS = new Set(['PostToolUse']);
const FAILURE_STATUSES = new Set(['failed', 'failure', 'error', 'blocked', 'cancelled', 'canceled', 'timeout', 'timedout']);

const HIGH_RISK_COMMAND_RULES = [
  { id: 'git-reset-hard', pattern: /\bgit\s+reset\s+--hard\b/i },
  { id: 'git-clean-force', pattern: /\bgit\s+clean\s+-[^\n]*[fd][^\n]*\b/i },
  { id: 'rm-rf-broad-target', pattern: /\brm\s+-[^\n]*[rf][^\n]*\s+(?:\/|~|\*|\.|\.\.|[A-Za-z]:[\\/])/i },
  { id: 'powershell-remove-force-recurse', pattern: /\bRemove-Item\b(?=[^\n]*(?:^|\s)-Recurse\b)(?=[^\n]*(?:^|\s)-Force\b)/i },
  { id: 'windows-del-recursive-quiet', pattern: /\b(?:del|erase)\b(?=[^\n]*\/(?:s|q)\b)(?=[^\n]*\/(?:q|s)\b)/i },
  { id: 'disk-management', pattern: /\b(?:format|diskpart)\b/i },
];

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

function getToolName(payload = {}) {
  const raw = payload.toolName
    ?? payload.tool_name
    ?? payload.name
    ?? payload.tool
    ?? payload.params?.tool
    ?? payload.input?.tool
    ?? payload.toolUse?.tool;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return firstString(raw.name, raw.id, raw.toolName);
  return '';
}

function getCommand(payload = {}) {
  return firstString(
    payload.command,
    payload.input?.command,
    payload.arguments?.command,
    payload.params?.command,
    payload.toolInput?.command,
    payload.toolUse?.command,
  );
}

function getDecision(payload = {}) {
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  const toolUse = payload.toolUse && typeof payload.toolUse === 'object' ? payload.toolUse : {};
  const explicit = firstString(
    payload.decision,
    payload.status,
    payload.outcome,
    result.status,
    result.outcome,
    toolUse.status,
    toolUse.outcome,
  );
  if (explicit) return explicit.toLowerCase();
  if (payload.success === false || result.success === false || toolUse.success === false) return 'failed';
  if (payload.exitCode !== undefined || result.exitCode !== undefined || toolUse.exitCode !== undefined) {
    return Number(payload.exitCode ?? result.exitCode ?? toolUse.exitCode) === 0 ? 'succeeded' : 'failed';
  }
  return 'completed';
}

function getExitCode(payload = {}) {
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  const toolUse = payload.toolUse && typeof payload.toolUse === 'object' ? payload.toolUse : {};
  const raw = payload.exitCode ?? payload.exit_code ?? result.exitCode ?? result.exit_code ?? toolUse.exitCode ?? toolUse.exit_code;
  return Number.isInteger(raw) ? raw : Number.isInteger(Number(raw)) ? Number(raw) : null;
}

function getDurationMs(payload = {}) {
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  const toolUse = payload.toolUse && typeof payload.toolUse === 'object' ? payload.toolUse : {};
  const raw = payload.durationMs ?? payload.duration_ms ?? result.durationMs ?? result.duration_ms ?? toolUse.durationMs ?? toolUse.duration_ms;
  return Number.isFinite(raw) ? raw : Number.isFinite(Number(raw)) ? Number(raw) : null;
}

function truncate(value, max = 240) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function redactSecrets(text) {
  return String(text)
    .replace(/(api[_-]?key|token|password|secret|credential)(\s*[:=]\s*)[^\s&]+/gi, '$1$2[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]');
}

function buildInputSummary(payload = {}) {
  const command = getCommand(payload);
  if (command) return { kind: 'command', text: truncate(redactSecrets(command)) };

  const path = firstString(
    payload.path,
    payload.file,
    payload.filePath,
    payload.input?.path,
    payload.input?.file,
    payload.params?.path,
  );
  if (path) return { kind: 'path', text: truncate(path) };

  const keys = Object.keys(payload.input ?? payload.params ?? payload.arguments ?? {}).slice(0, 20);
  return { kind: keys.length > 0 ? 'keys' : 'unknown', text: keys.join(', ') };
}

function collectArtifacts(payload = {}) {
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  const toolUse = payload.toolUse && typeof payload.toolUse === 'object' ? payload.toolUse : {};
  const raw = payload.artifacts
    ?? payload.artifactPaths
    ?? payload.artifact_paths
    ?? payload.outputFiles
    ?? payload.output_files
    ?? payload.files
    ?? result.artifacts
    ?? result.artifactPaths
    ?? result.outputFiles
    ?? toolUse.artifacts
    ?? toolUse.outputFiles;

  return asArray(raw)
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return firstString(item.path, item.file, item.filePath, item.name);
      return '';
    })
    .filter(Boolean);
}

function getErrorSummary(payload = {}) {
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  const toolUse = payload.toolUse && typeof payload.toolUse === 'object' ? payload.toolUse : {};
  return truncate(firstString(
    payload.error,
    payload.errorMessage,
    payload.error_message,
    payload.stderr,
    payload.message,
    result.error,
    result.errorMessage,
    result.stderr,
    result.message,
    toolUse.error,
    toolUse.stderr,
    toolUse.message,
  ));
}

function classifyToolUse(payload = {}) {
  const reasons = [];
  const command = getCommand(payload);
  const artifacts = collectArtifacts(payload);
  const exitCode = getExitCode(payload);
  const decision = getDecision(payload);

  if (FAILURE_STATUSES.has(decision) || (exitCode !== null && exitCode !== 0)) reasons.push('tool-failed');

  for (const rule of HIGH_RISK_COMMAND_RULES) {
    if (command && rule.pattern.test(command)) reasons.push(rule.id);
  }

  const sensitiveArtifact = artifacts.some(path => {
    const lower = path.toLowerCase();
    const name = lower.split(/[\\/]/).pop() || lower;
    return name === '.env' || name.startsWith('.env.') || lower.includes('secret') || lower.endsWith('.pem') || lower.endsWith('.key') || lower.endsWith('.p12') || lower.endsWith('.pfx');
  });
  if (sensitiveArtifact) reasons.push('sensitive-artifact');

  if (artifacts.some(path => path.replaceAll('\\', '/').startsWith('src/generated/'))) reasons.push('generated-artifact');

  const highReasons = new Set(['git-reset-hard', 'git-clean-force', 'rm-rf-broad-target', 'powershell-remove-force-recurse', 'windows-del-recursive-quiet', 'disk-management', 'sensitive-artifact']);
  const risk = reasons.some(reason => highReasons.has(reason)) ? 'high' : reasons.length > 0 ? 'medium' : 'low';
  return { risk, reasons: [...new Set(reasons)] };
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
  const decision = getDecision(payload);
  const exitCode = getExitCode(payload);
  const failed = FAILURE_STATUSES.has(decision) || (exitCode !== null && exitCode !== 0);
  const classification = classifyToolUse(payload);
  const errorSummary = getErrorSummary(payload);

  return {
    spec_dir: getSpecDir(payload) || null,
    timestamp: now(),
    stage: `hook:${event}`,
    skill: hook.id || 'post-tool-use-audit',
    passed: !failed,
    violations: failed ? [errorSummary || 'Tool execution failed'] : [],
    event,
    decision,
    risk: failed && classification.risk === 'low' ? 'medium' : classification.risk,
    tool_use: {
      tool: getToolName(payload) || null,
      input_summary: buildInputSummary(payload),
      exit_code: exitCode,
      success: !failed,
      duration_ms: getDurationMs(payload),
      artifacts: collectArtifacts(payload),
      error_summary: errorSummary || null,
      risk_reasons: classification.reasons,
    },
  };
}

function run({ event, payload = {}, hook = {} } = {}) {
  if (!HANDLED_EVENTS.has(event)) {
    return { status: 'skipped', message: `post-tool-use-audit only handles PostToolUse, got ${event}` };
  }

  const projectRoot = getProjectRoot(payload);
  const record = buildRecord(event, payload, hook);
  const historyPath = writeComplianceRecord(projectRoot, record);
  const warned = record.passed === false || record.risk !== 'low';

  return {
    status: warned ? 'warned' : 'ok',
    message: warned ? 'Tool result audit recorded with execution or risk warnings' : 'Tool result recorded in compliance history',
    historyPath,
    record,
  };
}

module.exports = run;
module.exports.run = run;
module.exports.buildRecord = buildRecord;
module.exports.writeComplianceRecord = writeComplianceRecord;
module.exports.classifyToolUse = classifyToolUse;
