#!/usr/bin/env node

import { join } from 'node:path';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import {
  validateRequirementsFile,
  extractRequirementIds,
} from '../../../src/core/requirements.js';
import { validateTraceabilityFile } from '../../../src/core/traceability.js';

export function runAnalyzeArtifacts(specDir) {
  const errors = [];
  const specPath = join(specDir, 'spec.md');
  const requirementsPath = join(specDir, 'requirements.json');
  const planPath = join(specDir, 'plan.md');
  const tasksDir = join(specDir, 'tasks');

  if (!existsSync(specPath)) {
    return {
      ok: false,
      error: `Missing spec.md in ${specDir}`,
      errors: [`Missing spec.md in ${specDir}`],
      report: null,
    };
  }

  const specRequirementIds = extractRequirementIds(
    readFileSync(specPath, 'utf8')
  );

  const requirements = validateRequirementsFile(specDir, errors, {
    required: true,
    specRequirementIds,
  });
  const behaviorIdsByRequirement = requirements.behaviorIdsByRequirement || {};
  const allBehaviorIds = new Set();
  for (const ids of Object.values(behaviorIdsByRequirement)) {
    for (const id of ids) allBehaviorIds.add(id);
  }

  const traceabilityErrors = [];
  validateTraceabilityFile(specDir, traceabilityErrors, {
    required: true,
    specRequirementIds,
    behaviorIdsByRequirement,
    requireEvidence: false,
  });

  const findings = [];
  const coverage = {
    requirement_coverage: '0%',
    behavior_coverage: '0%',
    required_category_coverage: '0%',
    traceability_req_coverage: '0%',
    traceability_behavior_coverage: '0%',
  };

  const specReqSet = new Set(specRequirementIds);
  const requirementIds = new Set(requirements.requirementIds || []);
  const missingReqs = [...specReqSet].filter((id) => !requirementIds.has(id));
  const unknownReqs = [...requirementIds].filter((id) => !specReqSet.has(id));

  for (const id of missingReqs) {
    findings.push({
      id: `F-${findings.length + 1}`,
      kind: 'missing',
      severity: 'blocker',
      message: `requirements.json missing spec requirement ${id}`,
      requirement_id: id,
      artifact: 'requirements.json',
      suggested_fix: { action: 'update_requirement', details: `add ${id}` },
    });
  }
  for (const id of unknownReqs) {
    findings.push({
      id: `F-${findings.length + 1}`,
      kind: 'unrequested',
      severity: 'error',
      message: `requirements.json references unknown requirement ${id}`,
      requirement_id: id,
      artifact: 'requirements.json',
      suggested_fix: { action: 'update_requirement', details: `remove ${id}` },
    });
  }

  const taskFiles = existsSync(tasksDir)
    ? readdirSync(tasksDir).filter((f) => /^T\d+\.md$/i.test(f))
    : [];
  const planContent = existsSync(planPath) ? readFileSync(planPath, 'utf8') : '';
  for (const taskFile of taskFiles) {
    if (!planContent.includes(taskFile)) {
      findings.push({
        id: `F-${findings.length + 1}`,
        kind: 'orphan_task',
        severity: 'error',
        message: `${taskFile} exists but not listed in plan.md`,
        artifact: 'plan.md',
        suggested_fix: { action: 'update_plan', details: `add ${taskFile} to plan.md` },
      });
    }
  }
  for (const taskId of extractTaskReferences(planContent)) {
    const fileName = `${taskId}.md`;
    if (!taskFiles.map((f) => f.toLowerCase()).includes(fileName.toLowerCase())) {
      findings.push({
        id: `F-${findings.length + 1}`,
        kind: 'missing',
        severity: 'blocker',
        message: `plan.md references ${taskId} but ${fileName} does not exist`,
        artifact: 'plan.md',
        suggested_fix: { action: 'create_task', details: `create ${fileName}` },
      });
    }
  }

  const mappedBehaviors = new Set();
  for (const taskFile of taskFiles) {
    const content = readFileSync(join(tasksDir, taskFile), 'utf8');
    const frontmatter = parseFrontmatter(content);
    const behaviorIds = parseList(frontmatter.behavior_ids);
    for (const id of behaviorIds) {
      if (!allBehaviorIds.has(id)) {
        findings.push({
          id: `F-${findings.length + 1}`,
          kind: 'unknown_behavior',
          severity: 'blocker',
          message: `${taskFile} references unknown behavior ${id}`,
          behavior_id: id,
          artifact: taskFile,
          suggested_fix: { action: 'update_task', details: `remove ${id}` },
        });
      } else {
        mappedBehaviors.add(id);
      }
    }
    const reqIds = parseList(frontmatter.requirements);
    for (const id of reqIds) {
      if (!specReqSet.has(id)) {
        findings.push({
          id: `F-${findings.length + 1}`,
          kind: 'unknown_requirement',
          severity: 'blocker',
          message: `${taskFile} references unknown requirement ${id}`,
          requirement_id: id,
          artifact: taskFile,
          suggested_fix: { action: 'update_task', details: `remove ${id}` },
        });
      }
    }
  }

  for (const behaviorId of allBehaviorIds) {
    if (!mappedBehaviors.has(behaviorId)) {
      findings.push({
        id: `F-${findings.length + 1}`,
        kind: 'unmapped_behavior',
        severity: 'blocker',
        message: `${behaviorId} is not mapped to any task`,
        behavior_id: behaviorId,
        artifact: 'tasks/',
        suggested_fix: { action: 'update_task', details: `add ${behaviorId} to a task` },
      });
    }
  }

  for (const error of errors) {
    findings.push({
      id: `F-${findings.length + 1}`,
      kind: 'format',
      severity: 'error',
      message: error,
      artifact: 'requirements.json',
      suggested_fix: { action: 'fix_format', details: error },
    });
  }
  for (const error of traceabilityErrors) {
    findings.push({
      id: `F-${findings.length + 1}`,
      kind: 'traceability',
      severity: error.includes('not found') ? 'blocker' : 'error',
      message: error,
      artifact: 'traceability.json',
      suggested_fix: { action: 'fix_traceability', details: error },
    });
  }

  coverage.requirement_coverage = percent(
    specRequirementIds.filter((id) => requirementIds.has(id)).length,
    specRequirementIds.length
  );
  coverage.behavior_coverage = percent(
    mappedBehaviors.size,
    allBehaviorIds.size
  );
  coverage.traceability_req_coverage = percent(
    Math.min(requirementIds.size, specRequirementIds.length),
    specRequirementIds.length
  );
  coverage.traceability_behavior_coverage = percent(
    mappedBehaviors.size,
    allBehaviorIds.size
  );

  const blockingCount = findings.filter((f) => ['blocker', 'error'].includes(f.severity)).length;
  const report = {
    stage: 'analyze-artifacts',
    status: blockingCount === 0 ? 'pass' : 'blocked',
    coverage,
    findings,
    blocker_count: blockingCount,
    created_at: new Date().toISOString(),
  };

  const outPath = join(specDir, 'artifact-analysis.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  return {
    ok: blockingCount === 0,
    errors: findings.map((f) => `${['blocker', 'error'].includes(f.severity) ? 'ERROR' : 'WARN'} ${f.id} [${f.kind}] ${f.message}`),
    report,
  };
}

function percent(part, total) {
  if (total === 0) return '100%';
  return `${Math.round((part / total) * 100)}%`;
}

function extractTaskReferences(content) {
  const ids = new Set();
  const matches = content.matchAll(/\bT(\d+)\b/g);
  for (const match of matches) {
    ids.add(`T${match[1]}`);
  }
  return [...ids];
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

function parseList(value) {
  if (!value) return [];
  const cleaned = String(value).replace(/[[\]]/g, '');
  return cleaned.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

// ── CLI 包装层（仅供 loom 仓库内开发/测试用，部署后路径会断裂） ──
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('analyze-artifacts.mjs');
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const r = runAnalyzeArtifacts(options.specDir);
  if (r.error) console.error(`ERROR ${r.error}`);
  for (const e of r.errors || []) console.error(e);
  console.log(
    r.report
      ? `Analyzed artifacts in ${options.specDir} (${r.report.findings.length} findings, ${r.report.blocker_count} blocker, coverage: ${r.report.coverage.requirement_coverage} REQ, ${r.report.coverage.behavior_coverage} behavior)`
      : `Analyze artifacts failed in ${options.specDir}`
  );
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
