#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const PLACEHOLDER_RE = /\b(TBD|TODO|implement later|fill in details|Similar to Task N|add appropriate error handling)\b/i;

export function validatePlan(options = {}) {
  const specDir = options.specDir || process.cwd();
  const planPath = options.plan || join(specDir, 'plan.md');
  const tasksDir = options.tasksDir || join(specDir, 'tasks');
  const errors = [];
  const warnings = [];
  const taskFiles = [];
  const specPath = join(specDir, 'spec.md');
  const specRequirementIds = existsSync(specPath)
    ? new Set([...readFileSync(specPath, 'utf8').matchAll(/\bREQ-\d{3,}\b/g)].map(match => match[0]))
    : new Set();
  const mappedRequirementIds = new Set();

  if (!existsSync(planPath)) {
    errors.push(`Missing plan file: ${formatPath(specDir, planPath)}`);
    return { ok: false, errors, warnings, planPath, tasksDir, taskFiles };
  }

  const plan = readFileSync(planPath, 'utf8');
  checkNoPlaceholders('plan.md', plan, errors);
  if (!/##\s*Task/i.test(plan)) {
    errors.push('plan.md must include a Task overview section');
  }
  if (!/依赖关系|Dependencies/i.test(plan)) {
    warnings.push('plan.md should describe task dependencies');
  }

  if (!existsSync(tasksDir)) {
    errors.push(`Missing tasks directory: ${formatPath(specDir, tasksDir)}`);
    return { ok: false, errors, warnings, planPath, tasksDir, taskFiles };
  }

  for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^T\d+\.md$/i.test(entry.name)) continue;
    taskFiles.push(join(tasksDir, entry.name));
  }
  taskFiles.sort((a, b) => taskNumber(a) - taskNumber(b));

  if (taskFiles.length === 0) {
    errors.push('tasks/ must contain at least one Tn.md file');
  }

  for (let i = 0; i < taskFiles.length; i++) {
    const expected = `T${i + 1}.md`;
    if (basename(taskFiles[i]) !== expected) {
      errors.push(`Task files must be contiguous from T1.md; expected ${expected}, found ${basename(taskFiles[i])}`);
    }
  }

  const planTaskRefs = new Set([...plan.matchAll(/tasks\/(T\d+\.md)/gi)].map(match => match[1].toUpperCase()));
  for (const taskFile of taskFiles) {
    const name = basename(taskFile);
    const content = readFileSync(taskFile, 'utf8');
    checkNoPlaceholders(`tasks/${name}`, content, errors);
    checkTaskFile(name, content, errors, specRequirementIds, mappedRequirementIds);
    if (planTaskRefs.size > 0 && !planTaskRefs.has(name.toUpperCase())) {
      errors.push(`plan.md Task overview does not reference tasks/${name}`);
    }
  }

  if (specRequirementIds.size > 0) {
    for (const id of specRequirementIds) {
      if (!mappedRequirementIds.has(id)) errors.push(`spec requirement ${id} is not mapped to any task`);
    }
  } else {
    warnings.push('spec.md has no stable Requirement IDs (expected REQ-001 style IDs)');
  }

  return { ok: errors.length === 0, errors, warnings, planPath, tasksDir, taskFiles };
}

function checkTaskFile(name, content, errors, specRequirementIds, mappedRequirementIds) {
  const required = [
    [/Task\s+\d+|###\s*Task/i, 'task heading'],
    [/复杂度|Complexity/i, 'complexity'],
    [/依赖|Dependencies/i, 'dependencies'],
    [/涉及文件|Files/i, 'affected files'],
    [/- \[ \]/, 'checklist steps'],
    [/测试|test/i, 'test instructions'],
    [/验收映射|Acceptance Mapping/i, 'acceptance mapping'],
  ];

  for (const [pattern, label] of required) {
    if (!pattern.test(content)) {
      errors.push(`tasks/${name} missing ${label}`);
    }
  }


  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/m)?.[1];
  if (!frontmatter) {
    errors.push(`tasks/${name} missing YAML frontmatter`);
    return;
  }
  for (const key of ['owns', 'reads', 'depends_on', 'requirements', 'complexity']) {
    if (!new RegExp(`^${key}\\s*:`, 'm').test(frontmatter)) errors.push(`tasks/${name} missing frontmatter field ${key}`);
  }
  const requirementList = frontmatter.match(/^requirements\s*:\s*\[([^\]]*)\]/m)?.[1]
    ?.split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) || [];
  if (requirementList.length === 0) errors.push(`tasks/${name} requirements must not be empty`);
  for (const id of requirementList) {
    mappedRequirementIds.add(id);
    if (!/^REQ-\d{3,}$/.test(id)) errors.push(`tasks/${name} has invalid requirement id ${id}`);
    else if (specRequirementIds.size > 0 && !specRequirementIds.has(id)) errors.push(`tasks/${name} references unknown spec requirement ${id}`);
  }
}

function checkNoPlaceholders(label, content, errors) {
  const match = content.match(PLACEHOLDER_RE);
  if (match) {
    errors.push(`${label} contains placeholder phrase: ${match[0]}`);
  }
}

function taskNumber(path) {
  return Number(basename(path).match(/T(\d+)\.md/i)?.[1] || 0);
}

function formatPath(base, path) {
  return relative(base, path) || '.';
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spec-dir') options.specDir = argv[++i];
    else if (arg === '--plan') options.plan = argv[++i];
    else if (arg === '--tasks-dir') options.tasksDir = argv[++i];
  }
  return options;
}

function printReport(result) {
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  for (const error of result.errors) console.error(`ERROR ${error}`);
  console.log(`Checked ${result.taskFiles.length} task file(s)`);
}

if (process.argv[1] === __filename) {
  const result = validatePlan(parseArgs(process.argv.slice(2)));
  printReport(result);
  if (!result.ok) process.exitCode = 1;
}
