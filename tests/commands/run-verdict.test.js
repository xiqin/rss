import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { PipelineEngine } from '../../src/core/pipeline-engine.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-verdict-')); }
const write = (dir, file, content) => writeFileSync(join(dir, file), content, 'utf-8');

async function runVerdict(specDir, options = {}) {
  const exitCodes = [];
  const outputs = [];
  const errors = [];

  const origExit = process.exitCode;
  process.exitCode = undefined;

  const origLog = console.log;
  const origErr = console.error;
  console.log = (msg) => outputs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));

  try {
    const { default: runCommand } = await import('../../src/commands/run.js?bust=' + Date.now());
    await runCommand({ specDir, verdict: true, ...options });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }

  const exitCode = process.exitCode;
  process.exitCode = origExit;
  return { exitCode, output: outputs.join('\n'), error: errors.join('\n') };
}

describe('loom run --verdict', () => {
  let dir;
  beforeEach(() => { dir = tmp(); });

  it('qa-report.md 不存在时 exit 1', async () => {
    const { exitCode, error } = await runVerdict(dir);
    expect(exitCode).toBe(1);
    expect(error).toMatch(/not found/);
  });

  it('verdict: PASS → stdout PASS，exit 0', async () => {
    write(dir, 'qa-report.md', '# QA 报告\n\nverdict: PASS\n全部通过');
    const { exitCode, output } = await runVerdict(dir);
    expect(output.trim()).toBe('PASS');
    expect(exitCode).toBe(0);
  });

  it('verdict: FAIL → stdout FAIL，exit 1', async () => {
    write(dir, 'qa-report.md', '# QA 报告\n\nverdict: FAIL\n有失败用例');
    const { exitCode, output } = await runVerdict(dir);
    expect(output.trim()).toBe('FAIL');
    expect(exitCode).toBe(1);
  });

  it('verdict: PARTIAL → stdout PARTIAL，exit 2', async () => {
    write(dir, 'qa-report.md', '# QA 报告\n\nverdict: PARTIAL\n手动用例遗留');
    const { exitCode, output } = await runVerdict(dir);
    expect(output.trim()).toBe('PARTIAL');
    expect(exitCode).toBe(2);
  });

  it('无 verdict 字段回退 FAIL，exit 1', async () => {
    write(dir, 'qa-report.md', '# QA 报告\n内容未给出裁定');
    const { exitCode, output } = await runVerdict(dir);
    expect(output.trim()).toBe('FAIL');
    expect(exitCode).toBe(1);
  });

  it('--verdict-file 指定自定义报告文件', async () => {
    write(dir, 'custom-report.md', 'verdict: PASS');
    const { exitCode, output } = await runVerdict(dir, { verdictFile: 'custom-report.md' });
    expect(output.trim()).toBe('PASS');
    expect(exitCode).toBe(0);
  });
});

async function runCommandWithCapture(options = {}) {
  const outputs = [];
  const errors = [];
  const origExit = process.exitCode;
  process.exitCode = undefined;
  const origLog = console.log;
  const origErr = console.error;
  console.log = (msg) => outputs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  try {
    const { default: runCommand } = await import('../../src/commands/run.js?bust=' + Date.now() + Math.random());
    await runCommand(options);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const exitCode = process.exitCode;
  process.exitCode = origExit;
  return { exitCode, output: outputs.join('\n'), error: errors.join('\n') };
}

describe('loom run write locking', () => {
  it('rejects project root as spec_dir before initializing', async () => {
    const root = tmp();

    const result = await runCommandWithCapture({
      cwd: root,
      specDir: '.'
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('points at project root');
  });

  it('keeps the spec lock after task update failure when another process holds it', async () => {
    const root = tmp();
    const specDir = join(root, 'specs', 'feature');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, '.loom-run.lock'), `${process.pid}\n2026-01-01T00:00:00.000Z\nother-token`, 'utf-8');

    const result = await runCommandWithCapture({
      cwd: root,
      specDir: 'specs/feature',
      task: 'T1',
      taskStatus: 'done'
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/spec is locked/);
    expect(existsSync(join(specDir, '.loom-run.lock'))).toBe(true);
  });
});

describe('loom run terminal completion reports', () => {
  it('records terminal verification and writes default completion reports', async () => {
    const root = setupTerminalProject();

    const result = await runCommandWithCapture({
      cwd: root,
      specDir: 'specs/auto-reports',
      advance: true,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.output).toContain('Pipeline complete at stage: verification');
    expect(result.output).toContain('Finalized 3 artifact(s)');
    expect(existsSync(join(root, '.loom', 'evidence', 'auto-reports.md'))).toBe(true);
    expect(existsSync(join(root, '.loom', 'evidence', 'auto-reports-trends.json'))).toBe(true);
    expect(existsSync(join(root, '.loom', 'memory', 'MEMORY.md'))).toBe(true);

    const evidence = readFileSync(join(root, '.loom', 'evidence', 'auto-reports.md'), 'utf-8');
    expect(evidence).toContain('| Total | 1 |');
    const history = JSON.parse(readFileSync(join(root, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ stage: 'verification', passed: true });
  });

  it('can include PR evidence and dashboard on request', async () => {
    const root = setupTerminalProject('rich-reports');

    const result = await runCommandWithCapture({
      cwd: root,
      specDir: 'specs/rich-reports',
      advance: true,
      prEvidence: true,
      dashboard: true,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.output).toContain('Finalized 6 artifact(s)');
    expect(existsSync(join(root, '.loom', 'evidence', 'pr-rich-reports.md'))).toBe(true);
    expect(existsSync(join(root, '.loom', 'reports', 'rich-reports-dashboard.html'))).toBe(true);
    expect(existsSync(join(root, '.loom', 'reports', 'rich-reports-dashboard.json'))).toBe(true);
  });

  it('--no-reports skips report generation but keeps terminal compliance', async () => {
    const root = setupTerminalProject('skip-reports');

    const result = await runCommandWithCapture({
      cwd: root,
      specDir: 'specs/skip-reports',
      advance: true,
      reports: false,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.output).toContain('Pipeline complete at stage: verification');
    expect(existsSync(join(root, '.loom', 'evidence', 'skip-reports.md'))).toBe(false);
    const history = JSON.parse(readFileSync(join(root, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
  });
});

function setupTerminalProject(slug = 'auto-reports') {
  const root = tmp();
  mkdirSync(join(root, '.loom'), { recursive: true });
  writeFileSync(join(root, '.loom', 'workflow.yaml'), `
defaults:
  pipeline_type: quickfix
reporting:
  on_complete:
    enabled: true
pipelines:
  quickfix:
    steps:
      - id: verification
        outputs: [verify-report.md, handoffs/verification.json]
        gate_verdict: verify-report.md
        evidence_required: true
`, 'utf-8');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }), 'utf-8');

  const specDir = join(root, 'specs', slug);
  mkdirSync(join(specDir, 'evidence'), { recursive: true });
  const log = 'npm test: passed\n';
  const hash = createHash('sha256').update(log).digest('hex');
  writeFileSync(join(specDir, 'evidence', 'verification.log'), log, 'utf-8');
  const report = [
    'verdict: PASS',
    'evidence-command: npm test',
    'evidence-exit-code: 0',
    'evidence-file: evidence/verification.log',
    `evidence-sha256: ${hash}`,
    ''
  ].join('\n');
  writeFileSync(join(specDir, 'verify-report.md'), report, 'utf-8');

  const engine = new PipelineEngine(root, specDir);
  engine.initialize('quickfix');
  engine.store.writeStageHandoff('verification', { status: 'done', summary: 'verified', artifacts: ['verify-report.md', 'evidence/verification.log'] });

  return root;
}
