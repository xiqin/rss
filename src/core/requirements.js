import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BEHAVIOR_CATEGORIES = [
  'happy-path',
  'boundary',
  'invalid-input',
  'authorization',
  'state-transition',
  'idempotency',
  'concurrency',
  'atomicity',
  'external-failure',
  'compatibility',
  'security',
  'performance',
  'observability',
  'recovery',
  'forbidden-behavior'
];

const TYPE_REQUIRED_CATEGORIES = {
  functional: ['happy-path'],
  input: ['invalid-input'],
  authorization: ['authorization'],
  auth: ['authorization'],
  write: ['atomicity'],
  mutation: ['atomicity'],
  state: ['state-transition'],
  idempotent: ['idempotency'],
  concurrent: ['concurrency'],
  external: ['external-failure'],
  security: ['security'],
  performance: ['performance'],
  observable: ['observability'],
  recovery: ['recovery']
};

export function extractRequirementIds(content) {
  return [...new Set([...content.matchAll(/\bREQ-\d{3,}\b/g)].map(match => match[0]))];
}

export function buildRequirementsFromSpec(content) {
  return {
    requirements: extractRequirementIds(content).map(id => ({
      id,
      status: 'failing',
      types: ['functional'],
      required_categories: ['happy-path'],
      acceptance: [`Acceptance criteria for ${id}`],
      behaviors: [
        {
          id: `${id}-B01`,
          category: 'happy-path',
          description: `Verifiable behavior for ${id}`,
          status: 'failing',
          acceptance: [`Evidence proves ${id}-B01 is implemented`],
          test_plan: {
            strategy: 'unit + boundary',
            inputs: ['representative input'],
            expected: ['documented outcome'],
            coverage_target: 'behavior acceptance'
          }
        }
      ]
    }))
  };
}

export function generateRequirementsFile(specDir, options = {}) {
  const specPath = join(specDir, 'spec.md');
  const requirementsPath = join(specDir, 'requirements.json');
  if (!existsSync(specPath)) return { ok: false, error: 'Missing required artifact: spec.md' };
  if (existsSync(requirementsPath) && !options.force) {
    return { ok: false, error: 'requirements.json already exists; pass force to overwrite' };
  }

  const data = buildRequirementsFromSpec(readFileSync(specPath, 'utf8'));
  writeFileSync(requirementsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return { ok: true, path: requirementsPath, count: data.requirements.length };
}

export function validateRequirementsFile(specDir, errors, options = {}) {
  const specPath = join(specDir, 'spec.md');
  const requirementsPath = join(specDir, 'requirements.json');
  const specRequirementIds = existsSync(specPath)
    ? extractRequirementIds(readFileSync(specPath, 'utf8'))
    : [];

  if (!existsSync(requirementsPath)) {
    if (options.required) errors.push('Missing required artifact: requirements.json');
    return { exists: false, specRequirementIds, requirementIds: [], behaviorIdsByRequirement: {}, behaviorCategoriesByRequirement: {} };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(requirementsPath, 'utf8'));
  } catch (err) {
    errors.push(`requirements.json is not valid JSON: ${err.message}`);
    return { exists: true, specRequirementIds, requirementIds: [], behaviorIdsByRequirement: {}, behaviorCategoriesByRequirement: {} };
  }

  const entries = normalizeRequirementEntries(data, errors);
  const requirementIds = entries.map(entry => entry.id).filter(Boolean);
  const behaviorIdsByRequirement = Object.fromEntries(
    entries
      .filter(entry => entry.id && entry.behaviors.length > 0)
      .map(entry => [entry.id, entry.behaviors.map(behavior => behavior.id).filter(Boolean)])
  );
  const behaviorCategoriesByRequirement = Object.fromEntries(
    entries
      .filter(entry => entry.id && entry.behaviors.length > 0)
      .map(entry => [entry.id, Object.fromEntries(
        entry.behaviors
          .filter(behavior => behavior.id)
          .map(behavior => [behavior.id, behavior.category || null])
      )])
  );
  const byId = new Map(entries.filter(entry => entry.id).map(entry => [entry.id, entry]));

  for (const id of specRequirementIds) {
    if (!byId.has(id)) errors.push(`requirements.json missing spec requirement ${id}`);
  }

  for (const entry of entries) {
    if (!entry.id) continue;
    if (!/^REQ-\d{3,}$/.test(entry.id)) {
      errors.push(`requirements.json has invalid requirement id ${entry.id}`);
    } else if (specRequirementIds.length > 0 && !specRequirementIds.includes(entry.id)) {
      errors.push(`requirements.json references unknown requirement ${entry.id}`);
    }
    if (!entry.status) errors.push(`requirements.json ${entry.id} missing status`);
    if (!entry.hasAcceptance && entry.behaviors.length === 0) {
      errors.push(`requirements.json ${entry.id} missing acceptance`);
    }
    validateRequiredCategories(entry, errors);
    validateRequirementBehaviors(entry, errors, { requireTestPlan: options.requireTestPlan === true });
  }

  return { exists: true, specRequirementIds, requirementIds, behaviorIdsByRequirement, behaviorCategoriesByRequirement };
}

function normalizeRequirementEntries(data, errors) {
  const requirements = data?.requirements;
  if (Array.isArray(requirements)) {
    return requirements.map((entry, index) => normalizeRequirementEntry(entry?.id, entry, index, errors));
  }
  if (requirements && typeof requirements === 'object') {
    return Object.entries(requirements).map(([id, entry], index) => normalizeRequirementEntry(id, entry, index, errors));
  }
  errors.push('requirements.json must contain a requirements array or object');
  return [];
}

function normalizeRequirementEntry(id, entry, index, errors) {
  if (!entry || typeof entry !== 'object') {
    errors.push(`requirements.json requirements[${index}] must be an object`);
    return { id };
  }
  const effectiveId = id || entry.id;
  if (!effectiveId) errors.push(`requirements.json requirements[${index}] missing id`);
  return {
    id: effectiveId,
    status: typeof entry.status === 'string' ? entry.status.trim() : '',
    types: parseStringList(entry.types),
    requiredCategories: parseStringList(entry.required_categories || entry.requiredCategories),
    hasAcceptance: hasNonEmptyValue(entry.acceptance || entry.acceptance_criteria || entry.scenarios),
    behaviors: normalizeBehaviors(effectiveId, entry.behaviors, errors)
  };
}

function validateRequiredCategories(entry, errors) {
  const required = requiredCategoriesFor(entry, errors);
  if (required.length === 0) return;

  const behaviorCategories = new Set(entry.behaviors.map(behavior => behavior.category).filter(Boolean));
  for (const category of required) {
    if (!behaviorCategories.has(category)) {
      errors.push(`requirements.json ${entry.id} missing behavior category ${category}`);
    }
  }
}

function requiredCategoriesFor(entry, errors) {
  const categories = [];
  for (const category of entry.requiredCategories) {
    if (!BEHAVIOR_CATEGORIES.includes(category)) {
      errors.push(`requirements.json ${entry.id} has unknown required category ${category}`);
      continue;
    }
    categories.push(category);
  }
  for (const type of entry.types) {
    const mapped = TYPE_REQUIRED_CATEGORIES[type];
    if (!mapped) continue;
    categories.push(...mapped);
  }
  return [...new Set(categories)];
}

function normalizeBehaviors(requirementId, behaviors, errors) {
  if (behaviors === undefined) return [];
  if (!Array.isArray(behaviors)) {
    errors.push(`requirements.json ${requirementId} behaviors must be an array`);
    return [];
  }
  return behaviors.map((behavior, index) => {
    if (!behavior || typeof behavior !== 'object') {
      errors.push(`requirements.json ${requirementId} behaviors[${index}] must be an object`);
      return { id: '', description: '', status: '', hasAcceptance: false };
    }
    return {
      id: typeof behavior.id === 'string' ? behavior.id.trim() : '',
      category: typeof behavior.category === 'string' ? behavior.category.trim() : '',
      description: typeof behavior.description === 'string' ? behavior.description.trim() : '',
      status: typeof behavior.status === 'string' ? behavior.status.trim() : '',
      hasAcceptance: hasNonEmptyValue(behavior.acceptance || behavior.acceptance_criteria || behavior.scenarios),
      test_plan: normalizeTestPlan(behavior.test_plan)
    };
  });
}

function normalizeTestPlan(testPlan) {
  if (!testPlan || typeof testPlan !== 'object') return null;
  return {
    strategy: typeof testPlan.strategy === 'string' ? testPlan.strategy : '',
    inputs: Array.isArray(testPlan.inputs) ? testPlan.inputs.map(String) : [],
    expected: Array.isArray(testPlan.expected) ? testPlan.expected.map(String) : [],
    coverage_target: typeof testPlan.coverage_target === 'string' ? testPlan.coverage_target : ''
  };
}

function validateRequirementBehaviors(entry, errors, options = {}) {
  for (const [index, behavior] of entry.behaviors.entries()) {
    const label = behavior.id || `${entry.id} behaviors[${index}]`;
    if (!behavior.id) {
      errors.push(`requirements.json ${entry.id} behaviors[${index}] missing id`);
    } else if (!new RegExp(`^${entry.id}-B\\d{2,}$`).test(behavior.id)) {
      errors.push(`requirements.json ${entry.id} behavior ${behavior.id} has invalid behavior id`);
    }
    if (!behavior.category) {
      errors.push(`requirements.json ${label} missing category`);
    } else if (!BEHAVIOR_CATEGORIES.includes(behavior.category)) {
      errors.push(`requirements.json ${label} has unknown category ${behavior.category}`);
    }
    if (!behavior.description) errors.push(`requirements.json ${label} missing description`);
    if (!behavior.status) errors.push(`requirements.json ${label} missing status`);
    if (!behavior.hasAcceptance) errors.push(`requirements.json ${label} missing acceptance`);
    if (options.requireTestPlan) {
      const tp = behavior.test_plan;
      if (!tp || !tp.strategy || !Array.isArray(tp.inputs) || tp.inputs.length === 0 || !Array.isArray(tp.expected) || tp.expected.length === 0) {
        errors.push(`requirements.json ${label} missing structured test_plan (strategy/inputs/expected required)`);
      }
    }
  }
}

function hasNonEmptyValue(value) {
  if (Array.isArray(value)) return value.some(item => String(item || '').trim());
  if (typeof value === 'string') return value.trim().length > 0;
  return false;
}

function parseStringList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

const ALLOWED_TRANSITIONS = {
  failing: ['in_progress', 'candidate_implemented', 'blocked'],
  in_progress: ['candidate_implemented', 'blocked', 'failing'],
  candidate_implemented: ['passing', 'blocked', 'failing'],
  passing: [],
  blocked: ['failing', 'in_progress'],
  superseded: []
};

export function updateBehaviorStatus(specDir, behaviorId, newStatus, options = {}) {
  if (!behaviorId || !/^(REQ-\d{3,})-B\d{2,}$/.test(behaviorId)) {
    return { ok: false, error: `Invalid behavior id: ${behaviorId}` };
  }
  if (!ALLOWED_TRANSITIONS[newStatus]) {
    return { ok: false, error: `Invalid status: ${newStatus}` };
  }

  const requirementsPath = join(specDir, 'requirements.json');
  if (!existsSync(requirementsPath)) {
    return { ok: false, error: 'Missing requirements.json' };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(requirementsPath, 'utf8'));
  } catch (err) {
    return { ok: false, error: `requirements.json is not valid JSON: ${err.message}` };
  }

  const reqId = behaviorId.match(/^(REQ-\d{3,})-/)[1];
  const entries = Array.isArray(data.requirements) ? data.requirements : Object.entries(data.requirements || {}).map(([id, e]) => ({ id, ...e }));
  const reqEntry = entries.find(e => e.id === reqId);
  if (!reqEntry || !Array.isArray(reqEntry.behaviors)) {
    return { ok: false, error: `Behavior ${behaviorId} not found in requirements.json` };
  }
  const behavior = reqEntry.behaviors.find(b => b.id === behaviorId);
  if (!behavior) {
    return { ok: false, error: `Behavior ${behaviorId} not found in requirements.json` };
  }

  if (behavior.status === 'passing') {
    return { ok: false, error: `Behavior ${behaviorId} is already passing; implementers may not regress it. Status changes require a new task and explicit reviewer approval.` };
  }
  if (behavior.status === 'superseded') {
    return { ok: false, error: `Behavior ${behaviorId} is superseded; cannot update.` };
  }

  const allowed = ALLOWED_TRANSITIONS[behavior.status] || [];
  if (!allowed.includes(newStatus)) {
    return { ok: false, error: `Illegal transition for ${behaviorId}: ${behavior.status} -> ${newStatus}. Allowed: ${allowed.join(', ') || 'none (terminal)'}` };
  }

  if (newStatus === 'passing') {
    if (!options.verifier || options.verifier === 'implementer') {
      return { ok: false, error: `Behavior ${behaviorId} passing requires an external verifier (not the implementer)` };
    }
    if (!options.evidenceReceipt || typeof options.evidenceReceipt !== 'string') {
      return { ok: false, error: `Cannot mark ${behaviorId} as passing without evidenceReceipt` };
    }
    behavior.evidence_receipt = options.evidenceReceipt;
    behavior.verified_at = new Date().toISOString();
    behavior.verified_by = options.verifier;
  }

  behavior.status = newStatus;
  if (Array.isArray(data.requirements)) {
    data.requirements = entries;
  } else {
    data.requirements = Object.fromEntries(entries.map(({ id, ...rest }) => [id, rest]));
  }
  writeFileSync(requirementsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return { ok: true, behavior_id: behaviorId, status: newStatus };
}
