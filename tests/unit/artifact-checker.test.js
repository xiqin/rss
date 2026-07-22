import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  parseVerdict, isReportPassing, validateReportEvidence,
  checkStageOutputs, inferStageFromArtifacts
} from '../../src/core/artifact-checker.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-artifact-')); }
const write = (dir, file, content) => writeFileSync(join(dir, file), content, 'utf-8');

describe('parseVerdict', () => {
  it('reads explicit verdict line', () => {
    expect(parseVerdict('verdict: PASS')).toBe('PASS');
    expect(parseVerdict('**Verdict:** FAIL')).toBe('FAIL');
    expect(parseVerdict('> 结论：通过')).toBe('PASS');
    expect(parseVerdict('结论: 失败')).toBe('FAIL');
  });
  it('returns null when no verdict field', () => {
    expect(parseVerdict('some report body without a verdict field')).toBe(null);
  });
  it('ignores the word FAIL inside prose (structured field only)', () => {
    expect(parseVerdict('We must ensure tests never FAIL.\nverdict: PASS')).toBe('PASS');
  });
});

describe('evidence receipts', () => {
  it('requires the on-disk log hash to match', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'evidence'), { recursive: true });
    const log = 'tests passed\n';
    write(dir, 'evidence/test.log', log);
    const hash = createHash('sha256').update(log).digest('hex');
    const report = `verdict: PASS\nevidence-command: npm test\nevidence-exit-code: 0\nevidence-file: evidence/test.log\nevidence-sha256: ${hash}`;
    write(dir, 'test-report.md', report);

    expect(validateReportEvidence(dir, report).ok).toBe(true);
    expect(isReportPassing(dir, 'test-report.md', undefined, { requireEvidence: true })).toBe(true);
    write(dir, 'evidence/test.log', 'changed');
    expect(isReportPassing(dir, 'test-report.md', undefined, { requireEvidence: true })).toBe(false);
  });
});

describe('isReportPassing (test-report)', () => {
  it('structured PASS wins over scary prose', () => {
    const dir = tmp();
    write(dir, 'test-report.md', '确保不会 FAIL 的情况下\n\nverdict: PASS\n');
    expect(isReportPassing(dir, 'test-report.md')).toBe(true);
  });
  it('structured FAIL blocks', () => {
    const dir = tmp();
    write(dir, 'test-report.md', 'verdict: FAIL\n');
    expect(isReportPassing(dir, 'test-report.md')).toBe(false);
  });
  it('falls back to heuristic without a verdict field', () => {
    const dir = tmp();
    write(dir, 'test-report.md', 'All tests PASS, 12 passed.');
    expect(isReportPassing(dir, 'test-report.md')).toBe(true);
  });
  it('false when report missing', () => {
    expect(isReportPassing(tmp(), 'test-report.md')).toBe(false);
  });
});

describe('isReportPassing (verify-report)', () => {
  it('respects structured verdict', () => {
    const dir = tmp();
    write(dir, 'verify-report.md', 'verdict: PASS\nall checks passed');
    expect(isReportPassing(dir, 'verify-report.md')).toBe(true);
  });
});

describe('checkStageOutputs placeholders', () => {
  it('flags uppercase TODO/TBD and {{VAR}}', () => {
    const dir = tmp();
    write(dir, 'spec.md', '# Spec\nTODO finish this');
    expect(checkStageOutputs(dir, ['spec.md']).withPlaceholders).toContain('spec.md');

    const dir2 = tmp();
    write(dir2, 'spec.md', 'see {{FEATURE_NAME}}');
    expect(checkStageOutputs(dir2, ['spec.md']).withPlaceholders).toContain('spec.md');
  });

  it('does NOT flag lowercase "todo" prose or time format HH:mm (regression)', () => {
    const dir = tmp();
    write(dir, 'spec.md', '# Spec\nUser sees a todo list at HH:mm format. Complete spec.');
    const r = checkStageOutputs(dir, ['spec.md']);
    expect(r.withPlaceholders).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('accepts directory outputs without reading them as files', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    write(dir, 'tasks/T1.md', 'TODO inside task file is not checked through directory output');

    const r = checkStageOutputs(dir, ['tasks/']);
    expect(r.ok).toBe(true);
    expect(r.missing).toHaveLength(0);
    expect(r.withPlaceholders).toHaveLength(0);
  });
});

describe('inferStageFromArtifacts', () => {
  it('returns executing when task-states dir is non-empty', () => {
    const dir = tmp();
    write(dir, 'spec.md', 'x'); write(dir, 'plan.md', 'x');
    mkdirSync(join(dir, 'task-states'), { recursive: true });
    write(dir, 'task-states/T1.state.json', '{"task_id":"T1"}');
    expect(inferStageFromArtifacts(dir)).toBe('executing');
  });

  it('does NOT return executing just because progress.md mentions the word (regression)', () => {
    const dir = tmp();
    write(dir, 'spec.md', 'x'); write(dir, 'plan.md', 'x');
    write(dir, 'progress.md', '| T1 | executing | ...');
    expect(inferStageFromArtifacts(dir)).toBe('analyze-artifacts');
  });

  it('maps artifacts to early stages', () => {
    const d1 = tmp(); write(d1, 'spec.md', 'x');
    expect(inferStageFromArtifacts(d1)).toBe('detail-expansion');
    expect(inferStageFromArtifacts(tmp())).toBe('brainstorming');
  });

  it('does not infer downstream stages from failed reports', () => {
    const blocked = tmp();
    write(blocked, 'spec.md', 'x');
    write(blocked, 'plan.md', 'x');
    write(blocked, 'artifact-analysis.json', '{"status":"blocked","blocker_count":1}');
    expect(inferStageFromArtifacts(blocked)).toBe('analyze-artifacts');

    const needsRound = tmp();
    write(needsRound, 'spec.md', 'x');
    write(needsRound, 'plan.md', 'x');
    write(needsRound, 'test-report.md', 'verdict: PASS');
    write(needsRound, 'convergence-report.json', '{"status":"needs_another_round","blocker_count":1}');
    expect(inferStageFromArtifacts(needsRound)).toBe('converge');

    const failedVerify = tmp();
    write(failedVerify, 'verify-report.md', 'verdict: FAIL');
    expect(inferStageFromArtifacts(failedVerify)).toBe('brainstorming');
  });
});
