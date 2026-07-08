import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_policy_command__');

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, '.loom'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writePolicy(policy) {
  writeFileSync(join(TEST_DIR, '.loom', 'policy.json'), JSON.stringify(policy, null, 2), 'utf-8');
}

describe('policy command', () => {
  it('fails when scanned files match sensitive paths or secret patterns', async () => {
    writePolicy({
      sensitivePaths: ['.env', 'config/production.json'],
      secretPatterns: [
        { id: 'api-key', pattern: 'API_KEY\\s*=' },
      ],
    });
    writeFileSync(join(TEST_DIR, '.env'), 'API_KEY=super-secret\n', 'utf-8');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: policyCommand } = await import('../../src/commands/policy.js');
    const result = await policyCommand('check', { cwd: TEST_DIR, files: '.env' });

    expect(result.verdict).toBe('FAIL');
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'sensitive-path', path: '.env' }),
      expect.objectContaining({ rule: 'secret-pattern', id: 'api-key', path: '.env' }),
    ]));
    expect(existsSync(join(TEST_DIR, '.loom', 'compliance', 'policy-audit.jsonl'))).toBe(true);

    const records = readFileSync(join(TEST_DIR, '.loom', 'compliance', 'policy-audit.jsonl'), 'utf-8').trim().split('\n').map(JSON.parse);
    expect(records[0]).toMatchObject({ type: 'policy_check', verdict: 'FAIL', risk: 'high' });
    expect(records[0].violations).toHaveLength(2);
  });

  it('passes clean files and supports custom audit output', async () => {
    writePolicy({
      sensitivePaths: ['.env'],
      secretPatterns: [{ id: 'token', pattern: 'TOKEN\\s*=' }],
    });
    mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'src', 'app.js'), 'const mode = "test";\n', 'utf-8');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: policyCommand } = await import('../../src/commands/policy.js');
    const result = await policyCommand('check', {
      cwd: TEST_DIR,
      files: 'src/app.js',
      out: '.loom/compliance/custom-policy.jsonl',
    });

    expect(result.verdict).toBe('PASS');
    expect(result.violations).toEqual([]);
    const record = JSON.parse(readFileSync(join(TEST_DIR, '.loom', 'compliance', 'custom-policy.jsonl'), 'utf-8').trim());
    expect(record).toMatchObject({ type: 'policy_check', verdict: 'PASS', risk: 'low' });
  });

  it('honors absolute policy and audit output paths', async () => {
    const policyPath = join(TEST_DIR, 'custom-policy.json');
    const auditPath = join(TEST_DIR, 'audit', 'policy.jsonl');
    writeFileSync(policyPath, JSON.stringify({
      sensitivePaths: ['secrets.txt'],
      secretPatterns: [{ id: 'password', pattern: 'PASSWORD\\s*=' }],
    }), 'utf-8');
    writeFileSync(join(TEST_DIR, 'secrets.txt'), 'PASSWORD=hidden\n', 'utf-8');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: policyCommand } = await import('../../src/commands/policy.js');
    const result = await policyCommand('check', {
      cwd: TEST_DIR,
      policy: policyPath,
      file: 'secrets.txt',
      out: auditPath,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.auditPath).toBe(auditPath);
    expect(existsSync(auditPath)).toBe(true);
    const record = JSON.parse(readFileSync(auditPath, 'utf-8').trim());
    expect(record.policy_path).toBe('custom-policy.json');
    expect(record.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'secret-pattern', id: 'password' }),
    ]));
  });
});
