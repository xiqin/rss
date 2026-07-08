import { basename, isAbsolute, join, resolve } from 'node:path';
import { EvidenceStore } from '../core/evidence-store.js';
import { MemoryStore } from '../core/memory-store.js';
import { loadWorkflow } from '../core/pipeline-engine.js';
import { resolvePipelineDir } from '../core/spec-dir.js';
import dashboardCommand from './dashboard.js';

export default async function finalizeCommand(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  if (!options.specDir) {
    console.error('\n  loom finalize: --spec-dir is required\n');
    process.exitCode = 1;
    return null;
  }

  let specDir;
  try {
    specDir = resolvePipelineDir(cwd, options.specDir);
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exitCode = 1;
    return null;
  }

  let workflow = null;
  try {
    workflow = loadWorkflow(cwd, undefined, { requirePipelines: false });
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exitCode = 1;
    return null;
  }

  const result = await finalizeReports({ ...options, cwd, specDir, workflow });
  printFinalizeResult(result);
  return result;
}

export async function finalizeReports(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const specDir = isAbsolute(options.specDir) ? options.specDir : resolve(cwd, options.specDir || '');
  const config = resolveReportingConfig(options.workflow, options);
  if (!config.enabled) return { skipped: true, artifacts: [], config };

  const slug = sanitizeSlug(basename(specDir));
  const artifacts = [];
  const store = new EvidenceStore(cwd);

  if (config.evidence.enabled) {
    const out = join(cwd, '.loom', 'evidence', `${slug}.md`);
    artifacts.push({ kind: 'evidence', ...store.export({
      path: out,
      format: config.evidence.format,
      specDir,
      limit: config.evidence.limit,
      hashArtifacts: config.evidence.hashArtifacts,
    }) });

    if (config.evidence.trends) {
      const trendsOut = join(cwd, '.loom', 'evidence', `${slug}-trends.json`);
      artifacts.push({ kind: 'evidence-trends', ...store.exportTrends({
        path: trendsOut,
        specDir,
        limit: 0,
      }) });
    }
  }

  if (config.prEvidence.enabled) {
    const out = join(cwd, '.loom', 'evidence', `pr-${slug}.md`);
    artifacts.push({ kind: 'pr-evidence', ...store.export({
      path: out,
      format: 'markdown',
      specDir,
      limit: config.prEvidence.limit,
      hashArtifacts: config.prEvidence.hashArtifacts,
    }) });
  }

  if (config.dashboard.enabled) {
    const result = await dashboardCommand({
      cwd,
      specDir,
      out: join('.loom', 'reports', `${slug}-dashboard.html`),
      web: config.dashboard.web,
      dataOut: join('.loom', 'reports', `${slug}-dashboard.json`),
      limit: config.dashboard.limit,
      refresh: config.dashboard.refresh,
      silent: true,
    });
    artifacts.push({ kind: 'dashboard', path: result.path, bytes: result.bytes });
    if (result.dataPath) artifacts.push({ kind: 'dashboard-data', path: result.dataPath });
  }

  if (config.memoryExport.enabled) {
    const memoryStore = new MemoryStore(join(cwd, '.loom'));
    const md = memoryStore.exportMarkdown();
    artifacts.push({ kind: 'memory', path: join(cwd, '.loom', 'memory', 'MEMORY.md'), bytes: Buffer.byteLength(md, 'utf-8') });
  }

  return { skipped: false, artifacts, config };
}

export function printFinalizeResult(result) {
  if (!result) return;
  if (result.skipped) {
    console.log('\n  Finalize reports skipped.\n');
    return;
  }
  console.log(`\n  ✓ Finalized ${result.artifacts.length} artifact(s)`);
  for (const artifact of result.artifacts) {
    console.log(`  - ${artifact.kind}: ${artifact.path}`);
  }
  console.log('');
}

function resolveReportingConfig(workflow, options) {
  const cfg = workflow?.reporting?.on_complete || workflow?.reporting?.onComplete || {};
  const enabled = options.reports !== false && cfg.enabled !== false;
  return {
    enabled,
    evidence: sectionConfig(cfg.evidence, true, {
      format: 'markdown',
      trends: true,
      hashArtifacts: true,
      limit: 0,
    }, options.evidence === true ? true : undefined, {
      hashArtifacts: options.hashArtifacts === true ? true : undefined,
    }),
    prEvidence: sectionConfig(cfg.pr_evidence ?? cfg.prEvidence, false, {
      hashArtifacts: true,
      limit: 0,
    }, options.prEvidence === true ? true : undefined, {
      hashArtifacts: options.hashArtifacts === true ? true : undefined,
    }),
    dashboard: sectionConfig(cfg.dashboard, false, {
      web: true,
      limit: 10,
      refresh: 15,
    }, options.dashboard === true ? true : undefined),
    memoryExport: sectionConfig(cfg.memory_export ?? cfg.memoryExport, true),
  };
}

function sectionConfig(value, defaultEnabled, defaults = {}, forcedEnabled, overrides = {}) {
  const base = normalizeSectionConfig(typeof value === 'object' && value !== null ? value : {});
  const enabled = forcedEnabled !== undefined
    ? forcedEnabled
    : typeof value === 'boolean' ? value : base.enabled ?? defaultEnabled;
  return { ...defaults, ...base, ...cleanUndefined(overrides), enabled };
}

function normalizeSectionConfig(value) {
  const normalized = { ...value };
  if (normalized.hash_artifacts !== undefined && normalized.hashArtifacts === undefined) {
    normalized.hashArtifacts = normalized.hash_artifacts;
  }
  if (normalized.memory_export !== undefined && normalized.memoryExport === undefined) {
    normalized.memoryExport = normalized.memory_export;
  }
  return normalized;
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function sanitizeSlug(value) {
  return String(value || 'spec').replace(/[^A-Za-z0-9._+-]+/g, '-').replace(/^-+|-+$/g, '') || 'spec';
}
