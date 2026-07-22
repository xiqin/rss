#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRequirementIds, validateRequirementsFile } from '../../../src/core/requirements.js';
import { validateTraceabilityFile } from '../../../src/core/traceability.js';

const __filename = fileURLToPath(import.meta.url);

const PLACEHOLDER_RE = /\b(TBD|TODO|implement later|fill in details|Similar to Task N|add appropriate error handling)\b/i;

export function validatePlan(options = {}) {
  const specDir = options.specDir || process.cwd();
  const planPath = options.plan || join(specDir, 'plan.md');
  const tasksDir = options.tasksDir || join(specDir, 'tasks');
  const errors = [];
  const warnings = [];
  const taskFiles = [];
  const taskMetadata = [];
  const specPath = join(specDir, 'spec.md');
  const specRequirementIds = existsSync(specPath)
    ? new Set(extractRequirementIds(readFileSync(specPath, 'utf8')))
    : new Set();
  const mappedRequirementIds = new Set();
  const requirements = validateRequirementsFile(specDir, errors);
  const behaviorIdsByRequirement = requirements.behaviorIdsByRequirement || {};
  const mappedBehaviorIds = new Set();

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
    const metadata = checkTaskFile(name, content, errors, specRequirementIds, mappedRequirementIds, behaviorIdsByRequirement, mappedBehaviorIds);
    taskMetadata.push(metadata);
    if (planTaskRefs.size > 0 && !planTaskRefs.has(name.toUpperCase())) {
      errors.push(`plan.md Task overview does not reference tasks/${name}`);
    }
  }

  checkTaskGraph(taskMetadata, errors);
  checkOwnedFileConflicts(taskMetadata, errors);
  checkBehaviorTaskClosure(behaviorIdsByRequirement, mappedBehaviorIds, errors);
  validateTraceabilityFile(specDir, errors, {
    required: requirements.exists,
    specRequirementIds: [...specRequirementIds],
    behaviorIdsByRequirement,
    requireEvidence: false
  });

  if (specRequirementIds.size > 0) {
    for (const id of specRequirementIds) {
      if (!mappedRequirementIds.has(id)) errors.push(`spec requirement ${id} is not mapped to any task`);
    }
  } else {
    warnings.push('spec.md has no stable Requirement IDs (expected REQ-001 style IDs)');
  }

  return { ok: errors.length === 0, errors, warnings, planPath, tasksDir, taskFiles };
}

function checkTaskFile(name, content, errors, specRequirementIds, mappedRequirementIds, behaviorIdsByRequirement, mappedBehaviorIds) {
  const taskId = basename(name, '.md').toUpperCase();
  const metadata = { id: taskId, name, owns: [], depends_on: [], behavior_ids: [] };
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
    return metadata;
  }
  for (const key of ['owns', 'reads', 'depends_on', 'requirements', 'complexity']) {
    if (!new RegExp(`^${key}\\s*:`, 'm').test(frontmatter)) errors.push(`tasks/${name} missing frontmatter field ${key}`);
  }
  metadata.owns = parseFrontmatterList(frontmatter, 'owns');
  metadata.depends_on = parseFrontmatterList(frontmatter, 'depends_on').map(id => id.toUpperCase());
  metadata.behavior_ids = parseFrontmatterList(frontmatter, 'behavior_ids');
  const requirementList = parseFrontmatterList(frontmatter, 'requirements');
  if (requirementList.length === 0) errors.push(`tasks/${name} requirements must not be empty`);
  for (const id of requirementList) {
    mappedRequirementIds.add(id);
    if (!/^REQ-\d{3,}$/.test(id)) errors.push(`tasks/${name} has invalid requirement id ${id}`);
    else if (specRequirementIds.size > 0 && !specRequirementIds.has(id)) errors.push(`tasks/${name} references unknown spec requirement ${id}`);
  }
  const knownBehaviorIds = new Set(Object.values(behaviorIdsByRequirement).flat());
  if (knownBehaviorIds.size > 0 && !/^behavior_ids\s*:/m.test(frontmatter)) {
    errors.push(`tasks/${name} missing frontmatter field behavior_ids`);
  }
  if (knownBehaviorIds.size > 0 && metadata.behavior_ids.length === 0) {
    errors.push(`tasks/${name} behavior_ids must not be empty`);
  }
  for (const id of metadata.behavior_ids) {
    mappedBehaviorIds.add(id);
    if (!/^REQ-\d{3,}-B\d{2,}$/.test(id)) errors.push(`tasks/${name} has invalid behavior id ${id}`);
    else if (knownBehaviorIds.size > 0 && !knownBehaviorIds.has(id)) errors.push(`tasks/${name} references unknown behavior ${id}`);
  }
  return metadata;
}

function checkBehaviorTaskClosure(behaviorIdsByRequirement, mappedBehaviorIds, errors) {
  for (const behaviorId of Object.values(behaviorIdsByRequirement).flat()) {
    if (!mappedBehaviorIds.has(behaviorId)) errors.push(`requirements behavior ${behaviorId} is not mapped to any task`);
  }
}

function parseFrontmatterList(frontmatter, key) {
  const inline = frontmatter.match(new RegExp(`^${key}\\s*:\\s*\\[([^\\]]*)\\]`, 'm'))?.[1];
  if (inline !== undefined) return splitListItems(inline);

  const block = frontmatter.match(new RegExp(`^${key}\\s*:\\s*\\n((?:\\s+-\\s*[^\\n]+\\n?)+)`, 'm'))?.[1];
  if (!block) return [];
  return block
    .split('\n')
    .map(line => line.match(/^\s+-\s*(.+?)\s*$/)?.[1])
    .filter(Boolean)
    .map(cleanListItem)
    .filter(Boolean);
}

function splitListItems(value) {
  return value.split(',').map(cleanListItem).filter(Boolean);
}

function cleanListItem(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function checkTaskGraph(taskMetadata, errors) {
  const tasksById = new Map(taskMetadata.map(task => [task.id, task]));
  for (const task of taskMetadata) {
    for (const dependency of task.depends_on) {
      if (!/^T\d+$/.test(dependency)) {
        errors.push(`tasks/${task.name} has invalid depends_on id ${dependency}`);
      } else if (!tasksById.has(dependency)) {
        errors.push(`tasks/${task.name} depends_on unknown task ${dependency}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const reportedCycles = new Set();

  function visit(task, path) {
    if (visited.has(task.id)) return;
    const cycleStart = path.indexOf(task.id);
    if (cycleStart !== -1) {
      const cycle = [...path.slice(cycleStart), task.id];
      const key = cycle.join(' -> ');
      if (!reportedCycles.has(key)) {
        errors.push(`task dependency graph contains a cycle: ${key}`);
        reportedCycles.add(key);
      }
      return;
    }
    if (visiting.has(task.id)) return;

    visiting.add(task.id);
    for (const dependency of task.depends_on) {
      const dependencyTask = tasksById.get(dependency);
      if (dependencyTask) visit(dependencyTask, [...path, task.id]);
    }
    visiting.delete(task.id);
    visited.add(task.id);
  }

  for (const task of taskMetadata) visit(task, []);
}

function checkOwnedFileConflicts(taskMetadata, errors) {
  const ownersByFile = new Map();
  for (const task of taskMetadata) {
    for (const ownedFile of task.owns) {
      if (!ownedFile) continue;
      if (!ownersByFile.has(ownedFile)) ownersByFile.set(ownedFile, []);
      ownersByFile.get(ownedFile).push(task.id);
    }
  }

  for (const [ownedFile, owners] of ownersByFile) {
    if (owners.length > 1) {
      errors.push(`owned file ${ownedFile} is declared by multiple tasks: ${owners.join(', ')}`);
    }
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
