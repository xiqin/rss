import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkSubagentContextStale, diagnoseVersionProbe, getAdapterContractDiagnostics } from '../../src/commands/doctor.js';

const TEST_DIR = join(import.meta.dirname, '__test_doctor__');

beforeEach(() => {
  vi.resetModules();
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('doctor command', () => {
  it('reports no installation when no skills exist', async () => {
    const mockAdapter = {
      toolName: 'claude-code',
      getUserDir: () => join(TEST_DIR, '.claude'),
      getSkillsDir: () => join(TEST_DIR, '.claude', 'skills'),
      getCommandsDir: () => null,
      supportsPlugin: () => false,
      capabilities: { hooks: true, skills: false, commands: false, plugin: true, mcpConfig: true },
    };

    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => mockAdapter,
      USER_TOOL_IDS: ['claude-code'],
    }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: doctor } = await import('../../src/commands/doctor.js');
    await doctor({ tool: 'claude-code' });
    const output = sp.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No loom installation detected');
    sp.mockRestore();
  });

  it('reports skills when they exist', async () => {
    const skillsDir = join(TEST_DIR, '.claude', 'skills', 'test-skill');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'SKILL.md'), '# Test');

    const mockAdapter = {
      toolName: 'claude-code',
      getUserDir: () => join(TEST_DIR, '.claude'),
      getSkillsDir: () => join(TEST_DIR, '.claude', 'skills'),
      getCommandsDir: () => null,
      supportsPlugin: () => false,
      capabilities: { hooks: true, skills: false, commands: false, plugin: true, mcpConfig: true },
    };

    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => mockAdapter,
      USER_TOOL_IDS: ['claude-code'],
    }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: doctor } = await import('../../src/commands/doctor.js');
    await doctor({ tool: 'claude-code' });
    const output = sp.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('loom doctor');
    expect(output).toContain('1 skill(s)');
    expect(output).toContain('contract: ✓ capabilities match');
    expect(output).toContain('config surfaces: settings.json, .claudeignore, plugin marketplace');
    expect(output).toContain('managed artifacts: plugin registration, mcpServers.loom, mcpServers.codegraph, .claudeignore');
    expect(output).toContain('install side effects:');
    expect(output).toContain('uninstall side effects:');
    expect(output).toContain('mcp servers: loom local required @ settings.json#mcpServers.loom; codegraph local optional @ settings.json#mcpServers.codegraph');
    expect(output).toContain('directory layout: plugins user plugin marketplace/loom registered; config user ./settings.json managed; ignore user ./.claudeignore generated-if-managed');
    expect(output).toContain('permissions: fs read-write user settings.json; fs write-if-managed user .claudeignore');
    expect(output).toContain('cmd execute install claude plugin marketplace add');
    expect(output).toContain('cmd execute uninstall claude plugin uninstall');
    expect(output).toContain('hook handlers: SessionStart:session-start local-script optional warn; PreToolUse:pre-tool-use-audit local-script blocking error');
    sp.mockRestore();
  });

  it('reports cursor mdc files as skills', async () => {
    const rulesDir = join(TEST_DIR, '.cursor', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'loom-test-skill.mdc'), 'test');

    const mockAdapter = {
      toolName: 'cursor',
      getUserDir: () => join(TEST_DIR, '.cursor'),
      getRulesDir: () => rulesDir,
      supportsPlugin: () => false,
    };

    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => mockAdapter,
      USER_TOOL_IDS: ['cursor'],
    }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: doctor } = await import('../../src/commands/doctor.js');
    await doctor({ tool: 'cursor' });
    const output = sp.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('loom doctor');
    expect(output).toContain('1 skill(s)');
    sp.mockRestore();
  });

  it('outputs machine-readable JSON diagnostics', async () => {
    const skillsDir = join(TEST_DIR, '.claude', 'skills', 'test-skill');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'SKILL.md'), '# Test');
    mkdirSync(join(TEST_DIR, '.loom', 'rules'), { recursive: true });
    mkdirSync(join(TEST_DIR, '.loom', 'memory'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.loom', 'rules', 'constitution.md'), '# Rules');
    writeFileSync(join(TEST_DIR, '.loom', 'workflow.yaml'), 'steps: []\n');
    writeFileSync(join(TEST_DIR, '.loom', 'memory', 'MEMORY.md'), '# Memory');

    const mockAdapter = {
      toolName: 'claude-code',
      getUserDir: () => join(TEST_DIR, '.claude'),
      getSkillsDir: () => join(TEST_DIR, '.claude', 'skills'),
      getCommandsDir: () => null,
      supportsPlugin: () => false,
      capabilities: { hooks: true, skills: false, commands: false, plugin: true, mcpConfig: true },
    };

    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => mockAdapter,
      USER_TOOL_IDS: ['claude-code'],
    }));

    vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: doctor } = await import('../../src/commands/doctor.js');
    await doctor({ tool: 'claude-code', json: true });

    expect(sp).toHaveBeenCalledTimes(1);
    const report = JSON.parse(sp.mock.calls[0][0]);
    expect(report.schema).toBe('loom.doctor.v1');
    expect(report.project.root).toBe(TEST_DIR);
    expect(report.project.exists).toBe(true);
    expect(report.project.health.constitution.status).toBe('ok');
    expect(report.project.health.workflow.status).toBe('ok');
    expect(report.project.health.memory.status).toBe('ok');
    expect(report.tools[0].id).toBe('claude-code');
    expect(report.tools[0].installed).toBe(true);
    expect(report.tools[0].skills.count).toBe(1);
    expect(report.tools[0].contract.capabilitiesMatch).toBe(true);
    sp.mockRestore();
  });

  it('writes a non-mutating doctor fix plan', async () => {
    mkdirSync(join(TEST_DIR, '.loom', 'rules'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.loom', 'rules', 'constitution.md'), '# {{PROJECT_NAME}}');

    const mockAdapter = {
      toolName: 'claude-code',
      getUserDir: () => join(TEST_DIR, '.claude'),
      getSkillsDir: () => join(TEST_DIR, '.claude', 'skills'),
      getCommandsDir: () => null,
      supportsPlugin: () => false,
      capabilities: { hooks: true, skills: false, commands: false, plugin: true, mcpConfig: true },
    };

    vi.doMock('../../src/core/installer.js', () => ({
      getUserAdapter: async () => mockAdapter,
      USER_TOOL_IDS: ['claude-code'],
    }));

    vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: doctor } = await import('../../src/commands/doctor.js');
    const result = await doctor({ tool: 'claude-code', fixPlan: true, json: true });

    const planPath = join(TEST_DIR, '.loom', 'doctor', 'fix-plan.json');
    expect(result.fixPlan.path).toBe(planPath);
    expect(existsSync(planPath)).toBe(true);
    expect(existsSync(join(TEST_DIR, '.loom', 'workflow.yaml'))).toBe(false);

    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    expect(plan.schema).toBe('loom.doctor-fix-plan.v1');
    expect(plan.safety).toMatchObject({ autoApply: false, mutatesFiles: false, requiresReview: true });
    expect(plan.actions).toContainEqual(expect.objectContaining({
      id: 'install-claude-code',
      command: 'loom install --tool claude-code',
      risk: 'medium',
    }));
    expect(plan.actions).toContainEqual(expect.objectContaining({
      id: 'render-constitution',
      status: 'manual-review',
      target: join(TEST_DIR, '.loom', 'rules', 'constitution.md'),
    }));
    expect(plan.actions).toContainEqual(expect.objectContaining({
      id: 'create-workflow',
      command: 'loom init-project',
    }));
    expect(plan.actions).toContainEqual(expect.objectContaining({
      id: 'create-memory',
      command: 'loom init-project',
    }));
    expect(sp).toHaveBeenCalledTimes(1);
    const output = JSON.parse(sp.mock.calls[0][0]);
    expect(output.fixPlan.schema).toBe('loom.doctor-fix-plan.v1');
    sp.mockRestore();
  });

  it('diagnoses adapter contract capability mismatches', () => {
    const diagnostics = getAdapterContractDiagnostics('copilot', {
      capabilities: {
        hooks: false,
        skills: true,
        commands: true,
        plugin: false,
        mcpConfig: false,
        globalInstructions: true,
      },
    });

    expect(diagnostics.capabilitiesMatch).toBe(false);
    expect(diagnostics.mismatches).toContain('templates: expected true, got undefined');
  });

  it('diagnoses adapter contract version probes', () => {
    const diagnostics = getAdapterContractDiagnostics('opencode', {
      capabilities: {
        hooks: false,
        skills: true,
        commands: true,
        plugin: true,
        mcpConfig: true,
        templates: true,
      },
    }, {
      runVersionProbe: () => 'opencode 1.2.3',
    });

    expect(diagnostics.version.status).toBe('ok');
    expect(diagnostics.version.version).toBe('1.2.3');
  });

  it('reports unavailable and outdated version probes', () => {
    const unavailable = diagnoseVersionProbe({
      command: 'missing-tool',
      args: ['--version'],
      installHint: 'Install missing-tool.',
    }, () => {
      throw new Error('not found');
    });
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.message).toBe('Install missing-tool.');

    const outdated = diagnoseVersionProbe({
      command: 'tool',
      args: ['--version'],
      versionPattern: '(\\d+\\.\\d+\\.\\d+)',
      minimumVersion: '2.0.0',
    }, () => 'tool 1.5.0');
    expect(outdated.status).toBe('outdated');
    expect(outdated.version).toBe('1.5.0');
    expect(outdated.message).toContain('below recommended 2.0.0');
  });
});

describe('checkSubagentContextStale', () => {
  function seed(loomDir, { ctx = true, constitution = true } = {}) {
    mkdirSync(join(loomDir, 'contexts'), { recursive: true });
    mkdirSync(join(loomDir, 'rules'), { recursive: true });
    if (ctx) writeFileSync(join(loomDir, 'contexts', 'subagent-context.md'), '# ctx');
    if (constitution) writeFileSync(join(loomDir, 'rules', 'constitution.md'), '# 宪章');
  }

  it('returns exists:false when subagent-context.md missing', () => {
    const loomDir = join(TEST_DIR, '.loom');
    seed(loomDir, { ctx: false });
    expect(checkSubagentContextStale(loomDir)).toEqual({ exists: false });
  });

  it('not stale when constitution older than subagent-context', () => {
    const loomDir = join(TEST_DIR, '.loom');
    seed(loomDir);
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(loomDir, 'rules', 'constitution.md'), old, old);
    const r = checkSubagentContextStale(loomDir);
    expect(r.exists).toBe(true);
    expect(r.stale).toBe(false);
  });

  it('stale when constitution newer than subagent-context', () => {
    const loomDir = join(TEST_DIR, '.loom');
    seed(loomDir);
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(loomDir, 'contexts', 'subagent-context.md'), old, old);
    const r = checkSubagentContextStale(loomDir);
    expect(r.stale).toBe(true);
  });

  it('not stale when constitution missing', () => {
    const loomDir = join(TEST_DIR, '.loom');
    seed(loomDir, { constitution: false });
    expect(checkSubagentContextStale(loomDir)).toEqual({ exists: true, stale: false });
  });

  it('uses the embedded constitution hash instead of timestamp ordering', () => {
    const loomDir = join(TEST_DIR, '.loom-hash');
    mkdirSync(join(loomDir, 'rules'), { recursive: true });
    mkdirSync(join(loomDir, 'contexts'), { recursive: true });
    const constitution = '# rules\n';
    const hash = createHash('sha256').update(constitution).digest('hex');
    writeFileSync(join(loomDir, 'rules', 'constitution.md'), constitution);
    writeFileSync(join(loomDir, 'contexts', 'subagent-context.md'), `constitution-sha256: ${hash}\n`);
    expect(checkSubagentContextStale(loomDir).stale).toBe(false);

    writeFileSync(join(loomDir, 'rules', 'constitution.md'), '# changed rules\n');
    expect(checkSubagentContextStale(loomDir).stale).toBe(true);
  });
});
