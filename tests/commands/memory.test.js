import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_memory_command__');

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('memory command', () => {
  it('adds structured metadata for knowledge retrieval', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: memoryCommand } = await import('../../src/commands/memory.js');

    await memoryCommand('add', {
      cwd: TEST_DIR,
      type: '决策',
      content: '复用 evidence report 作为 PR 摘要',
      author: 'tester',
      tags: 'github,evidence',
      source: 'issue:42',
      confidence: '0.75',
      scope: 'spec',
      expiresAt: '2026-12-31T00:00:00.000Z',
      specDir: 'specs/2026-07-07+pr-evidence',
      pr: '123',
      commit: 'abc1234',
      task: 'T1',
      handoff: 'handoffs/T1.json',
      stage: 'verification',
      files: 'src/core/evidence-store.js,src/commands/pr.js',
    });

    const store = JSON.parse(readFileSync(join(TEST_DIR, '.loom', 'memory', 'store.json'), 'utf-8'));
    expect(store.entries[0]).toMatchObject({
      source: 'issue:42',
      confidence: 0.75,
      scope: 'spec',
      expires_at: '2026-12-31T00:00:00.000Z',
      stage: 'verification',
      tags: ['github', 'evidence'],
      files: ['src/core/evidence-store.js', 'src/commands/pr.js'],
      links: {
        spec: 'specs/2026-07-07+pr-evidence',
        pr: '123',
        commit: 'abc1234',
        task: 'T1',
        handoff: 'handoffs/T1.json',
      },
    });
  });

  it('lists memory by structured knowledge filters', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: memoryCommand } = await import('../../src/commands/memory.js');

    await memoryCommand('add', {
      cwd: TEST_DIR,
      type: '决策',
      content: 'PR evidence uses markdown reports',
      author: 'tester',
      tags: 'github,evidence',
      scope: 'spec',
      specDir: 'specs/a',
      task: 'T1',
      stage: 'verification',
      files: 'src/core/evidence-store.js',
    });
    await memoryCommand('add', {
      cwd: TEST_DIR,
      type: '踩坑',
      content: 'workflow files must not be overwritten',
      author: 'tester',
      tags: 'copilot',
      scope: 'project',
      specDir: 'specs/b',
      task: 'T2',
      stage: 'install',
      files: 'src/adapters/copilot.js',
    });

    const output = [];
    console.log.mockImplementation((line) => output.push(String(line)));

    await memoryCommand('list', {
      cwd: TEST_DIR,
      tag: 'evidence',
      specDir: 'specs/a',
      task: 'T1',
      file: 'src/core/evidence-store.js',
      stage: 'verification',
      limit: '20',
    });

    const text = output.join('\n');
    expect(text).toContain('PR evidence uses markdown reports');
    expect(text).toContain('scope:spec');
    expect(text).toContain('specs/a');
    expect(text).not.toContain('workflow files must not be overwritten');
  });
});
