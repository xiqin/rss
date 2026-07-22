import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PipelineSelector } from '../../src/core/pipeline-selector.js';

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'loom-sel-'));
  mkdirSync(join(root, '.loom'), { recursive: true });
  copyFileSync(
    join(process.cwd(), 'templates', 'workflow.yaml'),
    join(root, '.loom', 'workflow.yaml')
  );
  return root;
}

function setupSpecDir() {
  return mkdtempSync(join(tmpdir(), 'loom-sel-spec-'));
}

describe('PipelineSelector', () => {
  let projectRoot;
  beforeEach(() => {
    projectRoot = setupProject();
  });

  // ── 规则短路 ────────────────────────────────────────────

  describe('short-circuit', () => {
    it('keeps quickfix lightweight without dependency closure or gate guards', async () => {
      const sel = new PipelineSelector(projectRoot);
      const result = await sel.select('修复 README 里的 typo');
      expect(result.source).toBe('short-circuit:quickfix');
      const ids = result.steps.map(s => s.id);
      expect(ids).toEqual(['executing', 'verification']);
      const executing = result.steps.find(s => s.id === 'executing');
      const verification = result.steps.find(s => s.id === 'verification');
      expect(executing.requires).toEqual([]);
      expect(executing.outputs).toEqual(['handoffs/executing.json']);
      expect(executing.validators).toEqual([]);
      expect(executing.gate_verdict).toBeUndefined();
      expect(executing.evidence_required).toBe(false);
      expect(verification.requires).toEqual(['test-report.md']);
    });

    it('hits chore for dependency upgrade', async () => {
      const sel = new PipelineSelector(projectRoot);
      const result = await sel.select('bump react 到 18，依赖升级');
      expect(result.source).toBe('short-circuit:chore');
      const ids = result.steps.map(s => s.id);
      expect(ids).toEqual(['executing', 'verification']);
    });

    it('hits hotfix for production emergency', async () => {
      const sel = new PipelineSelector(projectRoot);
      const result = await sel.select('生产紧急 P0 故障');
      expect(result.source).toBe('short-circuit:hotfix');
      const ids = result.steps.map(s => s.id);
      expect(ids).toContain('approved');
      expect(ids).toContain('executing');
      expect(ids).toContain('verification');
    });

    it('hits bugfix-no-brainstorm when root cause known and structured spec artifacts exist', async () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Existing spec');
      writeFileSync(join(specDir, 'requirements.json'), '{"requirements":[]}');
      const sel = new PipelineSelector(projectRoot, specDir);
      const result = await sel.select('已定位 bug 根因，修复 src/auth.js');
      expect(result.source).toBe('short-circuit:bugfix-no-brainstorm');
      const ids = result.steps.map(s => s.id);
      expect(ids).not.toContain('brainstorming');
    });
  });

  // ── 规则兜底 ────────────────────────────────────────────

  describe('fallback (no AI)', () => {
    it('high risk → full pipeline with brainstorming + git-worktree', async () => {
      const sel = new PipelineSelector(projectRoot);
      const result = await sel.select('重构状态管理，跨模块改动');
      expect(result.source).toMatch(/^fallback:/);
      expect(result.risk).toBe('high');
      const ids = result.steps.map(s => s.id);
      expect(ids).toContain('brainstorming');
      expect(ids).toContain('planning');
      expect(ids).toContain('approved');
      expect(ids).toContain('executing');
      expect(ids).toContain('verification');
      expect(ids).toContain('synced');
    });

    it('medium risk → planning + approved + executing + verification + code-review + synced', async () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      writeFileSync(join(specDir, 'requirements.json'), '{"requirements":[]}');
      const sel = new PipelineSelector(projectRoot, specDir);
      const result = await sel.select('加个新功能 feature');
      expect(result.risk).toBe('medium');
      const ids = result.steps.map(s => s.id);
      expect(ids).toEqual(['detail-expansion', 'planning', 'analyze-artifacts', 'approved', 'executing', 'converge', 'verification', 'code-review-request', 'review-gate', 'code-review-response', 'synced']);
    });

    it('skips brainstorming when spec.md and requirements.json exist', async () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      writeFileSync(join(specDir, 'requirements.json'), '{"requirements":[]}');
      const sel = new PipelineSelector(projectRoot, specDir);
      const result = await sel.select('重构架构');
      const ids = result.steps.map(s => s.id);
      expect(ids).not.toContain('brainstorming');
    });

    it('high risk + cross-module signal → appends analyze-artifacts + converge (optional, not counted in max_steps)', async () => {
      const sel = new PipelineSelector(projectRoot);
      const result = await sel.select('重构状态管理，跨模块改动');
      expect(result.source).toMatch(/^fallback:/);
      expect(result.risk).toBe('high');
      const ids = result.steps.map(s => s.id);
      // analyze-artifacts 由"重构/跨模块"触发；converge 由"跨模块"触发
      expect(ids).toContain('analyze-artifacts');
      expect(ids).toContain('converge');
      // optional 位置正确：analyze-artifacts 在 planning 之后 approved 之前
      expect(ids.indexOf('analyze-artifacts')).toBeGreaterThan(ids.indexOf('planning'));
      expect(ids.indexOf('analyze-artifacts')).toBeLessThan(ids.indexOf('approved'));
      // converge 在 executing 之后 verification 之前
      expect(ids.indexOf('converge')).toBeGreaterThan(ids.indexOf('executing'));
      expect(ids.indexOf('converge')).toBeLessThan(ids.indexOf('verification'));
    });

    it('high risk + permission/security signal → appends detail-expansion after brainstorming', async () => {
      const sel = new PipelineSelector(projectRoot);
      const result = await sel.select('重构权限校验和并发安全模块，跨模块改动');
      expect(result.risk).toBe('high');
      const ids = result.steps.map(s => s.id);
      expect(ids).toContain('brainstorming');
      expect(ids).toContain('detail-expansion');
      // detail-expansion 紧随 brainstorming 之后、planning 之前
      expect(ids.indexOf('detail-expansion')).toBeGreaterThan(ids.indexOf('brainstorming'));
      expect(ids.indexOf('detail-expansion')).toBeLessThan(ids.indexOf('planning'));
    });

    it('medium risk without optional triggers → no optional steps (backward compat)', async () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      writeFileSync(join(specDir, 'requirements.json'), '{"requirements":[]}');
      const sel = new PipelineSelector(projectRoot, specDir);
      const result = await sel.select('加个新功能 feature');
      expect(result.risk).toBe('medium');
      const ids = result.steps.map(s => s.id);
      // 有 spec.md + requirements.json 时三步 mandatory，始终追加
      expect(ids).toEqual(['detail-expansion', 'planning', 'analyze-artifacts', 'approved', 'executing', 'converge', 'verification', 'code-review-request', 'review-gate', 'code-review-response', 'synced']);
    });
  });

  // ── 校验与修正 ───────────────────────────────────────────

  describe('validateAndFix', () => {
    it('fills missing must_include (verification)', () => {
      const sel = new PipelineSelector(projectRoot);
      const steps = sel._validateAndFix(['executing'], { fileScope: 3, hasSpecExists: true });
      const ids = steps.map(s => s.id);
      expect(ids).toContain('executing');
      expect(ids).toContain('verification');
    });

    it('fills dependency closure (executing needs plan.md → planning, spec.md → brainstorming)', () => {
      const specDir = setupSpecDir();
      const sel = new PipelineSelector(projectRoot, specDir);
      const steps = sel._validateAndFix(['executing', 'verification'], {
        fileScope: 3,
        hasSpecExists: false
      });
      const ids = steps.map(s => s.id);
      expect(ids).toContain('planning');
      expect(ids).toContain('brainstorming');
    });

    it('skips producer if file already exists', () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      writeFileSync(join(specDir, 'requirements.json'), '{"requirements":[]}');
      writeFileSync(join(specDir, 'plan.md'), '# Plan');
      writeFileSync(join(specDir, 'traceability.json'), '{"requirements":{}}');
      mkdirSync(join(specDir, 'tasks'), { recursive: true });
      const sel = new PipelineSelector(projectRoot, specDir);
      const steps = sel._validateAndFix(['executing', 'verification'], {
        fileScope: 3,
        hasSpecExists: true
      });
      const ids = steps.map(s => s.id);
      expect(ids).not.toContain('brainstorming');
      expect(ids).not.toContain('planning');
    });

    it('inserts approved gate between planning and executing for medium risk', () => {
      const sel = new PipelineSelector(projectRoot);
      const steps = sel._validateAndFix(['planning', 'executing', 'verification'], {
        fileScope: 3,
        hasSpecExists: true
      });
      const ids = steps.map(s => s.id);
      const approvedIdx = ids.indexOf('approved');
      const planningIdx = ids.indexOf('planning');
      const executingIdx = ids.indexOf('executing');
      expect(approvedIdx).toBeGreaterThan(planningIdx);
      expect(approvedIdx).toBeLessThan(executingIdx);
    });

    it('honors never_skip_gates even for low risk dependency closure', () => {
      const sel = new PipelineSelector(projectRoot);
      const steps = sel._validateAndFix(['executing', 'verification'], {
        fileScope: 1,
        hasSpecExists: true
      });
      const ids = steps.map(s => s.id);
      expect(ids).toContain('approved');
    });

    it('throws when max_steps exceeded', () => {
      const sel = new PipelineSelector(projectRoot);
      expect(() => sel._validateAndFix(
        ['brainstorming', 'detail-expansion', 'planning', 'analyze-artifacts', 'approved', 'git-worktree',
         'executing', 'converge', 'verification',
         'code-review-request', 'review-gate', 'code-review-response',
         'synced', 'extra1'],
        { fileScope: 3 }
      )).toThrow(/max_steps/);
    });

    it('marks approved step with human-approval gate', () => {
      const sel = new PipelineSelector(projectRoot);
      const steps = sel._validateAndFix(['planning', 'executing'], {
        fileScope: 3,
        hasSpecExists: true
      });
      const approved = steps.find(s => s.id === 'approved');
      expect(approved).toBeDefined();
      expect(approved.gate).toBe('human-approval');
    });

    it('marks review-gate step with human-approval gate from catalog', () => {
      const sel = new PipelineSelector(projectRoot);
      const steps = sel._validateAndFix(
        ['executing', 'verification', 'code-review-request', 'review-gate', 'code-review-response'],
        { fileScope: 3, hasSpecExists: true }
      );
      const reviewGate = steps.find(s => s.id === 'review-gate');
      expect(reviewGate).toBeDefined();
      expect(reviewGate.gate).toBe('human-approval');
      expect(reviewGate.approval_requires).toEqual(['review-feedback.md']);
    });

    it('preserves validators and evidence requirements in dynamic steps', () => {
      const sel = new PipelineSelector(projectRoot);
      const steps = sel._validateAndFix(
        ['detail-expansion', 'planning', 'analyze-artifacts', 'approved', 'executing', 'converge', 'verification', 'code-review-request', 'review-gate', 'code-review-response'],
        { fileScope: 3, hasSpecExists: true, hasSpecAndReqs: true }
      );
      expect(steps.find(s => s.id === 'detail-expansion').validators).toContain('detail-expansion-pass');
      expect(steps.find(s => s.id === 'analyze-artifacts').validators).toContain('artifact-analysis-pass');
      expect(steps.find(s => s.id === 'converge').validators).toContain('convergence-pass');
      expect(steps.find(s => s.id === 'verification')).toMatchObject({
        gate_verdict: 'verify-report.md',
        evidence_required: true
      });
      expect(steps.find(s => s.id === 'review-gate').approval_requires).toEqual(['review-feedback.md']);
    });

    it('adds mandatory structured-spec gates even when AI omits them', () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      writeFileSync(join(specDir, 'requirements.json'), '{"requirements":[]}');
      const sel = new PipelineSelector(projectRoot, specDir);
      const steps = sel._validateAndFix(['planning', 'approved', 'executing', 'verification'], {
        fileScope: 3,
        hasSpecExists: true,
        hasSpecAndReqs: true
      });
      const ids = steps.map(s => s.id);
      expect(ids).toContain('detail-expansion');
      expect(ids).toContain('analyze-artifacts');
      expect(ids).toContain('converge');
    });

    it('revalidates edited pipeline-plan.md before approving dynamic steps', () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      writeFileSync(join(specDir, 'requirements.json'), '{"requirements":[]}');
      const sel = new PipelineSelector(projectRoot, specDir);
      writeFileSync(join(specDir, 'pipeline-plan.md'), [
        '# Pipeline Plan',
        '',
        '## 选择步骤',
        '',
        '1. **planning** — edited',
        '2. **executing** — edited',
        '3. **verification** — edited',
        ''
      ].join('\n'));

      const ids = sel.readPipelinePlan().map(s => s.id);
      expect(ids).toContain('detail-expansion');
      expect(ids).toContain('analyze-artifacts');
      expect(ids).toContain('approved');
      expect(ids).toContain('converge');
    });

    it('sorts steps in canonical order', () => {
      const sel = new PipelineSelector(projectRoot);
      const steps = sel._validateAndFix(
        ['verification', 'executing', 'planning'],
        { fileScope: 3, hasSpecExists: true }
      );
      const ids = steps.map(s => s.id);
      expect(ids.indexOf('planning')).toBeLessThan(ids.indexOf('executing'));
      expect(ids.indexOf('executing')).toBeLessThan(ids.indexOf('verification'));
    });
  });

  // ── AI fallback ──────────────────────────────────────────

  describe('AI fallback', () => {
    it('uses AI result when aiClient provided', async () => {
      const fakeClient = {
        complete: async () => JSON.stringify({
          steps: ['planning', 'executing', 'verification'],
          reasoning: 'AI analyzed the request'
        })
      };
      const sel = new PipelineSelector(projectRoot, null, { aiClient: fakeClient });
      const result = await sel.select('复杂需求需要 AI 判断');
      expect(result.source).toBe('ai');
      expect(result.reasoning).toBe('AI analyzed the request');
    });

    it('adds mandatory structured-spec steps to AI result', async () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      writeFileSync(join(specDir, 'requirements.json'), '{"requirements":[]}');
      const fakeClient = {
        complete: async () => JSON.stringify({
          steps: ['planning', 'approved', 'executing', 'verification'],
          reasoning: 'AI omitted gates'
        })
      };
      const sel = new PipelineSelector(projectRoot, specDir, { aiClient: fakeClient });
      const result = await sel.select('复杂需求需要 AI 判断');
      const ids = result.steps.map(s => s.id);
      expect(ids).toContain('detail-expansion');
      expect(ids).toContain('analyze-artifacts');
      expect(ids).toContain('converge');
    });

    it('falls back when AI throws', async () => {
      const fakeClient = {
        complete: async () => { throw new Error('AI down'); }
      };
      const sel = new PipelineSelector(projectRoot, null, { aiClient: fakeClient });
      const result = await sel.select('复杂需求需要 AI 判断');
      expect(result.source).toMatch(/^fallback:/);
    });

    it('falls back when AI returns empty', async () => {
      const fakeClient = {
        complete: async () => 'not json'
      };
      const sel = new PipelineSelector(projectRoot, null, { aiClient: fakeClient });
      const result = await sel.select('复杂需求需要 AI 判断');
      expect(result.source).toMatch(/^fallback:/);
    });
  });

  // ── 信号收集 ─────────────────────────────────────────────

  describe('signal collection', () => {
    it('extracts risk keywords', () => {
      const sel = new PipelineSelector(projectRoot);
      const signals = sel._collectSignals('重构状态管理');
      expect(signals.keywords).toContain('重构');
    });

    it('detects root cause mention', () => {
      const sel = new PipelineSelector(projectRoot);
      const signals = sel._collectSignals('已定位根因');
      expect(signals.hasRootCause).toBe(true);
    });

    it('detects spec.md existence', () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      const sel = new PipelineSelector(projectRoot, specDir);
      const signals = sel._collectSignals('any request');
      expect(signals.hasSpecExists).toBe(true);
    });

    it('does not treat a normal git checkout as an extra worktree', () => {
      const sel = new PipelineSelector(process.cwd());
      expect(sel._isInWorktree()).toBe(false);
    });
  });
});
