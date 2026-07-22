import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validatePlan } from '../../skills/loom-writing-plans/scripts/validate-plan.mjs';
import { verifyArtifacts } from '../../skills/loom-verification-before-completion/scripts/verify-artifacts.mjs';
import { validateIndex } from '../../skills/loom-index-update/scripts/validate-index.mjs';
import { generateRequirementsFile, validateRequirementsFile, updateBehaviorStatus } from '../../src/core/requirements.js';
import { generateTraceabilityFile, validateTraceabilityFile } from '../../src/core/traceability.js';
import { generateImplementationPacket, validateImplementationPacket } from '../../src/core/implementation-packets.js';
import { buildReceipt, writeReceipt, validateReceiptFile, validateReceiptsDir } from '../../src/core/receipts.js';
import { runParallelEvaluators, runRequirementsEvaluator } from '../../src/core/evaluators.js';

const TMP_ROOT = join(import.meta.dirname, '__test_workflow_scripts__');

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('workflow helper scripts', () => {
  it('validates a complete plan with contiguous task files', () => {
    const specDir = join(TMP_ROOT, 'specs', 'feature');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| Requirement ID | Acceptance |\n|---|---|\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'plan.md'), `# Feature Plan

## Task Overview

| Task | File |
| ---- | ---- |
| T1 | \`tasks/T1.md\` |
| T2 | \`tasks/T2.md\` |

## Dependencies

T1 -> T2
`);
    writeTask(specDir, 1, 'None');
    writeTask(specDir, 2, 'T1');

    const result = validatePlan({ specDir });
    expect(result.errors).toEqual([]);
    expect(result.taskFiles).toHaveLength(2);
  });

  it('reports missing task fields and placeholders', () => {
    const specDir = join(TMP_ROOT, 'specs', 'bad-feature');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'plan.md'), '## Task Overview\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'tasks', 'T1.md'), '### Task 1\nTODO\n');

    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes('placeholder'))).toBe(true);
    expect(result.errors.some(error => error.includes('complexity'))).toBe(true);
  });

  it('rejects invalid task dependencies and overlapping owned files', () => {
    const specDir = join(TMP_ROOT, 'specs', 'invalid-task-graph');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| Requirement ID | Acceptance |\n|---|---|\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'plan.md'), `# Feature Plan

## Task Overview

| Task | File |
| ---- | ---- |
| T1 | \`tasks/T1.md\` |
| T2 | \`tasks/T2.md\` |

## Dependencies

T1 -> T2
`);
    writeTask(specDir, 1, 'None', { owns: ['src/shared.js'], depends_on: ['T2'] });
    writeTask(specDir, 2, 'T1', { owns: ['src/shared.js'], depends_on: ['T1', 'T9'] });

    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('tasks/T2.md depends_on unknown task T9');
    expect(result.errors).toContain('task dependency graph contains a cycle: T1 -> T2 -> T1');
    expect(result.errors).toContain('owned file src/shared.js is declared by multiple tasks: T1, T2');
  });

  it('rejects requirements.json drift during plan validation', () => {
    const specDir = join(TMP_ROOT, 'specs', 'requirements-drift-plan');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\nREQ-002: handles errors\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: {
        'REQ-001': { status: 'failing', acceptance: ['works'] },
        'REQ-999': { status: 'failing' }
      }
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), `# Feature Plan

## Task Overview

| Task | File |
| ---- | ---- |
| T1 | \`tasks/T1.md\` |

## Dependencies

None
`);
    writeTask(specDir, 1, 'None', { owns: ['src/example.js'], depends_on: [] });

    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('requirements.json missing spec requirement REQ-002');
    expect(result.errors).toContain('requirements.json references unknown requirement REQ-999');
    expect(result.errors).toContain('requirements.json REQ-999 missing acceptance');
  });

  it('generates requirements.json from spec requirement IDs', () => {
    const specDir = join(TMP_ROOT, 'specs', 'requirements-generate');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\nREQ-002: handles errors\n');

    const result = generateRequirementsFile(specDir);
    expect(result).toMatchObject({ ok: true, count: 2 });
    expect(existsSync(join(specDir, 'requirements.json'))).toBe(true);
    const data = JSON.parse(readFileSync(join(specDir, 'requirements.json'), 'utf8'));
    expect(data.requirements.map(requirement => requirement.id)).toEqual(['REQ-001', 'REQ-002']);
    expect(data.requirements.every(requirement => requirement.status === 'failing')).toBe(true);
    expect(data.requirements[0].types).toEqual(['functional']);
    expect(data.requirements[0].required_categories).toEqual(['happy-path']);
    expect(data.requirements[0].acceptance).toEqual(['Acceptance criteria for REQ-001']);
    expect(data.requirements[0].behaviors).toEqual([
      {
        id: 'REQ-001-B01',
        category: 'happy-path',
        description: 'Verifiable behavior for REQ-001',
        status: 'failing',
        acceptance: ['Evidence proves REQ-001-B01 is implemented'],
        test_plan: {
          strategy: 'unit + boundary',
          inputs: ['representative input'],
          expected: ['documented outcome'],
          coverage_target: 'behavior acceptance'
        }
      }
    ]);
  });

  it('rejects requirements.json behaviors that are not independently verifiable', () => {
    const specDir = join(TMP_ROOT, 'specs', 'requirements-behaviors');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          behaviors: [
            { id: 'REQ-001-EDGE', category: 'edge', status: 'failing' },
            { id: 'REQ-001-B02', description: 'handles errors' }
          ]
        }
      ]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), `# Feature Plan

## Task Overview

| Task | File |
| ---- | ---- |
| T1 | \`tasks/T1.md\` |

## Dependencies

None
`);
    writeTask(specDir, 1, 'None', { owns: ['src/example.js'], depends_on: [] });

    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('requirements.json REQ-001 behavior REQ-001-EDGE has invalid behavior id');
    expect(result.errors).toContain('requirements.json REQ-001-EDGE has unknown category edge');
    expect(result.errors).toContain('requirements.json REQ-001-EDGE missing description');
    expect(result.errors).toContain('requirements.json REQ-001-EDGE missing acceptance');
    expect(result.errors).toContain('requirements.json REQ-001-B02 missing category');
    expect(result.errors).toContain('requirements.json REQ-001-B02 missing status');
    expect(result.errors).toContain('requirements.json REQ-001-B02 missing acceptance');
  });

  it('rejects requirements.json behaviors without known detail categories', () => {
    const specDir = join(TMP_ROOT, 'specs', 'requirements-behavior-categories');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          acceptance: ['works'],
          behaviors: [
            { id: 'REQ-001-B01', description: 'works normally', status: 'failing', acceptance: ['tested'] },
            { id: 'REQ-001-B02', category: 'custom-edge', description: 'custom behavior', status: 'failing', acceptance: ['tested'] }
          ]
        }
      ]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), `# Feature Plan

## Task Overview

| Task | File |
| ---- | ---- |
| T1 | \`tasks/T1.md\` |

## Dependencies

None
`);
    writeTask(specDir, 1, 'None', { owns: ['src/example.js'], depends_on: [] });

    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('requirements.json REQ-001-B01 missing category');
    expect(result.errors).toContain('requirements.json REQ-001-B02 has unknown category custom-edge');
  });

  it('rejects requirements.json when required behavior categories are not covered', () => {
    const specDir = join(TMP_ROOT, 'specs', 'requirements-required-categories');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: protects writes\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          types: ['input', 'authorization', 'write'],
          required_categories: ['observability', 'custom-category'],
          acceptance: ['protects writes'],
          behaviors: [
            { id: 'REQ-001-B01', category: 'happy-path', description: 'works normally', status: 'failing', acceptance: ['tested'] },
            { id: 'REQ-001-B02', category: 'invalid-input', description: 'rejects bad input', status: 'failing', acceptance: ['tested'] }
          ]
        }
      ]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), `# Feature Plan

## Task Overview

| Task | File |
| ---- | ---- |
| T1 | \`tasks/T1.md\` |

## Dependencies

None
`);
    writeTask(specDir, 1, 'None', { owns: ['src/example.js'], depends_on: [] });

    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('requirements.json REQ-001 has unknown required category custom-category');
    expect(result.errors).toContain('requirements.json REQ-001 missing behavior category authorization');
    expect(result.errors).toContain('requirements.json REQ-001 missing behavior category atomicity');
    expect(result.errors).toContain('requirements.json REQ-001 missing behavior category observability');
  });

  it('rejects tasks that omit or invent behavior_ids', () => {
    const specDir = join(TMP_ROOT, 'specs', 'task-behavior-ids');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          acceptance: ['works'],
          behaviors: [
            { id: 'REQ-001-B01', category: 'happy-path', description: 'works normally', status: 'failing', acceptance: ['tested'] }
          ]
        }
      ]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), `# Feature Plan

## Task Overview

| Task | File |
| ---- | ---- |
| T1 | \`tasks/T1.md\` |
| T2 | \`tasks/T2.md\` |

## Dependencies

None
`);
    writeTask(specDir, 1, 'None', { behavior_ids: [] });
    writeTask(specDir, 2, 'None', { behavior_ids: ['REQ-001-B99', 'bad'] });
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T1'],
          tests: [],
          evidence: [],
          behaviors: {
            'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] }
          }
        }
      }
    }, null, 2));

    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('tasks/T1.md behavior_ids must not be empty');
    expect(result.errors).toContain('tasks/T2.md references unknown behavior REQ-001-B99');
    expect(result.errors).toContain('tasks/T2.md has invalid behavior id bad');
  });

  it('rejects planning traceability that omits task mappings', () => {
    const specDir = join(TMP_ROOT, 'specs', 'planning-traceability-task-mapping');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          acceptance: ['works'],
          behaviors: [
            { id: 'REQ-001-B01', category: 'happy-path', description: 'works normally', status: 'failing', acceptance: ['tested'] }
          ]
        }
      ]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), `# Feature Plan

## Task Overview

| Task | File |
| ---- | ---- |
| T1 | \`tasks/T1.md\` |

## Dependencies

None
`);
    writeTask(specDir, 1, 'None', { behavior_ids: ['REQ-001-B01'] });
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: [],
          tests: [],
          evidence: [],
          behaviors: {
            'REQ-001-B01': { tasks: [], tests: [], evidence: [] }
          }
        }
      }
    }, null, 2));

    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('traceability.json REQ-001 has no task references');
    expect(result.errors).toContain('traceability.json REQ-001-B01 has no task references');
  });

  it('checks verification artifacts before completion', () => {
    const specDir = join(TMP_ROOT, 'specs', 'verified-feature');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| Requirement ID | Acceptance |\n|---|---|\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 complete at 14:30\n');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    const log = '1 test passed\n';
    writeFileSync(join(specDir, 'evidence', 'test.log'), log);
    const hash = createHash('sha256').update(log).digest('hex');
    writeFileSync(join(specDir, 'test-report.md'), `verdict: PASS\nevidence-command: npm test\nevidence-exit-code: 0\nevidence-file: evidence/test.log\nevidence-sha256: ${hash}\n\nCovered: REQ-001\n`);

    const result = verifyArtifacts({ specDir });
    expect(result.errors).toEqual([]);
  });

  it('rejects incomplete verification evidence', () => {
    const specDir = join(TMP_ROOT, 'specs', 'incomplete-feature');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 started at HH:mm\n');

    const result = verifyArtifacts({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing required artifact: test-report.md');
    expect(result.errors).toContain('progress.md still contains literal HH:mm placeholder');
  });

  it('rejects passing verification reports that omit spec requirement coverage', () => {
    const specDir = join(TMP_ROOT, 'specs', 'missing-coverage');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| Requirement ID | Acceptance |\n|---|---|\n| REQ-001 | works |\n| REQ-002 | handles errors |\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 complete at 14:30\n');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    const log = '1 test passed\n';
    writeFileSync(join(specDir, 'evidence', 'test.log'), log);
    const hash = createHash('sha256').update(log).digest('hex');
    writeFileSync(join(specDir, 'test-report.md'), `verdict: PASS
evidence-command: npm test
evidence-exit-code: 0
evidence-file: evidence/test.log
evidence-sha256: ${hash}

Covered: REQ-001
`);

    const result = verifyArtifacts({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('test-report.md PASS does not mention spec requirement REQ-002');
  });

  it('rejects passing final verify reports that omit spec requirement coverage', () => {
    const specDir = join(TMP_ROOT, 'specs', 'missing-final-coverage');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| Requirement ID | Acceptance |\n|---|---|\n| REQ-001 | works |\n| REQ-002 | handles errors |\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 complete at 14:30\n');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    const log = '1 test passed\n';
    writeFileSync(join(specDir, 'evidence', 'test.log'), log);
    const hash = createHash('sha256').update(log).digest('hex');
    writeFileSync(join(specDir, 'test-report.md'), `verdict: PASS
evidence-command: npm test
evidence-exit-code: 0
evidence-file: evidence/test.log
evidence-sha256: ${hash}

Covered: REQ-001, REQ-002
`);
    writeFileSync(join(specDir, 'verify-report.md'), `verdict: PASS
evidence-command: npm run build
evidence-exit-code: 0
evidence-file: evidence/test.log
evidence-sha256: ${hash}

Covered: REQ-001
`);

    const result = verifyArtifacts({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('verify-report.md PASS does not mention spec requirement REQ-002');
  });

  it('rejects incomplete traceability requirement mappings', () => {
    const specDir = join(TMP_ROOT, 'specs', 'incomplete-traceability');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\nREQ-002: handles errors\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 complete at 14:30\n');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    const log = '1 test passed\n';
    writeFileSync(join(specDir, 'evidence', 'test.log'), log);
    const hash = createHash('sha256').update(log).digest('hex');
    const report = `verdict: PASS
evidence-command: npm test
evidence-exit-code: 0
evidence-file: evidence/test.log
evidence-sha256: ${hash}

Covered: REQ-001, REQ-002
`;
    writeFileSync(join(specDir, 'test-report.md'), report);
    writeFileSync(join(specDir, 'verify-report.md'), report);
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T1']
        }
      }
    }, null, 2));

    const result = verifyArtifacts({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('traceability.json REQ-001 has no test references');
    expect(result.errors).toContain('traceability.json REQ-001 has no evidence references');
    expect(result.errors).toContain('traceability.json missing spec requirement REQ-002');
  });

  it('rejects requirements.json drift during verification', () => {
    const specDir = join(TMP_ROOT, 'specs', 'requirements-drift-verification');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\nREQ-002: handles errors\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [
        { id: 'REQ-001', status: 'passing', acceptance: ['works'] }
      ]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 complete at 14:30\n');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    const log = '1 test passed\n';
    writeFileSync(join(specDir, 'evidence', 'test.log'), log);
    const hash = createHash('sha256').update(log).digest('hex');
    const report = `verdict: PASS
evidence-command: npm test
evidence-exit-code: 0
evidence-file: evidence/test.log
evidence-sha256: ${hash}

Covered: REQ-001, REQ-002
`;
    writeFileSync(join(specDir, 'test-report.md'), report);
    writeFileSync(join(specDir, 'verify-report.md'), report);

    const result = verifyArtifacts({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('requirements.json missing spec requirement REQ-002');
  });

  it('requires traceability.json when requirements.json exists during verification', () => {
    const specDir = join(TMP_ROOT, 'specs', 'requirements-require-traceability');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [
        { id: 'REQ-001', status: 'passing', acceptance: ['works'] }
      ]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 complete at 14:30\n');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    const log = '1 test passed\n';
    writeFileSync(join(specDir, 'evidence', 'test.log'), log);
    const hash = createHash('sha256').update(log).digest('hex');
    const report = `verdict: PASS
evidence-command: npm test
evidence-exit-code: 0
evidence-file: evidence/test.log
evidence-sha256: ${hash}

Covered: REQ-001
`;
    writeFileSync(join(specDir, 'test-report.md'), report);
    writeFileSync(join(specDir, 'verify-report.md'), report);

    const result = verifyArtifacts({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing required artifact: traceability.json');
  });

  it('rejects traceability references that do not exist', () => {
    const specDir = join(TMP_ROOT, 'specs', 'traceability-missing-references');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 complete at 14:30\n');
    const log = '1 test passed\n';
    writeFileSync(join(specDir, 'evidence', 'test.log'), log);
    const hash = createHash('sha256').update(log).digest('hex');
    const report = `verdict: PASS
evidence-command: npm test
evidence-exit-code: 0
evidence-file: evidence/test.log
evidence-sha256: ${hash}

Covered: REQ-001
`;
    writeFileSync(join(specDir, 'test-report.md'), report);
    writeFileSync(join(specDir, 'verify-report.md'), report);
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T9'],
          tests: ['tests/missing.test.js#covers REQ-001'],
          evidence: ['evidence/missing.log']
        }
      }
    }, null, 2));

    const result = verifyArtifacts({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('traceability.json REQ-001 task reference not found: T9');
    expect(result.errors).toContain('traceability.json REQ-001 test reference not found: tests/missing.test.js#covers REQ-001');
    expect(result.errors).toContain('traceability.json REQ-001 evidence reference not found: evidence/missing.log');
  });

  it('rejects traceability that omits requirement behaviors', () => {
    const specDir = join(TMP_ROOT, 'specs', 'traceability-missing-behavior');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    mkdirSync(join(TMP_ROOT, 'tests'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          acceptance: ['works'],
          behaviors: [
            { id: 'REQ-001-B01', category: 'happy-path', description: 'happy path', status: 'passing', acceptance: ['tested'] },
            { id: 'REQ-001-B02', category: 'invalid-input', description: 'error path', status: 'failing', acceptance: ['tested'] }
          ]
        }
      ]
    }, null, 2));
    writeTask(specDir, 1, 'None', { owns: ['src/example.js'], depends_on: [] });
    writeFileSync(join(TMP_ROOT, 'tests', 'example.test.js'), 'test placeholder\n');
    writeFileSync(join(specDir, 'evidence', 'test.log'), '1 test passed\n');
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T1'],
          tests: ['tests/example.test.js#REQ-001'],
          evidence: ['evidence/test.log'],
          behaviors: {
            'REQ-001-B01': {
              tasks: ['T1'],
              tests: ['tests/example.test.js#REQ-001-B01'],
              evidence: ['evidence/test.log']
            }
          }
        }
      }
    }, null, 2));

    const errors = [];
    const result = validateTraceabilityFile(specDir, errors, { required: true });
    expect(result.requirementIds).toEqual(['REQ-001']);
    expect(errors).toContain('traceability.json REQ-001 missing behavior REQ-001-B02');
  });

  it('generates traceability.json from spec requirements and task mappings', () => {
    const specDir = join(TMP_ROOT, 'specs', 'traceability-generate');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\nREQ-002: handles errors\n');
    writeTask(specDir, 1, 'None', { owns: ['src/example.js'], depends_on: [] });

    const result = generateTraceabilityFile(specDir);
    expect(result).toMatchObject({ ok: true, count: 2 });
    expect(existsSync(join(specDir, 'traceability.json'))).toBe(true);
    const data = JSON.parse(readFileSync(join(specDir, 'traceability.json'), 'utf8'));
    expect(data.requirements['REQ-001'].tasks).toEqual(['T1']);
    expect(data.requirements['REQ-001'].tests).toEqual([]);
    expect(data.requirements['REQ-002'].tasks).toEqual([]);
  });

  it('checks traceability.json through the CLI', () => {
    const specDir = join(TMP_ROOT, 'specs', 'traceability-cli');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    mkdirSync(join(TMP_ROOT, 'tests'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeTask(specDir, 1, 'None', { owns: ['src/example.js'], depends_on: [] });
    writeFileSync(join(TMP_ROOT, 'tests', 'example.test.js'), 'test placeholder\n');
    writeFileSync(join(specDir, 'evidence', 'test.log'), '1 test passed\n');
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T1'],
          tests: ['tests/example.test.js#REQ-001'],
          evidence: ['evidence/test.log']
        }
      }
    }, null, 2));

    const output = execFileSync(process.execPath, [
      join(process.cwd(), 'scripts', 'traceability-json.mjs'),
      'check',
      '--spec-dir',
      specDir,
      '--required'
    ], { cwd: TMP_ROOT, encoding: 'utf8' });

    expect(output).toContain('Checked traceability.json');
    const errors = [];
    const result = validateTraceabilityFile(specDir, errors, { required: true });
    expect(result.requirementIds).toEqual(['REQ-001']);
    expect(errors).toEqual([]);
  });

  it('validates codegraph and structured memory state', () => {
    mkdirSync(join(TMP_ROOT, '.codegraph'), { recursive: true });
    mkdirSync(join(TMP_ROOT, '.loom', 'memory'), { recursive: true });
    writeFileSync(join(TMP_ROOT, '.loom', 'memory', 'store.json'), '{"entries":[],"sessions":[]}\n');

    const result = validateIndex({ root: TMP_ROOT });
    expect(result.errors).toEqual([]);
  });

  it('reports missing structured memory store', () => {
    mkdirSync(join(TMP_ROOT, '.loom', 'memory'), { recursive: true });

    const result = validateIndex({ root: TMP_ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing required file: .loom/memory/store.json');
  });
});

describe('implementation packets', () => {
  it('generates a packet from a task with behavior_ids and validates it', () => {
    const specDir = join(TMP_ROOT, 'specs', 'packet-feature');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| Requirement ID | Acceptance |\n|---|---|\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001',
        status: 'failing',
        types: ['functional'],
        required_categories: ['happy-path'],
        acceptance: ['returns 200'],
        behaviors: [{
          id: 'REQ-001-B01',
          category: 'happy-path',
          description: 'normal flow returns 200',
          status: 'failing',
          acceptance: ['GET /x returns 200']
        }]
      }]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n\n| Task | File |\n| --- | --- |\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T1'],
          tests: [],
          evidence: [],
          behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] } }
        }
      }
    }, null, 2));
    writeTask(specDir, 1, 'None', { behavior_ids: ['REQ-001-B01'], owns: ['src/example-1.js'] });

    const result = generateImplementationPacket(specDir, 'T1');
    expect(result.ok).toBe(true);
    expect(result.task_id).toBe('T1');
    expect(existsSync(result.path)).toBe(true);

    const packet = JSON.parse(readFileSync(result.path, 'utf8'));
    expect(packet.task_id).toBe('T1');
    expect(packet.obligation_ids).toEqual(['REQ-001-B01']);
    expect(packet.allowed_files).toContain('src/example-1.js');
    expect(packet.packet_sha256).toMatch(/^[a-f0-9]{64}$/);

    const errors = [];
    const checkResult = validateImplementationPacket(specDir, 'T1', errors);
    expect(checkResult.ok).toBe(true);
    expect(errors).toEqual([]);
  });

  it('detects stale packets when task changes', () => {
    const specDir = join(TMP_ROOT, 'specs', 'stale-packet');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'], acceptance: ['ok'], behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', description: 'x', status: 'failing', acceptance: ['y'] }] }]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({ requirements: { 'REQ-001': { tasks: ['T1'], tests: [], evidence: [], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] } } } } }, null, 2));
    writeTask(specDir, 1, 'None', { behavior_ids: ['REQ-001-B01'] });

    generateImplementationPacket(specDir, 'T1');

    writeFileSync(join(specDir, 'tasks', 'T1.md'), readFileSync(join(specDir, 'tasks', 'T1.md'), 'utf8') + '\n<!-- extra change -->\n');

    const errors = [];
    const result = validateImplementationPacket(specDir, 'T1', errors);
    expect(result.ok).toBe(false);
    expect(errors.some(e => e.includes('stale'))).toBe(true);
  });

  it('reports missing packet file', () => {
    const specDir = join(TMP_ROOT, 'specs', 'missing-packet');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'tasks', 'T1.md'), 'placeholder');
    const errors = [];
    const result = validateImplementationPacket(specDir, 'T1', errors);
    expect(result.ok).toBe(false);
    expect(errors.some(e => e.includes('Missing implementation packet'))).toBe(true);
  });
});

describe('structured receipts', () => {
  it('builds a valid test receipt with artifact fingerprints and evidence', () => {
    const specDir = join(TMP_ROOT, 'specs', 'receipt-feature');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    writeFileSync(join(specDir, 'evidence', 'test.log'), 'PASS\n');
    const logSha = createHash('sha256').update('PASS\n').digest('hex');

    const result = buildReceipt({
      kind: 'test',
      stage: 'verification',
      taskId: 'T1',
      verdict: 'pass',
      specDir,
      artifacts: ['evidence/test.log'],
      behaviors: ['REQ-001-B01'],
      requirements: ['REQ-001'],
      evidence: [{
        command: 'npm test',
        exit_code: 0,
        log_file: 'evidence/test.log',
        log_sha256: logSha
      }]
    });
    expect(result.ok).toBe(true);
    expect(result.receipt.kind).toBe('test');
    expect(result.receipt.artifact_fingerprints['evidence/test.log']).toBe(logSha);
    expect(result.receipt.behaviors).toEqual(['REQ-001-B01']);
    expect(result.receipt.evidence[0].log_sha256).toBe(logSha);
  });

  it('writes receipt to receipts/<subdir> and validates it', () => {
    const specDir = join(TMP_ROOT, 'specs', 'receipt-write');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    writeFileSync(join(specDir, 'evidence', 'test.log'), 'PASS\n');
    const logSha = createHash('sha256').update('PASS\n').digest('hex');
    const built = buildReceipt({
      kind: 'test',
      stage: 'verification',
      specDir,
      artifacts: ['evidence/test.log'],
      evidence: [{ command: 'npm test', exit_code: 0, log_file: 'evidence/test.log', log_sha256: logSha }]
    });
    const written = writeReceipt({ specDir, subdir: 'tests', receipt: built.receipt });
    expect(written.ok).toBe(true);
    expect(existsSync(written.path)).toBe(true);

    const errors = [];
    const result = validateReceiptFile(written.path, errors);
    expect(result.ok).toBe(true);
  });

  it('rejects receipts with missing artifacts or invalid evidence', () => {
    const specDir = join(TMP_ROOT, 'specs', 'receipt-bad');
    const built = buildReceipt({
      kind: 'test',
      stage: 'verification',
      specDir,
      artifacts: ['evidence/missing.log'],
      evidence: [{ command: 'npm test', exit_code: 1, log_file: 'x.log', log_sha256: 'bad' }]
    });
    expect(built.ok).toBe(false);
    expect(built.errors.some(e => e.includes('Cannot fingerprint missing artifact'))).toBe(true);
    expect(built.errors.some(e => e.includes('Invalid receipt kind') === false)).toBe(true);
  });

  it('validates all receipts in a receipts subdir', () => {
    const specDir = join(TMP_ROOT, 'specs', 'receipt-dir');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    writeFileSync(join(specDir, 'evidence', 'a.log'), 'a');
    const logSha = createHash('sha256').update('a').digest('hex');
    const built = buildReceipt({
      kind: 'review',
      stage: 'review-gate',
      specDir,
      artifacts: ['evidence/a.log'],
      evidence: [{ command: 'review', exit_code: 0, log_file: 'evidence/a.log', log_sha256: logSha }]
    });
    writeReceipt({ specDir, subdir: 'reviews', receipt: built.receipt });

    const errors = [];
    const result = validateReceiptsDir(specDir, 'reviews', errors);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
  });

  it('binds evidence to git tree and commit hashes when projectRoot is a git repo', () => {
    const specDir = join(TMP_ROOT, 'specs', 'git-bound');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    writeFileSync(join(specDir, 'evidence', 'a.log'), 'a');
    const logSha = createHash('sha256').update('a').digest('hex');
    const built = buildReceipt({
      kind: 'test',
      stage: 'verification',
      specDir,
      projectRoot: process.cwd(),
      artifacts: ['evidence/a.log'],
      evidence: [{ command: 'npm test', exit_code: 0, log_file: 'evidence/a.log', log_sha256: logSha }]
    });
    expect(built.ok).toBe(true);
    expect(built.receipt.git_commit).toMatch(/^[a-f0-9]{40}$/);
    expect(built.receipt.git_tree).toMatch(/^[a-f0-9]{40}$/);
    expect(built.receipt.diff_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('parallel evaluators', () => {
  it('runs 3 evaluators and aggregates blocker count', () => {
    const specDir = join(TMP_ROOT, 'specs', 'eval-feature');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001',
        status: 'failing',
        types: ['functional'],
        required_categories: ['happy-path'],
        acceptance: ['ok'],
        behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', description: 'x', status: 'failing', acceptance: ['y'], test_plan: { strategy: 'unit', inputs: ['a'], expected: ['b'], coverage_target: 'x' } }]
      }]
    }));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'tasks', 'T1.md'), `---
owns: [src/a.js]
reads: []
depends_on: []
requirements: [REQ-001]
behavior_ids: [REQ-001-B01]
complexity: low
---
body
`);
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: ['tests/a.test.js'], evidence: ['evidence/a.log'], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: ['tests/a.test.js'], evidence: ['evidence/a.log'] } } } }
    }));
    writeFileSync(join(specDir, 'evidence', 'a.log'), 'PASS\n');
    mkdirSync(join(specDir, 'tests'), { recursive: true });
    writeFileSync(join(specDir, 'tests', 'a.test.js'), '// placeholder test\n');

    const result = runParallelEvaluators(specDir, { writeReceipt: false });
    const evaluators = result.receipt.evaluators;
    expect(evaluators).toHaveLength(3);
    expect(evaluators.map(e => e.evaluator).sort()).toEqual(['architecture', 'requirements', 'security-test']);
    expect(result.ok).toBe(true);
  });

  it('reports blocker when requirements coverage is incomplete', () => {
    const specDir = join(TMP_ROOT, 'specs', 'eval-fail');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | a |\n| REQ-002 | b |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'], acceptance: ['ok'], behaviors: [] }]
    }));
    const r = runRequirementsEvaluator(specDir);
    expect(r.verdict).toBe('fail');
    expect(r.errors.some(e => e.includes('unknown requirement REQ-002') || e.includes('coverage gap'))).toBe(true);
  });
});

describe('structured receipts (continued)', () => {
  it('generates requirements.json with structured behavior test_plan', () => {
    const specDir = join(TMP_ROOT, 'specs', 'test-plan-gen');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    const result = generateRequirementsFile(specDir);
    expect(result.ok).toBe(true);
    const data = JSON.parse(readFileSync(result.path, 'utf8'));
    expect(data.requirements[0].behaviors[0].test_plan.strategy).toBe('unit + boundary');
    expect(data.requirements[0].behaviors[0].test_plan.inputs).toEqual(['representative input']);
  });

  it('rejects behaviors without structured test_plan in strict mode', () => {
    const specDir = join(TMP_ROOT, 'specs', 'test-plan-strict');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001',
        status: 'failing',
        types: ['functional'],
        required_categories: ['happy-path'],
        acceptance: ['ok'],
        behaviors: [{
          id: 'REQ-001-B01',
          category: 'happy-path',
          description: 'normal',
          status: 'failing',
          acceptance: ['returns 200']
        }]
      }]
    }));
    const errors = [];
    validateRequirementsFile(specDir, errors, { requireTestPlan: true });
    expect(errors.some(e => e.includes('REQ-001-B01 missing structured test_plan'))).toBe(true);
  });

  it('enforces behavior status transition rules and blocks implementer from regressing passing', () => {
    const specDir = join(TMP_ROOT, 'specs', 'status-machine');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001',
        status: 'failing',
        types: ['functional'],
        required_categories: ['happy-path'],
        acceptance: ['ok'],
        behaviors: [
          { id: 'REQ-001-B01', category: 'happy-path', description: 'x', status: 'failing', acceptance: ['y'] },
          { id: 'REQ-001-B02', category: 'invalid-input', description: 'x', status: 'passing', acceptance: ['y'] },
          { id: 'REQ-001-B03', category: 'boundary', description: 'x', status: 'failing', acceptance: ['y'] }
        ]
      }]
    }));

    const legal = updateBehaviorStatus(specDir, 'REQ-001-B01', 'in_progress');
    expect(legal.ok).toBe(true);

    const illegal = updateBehaviorStatus(specDir, 'REQ-001-B01', 'passing');
    expect(illegal.ok).toBe(false);
    expect(illegal.error).toContain('Illegal transition');

    const noPassing = updateBehaviorStatus(specDir, 'REQ-001-B03', 'passing');
    expect(noPassing.ok).toBe(false);
    expect(noPassing.error).toContain('candidate_implemented');

    const withEvidence = updateBehaviorStatus(specDir, 'REQ-001-B03', 'candidate_implemented');
    expect(withEvidence.ok).toBe(true);
    const verified = updateBehaviorStatus(specDir, 'REQ-001-B03', 'passing', {
      evidenceReceipt: 'receipts/tests/abc.json',
      verifier: 'test-reporter'
    });
    expect(verified.ok).toBe(true);

    const regress = updateBehaviorStatus(specDir, 'REQ-001-B02', 'failing');
    expect(regress.ok).toBe(false);
    expect(regress.error).toContain('already passing');

    updateBehaviorStatus(specDir, 'REQ-001-B01', 'candidate_implemented');
    const implementerAsVerifier = updateBehaviorStatus(specDir, 'REQ-001-B01', 'passing', { verifier: 'implementer' });
    expect(implementerAsVerifier.ok).toBe(false);
    expect(implementerAsVerifier.error).toContain('external verifier');
  });
});

function writeTask(specDir, number, deps, options = {}) {
  const owns = options.owns || [`src/example-${number}.js`];
  const dependsOn = options.depends_on || [];
  const behaviorIds = Object.hasOwn(options, 'behavior_ids') ? options.behavior_ids : ['REQ-001-B01'];
  writeFileSync(join(specDir, 'tasks', `T${number}.md`), `---
owns: [${owns.join(', ')}]
reads: []
depends_on: [${dependsOn.join(', ')}]
requirements: [REQ-001]
behavior_ids: [${behaviorIds.join(', ')}]
complexity: low
---
### Task ${number}: Implement slice

- **Complexity**: simple
- **Dependencies**: ${deps}
- **Files**:
  - Modify: \`src/example.js\`
  - Test: \`tests/example.test.js\`

- [ ] Step 1: write failing test
- [ ] Step 2: implement code

Run test for this task.

## Acceptance Mapping

| Requirement ID | Test |
|---|---|
| REQ-001 | example test |
`);
}

describe('detail-expansion script', () => {
  it('passes when requirements cover required categories with test_plan', () => {
    const specDir = join(TMP_ROOT, 'specs', 'detail-ok');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'],
        acceptance: ['works'],
        behaviors: [{
          id: 'REQ-001-B01', category: 'happy-path', status: 'failing',
          description: 'returns ok', acceptance: ['returns ok'],
          test_plan: { strategy: 'unit', inputs: ['x'], expected: ['ok'], coverage_target: '100%' }
        }]
      }]
    }, null, 2));

    const output = execFileSync(process.execPath, [
      'skills/loom-detail-expansion/scripts/check-detail-expansion.mjs', '--spec-dir', specDir,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(output).toContain('Checked detail-expansion');
    expect(output).toContain('0 missing category');
    expect(output).toContain('0 missing test_plan');
  });

  it('fails when required category or test_plan missing', () => {
    const specDir = join(TMP_ROOT, 'specs', 'detail-missing');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001', status: 'failing', types: ['input'], required_categories: ['invalid-input'],
        acceptance: ['works'],
        behaviors: [{
          id: 'REQ-001-B01', category: 'happy-path', status: 'failing',
          description: 'returns ok', acceptance: ['returns ok']
        }]
      }]
    }, null, 2));

    let exitCode = 0;
    let output = '';
    try {
      output = execFileSync(process.execPath, [
        'skills/loom-detail-expansion/scripts/check-detail-expansion.mjs', '--spec-dir', specDir,
      ], { cwd: process.cwd(), encoding: 'utf8' });
    } catch (error) {
      exitCode = error.status;
      output = (error.stdout || '') + (error.stderr || '');
    }
    expect(exitCode).toBe(1);
    expect(output).toContain('missing behavior category invalid-input');
    expect(output).toContain('missing test_plan');
  });
});

describe('analyze-artifacts script', () => {
  it('passes and writes artifact-analysis.json when consistent', () => {
    const specDir = join(TMP_ROOT, 'specs', 'analyze-ok');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'],
        acceptance: ['works'],
        behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', status: 'failing', description: 'ok', acceptance: ['ok'], test_plan: { strategy: 'unit', inputs: [], expected: [], coverage_target: '100%' } }]
      }]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'tasks', 'T1.md'), `---
owns: [src/example.js]
reads: []
depends_on: []
requirements: [REQ-001]
behavior_ids: [REQ-001-B01]
complexity: low
---
### Task 1
`);
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: [], evidence: [], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] } } } }
    }, null, 2));

    const output = execFileSync(process.execPath, [
      'skills/loom-analyze-artifacts/scripts/analyze-artifacts.mjs', '--spec-dir', specDir,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(output).toContain('Analyzed artifacts');
    expect(existsSync(join(specDir, 'artifact-analysis.json'))).toBe(true);
  });

  it('fails when task references unknown behavior', () => {
    const specDir = join(TMP_ROOT, 'specs', 'analyze-bad');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'],
        acceptance: ['works'],
        behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', status: 'failing', description: 'ok', acceptance: ['ok'], test_plan: { strategy: 'unit', inputs: [], expected: [], coverage_target: '100%' } }]
      }]
    }, null, 2));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'tasks', 'T1.md'), `---
owns: [src/example.js]
reads: []
depends_on: []
requirements: [REQ-001]
behavior_ids: [REQ-001-B99]
complexity: low
---
### Task 1
`);
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: [], evidence: [], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] } } } }
    }, null, 2));

    let exitCode = 0;
    let output = '';
    try {
      output = execFileSync(process.execPath, [
        'skills/loom-analyze-artifacts/scripts/analyze-artifacts.mjs', '--spec-dir', specDir,
      ], { cwd: process.cwd(), encoding: 'utf8' });
    } catch (error) {
      exitCode = error.status;
      output = (error.stdout || '') + (error.stderr || '');
    }
    expect(exitCode).toBe(1);
    expect(output).toContain('unknown behavior REQ-001-B99');
  });
});

describe('converge script', () => {
  it('reports converged when all behaviors have tests/evidence', () => {
    const specDir = join(TMP_ROOT, 'specs', 'converge-ok');
    mkdirSync(specDir, { recursive: true });
    mkdirSync(join(specDir, 'tests'), { recursive: true });
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'],
        acceptance: ['works'],
        behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', status: 'passing', description: 'ok', acceptance: ['ok'], test_plan: { strategy: 'unit', inputs: [], expected: [], coverage_target: '100%' } }]
      }]
    }, null, 2));
    writeFileSync(join(specDir, 'tests', 'a.test.js'), 'test');
    writeFileSync(join(specDir, 'evidence', 'a.log'), 'pass');
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: ['tests/a.test.js'], evidence: ['evidence/a.log'], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: ['tests/a.test.js'], evidence: ['evidence/a.log'] } } } }
    }, null, 2));

    const output = execFileSync(process.execPath, [
      'skills/loom-converge/scripts/converge.mjs', '--spec-dir', specDir, '--round', '1',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(output).toContain('converged');
    expect(existsSync(join(specDir, 'convergence-report.json'))).toBe(true);
  });

  it('reports needs_another_round when behavior missing tests', () => {
    const specDir = join(TMP_ROOT, 'specs', 'converge-missing');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'],
        acceptance: ['works'],
        behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', status: 'failing', description: 'ok', acceptance: ['ok'], test_plan: { strategy: 'unit', inputs: [], expected: [], coverage_target: '100%' } }]
      }]
    }, null, 2));
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: [], evidence: [], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] } } } }
    }, null, 2));

    let exitCode = 0;
    let output = '';
    try {
      output = execFileSync(process.execPath, [
        'skills/loom-converge/scripts/converge.mjs', '--spec-dir', specDir, '--round', '1',
      ], { cwd: process.cwd(), encoding: 'utf8' });
    } catch (error) {
      exitCode = error.status;
      output = (error.stdout || '') + (error.stderr || '');
    }
    expect(exitCode).toBe(1);
    expect(output).toContain('needs_another_round');
  });
});

describe('omission-hunter script', () => {
  it('passes when all behaviors have tests/evidence files', () => {
    const specDir = join(TMP_ROOT, 'specs', 'omit-ok');
    mkdirSync(specDir, { recursive: true });
    mkdirSync(join(specDir, 'tests'), { recursive: true });
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'],
        acceptance: ['works'],
        behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', status: 'passing', description: 'ok', acceptance: ['ok'], test_plan: { strategy: 'unit', inputs: [], expected: [], coverage_target: '100%' } }]
      }]
    }, null, 2));
    writeFileSync(join(specDir, 'tests', 'a.test.js'), 'test');
    writeFileSync(join(specDir, 'evidence', 'a.log'), 'pass');
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: ['tests/a.test.js'], evidence: ['evidence/a.log'], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: ['tests/a.test.js'], evidence: ['evidence/a.log'] } } } }
    }, null, 2));

    const output = execFileSync(process.execPath, [
      'skills/loom-omission-hunter/scripts/omission-hunt.mjs', '--spec-dir', specDir,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(output).toContain('pass');
    expect(existsSync(join(specDir, 'findings', 'omission-hunter.json'))).toBe(true);
  });

  it('blocks when test reference file does not exist', () => {
    const specDir = join(TMP_ROOT, 'specs', 'omit-missing');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\nREQ-001: works\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'],
        acceptance: ['works'],
        behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', status: 'failing', description: 'ok', acceptance: ['ok'], test_plan: { strategy: 'unit', inputs: [], expected: [], coverage_target: '100%' } }]
      }]
    }, null, 2));
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: ['tests/missing.test.js'], evidence: [], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: ['tests/missing.test.js'], evidence: [] } } } }
    }, null, 2));

    let exitCode = 0;
    let output = '';
    try {
      output = execFileSync(process.execPath, [
        'skills/loom-omission-hunter/scripts/omission-hunt.mjs', '--spec-dir', specDir,
      ], { cwd: process.cwd(), encoding: 'utf8' });
    } catch (error) {
      exitCode = error.status;
      output = (error.stdout || '') + (error.stderr || '');
    }
    expect(exitCode).toBe(1);
    expect(output).toContain('test reference not found');
    expect(output).toContain('blocked');
  });
});
