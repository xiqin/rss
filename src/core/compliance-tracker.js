/**
 * compliance-tracker.js — Skill 遵守率量化
 *
 * 读取 verify-artifacts 输出 + pipeline.state.json 中的历史，
 * 统计每个 skill 被绕过/失败的频率。
 *
 * 数据存储：.loom/compliance/history.json
 *   [{
 *     spec_dir, timestamp, stage, skill,
 *     passed: boolean, violations: string[]
 *   }]
 */

import { NodeFileSystem } from './fs-interface.js';
import { join, basename } from 'node:path';

function now() { return new Date().toISOString(); }

export class ComplianceTracker {
  constructor(projectRoot, { fs } = {}) {
    this.root = projectRoot;
    this.dir = join(projectRoot, '.loom', 'compliance');
    this.historyPath = join(this.dir, 'history.json');
    this.fs = fs || new NodeFileSystem();
  }

  // ── 记录 ────────────────────────────────────────────────────────────────

  record(specDir, stage, skill, passed, violations = []) {
    this.fs.mkdirSync(this.dir, { recursive: true });
    const history = this._load();
    history.push({
      spec_dir: specDir,
      timestamp: now(),
      stage,
      skill,
      passed,
      violations
    });
    // 保留最近 500 条
    if (history.length > 500) history.splice(0, history.length - 500);
    this.fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2) + '\n', 'utf-8');
  }

  /**
   * 从 verify-report.md 中提取违规项并记录
   */
  recordFromVerifyReport(specDir) {
    const reportPath = join(specDir, 'verify-report.md');
    if (!this.fs.existsSync(reportPath)) return;

    const content = this.fs.readFileSync(reportPath, 'utf-8');
    const violations = [];

    // 提取 FAIL / BLOCKER 行
    const failLines = content.match(/(?:FAIL|BLOCKER|ERROR|❌)[^\n]*/gi) || [];
    for (const line of failLines) {
      violations.push(line.trim().slice(0, 200));
    }

    const passed = violations.length === 0;
    this.record(specDir, 'verification', 'loom-verification-before-completion', passed, violations);
  }

  /**
   * 从 pipeline.state.json 的 stage_history 批量导入
   */
  importFromPipeline(specDir) {
    const statePath = join(specDir, 'pipeline.state.json');
    if (!this.fs.existsSync(statePath)) return;

    try {
      const state = JSON.parse(this.fs.readFileSync(statePath, 'utf-8'));
      for (const h of state.stage_history || []) {
        // 已记录的跳过（按 timestamp 去重）
        const history = this._load();
        const key = `${specDir}:${h.stage}:${h.exited_at}`;
        if (history.some(r => `${r.spec_dir}:${r.stage}:${r.timestamp}` === key)) continue;

        this.record(
          specDir, h.stage,
          this._stageToSkill(h.stage),
          h.status === 'passed',
          h.reason ? [h.reason] : []
        );
      }
    } catch {}
  }

  // ── 统计 ────────────────────────────────────────────────────────────────

  /**
   * 按 skill 维度聚合遵守率
   * @returns {{ skill: string, total: number, passed: number, rate: string, topViolations: string[] }[] }
   */
  aggregate() {
    const history = this._load();
    const bySkill = {};

    for (const r of history) {
      const skill = r.skill || 'unknown';
      if (!bySkill[skill]) bySkill[skill] = { skill, total: 0, passed: 0, violations: [] };
      bySkill[skill].total++;
      if (r.passed) bySkill[skill].passed++;
      else bySkill[skill].violations.push(...(r.violations || []));
    }

    return Object.values(bySkill)
      .map(s => ({
        skill: s.skill,
        total: s.total,
        passed: s.passed,
        rate: s.total > 0 ? (s.passed / s.total * 100).toFixed(0) + '%' : 'N/A',
        topViolations: this._topN(s.violations, 5)
      }))
      .sort((a, b) => {
        // 最低遵守率在前（高风险 skill）
        const ra = a.total > 0 ? a.passed / a.total : 1;
        const rb = b.total > 0 ? b.passed / b.total : 1;
        return ra - rb;
      });
  }

  /**
   * 最近 N 次执行的历史
   */
  recent(limit = 20) {
    return this._load().slice(-limit).reverse();
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  _load() {
    if (!this.fs.existsSync(this.historyPath)) return [];
    try { return JSON.parse(this.fs.readFileSync(this.historyPath, 'utf-8')); }
    catch { return []; }
  }

  _stageToSkill(stage) {
    const map = {
      brainstorming: 'loom-brainstorming',
      'detail-expansion': 'loom-detail-expansion',
      planning: 'loom-writing-plans',
      'analyze-artifacts': 'loom-analyze-artifacts',
      'git-worktree': 'loom-using-git-worktrees',
      executing: 'loom-subagent-driven-development',
      converge: 'loom-converge',
      verification: 'loom-verification-before-completion',
      synced: 'loom-index-update'
    };
    return map[stage] || stage;
  }

  _topN(arr, n) {
    const counts = {};
    for (const v of arr) { counts[v] = (counts[v] || 0) + 1; }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([v, c]) => `${v} (${c}x)`);
  }
}
