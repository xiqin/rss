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
    it('hits quickfix for typo', async () => {
      const sel = new PipelineSelector(projectRoot);
      const result = await sel.select('修复 README 里的 typo');
      expect(result.source).toBe('short-circuit:quickfix');
      const ids = result.steps.map(s => s.id);
      expect(ids).toEqual(['executing', 'verification']);
    });

    it('hits chore for dependency upgrade', async () => {
      const sel = new PipelineSelector(projectRoot);
      const result = await sel.select('bump react 到 18，依赖升级');
      expect(result.source).toBe('short-circuit:chore');
      const ids = result.steps.map(s => s.id);
      expect(ids).toContain('executing');
      expect(ids).toContain('verification');
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

    it('hits bugfix-no-brainstorm when root cause known and spec exists', async () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Existing spec');
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
      const sel = new PipelineSelector(projectRoot, specDir);
      const result = await sel.select('加个新功能 feature');
      expect(result.risk).toBe('medium');
      const ids = result.steps.map(s => s.id);
      expect(ids).toEqual(['planning', 'approved', 'executing', 'verification', 'code-review-request', 'review-gate', 'code-review-response', 'synced']);
    });

    it('skips brainstorming when spec.md exists', async () => {
      const specDir = setupSpecDir();
      writeFileSync(join(specDir, 'spec.md'), '# Spec');
      const sel = new PipelineSelector(projectRoot, specDir);
      const result = await sel.select('重构架构');
      const ids = result.steps.map(s => s.id);
      expect(ids).not.toContain('brainstorming');
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
      writeFileSync(join(specDir, 'plan.md'), '# Plan');
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

    it('does not insert approved gate for low risk', () => {
      const sel = new PipelineSelector(projectRoot);
      const steps = sel._validateAndFix(['executing', 'verification'], {
        fileScope: 1,
        hasSpecExists: true
      });
      const ids = steps.map(s => s.id);
      expect(ids).not.toContain('approved');
    });

    it('throws when max_steps exceeded', () => {
      const sel = new PipelineSelector(projectRoot);
      expect(() => sel._validateAndFix(
        ['brainstorming', 'planning', 'approved', 'git-worktree',
         'executing', 'verification',
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
  });
});
