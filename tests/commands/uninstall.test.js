import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uninstall command', () => {
  it('passes loom root and current project root to adapter.uninstall', async () => {
    const mockAdapter = {
      toolName: 'copilot',
      getUserDir: () => '.copilot',
      getSkillsDir: () => '.copilot/skills',
      getCommandsDir: () => '.copilot/instructions',
      supportsPlugin: () => false,
      uninstall: vi.fn(() => ['  uninstalled']),
    };

    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => mockAdapter,
      USER_TOOL_IDS: ['copilot'],
    }));

    const projectRoot = process.cwd();
    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: uninstall } = await import('../../src/commands/uninstall.js');

    await uninstall({ tool: 'copilot' });

    expect(mockAdapter.uninstall).toHaveBeenCalledTimes(1);
    const [loomRoot, passedProjectRoot] = mockAdapter.uninstall.mock.calls[0];
    expect(loomRoot).toContain('rss');
    expect(passedProjectRoot).toBe(projectRoot);
    sp.mockRestore();
  });
});
