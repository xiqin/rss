import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PipelineEngine } from '../../src/core/pipeline-engine.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-qa-engine-')); }

function setupProject(yaml) {
  const root = tmp();
  mkdirSync(join(root, '.loom'), { recursive: true });
  writeFileSync(join(root, '.loom', 'workflow.yaml'), yaml, 'utf-8');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }), 'utf-8');
  return root;
}

const QA_WF = `
defaults:
  pipeline_type: qa
pipelines:
  qa:
    description: "QA 验收流水线"
    steps:
      - id: qa-analysis
        skill: loom-qa
        next: qa-design
        outputs: [qa-plan.md, handoffs/qa-analysis.json]
      - id: qa-design
        skill: loom-qa
        next: qa-approved
        requires: [qa-plan.md]
        outputs: [qa-cases.md, handoffs/qa-design.json]
      - id: qa-approved
        gate: human-approval
        next: qa-execution
      - id: qa-execution
        skill: loom-qa
        next: qa-signoff
        requires: [qa-cases.md]
        outputs: [qa-execution-report.md, manual-checklist.md, handoffs/qa-execution.json]
        gate_verdict: qa-execution-report.md
      - id: qa-signoff
        gate: human-approval
        next: qa-report
      - id: qa-report
        skill: loom-qa
        requires: [qa-execution-report.md, manual-checklist.md]
        outputs: [qa-report.md, handoffs/qa-report.json]
`;

describe('QA 流水线 — 从 qa-analysis 起步（#1 修复验证）', () => {
  it('初始化后当前阶段是 qa-analysis，不是 brainstorming', () => {
    const root = setupProject(QA_WF);
    const specDir = join(root, 'qa', 'test-target');
    mkdirSync(specDir, { recursive: true });
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('qa');
    expect(engine.currentStage()).toBe('qa-analysis');
  });
});

describe('QA 流水线 — 声明式产物门禁（#2#3#5 验证）', () => {
  let root, specDir, engine;

  beforeEach(() => {
    root = setupProject(QA_WF);
    specDir = join(root, 'qa', 'test-feature');
    mkdirSync(specDir, { recursive: true });
    engine = new PipelineEngine(root, specDir);
    engine.initialize('qa');
  });

  const write = (file, content) => writeFileSync(join(specDir, file), content, 'utf-8');
  const handoff = (stage) => engine.store.writeStageHandoff(stage, { status: 'done', summary: `${stage} done` });

  it('缺少 qa-plan.md 时阻断 qa-analysis 推进', () => {
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/outputs incomplete/);
    expect(r.error).toMatch(/qa-plan\.md/);
  });

  it('缺少 qa-analysis handoff 时阻断 qa-analysis 推进', () => {
    write('qa-plan.md', '# QA 测试矩阵\n内容完整');
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/handoffs\/qa-analysis\.json/);
  });

  it('qa-plan.md 落地后推进到 qa-design', () => {
    write('qa-plan.md', '# QA 测试矩阵\n内容完整');
    handoff('qa-analysis');
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.compression_required).toBe(true);

    const confirmed = engine.advance({ compressionConfirmed: true });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.to).toBe('qa-design');
  });

  it('压缩确认后 qa-plan.md 落地推进到 qa-design', () => {
    write('qa-plan.md', '# QA 测试矩阵\n内容完整');
    handoff('qa-analysis');
    const r = engine.advance({ compressionConfirmed: true });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('qa-design');
  });

  it('qa-execution requires qa-cases.md，缺失时阻断从 qa-approved 进入', () => {
    // 推进到 qa-approved gate，不写 qa-cases.md
    write('qa-plan.md', '# plan');
    handoff('qa-analysis');
    engine.advance({ compressionConfirmed: true }); // qa-analysis → qa-design（需要 qa-plan.md outputs ✓）
    // 此时未写 qa-cases.md，qa-design 的 outputs 检查会阻断
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/qa-cases\.md/);
  });

  it('qa-execution gate_verdict=FAIL 时阻断推进', () => {
    // 推进到 qa-execution
    write('qa-plan.md', '# plan');
    handoff('qa-analysis');
    engine.advance({ compressionConfirmed: true }); // → qa-design
    write('qa-cases.md', '# cases');
    handoff('qa-design');
    engine.advance({ compressionConfirmed: true }); // → qa-approved (gate)
    engine.approve(); // → qa-execution
    // 写 FAIL 的执行报告
    write('qa-execution-report.md', 'verdict: FAIL\n有用例失败');
    write('manual-checklist.md', '# checklist');
    handoff('qa-execution');
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/qa-execution-report\.md/);
  });

  it('qa-execution gate_verdict=PASS 后推进到 qa-signoff', () => {
    write('qa-plan.md', '# plan');
    handoff('qa-analysis');
    engine.advance({ compressionConfirmed: true });
    write('qa-cases.md', '# cases');
    handoff('qa-design');
    engine.advance({ compressionConfirmed: true }); // → qa-approved
    engine.approve(); // → qa-execution
    write('qa-execution-report.md', 'verdict: PASS\n全部通过');
    write('manual-checklist.md', '# checklist');
    handoff('qa-execution');
    const r = engine.advance({ compressionConfirmed: true });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('qa-signoff');
  });

  it('qa-signoff gate 阻断自动推进，approve 后进入 qa-report', () => {
    write('qa-plan.md', '# plan');
    handoff('qa-analysis');
    engine.advance({ compressionConfirmed: true });
    write('qa-cases.md', '# cases');
    handoff('qa-design');
    engine.advance({ compressionConfirmed: true }); // → qa-approved
    engine.approve(); // → qa-execution
    write('qa-execution-report.md', 'verdict: PASS');
    write('manual-checklist.md', '# checklist');
    handoff('qa-execution');
    engine.advance({ compressionConfirmed: true }); // → qa-signoff
    expect(engine.advance().ok).toBe(false); // gate
    const r = engine.approve();
    expect(r.ok).toBe(true);
    expect(r.to).toBe('qa-report');
  });
});

describe('bugfix 流水线从 planning 起步（潜伏 bug 修复验证）', () => {
  it('bugfix 初始化从 planning 起步，不是 brainstorming', () => {
    const wf = `
defaults:
  pipeline_type: bugfix
pipelines:
  bugfix:
    steps:
      - id: planning
        skill: loom-writing-plans
        next: approved
        outputs: [plan.md]
      - id: approved
        gate: human-approval
        next: executing
      - id: executing
        skill: loom-subagent-driven-development
        outputs: []
`;
    const root = setupProject(wf);
    const specDir = join(root, 'specs', 'test-bug');
    mkdirSync(specDir, { recursive: true });
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('bugfix');
    expect(engine.currentStage()).toBe('planning');
  });
});
