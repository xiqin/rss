import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { EvidenceStore, normalizeComplianceRecord } from '../../src/core/evidence-store.js';
import { InMemoryFileSystem } from '../../src/core/fs-interface.js';

function seedHistory(fs, root, records) {
  fs.writeFileSync(join(root, '.loom', 'compliance', 'history.json'), JSON.stringify(records, null, 2), 'utf-8');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

describe('EvidenceStore', () => {
  it('normalizes hook compliance records into evidence v1 objects', () => {
    const item = normalizeComplianceRecord({
      spec_dir: 'specs/demo',
      timestamp: '2026-07-07T10:00:00.000Z',
      stage: 'hook:PostToolUse',
      skill: 'post-tool-use-audit',
      passed: false,
      risk: 'medium',
      violations: ['Build failed'],
      tool_use: {
        tool: 'bash',
        input_summary: { kind: 'command', text: 'npm run build' },
        exit_code: 1,
        success: false,
        duration_ms: 1200,
        artifacts: ['build.log'],
        error_summary: 'Build failed',
        risk_reasons: ['tool-failed'],
      },
    }, 0);

    expect(item.schema_version).toBe('loom.evidence.v1');
    expect(item.type).toBe('tool_use');
    expect(item.verdict).toBe('FAIL');
    expect(item.risk).toBe('medium');
    expect(item.subject.tool).toBe('bash');
    expect(item.artifacts).toEqual(['build.log']);
    expect(item.metrics).toEqual({ duration_ms: 1200, exit_code: 1 });
  });

  it('lists evidence sorted by timestamp and summarizes verdicts, risks, and types', () => {
    const fs = new InMemoryFileSystem();
    const root = '/repo';
    seedHistory(fs, root, [
      {
        timestamp: '2026-07-07T10:00:00.000Z',
        stage: 'hook:UserPromptSubmit',
        skill: 'user-prompt-audit',
        passed: true,
        risk: 'low',
        prompt: { text: 'Add status command', suggestions: ['consider-pipeline-selector'] },
      },
      {
        timestamp: '2026-07-07T10:01:00.000Z',
        stage: 'hook:FileChanged',
        skill: 'file-changed-audit',
        passed: true,
        risk: 'high',
        file_change: {
          changed_count: 1,
          files: [{ path: '.env.production' }],
          sensitive_files: ['.env.production'],
          sync_suggestions: ['run-secret-scan'],
        },
      },
    ]);

    const store = new EvidenceStore(root, { fs });
    const items = store.list();
    expect(items.map(i => i.type)).toEqual(['file_change', 'user_prompt']);
    expect(items[0].verdict).toBe('WARN');
    expect(items[0].artifacts).toEqual(['.env.production']);

    expect(store.summary()).toEqual({
      total: 2,
      verdicts: { PASS: 1, WARN: 1, FAIL: 0 },
      risks: { low: 1, medium: 0, high: 1 },
      types: { file_change: 1, user_prompt: 1 },
    });
  });

  it('filters evidence by type, risk, verdict, and spec directory', () => {
    const fs = new InMemoryFileSystem();
    const root = '/repo';
    seedHistory(fs, root, [
      { spec_dir: 'specs/a', timestamp: '2026-07-07T10:00:00.000Z', stage: 'hook:TaskCompleted', skill: 'task-completed-audit', passed: true, risk: 'low', task: { id: 'T1' } },
      { spec_dir: 'specs/b', timestamp: '2026-07-07T10:01:00.000Z', stage: 'hook:PermissionDenied', skill: 'permission-denied-audit', passed: false, risk: 'medium', permission: { tool: 'bash' } },
    ]);

    const store = new EvidenceStore(root, { fs });
    expect(store.list({ type: 'permission' })).toHaveLength(1);
    expect(store.list({ risk: 'medium' })).toHaveLength(1);
    expect(store.list({ verdict: 'FAIL' })).toHaveLength(1);
    expect(store.list({ specDir: 'specs/a' })).toHaveLength(1);
  });

  it('matches spec directory filters across relative and absolute paths', () => {
    const fs = new InMemoryFileSystem();
    const root = resolve('/repo');
    seedHistory(fs, root, [
      { spec_dir: resolve(root, 'specs/a'), timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', passed: true, risk: 'low', violations: [] },
      { spec_dir: 'specs/b', timestamp: '2026-07-07T10:01:00.000Z', stage: 'verification', passed: true, risk: 'low', violations: [] },
    ]);

    const store = new EvidenceStore(root, { fs });
    expect(store.list({ specDir: 'specs/a' })).toHaveLength(1);
    expect(store.list({ specDir: resolve(root, 'specs/b') })).toHaveLength(1);
  });

  it('emits JSON Lines for filtered evidence', () => {
    const fs = new InMemoryFileSystem();
    const root = '/repo';
    seedHistory(fs, root, [
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', skill: 'loom-verification-before-completion', passed: true, violations: [] },
    ]);

    const line = new EvidenceStore(root, { fs }).jsonl();
    expect(JSON.parse(line)).toMatchObject({ type: 'verification', verdict: 'PASS' });
  });

  it('adds sha256 hashes for existing artifact files when requested', () => {
    const fs = new InMemoryFileSystem();
    const root = resolve('/repo');
    seedHistory(fs, root, [
      {
        spec_dir: 'specs/demo',
        timestamp: '2026-07-07T10:00:00.000Z',
        stage: 'hook:TaskCompleted',
        skill: 'task-completed-audit',
        passed: true,
        risk: 'low',
        task: { id: 'T1', artifacts: ['test-report.md', 'src/parser.js', '../escape.txt'] },
      },
    ]);
    fs.writeFileSync(join(root, 'specs', 'demo', 'test-report.md'), 'PASS\n', 'utf-8');
    fs.writeFileSync(join(root, 'src', 'parser.js'), 'export const ok = true;\n', 'utf-8');

    const [item] = new EvidenceStore(root, { fs }).list({ hashArtifacts: true });
    expect(item.artifact_hashes).toEqual({
      'src/parser.js': sha256('export const ok = true;\n'),
      'test-report.md': sha256('PASS\n'),
    });
  });

  it('exports normalized evidence to JSON and JSON Lines files', () => {
    const fs = new InMemoryFileSystem();
    const root = '/repo';
    seedHistory(fs, root, [
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', skill: 'loom-verification-before-completion', passed: true, violations: [] },
    ]);

    const store = new EvidenceStore(root, { fs });
    const jsonResult = store.export({ path: join(root, '.loom', 'evidence', 'evidence.json') });
    const json = JSON.parse(fs.readFileSync(jsonResult.path, 'utf-8'));
    expect(json.summary.total).toBe(1);
    expect(json.evidence[0]).toMatchObject({ type: 'verification', verdict: 'PASS' });

    const jsonlResult = store.export({ path: join(root, '.loom', 'evidence', 'evidence.jsonl'), format: 'jsonl' });
    expect(JSON.parse(fs.readFileSync(jsonlResult.path, 'utf-8'))).toMatchObject({ type: 'verification' });
  });

  it('exports Markdown and HTML evidence reports', () => {
    const fs = new InMemoryFileSystem();
    const root = '/repo';
    seedHistory(fs, root, [
      {
        timestamp: '2026-07-07T10:00:00.000Z',
        stage: 'hook:PostToolUse',
        skill: 'post-tool-use-audit',
        passed: false,
        risk: 'medium',
        violations: ['Build failed'],
        tool_use: { tool: 'bash', artifacts: ['build.log'], error_summary: 'Build failed' },
      },
    ]);

    const store = new EvidenceStore(root, { fs });
    const markdownResult = store.export({ path: join(root, '.loom', 'evidence', 'report.md'), format: 'markdown' });
    const markdown = fs.readFileSync(markdownResult.path, 'utf-8');
    expect(markdown).toContain('# Loom Evidence Report');
    expect(markdown).toContain('| FAIL | medium | tool_use |');
    expect(markdown).toContain('Build failed');

    const htmlResult = store.export({ path: join(root, '.loom', 'evidence', 'report.html'), format: 'html' });
    const html = fs.readFileSync(htmlResult.path, 'utf-8');
    expect(html).toContain('<title>Loom Evidence Report</title>');
    expect(html).toContain('<td>FAIL</td>');
    expect(html).toContain('Build failed');
  });

  it('computes trend metrics across normalized evidence', () => {
    const fs = new InMemoryFileSystem();
    const root = '/repo';
    seedHistory(fs, root, [
      {
        timestamp: '2026-07-07T10:00:00.000Z',
        stage: 'hook:PostToolUse',
        skill: 'post-tool-use-audit',
        passed: false,
        risk: 'medium',
        violations: ['Build failed'],
        tool_use: { tool: 'bash', duration_ms: 1200, exit_code: 1 },
      },
      {
        timestamp: '2026-07-07T10:01:00.000Z',
        stage: 'hook:PostToolUse',
        skill: 'post-tool-use-audit',
        passed: false,
        risk: 'medium',
        violations: ['Build failed'],
        tool_use: { tool: 'bash', duration_ms: 800, exit_code: 1 },
      },
      {
        timestamp: '2026-07-07T10:02:00.000Z',
        stage: 'hook:TaskCompleted',
        skill: 'task-completed-audit',
        passed: true,
        risk: 'low',
        task: { id: 'T1', duration_ms: 400 },
      },
      {
        timestamp: '2026-07-07T10:03:00.000Z',
        stage: 'hook:FileChanged',
        skill: 'file-changed-audit',
        passed: true,
        risk: 'high',
        file_change: { changed_count: 1, files: [{ path: '.env.production' }] },
      },
    ]);

    const trends = new EvidenceStore(root, { fs }).trends({ top: 1 });
    expect(trends.total).toBe(4);
    expect(trends.window).toEqual({ limit: null, earliest: '2026-07-07T10:00:00.000Z', latest: '2026-07-07T10:03:00.000Z' });
    expect(trends.verdicts).toEqual({ PASS: 1, WARN: 1, FAIL: 2 });
    expect(trends.risks).toEqual({ low: 1, medium: 2, high: 1 });
    expect(trends.rates).toEqual({ pass: 0.25, warn: 0.25, fail: 0.5 });
    expect(trends.average_duration_ms).toBe(800);
    expect(trends.duration_count).toBe(3);
    expect(trends.failure_reasons).toEqual([{ reason: 'Build failed', count: 2 }]);
    expect(trends.risk_by_type.tool_use).toEqual({ low: 0, medium: 2, high: 0 });
  });

  it('exports trend metrics to a JSON file', () => {
    const fs = new InMemoryFileSystem();
    const root = '/repo';
    seedHistory(fs, root, [
      { timestamp: '2026-07-07T10:00:00.000Z', stage: 'verification', skill: 'loom-verification-before-completion', passed: true, violations: [] },
    ]);

    const store = new EvidenceStore(root, { fs });
    const result = store.exportTrends({ path: join(root, '.loom', 'evidence', 'trends.json') });
    const trends = JSON.parse(fs.readFileSync(result.path, 'utf-8'));
    expect(trends).toMatchObject({ total: 1, verdicts: { PASS: 1, WARN: 0, FAIL: 0 }, rates: { pass: 1, warn: 0, fail: 0 } });
  });
});
