import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkSubagentContextStale } from '../../src/commands/doctor.js';

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
