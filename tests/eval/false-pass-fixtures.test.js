import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePlan } from '../../skills/loom-writing-plans/scripts/validate-plan.mjs';
import { verifyArtifacts } from '../../skills/loom-verification-before-completion/scripts/verify-artifacts.mjs';
import { validateRequirementsFile, updateBehaviorStatus, generateRequirementsFile } from '../../src/core/requirements.js';
import { validateTraceabilityFile } from '../../src/core/traceability.js';
import { validateImplementationPacket, generateImplementationPacket } from '../../src/core/implementation-packets.js';
import { buildReceipt, validateReceiptFile } from '../../src/core/receipts.js';
import { runParallelEvaluators } from '../../src/core/evaluators.js';

const TMP_ROOT = join(import.meta.dirname, '__test_false_pass__');

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

describe('false PASS regression fixtures', () => {
  function setupSpecDir(name) {
    const specDir = join(TMP_ROOT, 'specs', name);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    return specDir;
  }

  it('F-001: blocks passing test-report that omits a spec REQ', () => {
    const specDir = setupSpecDir('F-001');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | a |\n| REQ-002 | b |\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'progress.md'), '# Progress');
    writeFileSync(join(specDir, 'evidence', 't.log'), 'ok');
    const logSha = sha256('ok');
    writeFileSync(join(specDir, 'test-report.md'), `verdict: PASS\nevidence-command: npm test\nevidence-exit-code: 0\nevidence-file: evidence/t.log\nevidence-sha256: ${logSha}\nCovered: REQ-001\n`);
    writeFileSync(join(specDir, 'verify-report.md'), `verdict: PASS\nevidence-command: npm test\nevidence-exit-code: 0\nevidence-file: evidence/t.log\nevidence-sha256: ${logSha}\nCovered: REQ-001\n`);
    const result = verifyArtifacts({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('REQ-002'))).toBe(true);
  });

  it('F-002: blocks plan validation when task depends_on references unknown task', () => {
    const specDir = setupSpecDir('F-002');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'tasks', 'T1.md'), `---
owns: [src/a.js]
reads: []
depends_on: [T9]
requirements: [REQ-001]
behavior_ids: []
complexity: low
---
body
`);
    const result = validatePlan({ specDir });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('depends_on unknown task T9'))).toBe(true);
  });

  it('F-003: blocks verification when traceability references missing test file', () => {
    const specDir = setupSpecDir('F-003');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'], acceptance: ['ok'], behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', description: 'x', status: 'failing', acceptance: ['y'] }] }]
    }));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'progress.md'), '# Progress');
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
    writeFileSync(join(specDir, 'evidence', 't.log'), 'ok');
    const logSha = sha256('ok');
    writeFileSync(join(specDir, 'test-report.md'), `verdict: PASS\nevidence-command: npm test\nevidence-exit-code: 0\nevidence-file: evidence/t.log\nevidence-sha256: ${logSha}\nCovered: REQ-001\n`);
    writeFileSync(join(specDir, 'verify-report.md'), `verdict: PASS\nevidence-command: npm test\nevidence-exit-code: 0\nevidence-file: evidence/t.log\nevidence-sha256: ${logSha}\nCovered: REQ-001\n`);
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: ['tests/missing.test.js'], evidence: ['evidence/t.log'], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: ['tests/missing.test.js'], evidence: ['evidence/t.log'] } } } }
    }));
    const errors = [];
    validateTraceabilityFile(specDir, errors, { required: true });
    expect(errors.some(e => e.includes('test reference not found'))).toBe(true);
  });

  it('F-004: blocks implementer from regressing a passing behavior', () => {
    const specDir = setupSpecDir('F-004');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'], acceptance: ['ok'], behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', description: 'x', status: 'passing', acceptance: ['y'] }] }]
    }));
    const result = updateBehaviorStatus(specDir, 'REQ-001-B01', 'failing');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already passing');
  });

  it('F-005: blocks stale implementation packet when task changes', () => {
    const specDir = setupSpecDir('F-005');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | works |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'], acceptance: ['ok'], behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', description: 'x', status: 'failing', acceptance: ['y'] }] }]
    }));
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n| T1 | `tasks/T1.md` |\n');
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: { 'REQ-001': { tasks: ['T1'], tests: [], evidence: [], behaviors: { 'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] } } } }
    }));
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
    generateImplementationPacket(specDir, 'T1');
    writeFileSync(join(specDir, 'tasks', 'T1.md'), readFileSync(join(specDir, 'tasks', 'T1.md'), 'utf8') + '\n<!-- changed -->\n');
    const errors = [];
    const result = validateImplementationPacket(specDir, 'T1', errors);
    expect(result.ok).toBe(false);
    expect(errors.some(e => e.includes('stale'))).toBe(true);
  });

  it('F-006: blocks receipt with missing evidence artifact fingerprint', () => {
    const specDir = setupSpecDir('F-006');
    const built = buildReceipt({
      kind: 'test',
      stage: 'verification',
      specDir,
      artifacts: ['evidence/missing.log'],
      evidence: []
    });
    expect(built.ok).toBe(false);
    expect(built.errors.some(e => e.includes('Cannot fingerprint missing artifact'))).toBe(true);
  });

  it('F-007: blocks requirements drift between spec.md and requirements.json', () => {
    const specDir = setupSpecDir('F-007');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | a |\n| REQ-002 | b |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'], acceptance: ['ok'], behaviors: [] }]
    }));
    const errors = [];
    validateRequirementsFile(specDir, errors);
    expect(errors.some(e => e.includes('missing spec requirement REQ-002'))).toBe(true);
  });

  it('F-008: blocks requirement with required category not covered by any behavior', () => {
    const specDir = setupSpecDir('F-008');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | a |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['input'], required_categories: ['invalid-input'], acceptance: ['ok'], behaviors: [{ id: 'REQ-001-B01', category: 'happy-path', description: 'x', status: 'failing', acceptance: ['y'] }] }]
    }));
    const errors = [];
    validateRequirementsFile(specDir, errors);
    expect(errors.some(e => e.includes('missing behavior category invalid-input'))).toBe(true);
  });

  it('F-009: parallel evaluators block when requirements coverage is incomplete', () => {
    const specDir = setupSpecDir('F-009');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | a |\n| REQ-002 | b |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'], acceptance: ['ok'], behaviors: [] }]
    }));
    const result = runParallelEvaluators(specDir, { writeReceipt: false });
    expect(result.ok).toBe(false);
    expect(result.receipt.verdict).toBe('fail');
  });

  it('F-010: blocks behavior with invalid category', () => {
    const specDir = setupSpecDir('F-010');
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n\n| REQ-001 | a |\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{ id: 'REQ-001', status: 'failing', types: ['functional'], required_categories: ['happy-path'], acceptance: ['ok'], behaviors: [{ id: 'REQ-001-B01', category: 'custom-edge', description: 'x', status: 'failing', acceptance: ['y'] }] }]
    }));
    const errors = [];
    validateRequirementsFile(specDir, errors);
    expect(errors.some(e => e.includes('unknown category custom-edge'))).toBe(true);
  });
});
