import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PipelineEngine } from '../../src/core/pipeline-engine.js';
import { PipelineStateStore } from '../../src/core/state-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-e2e-')); }

/** 用仓库自带的真实 templates/workflow.yaml 搭一个项目 */
function setupRealProject() {
  const root = tmp();
  mkdirSync(join(root, '.loom'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'templates', 'workflow.yaml'), join(root, '.loom', 'workflow.yaml'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.0.1' }), 'utf-8');
  const specDir = join(root, 'specs', '2026-05-30+demo');
  mkdirSync(specDir, { recursive: true });
  return { root, specDir };
}

const write = (dir, file, body) => writeFileSync(join(dir, file), body, 'utf-8');
const writeStageHandoff = (engine, stage, artifacts = []) => {
  engine.store.writeStageHandoff(stage, { status: 'done', summary: `${stage} complete`, artifacts });
};
const writePassingReport = (dir, file, command = 'npm test') => {
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  const evidenceName = `${file}.log`;
  const log = `${command}: passed\n`;
  write(dir, `evidence/${evidenceName}`, log);
  const hash = createHash('sha256').update(log).digest('hex');
  write(dir, file, `verdict: PASS\nevidence-command: ${command}\nevidence-exit-code: 0\nevidence-file: evidence/${evidenceName}\nevidence-sha256: ${hash}`);
};

describe('feature pipeline end-to-end (real workflow.yaml)', () => {
  it('walks brainstorming → planning → approved → git-worktree → executing → verification → code-review → synced', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    expect(engine.currentStage()).toBe('brainstorming');

    // brainstorming → planning
    write(specDir, 'spec.md', '# Spec\nComplete requirement.');
    writeStageHandoff(engine, 'brainstorming', ['spec.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'planning' });

    // planning → approved (gate)
    write(specDir, 'plan.md', '# Plan\nTasks laid out.');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', 'task one');
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'approved' });

    // gate: must approve, cannot auto-advance
    expect(engine.advance().ok).toBe(false);
    expect(engine.approve()).toMatchObject({ ok: true, to: 'git-worktree' });

    // git-worktree → executing (executing precondition needs tasks/ dir)
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'executing' });

    // executing → verification requires test-report PASS
    writePassingReport(specDir, 'test-report.md');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'verification' });

    // verification → code-review-request requires verify-report PASS
    writePassingReport(specDir, 'verify-report.md', 'npm run build');
    writeStageHandoff(engine, 'verification', ['verify-report.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'code-review-request' });

    // code-review-request → review-gate (审查请求产出后进入人工 gate)
    write(specDir, 'review-request.md', '# 代码审查请求\nverdict: PASS');
    writeStageHandoff(engine, 'code-review-request', ['review-request.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'review-gate' });

    // review-gate: must approve, cannot auto-advance
    expect(engine.advance().ok).toBe(false);
    expect(engine.approve()).toMatchObject({ ok: true, to: 'code-review-response' });

    // code-review-response → synced
    write(specDir, 'review-response.md', '# 审查反馈响应\nverdict: PASS');
    writeStageHandoff(engine, 'code-review-response', ['review-response.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'synced' });

    expect(engine.currentStage()).toBe('synced');

    // 状态文件完整、历史齐全
    const snap = new PipelineStateStore(specDir).snapshot();
    expect(snap.pipeline.stage_history.length).toBeGreaterThanOrEqual(5);
  });

  it('blocks synced when verify-report says FAIL', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec');
    writeStageHandoff(engine, 'brainstorming', ['spec.md']);
    engine.advance({ compressionConfirmed: true });
    write(specDir, 'plan.md', '# Plan');
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', 't');
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true }); // executing
    writePassingReport(specDir, 'test-report.md');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    engine.advance({ compressionConfirmed: true }); // verification
    write(specDir, 'verify-report.md', 'verdict: FAIL');
    writeStageHandoff(engine, 'verification', ['verify-report.md']);
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/verify-report/);
  });
});
