import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PipelineEngine } from '../../src/core/pipeline-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-qa-e2e-')); }

function setupQaProject() {
  const root = tmp();
  mkdirSync(join(root, '.loom'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'templates', 'workflow.yaml'), join(root, '.loom', 'workflow.yaml'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }), 'utf-8');
  const qaDir = join(root, 'qa', '2026-06-04+user-auth');
  mkdirSync(qaDir, { recursive: true });
  return { root, qaDir };
}

const write = (dir, file, body) => writeFileSync(join(dir, file), body, 'utf-8');
const handoff = (engine, stage, artifacts = []) => {
  engine.store.writeStageHandoff(stage, { status: 'done', summary: `${stage} done`, artifacts });
};
const writePassingReport = (dir, file, command = 'npm test') => {
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  const log = `${command}: passed\n`;
  write(dir, 'evidence/qa.log', log);
  const hash = createHash('sha256').update(log).digest('hex');
  write(dir, file, `verdict: PASS\nevidence-command: ${command}\nevidence-exit-code: 0\nevidence-file: evidence/qa.log\nevidence-sha256: ${hash}`);
};

describe('QA 流水线 e2e（使用真实 workflow.yaml）', () => {
  it('走完完整 QA 流程：analysis→design→approved→execution→signoff→report', () => {
    const { root, qaDir } = setupQaProject();
    const engine = new PipelineEngine(root, qaDir);
    engine.initialize('qa');

    // 从 qa-analysis 起步
    expect(engine.currentStage()).toBe('qa-analysis');

    // qa-analysis → qa-design：需要 qa-plan.md
    write(qaDir, 'qa-plan.md', '# QA 测试矩阵\n覆盖用户认证功能');
    handoff(engine, 'qa-analysis', ['qa-plan.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'qa-design' });

    // qa-design → qa-approved：需要 qa-plan.md（requires）+ qa-cases.md（outputs）
    write(qaDir, 'qa-cases.md', '# 用例清单\nTC-auth-001 正常登录');
    handoff(engine, 'qa-design', ['qa-cases.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'qa-approved' });

    // qa-approved 是 gate，不能自动推进
    expect(engine.advance().ok).toBe(false);
    expect(engine.approve()).toMatchObject({ ok: true, to: 'qa-execution' });

    // qa-execution → qa-signoff：需 qa-execution-report.md(PASS) + manual-checklist.md
    writePassingReport(qaDir, 'qa-execution-report.md');
    write(qaDir, 'manual-checklist.md', '- [x] TC-auth-006 UI 验证');
    handoff(engine, 'qa-execution', ['qa-execution-report.md', 'manual-checklist.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'qa-signoff' });

    // qa-signoff 是 gate
    expect(engine.advance().ok).toBe(false);
    expect(engine.approve()).toMatchObject({ ok: true, to: 'qa-report' });

    // qa-report 是终点：需要 qa-report.md 产出，流水线到达终点
    write(qaDir, 'qa-report.md', '# QA 验收报告\nverdict: PASS\n全部通过，建议上线');
    handoff(engine, 'qa-report', ['qa-report.md']);
    const r = engine.advance();
    // qa-report 是最后一步，无 next → 正常结束
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No next step/);
    expect(engine.currentStage()).toBe('qa-report');
  });

  it('qa-execution FAIL 时阻断流水线', () => {
    const { root, qaDir } = setupQaProject();
    const engine = new PipelineEngine(root, qaDir);
    engine.initialize('qa');

    write(qaDir, 'qa-plan.md', '# plan');
    handoff(engine, 'qa-analysis', ['qa-plan.md']);
    engine.advance({ compressionConfirmed: true });
    write(qaDir, 'qa-cases.md', '# cases');
    handoff(engine, 'qa-design', ['qa-cases.md']);
    engine.advance({ compressionConfirmed: true }); // → qa-approved
    engine.approve(); // → qa-execution

    write(qaDir, 'qa-execution-report.md', 'verdict: FAIL\n发现回归失败');
    write(qaDir, 'manual-checklist.md', '# checklist');
    handoff(engine, 'qa-execution', ['qa-execution-report.md', 'manual-checklist.md']);
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/qa-execution-report/);
  });

  it('qa 战役目录独立，不影响 specs/ 下的 feature 状态', () => {
    const { root, qaDir } = setupQaProject();
    // 同时有 feature 流水线
    const featureDir = join(root, 'specs', '2026-06-04+user-auth');
    mkdirSync(featureDir, { recursive: true });
    const featureEngine = new PipelineEngine(root, featureDir);
    featureEngine.initialize('feature');

    const qaEngine = new PipelineEngine(root, qaDir);
    qaEngine.initialize('qa');

    // 两条流水线互不干扰
    expect(featureEngine.currentStage()).toBe('brainstorming');
    expect(qaEngine.currentStage()).toBe('qa-analysis');

    // qa 推进不影响 feature
    write(qaDir, 'qa-plan.md', '# plan');
    handoff(qaEngine, 'qa-analysis', ['qa-plan.md']);
    qaEngine.advance({ compressionConfirmed: true });
    expect(featureEngine.currentStage()).toBe('brainstorming');
  });
});
