#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { validateRequirementsFile } from '../../../src/core/requirements.js';
import { validateTraceabilityFile } from '../../../src/core/traceability.js';

export function runOmissionHunt(specDir) {
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
  const behaviorCategoriesByRequirement = requirements.behaviorCategoriesByRequirement || {};

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

  const findings = [];
  const checkedBehaviors = [];
  let blockerCount = 0;

  for (const [reqId, behaviorIds] of Object.entries(behaviorIdsByRequirement)) {
    const categories = behaviorCategoriesByRequirement[reqId] || [];
    const reqEntry = entries[reqId] || {};
    const behaviors = reqEntry.behaviors || {};

    for (let i = 0; i < behaviorIds.length; i++) {
      const behaviorId = behaviorIds[i];
      const category = categories[i] || 'happy-path';
      checkedBehaviors.push(behaviorId);

      const behaviorEntry = behaviors[behaviorId] || {};
      const tests = behaviorEntry.tests || [];
      const evidence = behaviorEntry.evidence || [];

      if (tests.length === 0) {
        findings.push({
          id: `F-omit-${findings.length + 1}`,
          kind: 'missing',
          severity: 'blocker',
          message: `${behaviorId} (${category}) has no test reference in traceability.json`,
          requirement_id: reqId,
          behavior_id: behaviorId,
          artifact: 'traceability.json',
          suggested_fix: { action: 'create_task', details: `add test for ${behaviorId}` },
        });
        blockerCount += 1;
      } else {
        for (const ref of tests) {
          if (!fileExists(specDir, ref)) {
            findings.push({
              id: `F-omit-${findings.length + 1}`,
              kind: 'missing',
              severity: 'blocker',
              message: `${behaviorId} test reference not found: ${ref}`,
              requirement_id: reqId,
              behavior_id: behaviorId,
              artifact: ref,
              suggested_fix: { action: 'create_task', details: `create ${ref} or update traceability` },
            });
            blockerCount += 1;
          }
        }
      }

      if (evidence.length === 0) {
        findings.push({
          id: `F-omit-${findings.length + 1}`,
          kind: 'missing',
          severity: 'error',
          message: `${behaviorId} (${category}) has no evidence reference`,
          requirement_id: reqId,
          behavior_id: behaviorId,
          artifact: 'traceability.json',
          suggested_fix: { action: 'create_task', details: `add evidence for ${behaviorId}` },
        });
      } else {
        for (const ref of evidence) {
          if (!fileExists(specDir, ref)) {
            findings.push({
              id: `F-omit-${findings.length + 1}`,
              kind: 'missing',
              severity: 'blocker',
              message: `${behaviorId} evidence reference not found: ${ref}`,
              requirement_id: reqId,
              behavior_id: behaviorId,
              artifact: ref,
              suggested_fix: { action: 'create_task', details: `create ${ref} or update traceability` },
            });
            blockerCount += 1;
          }
        }
      }

      if (category === 'forbidden-behavior') {
        findings.push({
          id: `F-omit-${findings.length + 1}`,
          kind: 'check',
          severity: 'info',
          message: `${behaviorId} is forbidden-behavior; verify guard code exists (permission check / rate limit / input validation)`,
          requirement_id: reqId,
          behavior_id: behaviorId,
          artifact: 'code',
          suggested_fix: { action: 'manual_review', details: `verify guard code for ${behaviorId}` },
        });
      }

      if (category === 'concurrency' || category === 'atomicity') {
        findings.push({
          id: `F-omit-${findings.length + 1}`,
          kind: 'check',
          severity: 'info',
          message: `${behaviorId} is ${category}; verify lock/transaction/CAS guard exists`,
          requirement_id: reqId,
          behavior_id: behaviorId,
          artifact: 'code',
          suggested_fix: { action: 'manual_review', details: `verify ${category} guard for ${behaviorId}` },
        });
      }

      if (category === 'observability') {
        findings.push({
          id: `F-omit-${findings.length + 1}`,
          kind: 'check',
          severity: 'info',
          message: `${behaviorId} is observability; verify metric/log/trace instrumentation exists`,
          requirement_id: reqId,
          behavior_id: behaviorId,
          artifact: 'code',
          suggested_fix: { action: 'manual_review', details: `verify observability instrumentation for ${behaviorId}` },
        });
      }
    }
  }

  const report = {
    stage: 'omission-hunter',
    status: blockerCount === 0 ? 'pass' : 'blocked',
    findings,
    checked_behaviors: checkedBehaviors.length,
    blocker_count: blockerCount,
    created_at: new Date().toISOString(),
  };

  const findingsDir = join(specDir, 'findings');
  if (!existsSync(findingsDir)) mkdirSync(findingsDir, { recursive: true });
  const outPath = join(findingsDir, 'omission-hunter.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  const errorsOut = findings.map((f) => `${f.severity === 'blocker' ? 'ERROR' : f.severity === 'info' ? 'INFO' : 'WARN'} ${f.id} [${f.kind}] ${f.message}`);

  return {
    ok: blockerCount === 0,
    errors: errorsOut,
    report,
  };
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
        result[id] = { behaviors: normalizeBehaviors(entry.behaviors) };
      }
    }
  } else {
    for (const [id, entry] of Object.entries(data.requirements)) {
      result[id] = { behaviors: normalizeBehaviors(entry && entry.behaviors) };
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
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('omission-hunt.mjs');
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const r = runOmissionHunt(options.specDir);
  if (r.error) console.error(`ERROR ${r.error}`);
  for (const e of r.errors || []) console.error(e);
  if (r.report) {
    console.log(`Omission hunt in ${options.specDir}: ${r.report.checked_behaviors} behaviors, ${r.report.findings.length} findings, ${r.report.blocker_count} blocker -> ${r.report.status}`);
  }
  if (!r.ok) process.exit(1);
}

function parseArgs(argv) {
  const options = { specDir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spec-dir') options.specDir = argv[++i];
  }
  return options;
}
