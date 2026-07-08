import { EvidenceStore } from '../core/evidence-store.js';
import { isAbsolute, resolve } from 'node:path';

export default async function evidence(options = {}) {
  const cwd = options.cwd || process.cwd();
  const store = new EvidenceStore(cwd);
  const filters = {
    limit: options.limit,
    risk: options.risk,
    type: options.type,
    verdict: options.verdict,
    specDir: options.specDir,
    includeRaw: options.raw,
    hashArtifacts: options.hashArtifacts,
  };
  const format = String(options.format || (options.jsonl ? 'jsonl' : 'json')).toLowerCase();

  if (options.trends) {
    const trendOptions = { ...filters, top: options.top };
    if (options.out) {
      const outPath = isAbsolute(options.out) ? options.out : resolve(cwd, options.out);
      const result = store.exportTrends({ ...trendOptions, path: outPath });
      console.log(`Wrote evidence trends to ${result.path} (${result.bytes} bytes)`);
      return;
    }
    console.log(JSON.stringify(store.trends(trendOptions), null, 2));
    return;
  }

  if (options.out) {
    const outPath = isAbsolute(options.out) ? options.out : resolve(cwd, options.out);
    const result = store.export({ ...filters, path: outPath, format });
    console.log(`Wrote evidence export to ${result.path} (${result.bytes} bytes)`);
    return;
  }

  if (options.jsonl) {
    const out = store.jsonl(filters);
    if (out) console.log(out);
    return;
  }

  const items = store.list(filters);
  const summary = store.summary({ ...filters, limit: 0 });

  if (options.json) {
    console.log(JSON.stringify({ summary, evidence: items }, null, 2));
    return;
  }

  console.log(`\n  loom evidence — ${summary.total} record(s)\n`);
  if (summary.total === 0) {
    console.log('  (no evidence found)\n');
    return;
  }

  console.log(`  Verdicts: PASS ${summary.verdicts.PASS} · WARN ${summary.verdicts.WARN} · FAIL ${summary.verdicts.FAIL}`);
  console.log(`  Risks:    low ${summary.risks.low} · medium ${summary.risks.medium} · high ${summary.risks.high}`);
  console.log('');

  for (const item of items) {
    const stamp = item.timestamp ? item.timestamp.slice(0, 16).replace('T', ' ') : 'unknown-time';
    console.log(`  [${item.verdict}] ${stamp} ${item.type} ${item.risk} — ${item.summary}`);
    if (item.stage || item.skill) console.log(`      ${item.stage || '-'} / ${item.skill || '-'}`);
  }
  console.log('');
}
