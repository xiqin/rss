import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

const childProcessMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: childProcessMock,
  spawnSync: childProcessMock,
}));

let TEST_DIR;

beforeEach(() => {
  childProcessMock.mockClear();
  TEST_DIR = mkdtempSync(join(tmpdir(), 'loom-init-project-command-'));
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('init-project command', () => {
  it('initializes project context through the public loom CLI command', async () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
      name: 'demo-app',
      scripts: { test: 'vitest run' },
    }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: initProjectCommand } = await import('../../src/commands/init-project.js');
    await initProjectCommand({ cwd: TEST_DIR, tools: 'codex', codegraph: false });

    expect(existsSync(join(TEST_DIR, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.loom', 'rules', 'constitution.md'))).toBe(true);
    expect(readFileSync(join(TEST_DIR, 'AGENTS.md'), 'utf8')).toContain('.loom/rules/constitution.md');

    const output = sp.mock.calls.map(call => call[0]).join('\n');
    expect(output).toContain('loom init-project');
    expect(output).toContain('demo-app');
    sp.mockRestore();
  });

  it('keeps the deprecated codegraph option as a no-op without invoking external commands', async () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ name: 'demo-app' }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: initProjectCommand } = await import('../../src/commands/init-project.js');
    await initProjectCommand({ cwd: TEST_DIR, tools: 'codex', codegraph: false });

    expect(existsSync(join(TEST_DIR, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.loom', 'graph.config.json'))).toBe(true);
    expect(childProcessMock).not.toHaveBeenCalled();

    const output = sp.mock.calls.map(call => call[0]).join('\n');
    expect(output).not.toContain('codegraph init');
    expect(output).not.toContain('codegraph:');
    sp.mockRestore();
  });

  it('accepts --no-codegraph through the public CLI parser', async () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ name: 'demo-app' }));
    const fakeBin = join(TEST_DIR, 'bin');
    const codegraphMarker = join(TEST_DIR, 'codegraph-called');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, 'codegraph.cmd'), `@echo off\r\necho called > "${codegraphMarker}"\r\nexit /b 0\r\n`);
    writeFileSync(join(fakeBin, 'codegraph'), `#!/bin/sh\necho called > "${codegraphMarker}"\nexit 0\n`);
    chmodSync(join(fakeBin, 'codegraph'), 0o755);

    const { spawnSync } = await vi.importActual('node:child_process');
    const env = { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH || ''}` };
    if (process.platform === 'win32') env.Path = env.PATH;
    const result = spawnSync(process.execPath, [
      'src/cli.js',
      'init-project',
      '--cwd', TEST_DIR,
      '--tools', 'codex',
      '--no-codegraph',
    ], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('loom init-project');
    expect(existsSync(join(TEST_DIR, 'AGENTS.md'))).toBe(true);
    expect(existsSync(codegraphMarker)).toBe(false);
    expect(childProcessMock).not.toHaveBeenCalled();
  });

  it('accepts Claude Code as a public init-project tool id', async () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
      name: 'demo-app',
    }));

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: initProjectCommand } = await import('../../src/commands/init-project.js');
    await initProjectCommand({ cwd: TEST_DIR, tools: 'claude-code', interactive: false, codegraph: false });

    expect(existsSync(join(TEST_DIR, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'CLAUDE.md'))).toBe(true);
    expect(readFileSync(join(TEST_DIR, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    expect(existsSync(join(TEST_DIR, '.claudeignore'))).toBe(true);

    const output = sp.mock.calls.map(call => call[0]).join('\n');
    expect(output).toContain('claude-code');
    sp.mockRestore();
  });
});
