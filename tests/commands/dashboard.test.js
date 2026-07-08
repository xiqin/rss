import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_dashboard__');

beforeEach(() => {
  mkdirSync(join(TEST_DIR, '.loom', 'compliance'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.loom', 'memory'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function seedHistory(records, root = TEST_DIR) {
  mkdirSync(join(root, '.loom', 'compliance'), { recursive: true });
  writeFileSync(join(root, '.loom', 'compliance', 'history.json'), JSON.stringify(records, null, 2), 'utf-8');
}

function seedMemory(entries, root = TEST_DIR) {
  mkdirSync(join(root, '.loom', 'memory'), { recursive: true });
  writeFileSync(join(root, '.loom', 'memory', 'store.json'), JSON.stringify({ entries, sessions: [] }, null, 2), 'utf-8');
}

describe('dashboard command', () => {
  it('writes a team dashboard HTML report from evidence and memory', async () => {
    seedHistory([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', skill: 'loom-verification-before-completion', passed: true, risk: 'low', spec_dir: 'specs/a', violations: [] },
      { timestamp: '2026-07-07T10:01:00.000Z', stage: 'hook:PostToolUse', skill: 'post-tool-use-audit', passed: false, risk: 'medium', spec_dir: 'specs/a', violations: ['Build failed'], tool_use: { tool: 'bash', duration_ms: 1000 } },
    ]);
    seedMemory([
      {
        id: 'm1',
        type: 'decision',
        content: 'Use policy check before publishing.',
        scope: 'project',
        stage: 'governance',
        tags: ['policy'],
        links: { spec: 'specs/a' },
        files: ['src/commands/policy.js'],
        created_at: '2026-07-07T09:00:00.000Z',
      },
    ]);

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: dashboardCommand } = await import('../../src/commands/dashboard.js');
    const result = await dashboardCommand({ cwd: TEST_DIR });

    expect(result.path).toBe(join(TEST_DIR, '.loom', 'reports', 'team-dashboard.html'));
    const html = readFileSync(result.path, 'utf-8');
    expect(html).toContain('<title>Loom Team Dashboard</title>');
    expect(html).toContain('Evidence total');
    expect(html).toContain('Fail rate');
    expect(html).toContain('50%');
    expect(html).toContain('Build failed');
    expect(html).toContain('Use policy check before publishing.');
    expect(html).toContain('specs/a');
    expect(sp.mock.calls[0][0]).toContain('Wrote team dashboard');
  });

  it('supports spec filtering and custom output paths', async () => {
    seedHistory([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', passed: true, risk: 'low', spec_dir: 'specs/a', violations: [] },
      { timestamp: '2026-07-07T10:01:00.000Z', stage: 'verification', passed: false, risk: 'high', spec_dir: 'specs/b', violations: ['Wrong spec'] },
    ]);
    seedMemory([
      { id: 'm1', type: 'note', content: 'Spec A memory', scope: 'spec', links: { spec: 'specs/a' }, created_at: '2026-07-07T09:00:00.000Z' },
      { id: 'm2', type: 'note', content: 'Spec B memory', scope: 'spec', links: { spec: 'specs/b' }, created_at: '2026-07-07T09:01:00.000Z' },
    ]);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: dashboardCommand } = await import('../../src/commands/dashboard.js');
    const result = await dashboardCommand({ cwd: TEST_DIR, specDir: 'specs/a', out: 'dashboard.html' });

    expect(result.path).toBe(join(TEST_DIR, 'dashboard.html'));
    const html = readFileSync(result.path, 'utf-8');
    expect(html).toContain('Spec A memory');
    expect(html).toContain('specs/a');
    expect(html).not.toContain('Spec B memory');
    expect(html).not.toContain('Wrong spec');
  });

  it('calculates trend rates from all matching evidence, not only the recent display limit', async () => {
    seedHistory([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', passed: true, risk: 'low', spec_dir: 'specs/a', violations: [] },
      { timestamp: '2026-07-07T10:01:00.000Z', stage: 'verification', passed: false, risk: 'high', spec_dir: 'specs/a', violations: ['Latest failure'] },
    ]);
    seedMemory([]);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: dashboardCommand } = await import('../../src/commands/dashboard.js');
    const result = await dashboardCommand({ cwd: TEST_DIR, limit: 1 });

    const html = readFileSync(result.path, 'utf-8');
    expect(html).toContain('Latest failure');
    expect(html).toContain('<article class="panel metric"><span>Evidence total</span><strong>2</strong></article>');
    expect(html).toContain('<article class="panel metric fail"><span>Fail rate</span><strong>50%</strong></article>');
  });

  it('aggregates evidence and memory across repositories', async () => {
    const repoA = join(TEST_DIR, 'repo-a');
    const repoB = join(TEST_DIR, 'repo-b');
    seedHistory([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', passed: true, risk: 'low', spec_dir: 'specs/a', violations: [] },
    ], repoA);
    seedHistory([
      { timestamp: '2026-07-07T10:01:00.000Z', stage: 'verification', passed: false, risk: 'high', spec_dir: 'specs/b', violations: ['Repo B failed'] },
    ], repoB);
    seedMemory([
      { id: 'm1', type: 'note', content: 'Repo A learning', links: { spec: 'specs/a' }, created_at: '2026-07-07T09:00:00.000Z' },
    ], repoA);
    seedMemory([
      { id: 'm2', type: 'note', content: 'Repo B learning', links: { spec: 'specs/b' }, created_at: '2026-07-07T09:01:00.000Z' },
    ], repoB);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: dashboardCommand } = await import('../../src/commands/dashboard.js');
    const result = await dashboardCommand({ cwd: TEST_DIR, repos: [repoA, repoB], out: 'cross-repo.html' });

    expect(result.repositories).toHaveLength(2);
    const html = readFileSync(result.path, 'utf-8');
    expect(html).toContain('Repositories');
    expect(html).toContain('repo-a');
    expect(html).toContain('repo-b');
    expect(html).toContain('Evidence total');
    expect(html).toContain('50%');
    expect(html).toContain('Repo B failed');
    expect(html).toContain('Repo A learning');
    expect(html).toContain('Repo B learning');
  });

  it('writes static web dashboard assets with refresh metadata', async () => {
    seedHistory([
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', passed: true, risk: 'low', spec_dir: 'specs/a', violations: [] },
    ]);
    seedMemory([
      { id: 'm1', type: 'note', content: 'Live dashboard memory', links: { spec: 'specs/a' }, created_at: '2026-07-07T09:00:00.000Z' },
    ]);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: dashboardCommand } = await import('../../src/commands/dashboard.js');
    const result = await dashboardCommand({ cwd: TEST_DIR, web: true, refresh: 30 });

    expect(result.dataPath).toBe(join(TEST_DIR, '.loom', 'reports', 'team-dashboard.json'));
    const html = readFileSync(result.path, 'utf-8');
    expect(html).toContain('data-dashboard-json="team-dashboard.json"');
    expect(html).toContain('data-refresh-seconds="30"');
    expect(html).toContain('fetch(jsonPath');
    const payload = JSON.parse(readFileSync(result.dataPath, 'utf-8'));
    expect(payload.schema).toBe('loom.dashboard.v1');
    expect(payload.summary.total).toBe(1);
    expect(payload.memory[0].content).toBe('Live dashboard memory');
    expect(payload.refreshSeconds).toBe(30);
  });
});
