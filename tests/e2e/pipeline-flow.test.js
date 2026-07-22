import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
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
const writePlan = (dir, body = '# Plan\n\n| Task | File |\n| --- | --- |\n| T1 | tasks/T1.md |\n') => write(dir, 'plan.md', body);
const requirementIdsFromSpec = (dir) => {
  const specPath = join(dir, 'spec.md');
  if (!existsSync(specPath)) return [];
  return [...new Set([...readFileSync(specPath, 'utf-8').matchAll(/REQ-\d{3,}/g)].map(match => match[0]))];
};
const writeRequirements = (dir, ids = requirementIdsFromSpec(dir)) => {
  write(dir, 'requirements.json', JSON.stringify({
    requirements: ids.map(id => ({
      id,
      status: 'failing',
      types: ['functional'],
      required_categories: ['happy-path'],
      acceptance: [`${id} acceptance`],
      behaviors: [{
        id: `${id}-B01`,
        category: 'happy-path',
        status: 'failing',
        description: `${id} happy path is implemented and observable`,
        acceptance: [`${id} acceptance`],
        test_plan: { strategy: 'unit', inputs: ['valid input'], expected: ['expected output'], coverage_target: 'behavior' }
      }]
    }))
  }, null, 2));
};
const defaultTraceabilityEntries = (dir) => {
  const ids = requirementIdsFromSpec(dir);
  return Object.fromEntries(ids.map(id => [id, {
    tasks: ['T1'],
    tests: ['tests/example.test.js'],
    evidence: ['evidence/example.log'],
    behaviors: {
      [`${id}-B01`]: {
        tasks: ['T1'],
        tests: ['tests/example.test.js'],
        evidence: ['evidence/example.log']
      }
    }
  }]));
};
const writeTraceability = (dir, entries = defaultTraceabilityEntries(dir)) => {
  mkdirSync(join(dir, 'tests'), { recursive: true });
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  if (!existsSync(join(dir, 'tests', 'example.test.js'))) write(dir, 'tests/example.test.js', 'test passes');
  if (!existsSync(join(dir, 'evidence', 'example.log'))) write(dir, 'evidence/example.log', 'evidence passes');
  write(dir, 'traceability.json', JSON.stringify({ requirements: entries }, null, 2));
};
const ensureStageArtifacts = (dir, stage) => {
  if (stage === 'brainstorming' && !existsSync(join(dir, 'requirements.json'))) {
    writeRequirements(dir);
  }
  if (stage === 'detail-expansion' && !existsSync(join(dir, 'requirements.json'))) {
    writeRequirements(dir);
  }
  if (stage === 'planning' && !existsSync(join(dir, 'traceability.json'))) {
    writeTraceability(dir);
  }
};
const writeStageHandoff = (engine, stage, artifacts = []) => {
  ensureStageArtifacts(engine.specDir, stage);
  engine.store.writeStageHandoff(stage, { status: 'done', summary: `${stage} complete`, artifacts });
};
const writePassingReport = (dir, file, command = 'npm test', coverage = '') => {
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  const evidenceName = `${file}.log`;
  const log = `${command}: passed\n`;
  write(dir, `evidence/${evidenceName}`, log);
  const hash = createHash('sha256').update(log).digest('hex');
  write(dir, file, `verdict: PASS\nevidence-command: ${command}\nevidence-exit-code: 0\nevidence-file: evidence/${evidenceName}\nevidence-sha256: ${hash}${coverage ? `\n\n${coverage}` : ''}`);
};

describe('feature pipeline end-to-end (real workflow.yaml)', () => {
  it('walks brainstorming → detail-expansion → planning → analyze-artifacts → approved → git-worktree → executing → converge → verification → code-review → synced', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    expect(engine.currentStage()).toBe('brainstorming');

    // brainstorming → detail-expansion
    write(specDir, 'spec.md', '# Spec\nComplete requirement.');
    writeRequirements(specDir);
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'detail-expansion' });

    // detail-expansion → planning
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'planning' });

    // planning → analyze-artifacts (gate)
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', 'task one');
    writeTraceability(specDir);
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/', 'traceability.json']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'analyze-artifacts' });

    // analyze-artifacts → approved (gate)
    writeStageHandoff(engine, 'analyze-artifacts');
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'approved' });

    // gate: must approve, cannot auto-advance
    expect(engine.advance().ok).toBe(false);
    expect(engine.approve()).toMatchObject({ ok: true, to: 'git-worktree' });

    // git-worktree → executing (executing precondition needs tasks/ dir)
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'executing' });

    // executing → converge requires test-report PASS
    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md');
    writeStageHandoff(engine, 'executing', ['test-report.md', 'traceability.json']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'converge' });

    // converge → verification
    writeStageHandoff(engine, 'converge');
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
    write(specDir, 'review-feedback.md', '# 审查反馈\nverdict: PASS');
    expect(engine.approve()).toMatchObject({ ok: true, to: 'code-review-response' });

    // code-review-response → synced
    write(specDir, 'review-response.md', '# 审查反馈响应\nverdict: PASS');
    writeStageHandoff(engine, 'code-review-response', ['review-response.md']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'synced' });

    expect(engine.currentStage()).toBe('synced');

    // 状态文件完整、历史齐全
    const snap = new PipelineStateStore(specDir).snapshot();
    expect(snap.pipeline.stage_history.length).toBeGreaterThanOrEqual(8);
  });

  it('blocks review-gate approval until review feedback exists', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec');
    writeRequirements(specDir);
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', 't');
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true });
    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'converge');
    engine.advance({ compressionConfirmed: true });
    writePassingReport(specDir, 'verify-report.md', 'npm run build');
    writeStageHandoff(engine, 'verification', ['verify-report.md']);
    engine.advance({ compressionConfirmed: true });
    write(specDir, 'review-request.md', '# 代码审查请求');
    writeStageHandoff(engine, 'code-review-request', ['review-request.md']);
    engine.advance({ compressionConfirmed: true });

    const missing = engine.approve();
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('Approval requirements');
    expect(missing.error).toContain('review-feedback.md');

    write(specDir, 'review-feedback.md', '# 审查反馈\nverdict: PASS');
    expect(engine.approve()).toMatchObject({ ok: true, to: 'code-review-response' });
  });

  it('blocks review-gate approval when review feedback is not PASS', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec');
    writeRequirements(specDir);
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', 't');
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true });
    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'converge');
    engine.advance({ compressionConfirmed: true });
    writePassingReport(specDir, 'verify-report.md', 'npm run build');
    writeStageHandoff(engine, 'verification', ['verify-report.md']);
    engine.advance({ compressionConfirmed: true });
    write(specDir, 'review-request.md', '# 代码审查请求');
    writeStageHandoff(engine, 'code-review-request', ['review-request.md']);
    engine.advance({ compressionConfirmed: true });

    write(specDir, 'review-feedback.md', '# 审查反馈\nverdict: CHANGES_REQUESTED\nBLOCKER: 缺少权限测试');
    const blocked = engine.approve();
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('Review feedback for "review-gate" is not approved');
    expect(blocked.error).toContain('CHANGES_REQUESTED');

    write(specDir, 'review-feedback.md', '# 审查反馈\nverdict: PASS');
    expect(engine.approve()).toMatchObject({ ok: true, to: 'code-review-response' });
  });

  it('blocks synced when verify-report says FAIL', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec');
    writeRequirements(specDir);
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', 't');
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true }); // executing
    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    engine.advance({ compressionConfirmed: true }); // converge
    writeStageHandoff(engine, 'converge');
    engine.advance({ compressionConfirmed: true }); // verification
    write(specDir, 'verify-report.md', 'verdict: FAIL');
    writeStageHandoff(engine, 'verification', ['verify-report.md']);
    const r = engine.advance();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/verify-report/);
  });

  it('blocks verification when passing verify-report omits spec requirement coverage', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec\nREQ-001: first behavior\nREQ-002: second behavior');
    writeStageHandoff(engine, 'brainstorming', ['spec.md']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', `---
requirements: [REQ-001, REQ-002]
behavior_ids: [REQ-001-B01, REQ-002-B01]
---
# Task 1`);
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: ['T1'],
        tests: [],
        evidence: [],
        behaviors: {
          'REQ-001-B01': { tasks: ['T1'], tests: ['tests/example.test.js'], evidence: ['evidence/example.log'] }
        }
      },
      'REQ-002': {
        tasks: ['T1'],
        tests: [],
        evidence: [],
        behaviors: {
          'REQ-002-B01': { tasks: ['T1'], tests: ['tests/example.test.js'], evidence: ['evidence/example.log'] }
        }
      }
    });
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true });

    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md', 'npm test', 'Covered: REQ-001, REQ-002');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'converge');
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'verification' });

    writePassingReport(specDir, 'verify-report.md', 'npm run build', 'Covered: REQ-002');
    writeStageHandoff(engine, 'verification', ['verify-report.md']);
    const blocked = engine.advance({ compressionConfirmed: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('verification artifact validation failed');
    expect(blocked.error).toContain('REQ-001');
  });

  it('blocks verification when traceability is missing requirement evidence', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec\nREQ-001: first behavior\nREQ-002: second behavior');
    writeStageHandoff(engine, 'brainstorming', ['spec.md']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', `---
requirements: [REQ-001, REQ-002]
behavior_ids: [REQ-001-B01, REQ-002-B01]
---
# Task 1`);
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: ['T1'],
        tests: [],
        evidence: [],
        behaviors: {
          'REQ-001-B01': { tasks: ['T1'], tests: ['tests/example.test.js'], evidence: ['evidence/example.log'] }
        }
      },
      'REQ-002': {
        tasks: ['T1'],
        tests: [],
        evidence: [],
        behaviors: {
          'REQ-002-B01': { tasks: ['T1'], tests: ['tests/example.test.js'], evidence: ['evidence/example.log'] }
        }
      }
    });
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true });

    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md', 'npm test', 'Covered: REQ-001, REQ-002');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'converge');
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'verification' });

    writePassingReport(specDir, 'verify-report.md', 'npm run build', 'Covered: REQ-001, REQ-002');
    writeStageHandoff(engine, 'verification', ['verify-report.md', 'traceability.json']);
    const blocked = engine.advance({ compressionConfirmed: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('verification artifact validation failed');
    expect(blocked.error).toContain('traceability.json REQ-001 has no test references');
    expect(blocked.error).toContain('traceability.json REQ-002 has no evidence references');
  });

  it('blocks planning when requirements exist without traceability', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec\nREQ-001: first behavior');
    write(specDir, 'requirements.json', JSON.stringify({
      requirements: [
        { id: 'REQ-001', status: 'passing', acceptance: ['first behavior'] }
      ]
    }, null, 2));
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', `---
requirements: [REQ-001]
---
# Task 1`);
    engine.store.writeStageHandoff('planning', {
      status: 'done',
      summary: 'planning complete',
      artifacts: ['plan.md', 'tasks/']
    });
    const blocked = engine.advance({ compressionConfirmed: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('outputs incomplete');
    expect(blocked.error).toContain('traceability.json');
  });

  it('blocks planning when traceability lacks task mappings', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec\nREQ-001: first behavior');
    write(specDir, 'requirements.json', JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          acceptance: ['first behavior'],
          behaviors: [
            { id: 'REQ-001-B01', category: 'happy-path', description: 'happy path', status: 'failing', acceptance: ['covered'], test_plan: { strategy: 'unit', inputs: ['x'], expected: ['y'] } }
          ]
        }
      ]
    }, null, 2));
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', `---
requirements: [REQ-001]
behavior_ids: [REQ-001-B01]
---
# Task 1`);
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: [],
        tests: [],
        evidence: [],
        behaviors: {
          'REQ-001-B01': { tasks: [], tests: [], evidence: [] }
        }
      }
    });
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/', 'traceability.json']);

    const blocked = engine.advance({ compressionConfirmed: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('planning artifact validation failed');
    expect(blocked.error).toContain('traceability.json REQ-001 has no task references');
    expect(blocked.error).toContain('traceability.json REQ-001-B01 has no task references');
  });

  it('allows executing to update traceability after approval', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec\nREQ-001: first behavior');
    write(specDir, 'requirements.json', JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          acceptance: ['first behavior'],
          behaviors: [
            { id: 'REQ-001-B01', category: 'happy-path', description: 'happy path', status: 'failing', acceptance: ['covered'], test_plan: { strategy: 'unit', inputs: ['x'], expected: ['y'] } }
          ]
        }
      ]
    }, null, 2));
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    mkdirSync(join(specDir, 'tests'), { recursive: true });
    writeFileSync(join(specDir, 'tests', 'example.test.js'), 'test placeholder\n');
    write(specDir, 'tasks/T1.md', `---
requirements: [REQ-001]
behavior_ids: [REQ-001-B01]
---
# Task 1`);
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: ['T1'],
        tests: [],
        evidence: [],
        behaviors: {
          'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] }
        }
      }
    });
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/', 'traceability.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'approved' });
    expect(engine.approve()).toMatchObject({ ok: true, to: 'git-worktree' });
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'executing' });

    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md', 'npm test', 'Covered: REQ-001');
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: ['T1'],
        tests: ['tests/example.test.js#REQ-001'],
        evidence: ['evidence/test-report.md.log'],
        behaviors: {
          'REQ-001-B01': {
            tasks: ['T1'],
            tests: ['tests/example.test.js#REQ-001-B01'],
            evidence: ['evidence/test-report.md.log']
          }
        }
      }
    });
    writeStageHandoff(engine, 'executing', ['test-report.md', 'traceability.json']);

    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'converge' });
    writeStageHandoff(engine, 'converge');
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'verification' });
  });

  it('allows quickfix and chore verification without full spec artifacts', () => {
    for (const type of ['quickfix', 'chore']) {
      const { root, specDir } = setupRealProject();
      const engine = new PipelineEngine(root, specDir);
      engine.initialize(type);
      writeStageHandoff(engine, 'executing', ['handoffs/executing.json']);
      expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'verification' });
      writePassingReport(specDir, 'verify-report.md', 'npm run lint');
      writeStageHandoff(engine, 'verification', ['verify-report.md']);
      expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, complete: true, stage: 'verification' });
    }
  });

  it('blocks verification when traceability references missing files', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec\nREQ-001: first behavior');
    write(specDir, 'requirements.json', JSON.stringify({
      requirements: [
        { id: 'REQ-001', status: 'passing', acceptance: ['first behavior'] }
      ]
    }, null, 2));
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', `---
requirements: [REQ-001]
---
# Task 1`);
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: ['T1'],
        tests: ['tests/missing.test.js'],
        evidence: ['evidence/missing.log']
      }
    });
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true });

    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md', 'npm test', 'Covered: REQ-001');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'converge');
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'verification' });

    writePassingReport(specDir, 'verify-report.md', 'npm run build', 'Covered: REQ-001');
    writeStageHandoff(engine, 'verification', ['verify-report.md', 'traceability.json']);
    const blocked = engine.advance({ compressionConfirmed: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('verification artifact validation failed');
    expect(blocked.error).toContain('test reference not found');
    expect(blocked.error).toContain('evidence reference not found');
  });

  it('blocks converge when traceability omits requirement behavior evidence', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec\nREQ-001: first behavior');
    write(specDir, 'requirements.json', JSON.stringify({
      requirements: [
        {
          id: 'REQ-001',
          status: 'failing',
          acceptance: ['first behavior'],
          behaviors: [
            { id: 'REQ-001-B01', category: 'happy-path', description: 'happy path', status: 'passing', acceptance: ['covered'], test_plan: { strategy: 'unit', inputs: ['x'], expected: ['y'] } },
            { id: 'REQ-001-B02', category: 'invalid-input', description: 'error path', status: 'failing', acceptance: ['covered'], test_plan: { strategy: 'unit', inputs: ['x'], expected: ['y'] } }
          ]
        }
      ]
    }, null, 2));
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'tests', 'example.test.js'), 'test placeholder\n');
    write(specDir, 'tasks/T1.md', `---
requirements: [REQ-001]
behavior_ids: [REQ-001-B01, REQ-001-B02]
---
# Task 1`);
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: ['T1'],
        tests: [],
        evidence: [],
        behaviors: {
          'REQ-001-B01': {
            tasks: ['T1'],
            tests: [],
            evidence: []
          },
          'REQ-001-B02': {
            tasks: ['T1'],
            tests: [],
            evidence: []
          }
        }
      }
    });
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/', 'traceability.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true });

    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md', 'npm test', 'Covered: REQ-001');
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: ['T1'],
        tests: ['tests/example.test.js#REQ-001'],
        evidence: ['evidence/test-report.md.log'],
        behaviors: {
          'REQ-001-B01': {
            tasks: ['T1'],
            tests: ['tests/example.test.js#REQ-001-B01'],
            evidence: ['evidence/test-report.md.log']
          }
        }
      }
    });
    writeStageHandoff(engine, 'executing', ['test-report.md', 'traceability.json']);
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'converge' });

    writeStageHandoff(engine, 'converge');
    const blocked = engine.advance({ compressionConfirmed: true });
    expect(blocked).toMatchObject({ ok: true, retry: true, to: 'executing' });
    expect(blocked.reason).toContain('convergence check failed');
    expect(blocked.reason).toContain('REQ-001-B02');
  });

  it('blocks executing when task state is missing or unfinished', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec');
    writeRequirements(specDir);
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', 't');
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true });

    writePassingReport(specDir, 'test-report.md');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    const missing = engine.advance({ compressionConfirmed: true });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('task state closure failed');
    expect(missing.error).toContain('missing task states: T1');

    engine.store.updateTask('T1', { status: 'pending' });
    const unfinished = engine.advance({ compressionConfirmed: true });
    expect(unfinished.ok).toBe(false);
    expect(unfinished.error).toContain('unfinished task states: T1:pending');

    engine.store.updateTask('T1', { status: 'done' });
    expect(engine.advance({ compressionConfirmed: true })).toMatchObject({ ok: true, to: 'converge' });
  });

  it('blocks executing when spec requirements are not mapped to tasks', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec\nREQ-001: first behavior\nREQ-002: second behavior');
    writeStageHandoff(engine, 'brainstorming', ['spec.md']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', `---
requirements: [REQ-001]
behavior_ids: [REQ-001-B01, REQ-002-B01]
---
# Task 1`);
    writeTraceability(specDir, {
      'REQ-001': {
        tasks: ['T1'],
        tests: ['tests/example.test.js'],
        evidence: ['evidence/example.log'],
        behaviors: {
          'REQ-001-B01': { tasks: ['T1'], tests: ['tests/example.test.js'], evidence: ['evidence/example.log'] }
        }
      },
      'REQ-002': {
        tasks: ['T1'],
        tests: ['tests/example.test.js'],
        evidence: ['evidence/example.log'],
        behaviors: {
          'REQ-002-B01': { tasks: ['T1'], tests: ['tests/example.test.js'], evidence: ['evidence/example.log'] }
        }
      }
    });
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    engine.approve();
    engine.advance({ compressionConfirmed: true });

    engine.store.updateTask('T1', { status: 'done' });
    writePassingReport(specDir, 'test-report.md');
    writeStageHandoff(engine, 'executing', ['test-report.md']);
    const unmapped = engine.advance({ compressionConfirmed: true });
    expect(unmapped.ok).toBe(false);
    expect(unmapped.error).toContain('requirement-task closure failed');
    expect(unmapped.error).toContain('REQ-002');
  });

  it('invalidates approval when approved artifacts change', () => {
    const { root, specDir } = setupRealProject();
    const engine = new PipelineEngine(root, specDir);
    engine.initialize('feature');
    write(specDir, 'spec.md', '# Spec');
    writeRequirements(specDir);
    writeStageHandoff(engine, 'brainstorming', ['spec.md', 'requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'detail-expansion', ['requirements.json']);
    engine.advance({ compressionConfirmed: true });
    writePlan(specDir);
    mkdirSync(join(specDir, 'tasks'), { recursive: true });
    write(specDir, 'tasks/T1.md', 't');
    writeStageHandoff(engine, 'planning', ['plan.md', 'tasks/']);
    engine.advance({ compressionConfirmed: true });
    writeStageHandoff(engine, 'analyze-artifacts');
    engine.advance({ compressionConfirmed: true });
    expect(engine.approve()).toMatchObject({ ok: true, to: 'git-worktree' });

    writePlan(specDir, '# Plan\nChanged after approval');
    const stale = engine.advance({ compressionConfirmed: true });
    expect(stale.ok).toBe(false);
    expect(stale.error).toContain('Stale approval detected');
    expect(stale.error).toContain('plan.md changed');
  });
});
