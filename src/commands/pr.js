import { isAbsolute, resolve } from 'node:path';
import { EvidenceStore } from '../core/evidence-store.js';

export default async function prCommand(action, options = {}) {
  if (action !== 'evidence') throw new Error(`Unknown pr action: ${action}`);
  return exportPrEvidence(options);
}

function exportPrEvidence(options) {
  const cwd = options.cwd || process.cwd();
  const store = new EvidenceStore(cwd);
  const out = options.out || '.loom/evidence/pr-evidence.md';
  const outPath = isAbsolute(out) ? out : resolve(cwd, out);
  const result = store.export({
    path: outPath,
    format: 'markdown',
    limit: options.limit,
    risk: options.risk,
    type: options.type,
    verdict: options.verdict,
    specDir: options.specDir,
    includeRaw: options.raw,
    hashArtifacts: options.hashArtifacts,
  });

  console.log(`Wrote PR evidence summary to ${result.path} (${result.bytes} bytes)`);
  return result;
}
