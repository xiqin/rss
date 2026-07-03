import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePlan } from '../../skills/loom-writing-plans/scripts/validate-plan.mjs';
import { verifyArtifacts } from '../../skills/loom-verification-before-completion/scripts/verify-artifacts.mjs';
import { validateIndex } from '../../skills/loom-index-update/scripts/validate-index.mjs';

const TMP_ROOT = join(import.meta.dirname, '__test_workflow_scripts__');

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
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

  it('checks verification artifacts before completion', () => {
    const specDir = join(TMP_ROOT, 'specs', 'verified-feature');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n');
    writeFileSync(join(specDir, 'progress.md'), 'Step 5 complete at 14:30\n');
    mkdirSync(join(specDir, 'evidence'), { recursive: true });
    const log = '1 test passed\n';
    writeFileSync(join(specDir, 'evidence', 'test.log'), log);
    const hash = createHash('sha256').update(log).digest('hex');
    writeFileSync(join(specDir, 'test-report.md'), `verdict: PASS\nevidence-command: npm test\nevidence-exit-code: 0\nevidence-file: evidence/test.log\nevidence-sha256: ${hash}\n`);

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

function writeTask(specDir, number, deps) {
  writeFileSync(join(specDir, 'tasks', `T${number}.md`), `---
owns: [src/example-${number}.js]
reads: []
depends_on: []
requirements: [REQ-001]
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
