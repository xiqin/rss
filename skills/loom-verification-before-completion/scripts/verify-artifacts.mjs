#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReportEvidence } from '../../../src/core/artifact-checker.js';
import { extractRequirementIds, validateRequirementsFile } from '../../../src/core/requirements.js';
import { validateTraceabilityFile } from '../../../src/core/traceability.js';

const __filename = fileURLToPath(import.meta.url);
const PLACEHOLDER_RE = /\b(TBD|TODO|implement later|fill in details)\b/i;

export function verifyArtifacts(options = {}) {
  const specDir = options.specDir || process.cwd();
  const errors = [];
  const warnings = [];
  const coreFiles = ['test-report.md'];
  const fullFlowFiles = ['spec.md', 'plan.md', 'progress.md'];
  const specPath = join(specDir, 'spec.md');
  const specRequirementIds = existsSync(specPath)
    ? extractRequirementIds(readFileSync(specPath, 'utf8'))
    : [];

  for (const name of coreFiles) {
    const path = join(specDir, name);
    if (!existsSync(path)) {
      errors.push(`Missing required artifact: ${name}`);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    const match = content.match(PLACEHOLDER_RE);
    if (match) errors.push(`${name} contains placeholder phrase: ${match[0]}`);
  }

  for (const name of fullFlowFiles) {
    const path = join(specDir, name);
    if (!existsSync(path)) {
      warnings.push(`Missing full-flow artifact: ${name} (allowed for lightweight pipelines like bugfix)`);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    const match = content.match(PLACEHOLDER_RE);
    if (match) errors.push(`${name} contains placeholder phrase: ${match[0]}`);
  }

  checkReport('test-report.md', { requiredConclusion: true, specDir, specRequirementIds, errors, warnings });
  checkReport('verify-report.md', { requiredConclusion: false, specDir, specRequirementIds, errors, warnings });
  const requirements = validateRequirementsFile(specDir, errors);
  validateTraceabilityFile(specDir, errors, {
    required: requirements.exists,
    specRequirementIds,
    behaviorIdsByRequirement: requirements.behaviorIdsByRequirement
  });

  const progressPath = join(specDir, 'progress.md');
  if (existsSync(progressPath)) {
    const progress = readFileSync(progressPath, 'utf8');
    if (/HH:mm/i.test(progress)) {
      errors.push('progress.md still contains literal HH:mm placeholder');
    }
  }

  return { ok: errors.length === 0, errors, warnings, specDir };
}

function checkReport(name, { requiredConclusion, specDir, specRequirementIds, errors, warnings }) {
  const reportPath = join(specDir, name);
  if (!existsSync(reportPath)) return;
  const report = readFileSync(reportPath, 'utf8');
  if (/FAIL|失败|不通过/i.test(report) && !/WARN|预先存在|known/i.test(report)) {
    errors.push(`${name} contains failing result without known-warning context`);
  }
  if (requiredConclusion && !/PASS|通过|WARN/i.test(report)) {
    warnings.push(`${name} should include an explicit PASS/WARN conclusion`);
  }
  if (/^\s*(?:verdict|结论)\s*[:：]\s*(?:PASS|通过)/mi.test(report)) {
    const receipt = validateReportEvidence(specDir, report);
    for (const error of receipt.errors) errors.push(`${name} evidence: ${error}`);
    for (const id of specRequirementIds) {
      if (!new RegExp(`\\b${id}\\b`).test(report)) {
        errors.push(`${name} PASS does not mention spec requirement ${id}`);
      }
    }
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec-dir') options.specDir = argv[++i];
  }
  return options;
}

function printReport(result) {
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  for (const error of result.errors) console.error(`ERROR ${error}`);
  console.log(`Checked artifacts in ${relative(process.cwd(), result.specDir) || '.'}`);
}

if (process.argv[1] === __filename) {
  const result = verifyArtifacts(parseArgs(process.argv.slice(2)));
  printReport(result);
  if (!result.ok) process.exitCode = 1;
}
