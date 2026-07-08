import { describe, it, expect, beforeEach } from 'vitest';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkflow, PipelineEngine } from '../../src/core/pipeline-engine.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-engine-')); }

function setupProject(yaml) {
  const root = tmp();
  mkdirSync(join(root, '.loom'), { recursive: true });
  writeFileSync(join(root, '.loom', 'workflow.yaml'), yaml, 'utf-8');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }), 'utf-8');
  return root;
}

const MINIMAL_WF = `
defaults:
  pipeline_type: feature
  max_retries: 3
pipelines:
  feature:
    description: "flow with a #hashtag inside quotes"
    steps:
      - id: brainstorming
        skill: loom-brainstorming
        next: planning
        outputs: [spec.md]
      - id: planning
        skill: loom-writing-plans
        next: approved
        outputs: [plan.md]
      - id: approved
        gate: human-approval
        next: synced
      - id: synced
        skill: loom-index-update
        outputs: []
`;

describe('loadWorkflow / parser', () => {
  it('parses pipelines and preserves # inside quoted description', () => {
    const root = setupProject(MINIMAL_WF);
    const wf = loadWorkflow(root);
    expect(Object.keys(wf.pipelines)).toContain('feature');
    expect(wf.defaults.pipeline_type).toBe('feature');
    expect(wf.defaults.max_retries).toBe(3);
    expect(wf.pipelines.feature).toHaveLength(4);
  });

  it('throws (loud) when no pipelines parse', () => {
    const root = setupProject('garbage: true\nnothing here\n');
    expect(() => loadWorkflow(root)).toThrow();
  });

  it('throws when YAML is valid but has no pipelines', () => {
    const root = setupProject('defaults:\n  pipeline_type: feature\n');
    expect(() => loadWorkflow(root)).toThrow(/Failed to parse any pipelines/);
  });

  it('allows workflow without pipelines when only dynamic steps are required', () => {
    const root = setupProject('defaults:\n  pipeline_type: feature\nstep_catalog:\n  executing:\n    outputs: [test-report.md]\nselection_rules:\n  must_include: [executing]\n');
    const wf = loadWorkflow(root, undefined, { requirePipelines: false });
    expect(wf.pipelines).toEqual({});
    expect(wf.step_catalog.executing.outputs).toEqual(['test-report.md']);
  });

  it('throws YAML syntax error with line number for malformed YAML', () => {
    const root = setupProject('defaults:\n  pipeline_type: feature\npipelines:\n  feature:\n    steps:\n      - id: test\n        skill: test\n        outputs: [unbalanced bracket\n');
    expect(() => loadWorkflow(root)).toThrow(/YAML syntax error.*line/);
  });

  it('throws when a step is missing id', () => {
    const root = setupProject(`
defaults:
  pipeline_type: feature
pipelines:
  feature:
    steps:
      - skill: test
        next: done
`);
    expect(() => loadWorkflow(root)).toThrow(/missing "id"/);
  });
});

describe('PipelineEngine flow', () => {
  let root, specDir, engine;
  beforeEach(() => {
    root = setupProject(MINIMAL_WF);
    specDir = join(root, 'specs', 'x');
    mkdirSync(specDir, { recursive: true });
    engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
  });

  it('blocks advance when stage output (spec.md) missing', () => {
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/outputs incomplete/);
    expect(r.hint).toBeDefined();
    expect(r.hint).toMatch(/TBD|TODO|FIXME|XXX|占位符|placeholder/);
  });

  it('advances once stage output present', () => {
    writeFileSync(join(specDir, 'spec.md'), '# spec content', 'utf-8');
    const r = engine.advance();
    expect(r.ok).toBe(true);
    expect(r.to).toBe('planning');
  });

  it('blocks advance when required stage handoff is missing', () => {
    const wf = `
defaults:
  pipeline_type: feature
pipelines:
  feature:
    steps:
      - id: planning
        skill: loom-writing-plans
        next: executing
        outputs: [plan.md, handoffs/planning.json]
      - id: executing
        skill: loom-subagent-driven-development
        outputs: []
`;
    const handoffRoot = setupProject(wf);
    const handoffSpecDir = join(handoffRoot, 'specs', 'handoff-gate');
    mkdirSync(handoffSpecDir, { recursive: true });
    const handoffEngine = new PipelineEngine(handoffRoot, handoffSpecDir);
    handoffEngine.initialize('feature');

    writeFileSync(join(handoffSpecDir, 'plan.md'), '# plan', 'utf-8');
    const blocked = handoffEngine.advance();
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('handoffs/planning.json');

    handoffEngine.store.writeStageHandoff('planning', { status: 'done', summary: 'plan ready' });
    const needsCompression = handoffEngine.advance();
    expect(needsCompression).toMatchObject({
      ok: false,
      compression_required: true,
      required_action: 'compress_closed_stage_context'
    });
    expect(handoffEngine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'executing' });
  });

  it('refuses to auto-advance past a human-approval gate', () => {
    writeFileSync(join(specDir, 'spec.md'), '# spec', 'utf-8');
    writeFileSync(join(specDir, 'plan.md'), '# plan', 'utf-8');
    engine.advance(); // → planning
    engine.advance(); // → approved (gate)
    expect(engine.currentStage()).toBe('approved');
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/human-approval gate/);
    expect(r.hint).toBeDefined();
  });

  it('approve() passes the gate', () => {
    writeFileSync(join(specDir, 'spec.md'), '# spec', 'utf-8');
    writeFileSync(join(specDir, 'plan.md'), '# plan', 'utf-8');
    engine.advance(); engine.advance(); // → approved
    const r = engine.approve();
    expect(r.ok).toBe(true);
    expect(r.to).toBe('synced');
  });

  it('reads version from project package.json', () => {
    const s = engine.snapshot().pipeline;
    expect(s.loom_version).toBe('9.9.9');
  });

  it('returns stage artifact context and context policy', () => {
    engine.store.writeStageHandoff('brainstorming', {
      status: 'done',
      summary: 'spec ready',
      artifacts: ['spec.md']
    });

    const context = engine.getStageContext();
    expect(context.current_step).toMatchObject({
      id: 'brainstorming',
      requires: [],
      outputs: ['spec.md'],
      gate_verdict: null
    });
    expect(context.next_step).toMatchObject({ id: 'planning' });
    expect(context.handoffs_summary[0]).toMatchObject({
      id: 'brainstorming',
      stage: 'brainstorming',
      status: 'done',
      summary: 'spec ready',
      artifacts: ['spec.md']
    });
    expect(context.recommended_reads).toContain('progress.md');
    expect(context.compression_policy.write_stage_handoff).toBe('handoffs/brainstorming.json');
    expect(context.compression_policy.preserve).toContain('pipeline.state.json');
    expect(context.compression_policy.mandatory_before_next_stage).toBe(true);
    expect(context.compression_policy.guidance).toContain('必须先写 handoff');
  });
});

describe('PipelineEngine dynamic_steps', () => {
  const WF_WITH_CATALOG = `
defaults:
  pipeline_type: feature
  max_retries: 3
pipelines:
  feature:
    steps:
      - id: brainstorming
        skill: loom-brainstorming
        next: planning
        outputs: [spec.md]
      - id: planning
        skill: loom-writing-plans
        next: executing
        requires: [spec.md]
        outputs: [plan.md]
      - id: executing
        skill: loom-subagent-driven-development
        next: synced
        outputs: [test-report.md]
      - id: synced
        skill: loom-index-update
        outputs: []
step_catalog:
  brainstorming:
    skill: loom-brainstorming
    requires: []
    outputs: [spec.md]
    description: "brainstorming"
  planning:
    skill: loom-writing-plans
    requires: [spec.md]
    outputs: [plan.md]
    description: "planning"
  executing:
    skill: loom-subagent-driven-development
    requires: [plan.md]
    outputs: [test-report.md]
    description: "executing"
    mandatory: true
  verification:
    skill: loom-verification-before-completion
    requires: [test-report.md]
    outputs: [verify-report.md]
    description: "verification"
    mandatory: true
  synced:
    skill: loom-index-update
    requires: [verify-report.md]
    outputs: []
    description: "synced"
selection_rules:
  must_include: [executing, verification]
  max_steps: 8
`;

  it('initialize with dynamicSteps uses them as steps', () => {
    const root = setupProject(WF_WITH_CATALOG);
    const specDir = join(root, 'specs', 'd1');
    mkdirSync(specDir, { recursive: true });
    const eng = new PipelineEngine(root, specDir);
    const dynamicSteps = [
      { id: 'executing', skill: 'loom-subagent-driven-development', requires: [], outputs: ['test-report.md'], description: 'executing' },
      { id: 'verification', skill: 'loom-verification-before-completion', requires: ['test-report.md'], outputs: ['verify-report.md'], description: 'verification' }
    ];
    const result = eng.initialize(null, { dynamicSteps });
    expect(result.ok).toBe(true);
    expect(result.state.dynamic_steps).toHaveLength(2);
    expect(result.state.current_stage).toBe('executing');
    const steps = eng.getSteps();
    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe('executing');
  });

  it('initializes dynamicSteps without a pipelines section', () => {
    const root = setupProject(`
defaults:
  pipeline_type: feature
step_catalog:
  executing:
    skill: loom-subagent-driven-development
    requires: []
    outputs: [test-report.md]
selection_rules:
  must_include: [executing]
`);
    const specDir = join(root, 'specs', 'dynamic-only');
    mkdirSync(specDir, { recursive: true });
    const eng = new PipelineEngine(root, specDir, { requirePipelines: false });
    const result = eng.initialize(null, {
      dynamicSteps: [
        { id: 'executing', skill: 'loom-subagent-driven-development', requires: [], outputs: ['test-report.md'] }
      ]
    });
    expect(result.ok).toBe(true);
    expect(result.state.current_stage).toBe('executing');
    expect(eng.getSteps().map(s => s.id)).toEqual(['executing']);
  });

  it('getSteps reads dynamic_steps when present', () => {
    const root = setupProject(WF_WITH_CATALOG);
    const specDir = join(root, 'specs', 'd2');
    mkdirSync(specDir, { recursive: true });
    const eng = new PipelineEngine(root, specDir);
    eng.initialize('feature');
    const state = eng.store.read();
    eng.store.setDynamicSteps([
      { id: 'executing', skill: 'loom-subagent-driven-development', requires: [], outputs: ['test-report.md'], description: 'executing' },
      { id: 'verification', skill: 'loom-verification-before-completion', requires: ['test-report.md'], outputs: ['verify-report.md'], description: 'verification' }
    ]);
    const steps = eng.getSteps();
    expect(steps).toHaveLength(2);
    expect(steps.map(s => s.id)).toEqual(['executing', 'verification']);
  });

  it('checks terminal stage outputs before reporting completion', () => {
    const root = setupProject(WF_WITH_CATALOG);
    const specDir = join(root, 'specs', 'terminal');
    mkdirSync(specDir, { recursive: true });
    const eng = new PipelineEngine(root, specDir);
    eng.initialize(null, {
      dynamicSteps: [
        { id: 'executing', skill: null, outputs: ['test-report.md'], description: 'executing' },
        { id: 'verification', skill: 'loom-verification-before-completion', requires: ['test-report.md'], outputs: ['verify-report.md', 'handoffs/verification.json'], gate_verdict: 'verify-report.md', description: 'verification' }
      ]
    });

    writeFileSync(join(specDir, 'test-report.md'), 'PASS', 'utf-8');
    expect(eng.advance()).toMatchObject({ ok: true, to: 'verification' });

    const missing = eng.advance();
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('outputs incomplete');
    expect(missing.error).toContain('verify-report.md');
    expect(missing.error).toContain('handoffs/verification.json');

    writeFileSync(join(specDir, 'verify-report.md'), 'PASS', 'utf-8');
    eng.store.writeStageHandoff('verification', { status: 'done', summary: 'verified' });
    const complete = eng.advance();
    expect(complete).toMatchObject({ ok: true, complete: true, stage: 'verification', alreadyComplete: false });

    const history = JSON.parse(readFileSync(join(root, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ stage: 'verification', passed: true });

    const repeated = eng.advance();
    expect(repeated).toMatchObject({ ok: true, complete: true, stage: 'verification', alreadyComplete: true });
    const repeatedHistory = JSON.parse(readFileSync(join(root, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(repeatedHistory).toHaveLength(1);
  });

  it('adjust appends new steps preserving completed ones', () => {
    const root = setupProject(WF_WITH_CATALOG);
    const specDir = join(root, 'specs', 'd3');
    mkdirSync(specDir, { recursive: true });
    const eng = new PipelineEngine(root, specDir);
    eng.initialize('feature');
    // 写 spec.md 让 brainstorming 能推进
    writeFileSync(join(specDir, 'spec.md'), '# spec', 'utf-8');
    eng.advance(); // brainstorming → planning
    const state = eng.store.read();
    expect(state.current_stage).toBe('planning');
    // adjust: 追加 verification
    const result = eng.adjust([
      { id: 'verification', skill: 'loom-verification-before-completion', requires: ['test-report.md'], outputs: ['verify-report.md'], description: 'verification' }
    ]);
    expect(result.ok).toBe(true);
    const ids = result.dynamic_steps.map(s => s.id);
    expect(ids).toContain('brainstorming');
    expect(ids).toContain('planning');
    expect(ids).toContain('verification');
  });

  it('requires compression confirmation before low-risk executing advances', () => {
    for (const pipelineType of ['chore', 'quickfix']) {
      const root = tmp();
      mkdirSync(join(root, '.loom'), { recursive: true });
      copyFileSync(join(process.cwd(), 'templates', 'workflow.yaml'), join(root, '.loom', 'workflow.yaml'));
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }), 'utf-8');
      const specDir = join(root, 'specs', pipelineType);
      mkdirSync(specDir, { recursive: true });

      const eng = new PipelineEngine(root, specDir);
      eng.initialize(pipelineType);
      eng.store.writeStageHandoff('executing', { status: 'done', summary: `${pipelineType} done` });

      const blocked = eng.advance();
      expect(blocked, pipelineType).toMatchObject({
        ok: false,
        compression_required: true,
        required_action: 'compress_closed_stage_context'
      });
      expect(eng.currentStage(), pipelineType).toBe('executing');
      expect(eng.advance({ compressionConfirmed: true }), pipelineType).toMatchObject({ ok: true, to: 'verification' });
    }
  });
});
