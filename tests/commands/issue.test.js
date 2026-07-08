import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_issue_command__');

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('issue command', () => {
  it('imports a GitHub issue into an initial spec', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: issueCommand } = await import('../../src/commands/issue.js');

    const result = await issueCommand('import', {
      cwd: TEST_DIR,
      date: '2026-07-07',
      number: '42',
      title: 'Add login audit trail',
      body: 'Admins need to review login attempts from the security page.',
      url: 'https://github.com/acme/app/issues/42',
    });

    expect(result.specDir).toBe(join(TEST_DIR, 'specs', '2026-07-07+add-login-audit-trail'));
    const specPath = join(result.specDir, 'spec.md');
    expect(existsSync(specPath)).toBe(true);

    const content = readFileSync(specPath, 'utf-8');
    expect(content).toContain('# Add login audit trail');
    expect(content).toContain('GitHub Issue #42');
    expect(content).toContain('https://github.com/acme/app/issues/42');
    expect(content).toContain('Admins need to review login attempts from the security page.');
    expect(content).toContain('## Acceptance Criteria');
  });

  it('does not overwrite an existing issue spec unless forced', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const specDir = join(TEST_DIR, 'specs', '2026-07-07+add-login-audit-trail');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Existing Spec\n', 'utf-8');
    const { default: issueCommand } = await import('../../src/commands/issue.js');

    await expect(issueCommand('import', {
      cwd: TEST_DIR,
      date: '2026-07-07',
      title: 'Add login audit trail',
      body: 'New body',
    })).rejects.toThrow('already exists');

    expect(readFileSync(join(specDir, 'spec.md'), 'utf-8')).toBe('# Existing Spec\n');
  });

  it('sanitizes custom slugs and validates custom dates', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: issueCommand } = await import('../../src/commands/issue.js');

    const result = await issueCommand('import', {
      cwd: TEST_DIR,
      date: '2026-07-07',
      slug: '../Unsafe Slug!!',
      title: 'Unsafe title',
      body: 'Body',
    });

    expect(result.specDir).toBe(join(TEST_DIR, 'specs', '2026-07-07+unsafe-slug'));
    expect(existsSync(join(result.specDir, 'spec.md'))).toBe(true);

    await expect(issueCommand('import', {
      cwd: TEST_DIR,
      date: '../2026-07-07',
      title: 'Bad date',
      body: 'Body',
    })).rejects.toThrow('Invalid issue date');
  });

  it('reads relative body files from cwd', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(join(TEST_DIR, 'issue-body.md'), 'Body from file\n', 'utf-8');
    const { default: issueCommand } = await import('../../src/commands/issue.js');

    const result = await issueCommand('import', {
      cwd: TEST_DIR,
      date: '2026-07-07',
      title: 'Body File',
      bodyFile: 'issue-body.md',
    });

    const content = readFileSync(join(result.specDir, 'spec.md'), 'utf-8');
    expect(content).toContain('Body from file');
  });
});
