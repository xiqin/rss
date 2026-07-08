import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_pr_command__');

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, '.loom', 'compliance'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function seed(records) {
  writeFileSync(join(TEST_DIR, '.loom', 'compliance', 'history.json'), JSON.stringify(records, null, 2), 'utf-8');
}

describe('pr command', () => {
  it('writes a markdown evidence summary for pull requests', async () => {
    seed([
      {
        timestamp: '2026-07-07T10:00:00.000Z',
        stage: 'verification',
        skill: 'loom-verification-before-completion',
        passed: true,
        risk: 'low',
        violations: [],
      },
    ]);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: prCommand } = await import('../../src/commands/pr.js');
    const result = await prCommand('evidence', { cwd: TEST_DIR });

    expect(result.path).toBe(join(TEST_DIR, '.loom', 'evidence', 'pr-evidence.md'));
    expect(existsSync(result.path)).toBe(true);
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('# Loom Evidence Report');
    expect(content).toContain('verification');
    expect(content).toContain('PASS');
  });

  it('supports spec filtering for pull request evidence', async () => {
    seed([
      { timestamp: '2026-07-07T10:00:00.000Z', spec_dir: 'specs/a', stage: 'verification', passed: true },
      { timestamp: '2026-07-07T10:01:00.000Z', spec_dir: 'specs/b', stage: 'hook:PostToolUse', passed: false, risk: 'medium', violations: ['failed'] },
    ]);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: prCommand } = await import('../../src/commands/pr.js');
    const result = await prCommand('evidence', { cwd: TEST_DIR, specDir: 'specs/a' });

    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('specs/a');
    expect(content).not.toContain('specs/b');
  });
});
