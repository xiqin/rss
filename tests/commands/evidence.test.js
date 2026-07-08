import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_evidence__');

beforeEach(() => {
  mkdirSync(join(TEST_DIR, '.loom', 'compliance'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function seed(records) {
  writeFileSync(join(TEST_DIR, '.loom', 'compliance', 'history.json'), JSON.stringify(records, null, 2), 'utf-8');
}

describe('evidence command', () => {
  it('prints JSON evidence with summary', async () => {
    seed([
      {
        timestamp: '2026-07-07T10:00:00.000Z',
        stage: 'hook:PostToolUse',
        skill: 'post-tool-use-audit',
        passed: false,
        risk: 'medium',
        violations: ['Build failed'],
        tool_use: { tool: 'bash', exit_code: 1, success: false, error_summary: 'Build failed' },
      },
    ]);

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: evidence } = await import('../../src/commands/evidence.js');
    await evidence({ cwd: TEST_DIR, json: true });

    const out = JSON.parse(sp.mock.calls[0][0]);
    expect(out.summary.total).toBe(1);
    expect(out.summary.verdicts.FAIL).toBe(1);
    expect(out.evidence[0]).toMatchObject({ type: 'tool_use', verdict: 'FAIL', risk: 'medium' });
  });

  it('prints JSON Lines output', async () => {
    seed([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'hook:UserPromptSubmit', skill: 'user-prompt-audit', passed: true, risk: 'low', prompt: { text: 'Continue' } },
    ]);

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: evidence } = await import('../../src/commands/evidence.js');
    await evidence({ cwd: TEST_DIR, jsonl: true });

    expect(JSON.parse(sp.mock.calls[0][0])).toMatchObject({ type: 'user_prompt', verdict: 'PASS' });
  });

  it('prints an empty text view when no evidence exists', async () => {
    rmSync(join(TEST_DIR, '.loom', 'compliance', 'history.json'), { force: true });
    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: evidence } = await import('../../src/commands/evidence.js');
    await evidence({ cwd: TEST_DIR });

    const output = sp.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('loom evidence');
    expect(output).toContain('(no evidence found)');
  });

  it('writes evidence export files instead of printing evidence payloads', async () => {
    seed([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', skill: 'loom-verification-before-completion', passed: true, violations: [] },
    ]);

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { readFileSync } = await import('node:fs');
    const { default: evidence } = await import('../../src/commands/evidence.js');
    await evidence({ cwd: TEST_DIR, out: '.loom/evidence/evidence.json' });

    const notice = sp.mock.calls[0][0];
    expect(notice).toContain('Wrote evidence export');
    const out = JSON.parse(readFileSync(join(TEST_DIR, '.loom', 'evidence', 'evidence.json'), 'utf-8'));
    expect(out.evidence[0]).toMatchObject({ type: 'verification', verdict: 'PASS' });
  });

  it('writes Markdown and HTML report exports', async () => {
    seed([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'hook:PostToolUse', skill: 'post-tool-use-audit', passed: false, risk: 'medium', violations: ['Build failed'], tool_use: { tool: 'bash' } },
    ]);

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { readFileSync } = await import('node:fs');
    const { default: evidence } = await import('../../src/commands/evidence.js');
    await evidence({ cwd: TEST_DIR, out: '.loom/evidence/report.md', format: 'markdown' });
    await evidence({ cwd: TEST_DIR, out: '.loom/evidence/report.html', format: 'html' });

    expect(sp.mock.calls).toHaveLength(2);
    expect(readFileSync(join(TEST_DIR, '.loom', 'evidence', 'report.md'), 'utf-8')).toContain('# Loom Evidence Report');
    expect(readFileSync(join(TEST_DIR, '.loom', 'evidence', 'report.html'), 'utf-8')).toContain('<title>Loom Evidence Report</title>');
  });

  it('prints trend metrics as JSON', async () => {
    seed([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'hook:PostToolUse', skill: 'post-tool-use-audit', passed: false, risk: 'medium', violations: ['Build failed'], tool_use: { duration_ms: 1000 } },
      { timestamp: '2026-07-07T10:01:00.000Z', stage: 'hook:TaskCompleted', skill: 'task-completed-audit', passed: true, risk: 'low', task: { duration_ms: 500 } },
    ]);

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: evidence } = await import('../../src/commands/evidence.js');
    await evidence({ cwd: TEST_DIR, trends: true, top: '3' });

    const trends = JSON.parse(sp.mock.calls[0][0]);
    expect(trends.total).toBe(2);
    expect(trends.rates.fail).toBe(0.5);
    expect(trends.average_duration_ms).toBe(750);
    expect(trends.failure_reasons).toEqual([{ reason: 'Build failed', count: 1 }]);
  });

  it('writes trend metrics export files', async () => {
    seed([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', skill: 'loom-verification-before-completion', passed: true, violations: [] },
    ]);

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { readFileSync } = await import('node:fs');
    const { default: evidence } = await import('../../src/commands/evidence.js');
    await evidence({ cwd: TEST_DIR, trends: true, out: '.loom/evidence/trends.json' });

    expect(sp.mock.calls[0][0]).toContain('Wrote evidence trends');
    const trends = JSON.parse(readFileSync(join(TEST_DIR, '.loom', 'evidence', 'trends.json'), 'utf-8'));
    expect(trends).toMatchObject({ total: 1, verdicts: { PASS: 1, WARN: 0, FAIL: 0 } });
  });
});
