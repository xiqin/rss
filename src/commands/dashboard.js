import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { EvidenceStore } from '../core/evidence-store.js';
import { MemoryStore } from '../core/memory-store.js';

export default async function dashboardCommand(options = {}) {
  const cwd = options.cwd || process.cwd();
  const out = options.out || '.loom/reports/team-dashboard.html';
  const outPath = isAbsolute(out) ? out : resolve(cwd, out);
  const limit = parsePositiveInt(options.limit) || 10;
  const refreshSeconds = parsePositiveInt(options.refresh) || 15;
  const repositories = parseRepositories(options.repos, cwd);

  const filters = { specDir: options.specDir, limit };
  const data = repositories.map(repo => loadRepositoryDashboardData(repo, filters, options.specDir));
  const summary = aggregateSummary(data);
  const trends = aggregateTrends(data);
  const evidence = data.flatMap(repo => repo.evidence).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, limit);
  const memory = data.flatMap(repo => repo.memory).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  const payload = buildDashboardPayload({ summary, trends, evidence, memory, specDir: options.specDir, repositories: data, refreshSeconds });
  const dataPath = options.web ? resolveDashboardDataPath(cwd, outPath, options.dataOut) : null;
  const html = renderDashboard({ ...payload, dataFile: dataPath ? basename(dataPath) : null });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf-8');
  if (dataPath) {
    mkdirSync(dirname(dataPath), { recursive: true });
    writeFileSync(dataPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  }
  const bytes = Buffer.byteLength(html, 'utf-8');
  if (!options.silent) console.log(`Wrote team dashboard to ${outPath} (${bytes} bytes)`);
  return { path: outPath, bytes, dataPath, repositories: data.map(({ name, root, summary }) => ({ name, root, evidence: summary.total })) };
}

function resolveDashboardDataPath(cwd, outPath, dataOut) {
  if (dataOut) return isAbsolute(dataOut) ? dataOut : resolve(cwd, dataOut);
  return resolve(dirname(outPath), 'team-dashboard.json');
}

function buildDashboardPayload({ summary, trends, evidence, memory, specDir, repositories, refreshSeconds }) {
  return {
    schema: 'loom.dashboard.v1',
    generatedAt: new Date().toISOString(),
    refreshSeconds,
    specDir: specDir || null,
    summary,
    trends,
    evidence,
    memory,
    repositories: repositories.map(repo => ({
      name: repo.name,
      root: repo.root,
      summary: repo.summary,
      trends: repo.trends,
    })),
  };
}

function loadRepositoryDashboardData(repo, filters, specDir) {
  const evidenceStore = new EvidenceStore(repo.root);
  const memoryStore = new MemoryStore(resolve(repo.root, '.loom'));
  return {
    ...repo,
    summary: evidenceStore.summary({ specDir, limit: 0 }),
    trends: evidenceStore.trends({ specDir, limit: 0 }),
    allEvidence: evidenceStore.list({ specDir, limit: 0 }),
    evidence: evidenceStore.list(filters).map(item => ({ ...item, repository: repo.name })),
    memory: memoryStore.list({ specDir, limit: filters.limit }).map(item => ({ ...item, repository: repo.name })),
  };
}

function renderDashboard({ summary, trends, evidence, memory, specDir, repositories, dataFile, refreshSeconds }) {
  const bodyAttrs = dataFile ? ` data-dashboard-json="${html(dataFile)}" data-refresh-seconds="${html(refreshSeconds)}"` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loom Team Dashboard</title>
  <style>
    :root { color-scheme: light; --bg: #f8fafc; --card: #ffffff; --ink: #0f172a; --muted: #64748b; --line: #dbe3ef; --accent: #4338ca; --bad: #b91c1c; --warn: #b45309; --good: #15803d; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 2rem; }
    header { display: grid; gap: 0.4rem; margin-bottom: 1.5rem; }
    h1 { font-size: clamp(2rem, 5vw, 4rem); line-height: 0.95; margin: 0; letter-spacing: -0.06em; }
    h2 { margin: 0 0 0.75rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
    .scope { color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .panel { background: var(--card); border: 1px solid var(--line); border-radius: 1rem; padding: 1rem; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
    .metric { display: grid; gap: 0.25rem; }
    .metric strong { font-size: 2rem; letter-spacing: -0.04em; }
    .metric span { color: var(--muted); }
    .metric.fail strong { color: var(--bad); }
    .metric.warn strong { color: var(--warn); }
    .metric.pass strong { color: var(--good); }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--line); padding: 0.7rem 0.55rem; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .two { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr); gap: 1rem; }
    .pill { display: inline-block; border-radius: 999px; padding: 0.15rem 0.5rem; background: #eef2ff; color: var(--accent); font-size: 0.8rem; }
    .empty { color: var(--muted); }
    @media (max-width: 820px) { main { padding: 1rem; } .grid, .two { grid-template-columns: 1fr; } }
  </style>
</head>
<body${bodyAttrs}>
  <main>
    <header>
      <div class="pill">Loom Team Dashboard</div>
      <h1>AI engineering health</h1>
      <div class="scope">Generated at ${html(new Date().toISOString())}${specDir ? ` · scope ${html(specDir)}` : ''}</div>
    </header>

    <section class="grid" aria-label="Dashboard metrics">
      <article class="panel metric"><span>Evidence total</span><strong>${summary.total}</strong></article>
      <article class="panel metric pass"><span>PASS</span><strong>${summary.verdicts.PASS}</strong></article>
      <article class="panel metric warn"><span>WARN</span><strong>${summary.verdicts.WARN}</strong></article>
      <article class="panel metric fail"><span>Fail rate</span><strong>${percent(trends.rates.fail)}</strong></article>
    </section>

    <section class="two">
      <article class="panel">
        <h2>Recent Evidence</h2>
        ${renderEvidenceTable(evidence)}
      </article>
      <article class="panel">
        <h2>Knowledge Memory</h2>
        ${renderMemoryList(memory)}
      </article>
    </section>

    ${renderRepositoryTable(repositories)}

    <section class="panel" style="margin-top:1rem">
      <h2>Trend Snapshot</h2>
      <table><tbody>
        <tr><th>Window</th><td>${html(trends.window.earliest || '-')} → ${html(trends.window.latest || '-')}</td></tr>
        <tr><th>Risk mix</th><td>low ${trends.risks.low} / medium ${trends.risks.medium} / high ${trends.risks.high}</td></tr>
        <tr><th>Types</th><td>${html(formatCounts(trends.types))}</td></tr>
        <tr><th>Top failures</th><td>${trends.failure_reasons.length ? trends.failure_reasons.map(item => `${html(item.reason)} (${item.count})`).join('<br>') : '<span class="empty">none</span>'}</td></tr>
      </tbody></table>
    </section>
  </main>
  ${dataFile ? renderWebRefreshScript() : ''}
</body>
</html>
`;
}

function renderWebRefreshScript() {
  return `<script>
(() => {
  const jsonPath = document.body.dataset.dashboardJson;
  const refreshSeconds = Number.parseInt(document.body.dataset.refreshSeconds || '0', 10);
  if (!jsonPath || !refreshSeconds) return;
  async function refresh() {
    const response = await fetch(jsonPath, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    document.title = 'Loom Team Dashboard · ' + (data.generatedAt || 'live');
  }
  window.setInterval(refresh, refreshSeconds * 1000);
})();
</script>`;
}

function renderRepositoryTable(repositories) {
  if (!repositories || repositories.length <= 1) return '';
  return `<section class="panel" style="margin-top:1rem">
      <h2>Repositories</h2>
      <table><thead><tr><th>Repository</th><th>Evidence</th><th>PASS</th><th>WARN</th><th>FAIL</th><th>Fail rate</th></tr></thead><tbody>${repositories.map(repo => `<tr><td>${html(repo.name)}</td><td>${repo.summary.total}</td><td>${repo.summary.verdicts.PASS}</td><td>${repo.summary.verdicts.WARN}</td><td>${repo.summary.verdicts.FAIL}</td><td>${percent(repo.trends.rates.fail)}</td></tr>`).join('')}</tbody></table>
    </section>`;
}

function renderEvidenceTable(evidence) {
  if (evidence.length === 0) return '<p class="empty">No evidence found.</p>';
  return `<table><thead><tr><th>Verdict</th><th>Risk</th><th>Repo</th><th>Spec</th><th>Summary</th><th>Time</th></tr></thead><tbody>${evidence.map(item => `<tr><td>${html(item.verdict)}</td><td>${html(item.risk)}</td><td>${html(item.repository || '-')}</td><td>${html(item.spec_dir || '-')}</td><td>${html(item.summary || '')}</td><td>${html(item.timestamp || '')}</td></tr>`).join('')}</tbody></table>`;
}

function renderMemoryList(memory) {
  if (memory.length === 0) return '<p class="empty">No memory found.</p>';
  return `<ul>${memory.map(item => `<li><strong>${html(item.type)}</strong>: ${html(item.content)}<br><span class="scope">${formatMemoryMeta(item)}</span></li>`).join('')}</ul>`;
}

function formatMemoryMeta(item) {
  const parts = [];
  if (item.repository) parts.push(`repo:${item.repository}`);
  if (item.scope) parts.push(`scope:${item.scope}`);
  if (item.stage) parts.push(`stage:${item.stage}`);
  if (item.links?.spec) parts.push(item.links.spec);
  if (item.files?.length) parts.push(item.files.join(', '));
  return html(parts.join(' · ') || item.created_at || '');
}

function formatCounts(counts) {
  const entries = Object.entries(counts || {});
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(', ') : '-';
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseRepositories(value, cwd) {
  const roots = cleanArray(value);
  if (roots.length === 0) return [{ name: basename(resolve(cwd)) || 'current', root: resolve(cwd) }];
  return roots.map(root => {
    const resolved = isAbsolute(root) ? root : resolve(cwd, root);
    return { name: basename(resolved) || resolved, root: resolved };
  });
}

function cleanArray(value) {
  if (Array.isArray(value)) return value.flatMap(cleanArray);
  if (typeof value !== 'string') return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function aggregateSummary(repositories) {
  const summary = { total: 0, verdicts: { PASS: 0, WARN: 0, FAIL: 0 }, risks: { low: 0, medium: 0, high: 0 }, types: {} };
  for (const repo of repositories) {
    summary.total += repo.summary.total;
    for (const key of Object.keys(summary.verdicts)) summary.verdicts[key] += repo.summary.verdicts[key] || 0;
    for (const key of Object.keys(summary.risks)) summary.risks[key] += repo.summary.risks[key] || 0;
    addCounts(summary.types, repo.summary.types);
  }
  return summary;
}

function aggregateTrends(repositories) {
  const allEvidence = repositories.flatMap(repo => repo.allEvidence || repo.evidence);
  const total = allEvidence.length;
  const failed = allEvidence.filter(item => item.verdict === 'FAIL').length;
  const warned = allEvidence.filter(item => item.verdict === 'WARN').length;
  const risks = { low: 0, medium: 0, high: 0 };
  const types = {};
  const failures = new Map();
  const timestamps = allEvidence.map(item => item.timestamp).filter(Boolean).sort();
  for (const item of allEvidence) {
    if (risks[item.risk] != null) risks[item.risk]++;
    types[item.type] = (types[item.type] || 0) + 1;
    if (item.verdict === 'FAIL') {
      for (const violation of item.violations || []) failures.set(violation, (failures.get(violation) || 0) + 1);
    }
  }
  return {
    total,
    window: { earliest: timestamps[0] || null, latest: timestamps[timestamps.length - 1] || null },
    rates: { fail: total ? failed / total : 0, warn: total ? warned / total : 0 },
    risks,
    types,
    failure_reasons: [...failures.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
  };
}

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) target[key] = (target[key] || 0) + value;
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
