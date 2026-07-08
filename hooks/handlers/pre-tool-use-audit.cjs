const COMMAND_TOOL_NAMES = new Set(['bash', 'shell', 'powershell', 'cmd', 'terminal', 'run_command']);

const BLOCKED_COMMAND_RULES = [
  {
    id: 'git-reset-hard',
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: 'git reset --hard can discard uncommitted work',
  },
  {
    id: 'git-clean-force',
    pattern: /\bgit\s+clean\s+-[^\n]*[fd][^\n]*\b/i,
    reason: 'git clean -fd can delete untracked files',
  },
  {
    id: 'rm-rf-broad-target',
    pattern: /\brm\s+-[^\n]*[rf][^\n]*\s+(?:\/|~|\*|\.|\.\.|[A-Za-z]:[\\/])/i,
    reason: 'rm -rf against a broad target is destructive',
  },
  {
    id: 'powershell-remove-force-recurse',
    pattern: /\bRemove-Item\b(?=[^\n]*(?:^|\s)-Recurse\b)(?=[^\n]*(?:^|\s)-Force\b)/i,
    reason: 'Remove-Item -Recurse -Force is destructive',
  },
  {
    id: 'windows-del-recursive-quiet',
    pattern: /\b(?:del|erase)\b(?=[^\n]*\/(?:s|q)\b)(?=[^\n]*\/(?:q|s)\b)/i,
    reason: 'recursive quiet deletion is destructive',
  },
  {
    id: 'disk-management',
    pattern: /\b(?:format|diskpart)\b/i,
    reason: 'disk management commands can destroy data',
  },
];

function getToolName(payload = {}) {
  const raw = payload.toolName ?? payload.tool ?? payload.name ?? payload.params?.tool ?? payload.input?.tool;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return raw.name ?? raw.id;
  return '';
}

function getCommand(payload = {}) {
  return payload.command
    ?? payload.input?.command
    ?? payload.arguments?.command
    ?? payload.params?.command
    ?? payload.toolInput?.command
    ?? '';
}

function isCommandTool(toolName) {
  if (!toolName) return false;
  const normalized = String(toolName).toLowerCase();
  return COMMAND_TOOL_NAMES.has(normalized) || normalized.includes('bash') || normalized.includes('shell');
}

function hasExplicitApproval(payload = {}) {
  return payload.approved === true
    || payload.confirmed === true
    || payload.userApproved === true
    || payload.permission?.approved === true;
}

function classifyCommand(command) {
  for (const rule of BLOCKED_COMMAND_RULES) {
    if (rule.pattern.test(command)) return rule;
  }
  return null;
}

function run({ event, payload = {} } = {}) {
  const toolName = getToolName(payload);
  const command = getCommand(payload);

  if (event && event !== 'PreToolUse') {
    return { status: 'skipped', message: `pre-tool-use-audit only handles PreToolUse, got ${event}` };
  }

  if (!isCommandTool(toolName) || !command) {
    return { status: 'ok', risk: 'low', message: 'No shell command to audit' };
  }

  const matchedRule = classifyCommand(String(command));
  if (!matchedRule) {
    return { status: 'ok', risk: 'low', tool: toolName };
  }

  const decision = {
    status: hasExplicitApproval(payload) ? 'warned' : 'blocked',
    risk: 'high',
    rule: matchedRule.id,
    reason: matchedRule.reason,
    tool: toolName,
    command: String(command),
    message: `${matchedRule.reason}. Require explicit user confirmation before running this command.`,
  };

  if (decision.status === 'warned') {
    console.warn(`[loom:hook:pre-tool-use-audit] approved high-risk command: ${matchedRule.id}`);
  }

  return decision;
}

module.exports = run;
module.exports.run = run;
module.exports.classifyCommand = classifyCommand;
