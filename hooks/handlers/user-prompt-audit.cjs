const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const HANDLED_EVENTS = new Set(['UserPromptSubmit']);

const RISK_RULES = [
  {
    risk: 'high',
    reason: 'destructive-request',
    pattern: /\b(?:git\s+reset\s+--hard|git\s+clean\s+-[\w-]*[fd]|rm\s+-[\w-]*[rf]|Remove-Item\b[^\n]*(?:-Recurse|-Force)|format\b|diskpart\b)\b/i,
  },
  {
    risk: 'high',
    reason: 'credential-or-secret-request',
    pattern: /\b(?:secret|token|api[_ -]?key|password|credential|private\s+key|\.env)\b/i,
  },
  {
    risk: 'medium',
    reason: 'production-or-release-risk',
    pattern: /\b(?:prod|production|release|hotfix|deploy|deployment|rollback)\b/i,
  },
  {
    risk: 'medium',
    reason: 'large-scope-change',
    pattern: /\b(?:refactor|rewrite|migration|migrate|architecture|全量|重构|迁移|架构)\b/i,
  },
  {
    risk: 'medium',
    reason: 'security-sensitive-request',
    pattern: /\b(?:permission|auth|oauth|login|encrypt|decrypt|security|权限|认证|授权|加密|安全)\b/i,
  },
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

function getPrompt(payload = {}) {
  return firstString(
    payload.prompt,
    payload.userPrompt,
    payload.user_prompt,
    payload.message,
    payload.text,
    payload.request,
    payload.input?.prompt,
    payload.input?.message,
    payload.params?.prompt,
    payload.params?.message,
  );
}

function getDecision(payload = {}) {
  const explicit = firstString(payload.decision, payload.status, payload.outcome, payload.result, payload.promptAudit?.status, payload.promptAudit?.outcome);
  return explicit ? explicit.toLowerCase() : 'submitted';
}

function classifyPrompt(prompt) {
  if (!prompt) return { risk: 'low', reasons: ['empty-or-unknown-prompt'] };
  const reasons = [];
  let risk = 'low';

  for (const rule of RISK_RULES) {
    if (!rule.pattern.test(prompt)) continue;
    reasons.push(rule.reason);
    if (rule.risk === 'high') risk = 'high';
    if (rule.risk === 'medium' && risk !== 'high') risk = 'medium';
  }

  if (reasons.length === 0) reasons.push('general-request');
  return { risk, reasons };
}

function buildSuggestions(prompt, reasons) {
  const lower = prompt.toLowerCase();
  const suggestions = ['record-user-intent'];

  if (/\b(?:bug|error|fail|failing|failure|flaky|exception|crash|报错|失败|异常)\b/i.test(prompt)) {
    suggestions.push('use-systematic-debugging');
  }
  if (/\b(?:feature|implement|add|build|支持|新增|实现)\b/i.test(prompt)) {
    suggestions.push('consider-pipeline-selector');
  }
  if (/\b(?:review|审查|评审|code review)\b/i.test(prompt)) {
    suggestions.push('use-code-review-workflow');
  }
  if (/\b(?:test|tests|qa|验收|测试|regression)\b/i.test(prompt)) {
    suggestions.push('consider-qa-or-verification');
  }
  if (reasons.includes('destructive-request')) suggestions.push('require-explicit-confirmation');
  if (reasons.includes('credential-or-secret-request')) suggestions.push('avoid-secret-exposure');
  if (reasons.includes('large-scope-change') || reasons.includes('production-or-release-risk')) suggestions.push('require-plan-and-approval');
  if (reasons.includes('security-sensitive-request')) suggestions.push('review-permission-policy');
  if (lower.includes('继续')) suggestions.push('resume-current-roadmap');

  return [...new Set(suggestions)];
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
  const prompt = getPrompt(payload);
  const classification = classifyPrompt(prompt);
  const decision = getDecision(payload);
  const promptLength = prompt.length;

  return {
    spec_dir: getSpecDir(payload) || null,
    timestamp: now(),
    stage: `hook:${event}`,
    skill: hook.id || 'user-prompt-audit',
    passed: true,
    violations: [],
    event,
    decision,
    risk: firstString(payload.risk, payload.riskLevel, payload.promptAudit?.risk) || classification.risk,
    prompt: {
      text: prompt,
      length: promptLength,
      reasons: classification.reasons,
      suggestions: buildSuggestions(prompt, classification.reasons),
      session_id: firstString(payload.sessionId, payload.session_id, payload.input?.sessionId, payload.params?.sessionId),
      requester: firstString(payload.requester, payload.user, payload.actor, payload.input?.requester, payload.params?.requester),
      tags: asArray(payload.tags ?? payload.promptAudit?.tags),
    },
  };
}

function run({ event, payload = {}, hook = {} } = {}) {
  if (!HANDLED_EVENTS.has(event)) {
    return { status: 'skipped', message: `user-prompt-audit only handles UserPromptSubmit, got ${event}` };
  }

  const projectRoot = getProjectRoot(payload);
  const record = buildRecord(event, payload, hook);
  const historyPath = writeComplianceRecord(projectRoot, record);
  const warned = record.risk !== 'low';

  return {
    status: warned ? 'warned' : 'ok',
    message: warned ? 'User prompt recorded with risk or workflow suggestions' : 'User prompt recorded in compliance history',
    historyPath,
    record,
  };
}

module.exports = run;
module.exports.run = run;
module.exports.buildRecord = buildRecord;
module.exports.writeComplianceRecord = writeComplianceRecord;
module.exports.classifyPrompt = classifyPrompt;
