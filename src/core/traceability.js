import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { extractRequirementIds, validateRequirementsFile } from './requirements.js';

export function buildTraceabilityFromSpec(specDir) {
  const specPath = join(specDir, 'spec.md');
  const specRequirementIds = existsSync(specPath)
    ? extractRequirementIds(readFileSync(specPath, 'utf8'))
    : [];
  const tasksByRequirement = taskReferencesByRequirement(specDir);
  const requirements = validateRequirementsFile(specDir, []);
  const behaviorIdsByRequirement = requirements.behaviorIdsByRequirement || {};

  return {
    requirements: Object.fromEntries(specRequirementIds.map(id => [id, {
      tasks: tasksByRequirement.get(id) || [],
      tests: [],
      evidence: [],
      behaviors: Object.fromEntries((behaviorIdsByRequirement[id] || []).map(behaviorId => [behaviorId, {
        tasks: tasksByRequirement.get(id) || [],
        tests: [],
        evidence: []
      }]))
    }]))
  };
}

export function generateTraceabilityFile(specDir, options = {}) {
  const specPath = join(specDir, 'spec.md');
  const traceabilityPath = join(specDir, 'traceability.json');
  if (!existsSync(specPath)) return { ok: false, error: 'Missing required artifact: spec.md' };
  if (existsSync(traceabilityPath) && !options.force) {
    return { ok: false, error: 'traceability.json already exists; pass force to overwrite' };
  }

  const data = buildTraceabilityFromSpec(specDir);
  writeFileSync(traceabilityPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return { ok: true, path: traceabilityPath, count: Object.keys(data.requirements).length };
}

export function validateTraceabilityFile(specDir, errors, options = {}) {
  const specPath = join(specDir, 'spec.md');
  const specRequirementIds = options.specRequirementIds || (existsSync(specPath)
    ? extractRequirementIds(readFileSync(specPath, 'utf8'))
    : []);
  const traceabilityPath = join(specDir, 'traceability.json');

  if (!existsSync(traceabilityPath)) {
    if (options.required) errors.push('Missing required artifact: traceability.json');
    return { exists: false, specRequirementIds, requirementIds: [] };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(traceabilityPath, 'utf8'));
  } catch (err) {
    errors.push(`traceability.json is not valid JSON: ${err.message}`);
    return { exists: true, specRequirementIds, requirementIds: [] };
  }

  const entries = normalizeTraceabilityEntries(data);
  const requirementIds = entries.map(entry => entry.id).filter(Boolean);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const behaviorIdsByRequirement = Object.hasOwn(options, 'behaviorIdsByRequirement')
    ? options.behaviorIdsByRequirement || {}
    : validateRequirementsFile(specDir, errors).behaviorIdsByRequirement || {};
  const requireEvidence = options.requireEvidence !== false;
  const requireTaskFiles = options.requireTaskFiles !== false;
  for (const id of specRequirementIds) {
    const entry = byId.get(id);
    if (!entry) {
      errors.push(`traceability.json missing spec requirement ${id}`);
      continue;
    }
    if (entry.tasks.length === 0) errors.push(`traceability.json ${id} has no task references`);
    if (requireEvidence && entry.tests.length === 0) errors.push(`traceability.json ${id} has no test references`);
    if (requireEvidence && entry.evidence.length === 0) errors.push(`traceability.json ${id} has no evidence references`);
    checkTraceabilityReferences(specDir, id, entry, errors, { requireEvidence, requireTaskFiles });
    checkBehaviorTraceability(specDir, id, behaviorIdsByRequirement[id] || [], entry, errors, { requireEvidence, requireTaskFiles });
  }

  for (const entry of entries) {
    if (!specRequirementIds.includes(entry.id)) {
      errors.push(`traceability.json references unknown requirement ${entry.id}`);
    }
  }

  return { exists: true, specRequirementIds, requirementIds };
}

function taskReferencesByRequirement(specDir) {
  const tasksDir = join(specDir, 'tasks');
  if (!existsSync(tasksDir)) return new Map();

  const result = new Map();
  try {
    for (const name of readdirSync(tasksDir).filter(name => /^T\d+\.md$/i.test(name)).sort()) {
      const taskId = name.replace(/\.md$/i, '').toUpperCase();
      const requirements = parseFrontmatterList(readFileSync(join(tasksDir, name), 'utf8'), 'requirements');
      for (const requirementId of requirements) {
        if (!result.has(requirementId)) result.set(requirementId, []);
        result.get(requirementId).push(taskId);
      }
    }
  } catch {
    return result;
  }
  return result;
}

function parseFrontmatterList(content, key) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return [];
  const body = frontmatter[1];
  const inline = body.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'));
  if (inline) return splitListItems(inline[1]);
  const block = body.match(new RegExp(`^${key}:\\s*\\r?\\n((?:\\s+-\\s*[^\\r\\n]+\\r?\\n?)+)`, 'm'));
  if (!block) return [];
  return block[1].split(/\r?\n/).map(line => line.replace(/^\s+-\s*/, '')).filter(Boolean).map(cleanListItem);
}

function splitListItems(value) {
  return value.split(',').map(cleanListItem).filter(Boolean);
}

function cleanListItem(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function checkTraceabilityReferences(specDir, requirementId, entry, errors, options = {}) {
  const requireTaskFiles = options.requireTaskFiles !== false;
  if (requireTaskFiles) {
    for (const task of entry.tasks) {
      const path = resolveTaskReference(specDir, task);
      if (!path || !existsSync(path)) {
        errors.push(`traceability.json ${requirementId} task reference not found: ${task}`);
      }
    }
  }

  if (options.requireEvidence !== false) {
    for (const test of entry.tests) {
      const path = resolveProjectReference(specDir, stripReferenceTarget(test));
      if (!path || !existsSync(path)) {
        errors.push(`traceability.json ${requirementId} test reference not found: ${test}`);
      }
    }

    for (const evidence of entry.evidence) {
      const path = resolveSpecReference(specDir, stripReferenceTarget(evidence));
      if (!path || !existsSync(path)) {
        errors.push(`traceability.json ${requirementId} evidence reference not found: ${evidence}`);
      }
    }
  }
}

function checkBehaviorTraceability(specDir, requirementId, behaviorIds, entry, errors, options = {}) {
  if (behaviorIds.length === 0) return;
  const behaviorsById = new Map(entry.behaviors.map(behavior => [behavior.id, behavior]));

  for (const behaviorId of behaviorIds) {
    const behavior = behaviorsById.get(behaviorId);
    if (!behavior) {
      errors.push(`traceability.json ${requirementId} missing behavior ${behaviorId}`);
      continue;
    }
    if (behavior.tasks.length === 0) errors.push(`traceability.json ${behaviorId} has no task references`);
    if (options.requireEvidence !== false && behavior.tests.length === 0) errors.push(`traceability.json ${behaviorId} has no test references`);
    if (options.requireEvidence !== false && behavior.evidence.length === 0) errors.push(`traceability.json ${behaviorId} has no evidence references`);
    checkTraceabilityReferences(specDir, behaviorId, behavior, errors, options);
  }

  for (const behavior of entry.behaviors) {
    if (behavior.id && !behaviorIds.includes(behavior.id)) {
      errors.push(`traceability.json ${requirementId} references unknown behavior ${behavior.id}`);
    }
  }
}

function resolveTaskReference(specDir, ref) {
  const clean = stripReferenceTarget(ref);
  if (/^T\d+$/i.test(clean)) return join(specDir, 'tasks', `${clean.toUpperCase()}.md`);
  return resolveSpecReference(specDir, clean);
}

function resolveSpecReference(specDir, ref) {
  if (!ref || /^(?:https?:|urn:|sha256:)/i.test(ref)) return null;
  if (isAbsolute(ref)) return ref;
  return join(specDir, ref);
}

function resolveProjectReference(specDir, ref) {
  if (!ref || /^(?:https?:|urn:|sha256:)/i.test(ref)) return null;
  if (isAbsolute(ref)) return ref;
  const specLocal = join(specDir, ref);
  if (existsSync(specLocal)) return specLocal;
  return join(projectRootForSpecDir(specDir), ref);
}

function projectRootForSpecDir(specDir) {
  const parent = dirname(specDir);
  return /(?:^|[\\/])specs$/i.test(parent) ? dirname(parent) : specDir;
}

function stripReferenceTarget(ref) {
  if (typeof ref !== 'string') return '';
  return ref.trim().split('#')[0].split('::')[0].trim();
}

function normalizeTraceabilityEntries(data) {
  const requirements = data?.requirements;
  if (Array.isArray(requirements)) {
    return requirements
      .filter(entry => entry && entry.id)
      .map(entry => normalizeTraceabilityEntry(entry.id, entry));
  }
  if (requirements && typeof requirements === 'object') {
    return Object.entries(requirements).map(([id, entry]) => normalizeTraceabilityEntry(id, entry || {}));
  }
  return [];
}

function normalizeTraceabilityEntry(id, entry) {
  return {
    id,
    tasks: toArray(entry.tasks || entry.task_ids),
    tests: toArray(entry.tests || entry.test_refs || entry.test_ids),
    evidence: toArray(entry.evidence || entry.evidence_refs || entry.receipts),
    behaviors: normalizeBehaviorTraceabilityEntries(entry.behaviors)
  };
}

function normalizeBehaviorTraceabilityEntries(behaviors) {
  if (Array.isArray(behaviors)) {
    return behaviors
      .filter(entry => entry && entry.id)
      .map(entry => normalizeBehaviorTraceabilityEntry(entry.id, entry));
  }
  if (behaviors && typeof behaviors === 'object') {
    return Object.entries(behaviors).map(([id, entry]) => normalizeBehaviorTraceabilityEntry(id, entry || {}));
  }
  return [];
}

function normalizeBehaviorTraceabilityEntry(id, entry) {
  return {
    id,
    tasks: toArray(entry.tasks || entry.task_ids),
    tests: toArray(entry.tests || entry.test_refs || entry.test_ids),
    evidence: toArray(entry.evidence || entry.evidence_refs || entry.receipts)
  };
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}
