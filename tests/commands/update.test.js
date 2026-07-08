import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_update__');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('update command', () => {
  it('calls adapter.install for each tool', async () => {
    const mockAdapter = {
      toolName: 'claude-code',
      getUserDir: () => join(TEST_DIR, '.claude'),
      getSkillsDir: () => join(TEST_DIR, '.claude', 'skills'),
      getCommandsDir: () => null,
      supportsPlugin: () => false,
      install: vi.fn(() => ['  skills: 2 copied']),
    };

    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => mockAdapter,
      USER_TOOL_IDS: ['claude-code'],
    }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: update } = await import('../../src/commands/update.js');
    const projectRoot = process.cwd();
    await update({ tool: 'claude-code' });
    expect(mockAdapter.install).toHaveBeenCalledTimes(1);
    const [loomRoot, version, passedProjectRoot] = mockAdapter.install.mock.calls[0];
    expect(loomRoot).toContain('rss');
    expect(version).toBeTruthy();
    expect(passedProjectRoot).toBe(projectRoot);
    sp.mockRestore();
  });

  it('dry-run does not call install', async () => {
    const mockAdapter = {
      toolName: 'cursor',
      getUserDir: () => join(TEST_DIR, '.cursor'),
      getSkillsDir: () => join(TEST_DIR, '.cursor', 'skills'),
      getCommandsDir: () => join(TEST_DIR, '.cursor', 'commands'),
      supportsPlugin: () => false,
      install: vi.fn(),
    };

    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => mockAdapter,
      USER_TOOL_IDS: ['cursor'],
    }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: update } = await import('../../src/commands/update.js');
    await update({ tool: 'cursor', dryRun: true });
    expect(mockAdapter.install).not.toHaveBeenCalled();
    sp.mockRestore();
  });

  it('skips unknown tool', async () => {
    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => { throw new Error('Unknown tool'); },
      USER_TOOL_IDS: ['claude-code'],
    }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: update } = await import('../../src/commands/update.js');
    await update({ tool: 'unknown' });
    const output = sp.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('unknown');
    sp.mockRestore();
  });
});
