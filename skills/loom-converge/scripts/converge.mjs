#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { validateRequirementsFile } from '../../../src/core/requirements.js';
import { validateTraceabilityFile } from '../../../src/core/traceability.js';

export function runConverge(specDir, round = 1) {
  const errors = [];

  if (!existsSync(join(specDir, 'requirements.json'))) {
    return {
      ok: false,
      error: `Missing requirements.json in ${specDir}`,
      errors: [`Missing requirements.json in ${specDir}`],
      report: null,
    };
  }

  const requirements = validateRequirementsFile(specDir, errors, {
    required: true,
  });
  if (errors.length > 0) {
    return { ok: false, errors, report: null };
  }

  const behaviorIdsByRequirement = requirements.behaviorIdsByRequirement || {};
  const allBehaviorIds = [];
  for (const ids of Object.values(behaviorIdsByRequirement)) {
    for (const id of ids) allBehaviorIds.push(id);
  }

  const traceabilityErrors = [];
  validateTraceabilityFile(specDir, traceabilityErrors, {
    required: true,
    specRequirementIds: requirements.specRequirementIds,
    behaviorIdsByRequirement,
    requireEvidence: false,
    requireTaskFiles: false,
  });
  if (traceabilityErrors.length > 0) {
    return { ok: false, errors: traceabilityErrors, report: null };
  }

  const traceability = JSON.parse(
    readFileSync(join(specDir, 'traceability.json'), 'utf8')
  );
  const entries = normalizeTraceabilityEntries(traceability);

  const classification = {};
  const findings = [];
  let coveredCount = 0;
  let missingCount = 0;
  let partialCount = 0;
  let contradictsCount = 0;
  let unrequestedCount = 0;

  for (const behaviorId of allBehaviorIds) {
    const reqId = behaviorId.split('-B')[0];
    const reqEntry = entries[reqId] || {};
    const behaviorEntry = (reqEntry.behaviors || {})[behaviorId];
    if (!behaviorEntry) {
      classification[behaviorId] = 'missing';
      missingCount += 1;
      findings.push({
        id: `F-conv-${findings.length + 1}`,
        kind: 'missing',
        severity: 'blocker',
        message: `${behaviorId} has no traceability entry`,
        requirement_id: reqId,
        behavior_id: behaviorId,
        artifact: 'traceability.json',
        suggested_fix: { action: 'create_task', details: `add task to cover ${behaviorId}` },
      });
      continue;
    }

    const hasTests = (behaviorEntry.tests || []).length > 0;
    const hasEvidence = (behaviorEntry.evidence || []).length > 0;
    const testsExist = (behaviorEntry.tests || []).every((ref) => fileExists(specDir, ref));
    const evidenceExists = (behaviorEntry.evidence || []).every((ref) => fileExists(specDir, ref));

    if (!hasTests || !hasEvidence || !testsExist || !evidenceExists) {
      const kind = hasTests || hasEvidence ? 'partial' : 'missing';
      classification[behaviorId] = kind;
      if (kind === 'partial') partialCount += 1;
      else missingCount += 1;
      findings.push({
        id: `F-conv-${findings.length + 1}`,
        kind,
        severity: 'blocker',
        message: `${behaviorId} has missing or non-existent tests/evidence`,
        requirement_id: reqId,
        behavior_id: behaviorId,
        artifact: 'traceability.json',
        suggested_fix: { action: 'create_task', details: `add task to implement test/evidence for ${behaviorId}` },
      });
    } else {
      classification[behaviorId] = 'covered';
      coveredCount += 1;
    }
  }

  const knownBehaviors = new Set(allBehaviorIds);
  for (const reqId of Object.keys(entries)) {
    const reqEntry = entries[reqId] || {};
    for (const behaviorId of Object.keys(reqEntry.behaviors || {})) {
      if (!knownBehaviors.has(behaviorId)) {
        classification[behaviorId] = 'unrequested';
        unrequestedCount += 1;
        findings.push({
          id: `F-conv-${findings.length + 1}`,
          kind: 'unrequested',
          severity: 'warning',
          message: `${behaviorId} in traceability but not in requirements.json`,
          requirement_id: reqId,
          behavior_id: behaviorId,
          artifact: 'traceability.json',
          suggested_fix: { action: 'update_traceability', details: `remove ${behaviorId}` },
        });
      }
    }
  }

  const blockerCount = findings.filter((f) => f.severity === 'blocker').length;
  const report = {
    stage: 'converge',
    round,
    status: blockerCount === 0 ? 'converged' : 'needs_another_round',
    classification,
    findings,
    coverage: {
      behavior_coverage: percent(coveredCount, allBehaviorIds.length),
      missing_count: missingCount,
      partial_count: partialCount,
      contradicts_count: contradictsCount,
      unrequested_count: unrequestedCount,
    },
    blocker_count: blockerCount,
    created_at: new Date().toISOString(),
  };

  const outPath = join(specDir, 'convergence-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  const errorsOut = findings.map((f) => `${f.severity === 'blocker' ? 'ERROR' : 'WARN'} ${f.id} [${f.kind}] ${f.message}`);

  return {
    ok: blockerCount === 0,
    errors: errorsOut,
    report,
  };
}

function percent(part, total) {
  if (total === 0) return '100%';
  return `${Math.round((part / total) * 100)}%`;
}

function fileExists(specDir, ref) {
  if (!ref || /^(https?:|urn:|sha256:)/.test(ref)) return true;
  const stripped = ref.replace(/[#:].*$/, '');
  if (!stripped) return true;
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(stripped) || stripped.startsWith('/')) return existsSync(stripped);
  const projectRoot = dirname(dirname(specDir));
  return existsSync(join(specDir, stripped)) || existsSync(join(projectRoot, stripped));
}

function normalizeTraceabilityEntries(data) {
  const result = {};
  if (!data || !data.requirements) return result;
  if (Array.isArray(data.requirements)) {
    for (const entry of data.requirements) {
      const id = entry.id || entry.requirement_id;
      if (id) {
        result[id] = {
          tasks: entry.tasks || entry.task_ids || [],
          tests: entry.tests || entry.test_refs || [],
          evidence: entry.evidence || entry.evidence_refs || [],
          behaviors: normalizeBehaviors(entry.behaviors),
        };
      }
    }
  } else {
    for (const [id, entry] of Object.entries(data.requirements)) {
      result[id] = {
        tasks: entry.tasks || entry.task_ids || [],
        tests: entry.tests || entry.test_refs || [],
        evidence: entry.evidence || entry.evidence_refs || [],
        behaviors: normalizeBehaviors(entry.behaviors),
      };
    }
  }
  return result;
}

function normalizeBehaviors(behaviors) {
  const result = {};
  if (!behaviors) return result;
  if (Array.isArray(behaviors)) {
    for (const b of behaviors) {
      if (b && b.id) {
        result[b.id] = {
          tasks: b.tasks || b.task_ids || [],
          tests: b.tests || b.test_refs || [],
          evidence: b.evidence || b.evidence_refs || [],
        };
      }
    }
  } else {
    for (const [id, b] of Object.entries(behaviors)) {
      result[id] = {
        tasks: (b && (b.tasks || b.task_ids)) || [],
        tests: (b && (b.tests || b.test_refs)) || [],
        evidence: (b && (b.evidence || b.evidence_refs)) || [],
      };
    }
  }
  return result;
}

// ── CLI 包装层（仅供 loom 仓库内开发/测试用，部署后路径会断裂） ──
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('converge.mjs');
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const r = runConverge(options.specDir, options.round);
  if (r.error) console.error(`ERROR ${r.error}`);
  for (const e of r.errors || []) console.error(e);
  if (r.report) {
    console.log(`Converge round ${options.round} in ${options.specDir}: ${r.report.coverage.behavior_coverage} covered, ${r.report.coverage.missing_count} missing, ${r.report.blocker_count} blocker -> ${r.report.status}`);
  }
  if (!r.ok) process.exit(1);
}

function parseArgs(argv) {
  const options = { specDir: process.cwd(), round: 1 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spec-dir') options.specDir = argv[++i];
    else if (arg === '--round') options.round = parseInt(argv[++i], 10);
  }
  return options;
}
