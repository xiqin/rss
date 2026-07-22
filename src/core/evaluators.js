import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateRequirementsFile } from './requirements.js';
import { validateTraceabilityFile } from './traceability.js';

export function runRequirementsEvaluator(specDir) {
  const errors = [];
  const warnings = [];
  const requirements = validateRequirementsFile(specDir, errors);
  const traceability = validateTraceabilityFile(specDir, errors, {
    required: requirements.exists,
    specRequirementIds: requirements.specRequirementIds,
    behaviorIdsByRequirement: requirements.behaviorIdsByRequirement
  });

  const specReqCount = requirements.specRequirementIds.length;
  const mappedReqCount = requirements.requirementIds.length;
  const behaviorCount = Object.values(requirements.behaviorIdsByRequirement || {}).reduce((sum, arr) => sum + arr.length, 0);

  if (specReqCount > 0 && mappedReqCount < specReqCount) {
    errors.push(`requirements coverage gap: ${specReqCount - mappedReqCount} REQ(s) in spec.md not in requirements.json`);
  }
  if (requirements.exists && behaviorCount === 0) {
    warnings.push('requirements.json has no behaviors; detail-expansion may be missing');
  }
  if (!traceability.exists && requirements.exists) {
    errors.push('requirements evaluator: traceability.json missing while requirements.json exists');
  }

  return {
    evaluator: 'requirements',
    verdict: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    coverage: {
      spec_requirement_count: specReqCount,
      mapped_requirement_count: mappedReqCount,
      behavior_count: behaviorCount,
      traceability_exists: traceability.exists
    }
  };
}

export function runArchitectureEvaluator(specDir, options = {}) {
  const errors = [];
  const warnings = [];
  const diff = options.diff || '';
  const constitution = options.constitution || '';
  const allowedLayers = constitution.match(/^allow[^:]*:\s*(.+)$/mi)?.[1]?.split(',').map(s => s.trim()) || [];

  if (diff) {
    const changedFiles = diff.split('\n').filter(l => l.startsWith('diff --git') || l.startsWith('+++') || l.startsWith('---'))
      .map(l => l.replace(/^(diff --git a\/|(\+\+\+|---) b\/)/, '').split(' ')[0]);
    const unique = [...new Set(changedFiles)];
    if (unique.length > 15) {
      warnings.push(`architecture evaluator: diff touches ${unique.length} files; consider splitting tasks`);
    }
    if (allowedLayers.length > 0) {
      for (const f of unique) {
        if (!allowedLayers.some(layer => f.startsWith(layer))) {
          errors.push(`architecture evaluator: ${f} not in allowed layers ${allowedLayers.join(', ')}`);
        }
      }
    }
  }

  const tasksDir = join(specDir, 'tasks');
  if (!existsSync(tasksDir)) {
    warnings.push('architecture evaluator: no tasks/ directory');
  }

  return {
    evaluator: 'architecture',
    verdict: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    coverage: {
      diff_files: diff ? diff.split('\n').filter(l => l.startsWith('diff --git')).length : 0,
      allowed_layers: allowedLayers
    }
  };
}

export function runSecurityTestEvaluator(specDir) {
  const errors = [];
  const warnings = [];
  const requirements = validateRequirementsFile(specDir, []);

  const securityBehaviors = [];
  const authBehaviors = [];
  const observabilityBehaviors = [];
  const behaviorCategoriesByRequirement = requirements.behaviorCategoriesByRequirement || {};
  for (const [reqId, behaviorMap] of Object.entries(behaviorCategoriesByRequirement)) {
    for (const [bId, category] of Object.entries(behaviorMap)) {
      if (category === 'security') securityBehaviors.push(bId);
      if (category === 'authorization') authBehaviors.push(bId);
      if (category === 'observability') observabilityBehaviors.push(bId);
    }
  }

  const traceabilityErrors = [];
  const traceability = validateTraceabilityFile(specDir, traceabilityErrors, {
    required: requirements.exists,
    specRequirementIds: requirements.specRequirementIds,
    behaviorIdsByRequirement: requirements.behaviorIdsByRequirement
  });
  if (requirements.exists && !traceability.exists) {
    errors.push('security evaluator: traceability missing; cannot verify security behaviors have tests');
  }
  for (const err of traceabilityErrors) errors.push(`security evaluator: ${err}`);

  if (securityBehaviors.length > 0) {
    warnings.push(`security evaluator: ${securityBehaviors.length} security-tagged behavior(s) require explicit test review`);
  }

  const testReportPath = join(specDir, 'test-report.md');
  if (existsSync(testReportPath)) {
    const report = readFileSync(testReportPath, 'utf8');
    if (/verdict:\s*pass/i.test(report) && requirements.exists) {
      for (const reqId of requirements.specRequirementIds) {
        if (!report.includes(reqId)) {
          errors.push(`security evaluator: test-report PASS does not mention ${reqId}`);
        }
      }
    }
  }

  return {
    evaluator: 'security-test',
    verdict: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    coverage: {
      security_behavior_count: securityBehaviors.length,
      traceability_exists: traceability.exists
    }
  };
}

export function runParallelEvaluators(specDir, options = {}) {
  const r1 = runRequirementsEvaluator(specDir);
  const r2 = runArchitectureEvaluator(specDir, { diff: options.diff, constitution: options.constitution });
  const r3 = runSecurityTestEvaluator(specDir);

  const results = [r1, r2, r3];
  const blockerCount = results.filter(r => r.verdict === 'fail').length;
  const allErrors = results.flatMap(r => r.errors.map(e => ({ evaluator: r.evaluator, error: e })));

  const receipt = {
    kind: 'evaluation',
    stage: options.stage || 'verification',
    created_at: new Date().toISOString(),
    evaluators: results,
    verdict: blockerCount === 0 ? 'pass' : 'fail',
    blocker_count: blockerCount,
    errors: allErrors
  };

  if (options.writeReceipt !== false) {
    const dir = join(specDir, 'receipts', 'evaluations');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = process.hrtime ? process.hrtime().join('-') : Math.random().toString(36).slice(2, 8);
    const path = join(dir, `evaluation-${stamp}-${suffix}.json`);
    writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
    return { ok: receipt.verdict === 'pass', verdict: receipt.verdict, receipt, path };
  }

  return { ok: receipt.verdict === 'pass', verdict: receipt.verdict, receipt };
}
