import { describe, it, expect } from 'vitest';
import { getUserAdapter, USER_TOOL_IDS } from '../../src/core/installer.js';
import { ADAPTER_CONTRACTS, getAdapterContract, IMPLEMENTED_TOOL_IDS, TOOLS } from '../../src/generated/tooling.js';

describe('user adapter registry', () => {
  it('USER_TOOL_IDS includes all expected tools', () => {
    expect(USER_TOOL_IDS).toContain('claude-code');
    expect(USER_TOOL_IDS).toContain('cursor');
    expect(USER_TOOL_IDS).toContain('copilot');
    expect(USER_TOOL_IDS).toContain('opencode');
    expect(USER_TOOL_IDS).toContain('codex');
  });

  it('getUserAdapter returns adapter for "claude-code"', async () => {
    const adapter = await getUserAdapter('claude-code');
    expect(adapter.toolName).toBe('claude-code');
  });

  it('getUserAdapter returns adapter for "cursor"', async () => {
    const adapter = await getUserAdapter('cursor');
    expect(adapter.toolName).toBe('cursor');
  });

  it('getUserAdapter returns adapter for "copilot"', async () => {
    const adapter = await getUserAdapter('copilot');
    expect(adapter.toolName).toBe('copilot');
  });

  it('getUserAdapter returns adapter for "opencode"', async () => {
    const adapter = await getUserAdapter('opencode');
    expect(adapter.toolName).toBe('opencode');
  });

  it('getUserAdapter returns adapter for "codex"', async () => {
    const adapter = await getUserAdapter('codex');
    expect(adapter.toolName).toBe('codex');
  });

  it('getUserAdapter throws for unknown tool', async () => {
    await expect(() => getUserAdapter('unknown')).rejects.toThrow('Unknown tool');
  });

  it('each adapter has getUserDir returning a string', async () => {
    for (const tool of USER_TOOL_IDS) {
      const adapter = await getUserAdapter(tool);
      expect(typeof adapter.getUserDir()).toBe('string');
    }
  });

  it('each adapter has getSkillsDir returning a string (except cursor which uses rules)', async () => {
    for (const tool of USER_TOOL_IDS) {
      const adapter = await getUserAdapter(tool);
      const result = adapter.getSkillsDir();
      if (tool === 'cursor') {
        expect(result).toBeNull();
      } else {
        expect(typeof result).toBe('string');
      }
    }
  });

  it('generated adapter contracts exist for every implemented tool', () => {
    expect(Object.keys(ADAPTER_CONTRACTS).sort()).toEqual(TOOLS.map(t => t.id).sort());
    expect(IMPLEMENTED_TOOL_IDS.sort()).toEqual(USER_TOOL_IDS.sort());

    for (const tool of IMPLEMENTED_TOOL_IDS) {
      const contract = getAdapterContract(tool);
      expect(contract).toBeTruthy();
      expect(contract.capabilities).toBeTruthy();
      expect(Array.isArray(contract.installScopes)).toBe(true);
      expect(contract.installScopes).toContain('user');
      expect(Array.isArray(contract.configSurfaces)).toBe(true);
      expect(contract.configSurfaces.length).toBeGreaterThan(0);
      expect(Array.isArray(contract.managedArtifacts)).toBe(true);
      expect(contract.managedArtifacts.length).toBeGreaterThan(0);
      expect(contract.sideEffects).toBeTruthy();
      expect(Array.isArray(contract.sideEffects.install)).toBe(true);
      expect(contract.sideEffects.install.length).toBeGreaterThan(0);
      expect(Array.isArray(contract.sideEffects.uninstall)).toBe(true);
      expect(contract.sideEffects.uninstall.length).toBeGreaterThan(0);
      expect(Array.isArray(contract.mcpServers)).toBe(true);
      if (contract.capabilities.mcpConfig) {
        expect(contract.mcpServers.length).toBeGreaterThan(0);
      } else {
        expect(contract.mcpServers).toEqual([]);
      }
      expect(contract.permissions).toBeTruthy();
      expect(Array.isArray(contract.permissions.fileSystem)).toBe(true);
      expect(contract.permissions.fileSystem.length).toBeGreaterThan(0);
      expect(Array.isArray(contract.permissions.commands)).toBe(true);
      expect(Array.isArray(contract.hookHandlers)).toBe(true);
      if (contract.capabilities.hooks) {
        expect(contract.hookHandlers.length).toBeGreaterThan(0);
      } else {
        expect(contract.hookHandlers).toEqual([]);
      }
      expect(Array.isArray(contract.directoryLayout)).toBe(true);
      expect(contract.directoryLayout.length).toBeGreaterThan(0);
      expect(contract.versionProbe).toBeTruthy();
      expect(typeof contract.versionProbe.command).toBe('string');
      expect(Array.isArray(contract.versionProbe.args)).toBe(true);
      expect(typeof contract.versionProbe.versionPattern).toBe('string');
    }
  });

  it('adapter contracts describe install and uninstall side effects', () => {
    const copilot = getAdapterContract('copilot');

    expect(copilot.sideEffects.install).toContain('writes user-level ~/.copilot/copilot-instructions.md');
    expect(copilot.sideEffects.install).toContain('creates project-level .github/copilot-instructions.md when absent');
    expect(copilot.sideEffects.install).toContain('creates project-level .github/workflows/copilot-setup-steps.yml when absent');
    expect(copilot.sideEffects.install).toContain('creates project-level .github/workflows/loom-verify.yml when absent');
    expect(copilot.sideEffects.uninstall).toContain('removes generated repository copilot-instructions.md only when marked Generated by loom');
    expect(copilot.sideEffects.uninstall).toContain('removes generated copilot-setup-steps.yml only when marked Generated by loom');
    expect(copilot.sideEffects.uninstall).toContain('removes generated loom-verify.yml only when marked Generated by loom');
  });

  it('adapter contracts describe MCP servers structurally', () => {
    const opencode = getAdapterContract('opencode');
    const codex = getAdapterContract('codex');
    const copilot = getAdapterContract('copilot');

    expect(opencode.mcpServers).toContainEqual({
      id: 'loom',
      type: 'local',
      required: true,
      configPath: 'opencode.json',
      configKey: 'mcp.loom',
    });
    expect(opencode.mcpServers).toContainEqual({
      id: 'codegraph',
      type: 'local',
      required: false,
      configPath: 'opencode.json',
      configKey: 'mcp.codegraph',
    });
    expect(codex.mcpServers).toContainEqual({
      id: 'codegraph',
      type: 'local',
      required: false,
      configPath: 'config.toml',
      configKey: 'mcp_servers.codegraph',
    });
    expect(copilot.mcpServers).toEqual([]);
  });

  it('adapter contracts describe permissions structurally', () => {
    const claude = getAdapterContract('claude-code');
    const copilot = getAdapterContract('copilot');

    expect(claude.permissions.fileSystem).toContainEqual({
      scope: 'user',
      access: 'read-write',
      path: 'settings.json',
      reason: 'manage loom and optional codegraph MCP server entries',
    });
    expect(claude.permissions.commands).toContainEqual({
      phase: 'install',
      access: 'execute',
      command: 'claude plugin marketplace add',
      reason: 'register the local loom plugin marketplace',
    });
    expect(copilot.permissions.fileSystem).toContainEqual({
      scope: 'project',
      access: 'write-if-absent',
      path: '.github/copilot-instructions.md',
      reason: 'create repository-level Copilot custom instructions without overwriting user content',
    });
    expect(copilot.permissions.commands).toEqual([]);
  });

  it('adapter contracts describe hook handlers structurally', () => {
    const claude = getAdapterContract('claude-code');
    const cursor = getAdapterContract('cursor');

    expect(claude.hookHandlers).toContainEqual({
      id: 'session-start',
      event: 'SessionStart',
      handlerType: 'local-script',
      entry: 'handlers/session-start.cjs',
      blocking: false,
      fallback: 'warn',
    });
    expect(claude.hookHandlers).toContainEqual({
      id: 'pre-tool-use-audit',
      event: 'PreToolUse',
      handlerType: 'local-script',
      entry: 'handlers/pre-tool-use-audit.cjs',
      blocking: true,
      fallback: 'error',
    });
    expect(cursor.hookHandlers).toEqual([]);
  });

  it('adapter contracts describe directory layout structurally', () => {
    const cursor = getAdapterContract('cursor');
    const copilot = getAdapterContract('copilot');
    const claude = getAdapterContract('claude-code');

    expect(cursor.directoryLayout).toContainEqual({
      scope: 'user',
      kind: 'skills',
      path: 'rules/',
      pattern: 'loom-*.mdc',
      lifecycle: 'managed',
    });
    expect(copilot.directoryLayout).toContainEqual({
      scope: 'project',
      kind: 'instructions',
      path: '.github/',
      pattern: 'copilot-instructions.md',
      lifecycle: 'write-if-absent',
    });
    expect(copilot.directoryLayout).toContainEqual({
      scope: 'project',
      kind: 'workflow',
      path: '.github/workflows/',
      pattern: 'copilot-setup-steps.yml',
      lifecycle: 'write-if-absent',
    });
    expect(copilot.directoryLayout).toContainEqual({
      scope: 'project',
      kind: 'workflow',
      path: '.github/workflows/',
      pattern: 'loom-verify.yml',
      lifecycle: 'write-if-absent',
    });
    expect(claude.directoryLayout).toContainEqual({
      scope: 'user',
      kind: 'plugins',
      path: 'plugin marketplace',
      pattern: 'loom',
      lifecycle: 'registered',
    });
  });

  it('adapter runtime capabilities match generated contracts', async () => {
    for (const tool of IMPLEMENTED_TOOL_IDS) {
      const adapter = await getUserAdapter(tool);
      const contract = getAdapterContract(tool);

      for (const [capability, expected] of Object.entries(contract.capabilities)) {
        expect(adapter.capabilities[capability], `${tool}.${capability}`).toBe(expected);
      }
    }
  });
});
