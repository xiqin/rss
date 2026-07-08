import { dirname, join, resolve } from 'node:path';
import { NodeFileSystem } from './fs-interface.js';
import { resolveTrackedPath, sha256File } from './fingerprints.js';

const RISK_ORDER = { low: 0, medium: 1, high: 2 };
const HOOK_PREFIX = 'hook:';

export class EvidenceStore {
  constructor(projectRoot, { fs } = {}) {
    this.root = projectRoot;
    this.fs = fs || new NodeFileSystem();
    this.historyPath = join(projectRoot, '.loom', 'compliance', 'history.json');
    this.evidenceDir = join(projectRoot, '.loom', 'evidence');
    this.defaultExportPath = join(this.evidenceDir, 'evidence.json');
    this.defaultTrendsPath = join(this.evidenceDir, 'trends.json');
  }

  list(options = {}) {
    let evidence = this._loadHistory().map((record, index) => normalizeComplianceRecord(record, index, {
      ...options,
      projectRoot: this.root,
      fs: this.fs,
    }));

    if (options.type) evidence = evidence.filter(e => e.type === options.type);
    if (options.risk) evidence = evidence.filter(e => e.risk === options.risk);
    if (options.verdict) evidence = evidence.filter(e => e.verdict === options.verdict);
    if (options.specDir) evidence = evidence.filter(e => matchesSpecDir(e.spec_dir, options.specDir, this.root));

    evidence.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

    const limit = Number.parseInt(options.limit, 10);
    if (Number.isFinite(limit) && limit > 0) evidence = evidence.slice(0, limit);
    return evidence;
  }

  summary(options = {}) {
    const evidence = this.list({ ...options, limit: 0 });
    const summary = {
      total: evidence.length,
      verdicts: { PASS: 0, WARN: 0, FAIL: 0 },
      risks: { low: 0, medium: 0, high: 0 },
      types: {},
    };

    for (const item of evidence) {
      summary.verdicts[item.verdict] = (summary.verdicts[item.verdict] || 0) + 1;
      summary.risks[item.risk] = (summary.risks[item.risk] || 0) + 1;
      summary.types[item.type] = (summary.types[item.type] || 0) + 1;
    }

    return summary;
  }

  trends(options = {}) {
    const evidence = this.list(options);
    return buildTrends(evidence, options);
  }

  jsonl(options = {}) {
    return this.list(options).map(item => JSON.stringify(item)).join('\n');
  }

  export(options = {}) {
    const path = options.path || this.defaultExportPath;
    const format = String(options.format || 'json').toLowerCase();
    const payload = this.render({ ...options, format });

    this.fs.mkdirSync(dirname(path), { recursive: true });
    this.fs.writeFileSync(path, payload, 'utf-8');
    return { path, bytes: Buffer.byteLength(payload, 'utf-8') };
  }

  exportTrends(options = {}) {
    const path = options.path || this.defaultTrendsPath;
    const payload = JSON.stringify(this.trends(options), null, 2) + '\n';

    this.fs.mkdirSync(dirname(path), { recursive: true });
    this.fs.writeFileSync(path, payload, 'utf-8');
    return { path, bytes: Buffer.byteLength(payload, 'utf-8') };
  }

  render(options = {}) {
    const format = String(options.format || 'json').toLowerCase();
    if (format === 'jsonl') return this.jsonl(options);

    const summary = this.summary({ ...options, limit: 0 });
    const evidence = this.list(options);
    if (format === 'markdown' || format === 'md') return renderMarkdownReport(summary, evidence);
    if (format === 'html') return renderHtmlReport(summary, evidence);
    return JSON.stringify({ summary, evidence }, null, 2) + '\n';
  }

  _loadHistory() {
    if (!this.fs.existsSync(this.historyPath)) return [];
    try {
      const data = JSON.parse(this.fs.readFileSync(this.historyPath, 'utf-8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
}

export function normalizeComplianceRecord(record = {}, index = 0, options = {}) {
  const risk = normalizeRisk(record.risk);
  const passed = record.passed !== false;
  const type = inferEvidenceType(record);
  const subject = extractSubject(record, type);
  const artifacts = extractArtifacts(record, type);
  const artifactHashes = options.hashArtifacts ? hashArtifacts(artifacts, record, options) : {};
  const metrics = extractMetrics(record, type);
  const verdict = passed ? (risk === 'low' ? 'PASS' : 'WARN') : 'FAIL';

  const evidence = {
    schema_version: 'loom.evidence.v1',
    id: buildEvidenceId(record, index),
    source: 'compliance-history',
    type,
    timestamp: record.timestamp || null,
    spec_dir: record.spec_dir || null,
    stage: record.stage || null,
    skill: record.skill || null,
    verdict,
    passed,
    risk,
    summary: summarizeRecord(record, type),
    violations: Array.isArray(record.violations) ? record.violations : [],
    subject,
    artifacts,
    artifact_hashes: artifactHashes,
    metrics,
  };

  if (options.includeRaw) evidence.raw = record;
  return evidence;
}

function buildEvidenceId(record, index) {
  const parts = [record.timestamp, record.stage, record.skill, index]
    .filter(v => v !== undefined && v !== null && v !== '')
    .map(v => String(v).replace(/[^a-z0-9_.:-]+/gi, '-'));
  return parts.join('|') || `evidence-${index}`;
}

function normalizeRisk(risk) {
  return RISK_ORDER[String(risk || '').toLowerCase()] !== undefined ? String(risk).toLowerCase() : 'low';
}

function inferEvidenceType(record) {
  const stage = String(record.stage || '');
  const event = String(record.event || stage.replace(HOOK_PREFIX, ''));
  if (event === 'UserPromptSubmit') return 'user_prompt';
  if (event === 'PreToolUse' || event === 'PostToolUse') return 'tool_use';
  if (event === 'PermissionRequest' || event === 'PermissionDenied') return 'permission';
  if (event === 'SubagentStart' || event === 'SubagentStop') return 'subagent';
  if (event === 'TaskCreated' || event === 'TaskCompleted') return 'task';
  if (event === 'WorktreeCreate' || event === 'WorktreeRemove') return 'worktree';
  if (event === 'PreCompact' || event === 'PostCompact') return 'compaction';
  if (event === 'FileChanged') return 'file_change';
  if (stage === 'verification') return 'verification';
  if (stage.startsWith(HOOK_PREFIX)) return 'hook';
  return 'compliance';
}

function extractSubject(record, type) {
  switch (type) {
    case 'user_prompt':
      return pick(record.prompt, ['text', 'reasons', 'suggestions', 'session_id', 'requester']);
    case 'tool_use':
      return pick(record.tool_use, ['tool', 'input_summary', 'exit_code', 'success', 'error_summary', 'risk_reasons']);
    case 'permission':
      return pick(record.permission, ['tool', 'action', 'resource', 'reason', 'requester']);
    case 'subagent':
      return pick(record.subagent, ['id', 'session_id', 'task_id', 'role', 'model', 'status', 'summary']);
    case 'task':
      return pick(record.task, ['id', 'title', 'status', 'owner', 'complexity', 'summary']);
    case 'worktree':
      return pick(record.worktree, ['path', 'branch', 'base_branch', 'commit', 'cleanup_status', 'removed', 'dirty']);
    case 'compaction':
      return pick(record.compaction, ['id', 'session_id', 'reason', 'summary', 'handoff_path']);
    case 'file_change':
      return pick(record.file_change, ['changed_count', 'sensitive_files', 'sync_suggestions']);
    default:
      return {};
  }
}

function extractArtifacts(record, type) {
  if (type === 'tool_use') return asArray(record.tool_use?.artifacts);
  if (type === 'task') return asArray(record.task?.artifacts);
  if (type === 'file_change') return asArray(record.file_change?.files).map(f => f?.path || f).filter(Boolean);

  const paths = [];
  for (const obj of [record.task, record.subagent, record.compaction, record.worktree]) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of ['task_path', 'task_state_path', 'handoff_path', 'path']) {
      if (obj[key]) paths.push(obj[key]);
    }
  }
  return paths;
}

function extractMetrics(record, type) {
  const metrics = {};
  if (type === 'tool_use') {
    if (record.tool_use?.duration_ms !== undefined) metrics.duration_ms = record.tool_use.duration_ms;
    if (record.tool_use?.exit_code !== undefined) metrics.exit_code = record.tool_use.exit_code;
  }
  if (type === 'task' && record.task?.duration_ms !== undefined) metrics.duration_ms = record.task.duration_ms;
  if (type === 'subagent' && record.subagent?.duration_ms !== undefined) metrics.duration_ms = record.subagent.duration_ms;
  if (type === 'file_change' && record.file_change?.changed_count !== undefined) metrics.changed_count = record.file_change.changed_count;
  if (type === 'compaction') {
    if (record.compaction?.before_tokens !== undefined) metrics.before_tokens = record.compaction.before_tokens;
    if (record.compaction?.after_tokens !== undefined) metrics.after_tokens = record.compaction.after_tokens;
  }
  return metrics;
}

function hashArtifacts(artifacts, record, options) {
  const projectRoot = options.projectRoot;
  const fs = options.fs || new NodeFileSystem();
  if (!projectRoot) return {};

  const specRoot = record.spec_dir ? resolve(projectRoot, record.spec_dir) : projectRoot;
  const hashes = {};
  for (const artifact of artifacts) {
    if (typeof artifact !== 'string' || artifact.trim() === '') continue;
    const path = resolveTrackedPath(specRoot, projectRoot, artifact);
    const digest = path ? sha256File(path, fs) : null;
    if (digest) hashes[artifact] = digest;
  }
  return hashes;
}

function summarizeRecord(record, type) {
  if (record.violations?.length) return String(record.violations[0]);
  if (type === 'user_prompt') return truncate(record.prompt?.text || 'User prompt submitted');
  if (type === 'tool_use') return record.tool_use?.error_summary || `${record.tool_use?.tool || 'Tool'} ${record.decision || 'completed'}`;
  if (type === 'permission') return `${record.permission?.tool || 'Permission'} ${record.decision || 'recorded'}`;
  if (type === 'task') return record.task?.summary || `${record.task?.id || 'Task'} ${record.decision || 'recorded'}`;
  if (type === 'subagent') return record.subagent?.summary || `${record.subagent?.id || 'Subagent'} ${record.decision || 'recorded'}`;
  if (type === 'worktree') return record.worktree?.summary || `${record.worktree?.branch || record.worktree?.path || 'Worktree'} ${record.decision || 'recorded'}`;
  if (type === 'compaction') return record.compaction?.summary || `Compaction ${record.decision || 'recorded'}`;
  if (type === 'file_change') return `${record.file_change?.changed_count || 0} file(s) changed`;
  return `${record.stage || 'compliance'} ${record.passed === false ? 'failed' : 'passed'}`;
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function truncate(value, limit = 160) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function buildTrends(evidence, options = {}) {
  const total = evidence.length;
  const verdicts = { PASS: 0, WARN: 0, FAIL: 0 };
  const risks = { low: 0, medium: 0, high: 0 };
  const types = {};
  const riskByType = {};
  const durations = [];
  const failureReasons = new Map();
  const timestamps = evidence.map(item => item.timestamp).filter(Boolean).sort();

  for (const item of evidence) {
    verdicts[item.verdict] = (verdicts[item.verdict] || 0) + 1;
    risks[item.risk] = (risks[item.risk] || 0) + 1;
    types[item.type] = (types[item.type] || 0) + 1;
    riskByType[item.type] ||= { low: 0, medium: 0, high: 0 };
    riskByType[item.type][item.risk] = (riskByType[item.type][item.risk] || 0) + 1;

    const duration = Number(item.metrics?.duration_ms);
    if (Number.isFinite(duration)) durations.push(duration);

    if (item.verdict === 'FAIL') {
      const reason = String(item.violations?.[0] || item.summary || `${item.type} failed`);
      failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1);
    }
  }

  const top = Number.parseInt(options.top || options.topN || 5, 10);
  const topCount = Number.isFinite(top) && top > 0 ? top : 5;
  const durationTotal = durations.reduce((sum, value) => sum + value, 0);

  return {
    total,
    window: {
      limit: parsePositiveInt(options.limit),
      earliest: timestamps[0] || null,
      latest: timestamps[timestamps.length - 1] || null,
    },
    verdicts,
    risks,
    types,
    rates: {
      pass: rate(verdicts.PASS, total),
      warn: rate(verdicts.WARN, total),
      fail: rate(verdicts.FAIL, total),
    },
    average_duration_ms: durations.length ? Math.round(durationTotal / durations.length) : null,
    duration_count: durations.length,
    failure_reasons: [...failureReasons.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topCount)
      .map(([reason, count]) => ({ reason, count })),
    risk_by_type: riskByType,
  };
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function matchesSpecDir(recordSpecDir, filterSpecDir, projectRoot) {
  if (!recordSpecDir || !filterSpecDir) return false;
  return normalizeSpecDir(recordSpecDir, projectRoot) === normalizeSpecDir(filterSpecDir, projectRoot);
}

function normalizeSpecDir(specDir, projectRoot) {
  const resolved = resolve(projectRoot, specDir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function rate(count, total) {
  return total > 0 ? Number((count / total).toFixed(4)) : 0;
}

function renderMarkdownReport(summary, evidence) {
  const lines = [
    '# Loom Evidence Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Total | ${summary.total} |`,
    `| Verdicts | PASS ${summary.verdicts.PASS} / WARN ${summary.verdicts.WARN} / FAIL ${summary.verdicts.FAIL} |`,
    `| Risks | low ${summary.risks.low} / medium ${summary.risks.medium} / high ${summary.risks.high} |`,
    `| Types | ${formatTypeCounts(summary.types)} |`,
    '',
    '## Evidence',
    '',
  ];

  if (evidence.length === 0) {
    lines.push('(no evidence found)', '');
    return lines.join('\n');
  }

  lines.push('| Verdict | Risk | Type | Spec | Time | Summary | Stage / Skill | Artifacts |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const item of evidence) {
    lines.push([
      item.verdict,
      item.risk,
      item.type,
      item.spec_dir || '-',
      item.timestamp || '',
      item.summary || '',
      `${item.stage || '-'} / ${item.skill || '-'}`,
      formatArtifacts(item),
    ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  return lines.join('\n');
}

function renderHtmlReport(summary, evidence) {
  const rows = evidence.length === 0
    ? '<p>(no evidence found)</p>'
    : `<table><thead><tr><th>Verdict</th><th>Risk</th><th>Type</th><th>Spec</th><th>Time</th><th>Summary</th><th>Stage / Skill</th><th>Artifacts</th></tr></thead><tbody>${evidence.map(item => `<tr><td>${html(item.verdict)}</td><td>${html(item.risk)}</td><td>${html(item.type)}</td><td>${html(item.spec_dir || '-')}</td><td>${html(item.timestamp || '')}</td><td>${html(item.summary || '')}</td><td>${html(`${item.stage || '-'} / ${item.skill || '-'}`)}</td><td>${html(formatArtifacts(item))}</td></tr>`).join('')}</tbody></table>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Loom Evidence Report</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 2rem; color: #111827; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #d1d5db; padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    code { background: #f3f4f6; padding: 0.1rem 0.25rem; border-radius: 0.25rem; }
  </style>
</head>
<body>
  <h1>Loom Evidence Report</h1>
  <p>Generated at: ${html(new Date().toISOString())}</p>
  <h2>Summary</h2>
  <ul>
    <li>Total: ${summary.total}</li>
    <li>Verdicts: PASS ${summary.verdicts.PASS} / WARN ${summary.verdicts.WARN} / FAIL ${summary.verdicts.FAIL}</li>
    <li>Risks: low ${summary.risks.low} / medium ${summary.risks.medium} / high ${summary.risks.high}</li>
    <li>Types: ${html(formatTypeCounts(summary.types))}</li>
  </ul>
  <h2>Evidence</h2>
  ${rows}
</body>
</html>
`;
}

function formatTypeCounts(types) {
  const entries = Object.entries(types || {});
  return entries.length ? entries.map(([type, count]) => `${type}: ${count}`).join(', ') : '-';
}

function formatArtifacts(item) {
  const artifacts = asArray(item.artifacts);
  if (artifacts.length === 0) return '-';
  return artifacts.map(path => {
    const hash = item.artifact_hashes?.[path];
    return hash ? `${path} (${hash.slice(0, 12)})` : path;
  }).join(', ');
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
