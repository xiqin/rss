/**
 * pipeline-selector.js — AI 自主流程选择
 *
 * 三段决策：
 *   1. 规则短路：明确关键词信号 → 固定 pipeline，0 token
 *   2. AI fallback：信号模糊 → 调 AI（可选注入 aiClient）
 *   3. 规则兜底：AI 未注入或失败 → 按风险等级生成基础流程
 *
 * 输出经 _validateAndFix 校验：依赖闭包、护栏、gate。
 * 返回步骤对象数组，与 pipeline-engine.getSteps() 返回结构兼容。
 */

import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';
import { NodeFileSystem } from './fs-interface.js';

const RISK_KEYWORDS = {
  high: ['重构', '架构', '跨模块', '跨服务', 'refactor', 'architecture', 'cross-module'],
  medium: ['多文件', '新功能', 'feature', '依赖', 'integration', '集成'],
  low: ['typo', '错别字', '单文件', '配置', '文档', '小修复']
};

const ROOT_CAUSE_RE = /根因|root\s*cause|已定位|定位到|根因明确/i;

const STEP_ORDER = [
  'brainstorming', 'detail-expansion',
  'planning', 'analyze-artifacts', 'approved', 'git-worktree',
  'executing', 'converge', 'verification',
  'code-review-request', 'review-gate', 'code-review-response',
  'synced'
];

// 增强模块的触发关键词信号（来自 AGENTS.md + step_catalog.skip_when 的反向）
// 注：omission-hunter 由 converge 内部触发，不作为独立 step 出现在主线，此处不列。
const OPTIONAL_SIGNALS = {
  'detail-expansion': [
    '输入', '权限', '鉴权', '授权', '写操作', '状态', '并发', '原子',
    '外部依赖', '安全', '性能', '可观测', '恢复', '兼容', '幂等',
    'input', 'permission', 'auth', 'concurrency', 'security', 'performance',
    'observability', 'idempotent'
  ],
  'analyze-artifacts': [
    '跨模块', '多模块', '跨服务', '架构', '重构',
    'cross-module', 'architecture', 'refactor'
  ],
  'converge': [
    '多任务', '多 task', '并行', '跨模块', '多模块',
    'multi-task', 'parallel', 'cross-module'
  ]
};

export class PipelineSelector {
  constructor(projectRoot, specDir = null, { fs, aiClient } = {}) {
    this.projectRoot = resolve(projectRoot);
    this.specDir = specDir ? resolve(specDir) : null;
    this.fs = fs || new NodeFileSystem();
    this.aiClient = aiClient || null;
    this.workflow = this._loadWorkflow();
  }

  _loadWorkflow() {
    const wfPath = join(this.projectRoot, '.loom', 'workflow.yaml');
    if (!this.fs.existsSync(wfPath)) return null;
    try {
      return yaml.load(
        this.fs.readFileSync(wfPath, 'utf-8'),
        { schema: yaml.DEFAULT_SAFE_SCHEMA }
      );
    } catch {
      return null;
    }
  }

  /**
   * 主入口：选择 steps
   * @param {string} userRequest
   * @returns {Promise<{ steps: object[], source: string, reasoning: string, risk: string, signals: object }>}
   */
  async select(userRequest) {
    const signals = this._collectSignals(userRequest);

    const sc = this._matchShortCircuit(signals);
    if (sc) {
      const steps = this._validateAndFix(sc.steps, signals, {
        skipClosure: sc.skip_closure === true,
        skipGate: sc.skip_gate === true,
        skipMandatory: sc.skip_mandatory === true
      });
      return {
        steps,
        source: `short-circuit:${sc.name}`,
        reasoning: `命中关键词规则: ${sc.name}`,
        risk: this._assessRisk(signals),
        signals
      };
    }

    if (this.aiClient) {
      try {
        const aiPlan = await this._aiSelect(userRequest, signals);
        if (aiPlan?.steps?.length) {
          const steps = this._validateAndFix(aiPlan.steps, signals);
          return {
            steps,
            source: 'ai',
            reasoning: aiPlan.reasoning || 'AI 选择',
            risk: this._assessRisk(signals),
            signals
          };
        }
      } catch {
        // AI 失败 → 走兜底
      }
    }

    const fb = this._ruleBasedFallback(signals);
    const steps = this._validateAndFix(fb.steps, signals);
    return {
      steps,
      source: `fallback:${fb.name}`,
      reasoning: fb.reasoning,
      risk: fb.risk,
      signals
    };
  }

  // ── 信号收集 ─────────────────────────────────────────────

  _collectSignals(userRequest) {
    const text = (userRequest || '').toLowerCase();
    return {
      rawText: userRequest || '',
      keywords: this._extractKeywords(text),
      fileScope: this._estimateFileScope(text),
      moduleCount: 0,
      hasTestsImpact: /test|测试/.test(text),
      hasSpecExists: this._specExists(),
      hasSpecAndReqs: this._specAndReqsExist(),
      hasRootCause: ROOT_CAUSE_RE.test(text),
      inWorktree: this._isInWorktree(),
      optionalTriggers: this._detectOptionalTriggers(text)
    };
  }

  _detectOptionalTriggers(text) {
    const triggers = {};
    for (const [step, kws] of Object.entries(OPTIONAL_SIGNALS)) {
      triggers[step] = kws.some(kw => text.includes(kw.toLowerCase()));
    }
    return triggers;
  }

  _extractKeywords(text) {
    const all = [...RISK_KEYWORDS.high, ...RISK_KEYWORDS.medium, ...RISK_KEYWORDS.low];
    return all.filter(kw => text.includes(kw.toLowerCase()));
  }

  _estimateFileScope(text) {
    if (/单文件|single\s*file|typo|错别字/.test(text)) return 1;
    if (/跨模块|跨服务|architecture|架构/.test(text)) return 10;
    if (/多文件|多模块|multi/.test(text)) return 5;
    return 3;
  }

  _specExists() {
    if (!this.specDir) return false;
    return this.fs.existsSync(join(this.specDir, 'spec.md'));
  }

  _specAndReqsExist() {
    if (!this.specDir) return false;
    return this.fs.existsSync(join(this.specDir, 'spec.md')) &&
           this.fs.existsSync(join(this.specDir, 'requirements.json'));
  }

  _isInWorktree() {
    try {
      const gitDir = execSync('git rev-parse --git-dir', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      const commonDir = execSync('git rev-parse --git-common-dir', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      return resolve(this.projectRoot, gitDir) !== resolve(this.projectRoot, commonDir);
    } catch {
      return false;
    }
  }

  // ── 规则短路 ────────────────────────────────────────────

  _matchShortCircuit(signals) {
    const rules = this.workflow?.selection_rules?.short_circuits || [];
    for (const rule of rules) {
      if (this._ruleMatches(rule, signals)) return rule;
    }
    return null;
  }

  _ruleMatches(rule, signals) {
    const match = rule.match || {};
    if (match.keywords_any) {
      const hit = match.keywords_any.some(kw =>
        signals.rawText.toLowerCase().includes(kw.toLowerCase())
      );
      if (!hit) return false;
    }
    if (match.file_scope_max != null && signals.fileScope > match.file_scope_max) {
      return false;
    }
    if (match.has_root_cause != null && signals.hasRootCause !== match.has_root_cause) {
      return false;
    }
    return true;
  }

  // ── 风险评估 ─────────────────────────────────────────────

  _assessRisk(signals) {
    const keywords = signals?.keywords || [];
    if (keywords.some(k => RISK_KEYWORDS.high.includes(k))) return 'high';
    if (signals?.fileScope >= 5) return 'high';
    if (keywords.some(k => RISK_KEYWORDS.medium.includes(k))) return 'medium';
    if (signals?.fileScope >= 2) return 'medium';
    return 'low';
  }

  // ── 规则兜底 ─────────────────────────────────────────────

  _ruleBasedFallback(signals) {
    const risk = this._assessRisk(signals);
    const triggers = signals.optionalTriggers || {};

    if (risk === 'low') {
      return {
        name: 'low-risk',
        steps: ['executing', 'verification'],
        reasoning: '低风险改动，直接执行 + 最小验证',
        risk
      };
    }

    if (risk === 'medium') {
      const steps = this._buildMediumFallback(triggers, signals);
      return {
        name: 'medium-risk',
        steps,
        reasoning: '中等风险，需规划 + 审批 + 验证 + 对抗审查 + 同步' +
          this._optionalReasoning(triggers),
        risk
      };
    }

    const steps = this._buildHighFallback(signals, triggers);
    return {
      name: 'high-risk',
      steps,
      reasoning: '高风险，完整流程 + 隔离分支 + 对抗审查' +
        this._optionalReasoning(triggers),
      risk
    };
  }

  _buildMediumFallback(triggers, signals) {
    const steps = ['planning'];
    // mandatory 步骤：有 spec.md + requirements.json 时无条件追加（不再靠 triggers）
    if (signals?.hasSpecAndReqs) {
      steps.splice(steps.indexOf('planning'), 0, 'detail-expansion');
      steps.push('analyze-artifacts');
    } else if (triggers['analyze-artifacts']) {
      steps.push('analyze-artifacts');
    }
    steps.push('approved', 'executing');
    // converge：有 spec/requirements.json 时 mandatory，否则按 triggers
    if (signals?.hasSpecAndReqs || triggers['converge']) {
      steps.push('converge');
    }
    steps.push('verification');
    steps.push('code-review-request', 'review-gate', 'code-review-response', 'synced');
    return steps;
  }

  _buildHighFallback(signals, triggers) {
    const steps = [];
    if (!signals.hasSpecExists) {
      steps.push('brainstorming');
    }
    // detail-expansion：有 spec.md + requirements.json 时 mandatory
    if (signals.hasSpecAndReqs || triggers['detail-expansion']) {
      steps.push('detail-expansion');
    }
    steps.push('planning');
    // analyze-artifacts：有 spec/requirements.json 时 mandatory，否则按 triggers
    if (signals.hasSpecAndReqs || triggers['analyze-artifacts']) {
      steps.push('analyze-artifacts');
    }
    steps.push('approved');
    if (!signals.inWorktree) steps.push('git-worktree');
    steps.push('executing');
    // converge：有 spec/requirements.json 时 mandatory，否则按 triggers
    if (signals.hasSpecAndReqs || triggers['converge']) {
      steps.push('converge');
    }
    steps.push('verification', 'code-review-request', 'review-gate', 'code-review-response', 'synced');
    return steps;
  }

  _optionalReasoning(triggers) {
    const hit = Object.entries(triggers).filter(([, v]) => v).map(([k]) => k);
    if (!hit.length) return '';
    return `；按信号追加 optional: ${hit.join(', ')}`;
  }

  // ── AI fallback（可选注入 aiClient）─────────────────────

  async _aiSelect(userRequest, signals) {
    if (!this.aiClient) return null;
    const catalog = this.workflow?.step_catalog || {};
    const rules = this.workflow?.selection_rules || {};
    const prompt = this._buildAIPrompt(userRequest, signals, catalog, rules);
    const response = await this.aiClient.complete(prompt);
    return this._parseAIResponse(response);
  }

  _buildAIPrompt(userRequest, signals, catalog, rules) {
    return [
      'You are a pipeline selector. Pick steps from the catalog for the user request.',
      '',
      'User request:',
      userRequest,
      '',
      'Signals:',
      JSON.stringify(signals, null, 2),
      '',
      'Step catalog:',
      JSON.stringify(catalog, null, 2),
      '',
      'Selection rules:',
      JSON.stringify(rules, null, 2),
      '',
      'Output JSON: { "steps": ["stepId", ...], "reasoning": "..." }'
    ].join('\n');
  }

  _parseAIResponse(response) {
    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return null;
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  // ── pipeline-plan.md 读写 ───────────────────────────────

  /**
   * 把选择结果写成 pipeline-plan.md
   * @param {object} selection - select() 返回值
   * @returns {{ path: string, content: string }}
   */
  writePipelinePlan(selection) {
    if (!this.specDir) throw new Error('specDir is required to write pipeline-plan.md');
    const content = this._renderPipelinePlan(selection);
    const path = join(this.specDir, 'pipeline-plan.md');
    this.fs.mkdirSync(this.specDir, { recursive: true });
    this.fs.writeFileSync(path, content, 'utf-8');
    return { path, content };
  }

  /**
   * 读 pipeline-plan.md 并解析为 steps
   * @returns {object[]|null} 步骤对象数组，或 null（文件不存在/无步骤段）
   */
  readPipelinePlan() {
    if (!this.specDir) return null;
    const path = join(this.specDir, 'pipeline-plan.md');
    if (!this.fs.existsSync(path)) return null;
    const content = this.fs.readFileSync(path, 'utf-8');

    const stepsSection = this._extractSection(content, '选择步骤');
    if (!stepsSection) return null;

    const catalog = this.workflow?.step_catalog || {};
    const ids = [];
    const lines = stepsSection.split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*\d+\.\s*\*?\*?([a-z][a-z0-9-]*)\*?\*?\s*[—\-]/i);
      if (m) ids.push(m[1]);
    }

    return this._validateAndFix(ids, this._collectSignals(''));
  }

  _extractSection(content, heading) {
    const re = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
    const m = content.match(re);
    return m ? m[1].trim() : null;
  }

  _renderPipelinePlan(selection) {
    const s = selection.signals || {};
    const lines = [];
    lines.push('# Pipeline Plan');
    lines.push('');
    lines.push('> Auto-generated by loom-pipeline-selector. Do not edit manually.');
    lines.push(`> 生成时间: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## 用户需求');
    lines.push('');
    lines.push(s.rawText || '(未提供)');
    lines.push('');
    lines.push('## AI 分析');
    lines.push('');
    lines.push(`- 风险等级: ${selection.risk}`);
    lines.push(`- 关键词: ${(s.keywords || []).join(', ') || '(无)'}`);
    lines.push(`- 影响文件: ${s.fileScope ?? 'unknown'}`);
    lines.push(`- 已有 spec.md: ${s.hasSpecExists ? '是' : '否'}`);
    lines.push(`- 已有 spec.md + requirements.json: ${s.hasSpecAndReqs ? '是' : '否'}`);
    lines.push(`- 已在 worktree: ${s.inWorktree ? '是' : '否'}`);
    lines.push(`- 根因明确: ${s.hasRootCause ? '是' : '否'}`);
    lines.push('');
    lines.push('## 选择步骤');
    lines.push('');
    selection.steps.forEach((step, i) => {
      lines.push(`${i + 1}. **${step.id}** — ${step.description || '(无描述)'}`);
      if (step.skill) lines.push(`   - skill: \`${step.skill}\``);
      if (step.requires?.length) lines.push(`   - requires: ${step.requires.join(', ')}`);
      if (step.outputs?.length) lines.push(`   - outputs: ${step.outputs.join(', ')}`);
    });
    lines.push('');
    lines.push('## 来源');
    lines.push('');
    lines.push(selection.source);
    lines.push('');
    lines.push('## 理由');
    lines.push('');
    lines.push(selection.reasoning);
    lines.push('');
    lines.push('## 下一步');
    lines.push('');
    lines.push(`- 确认方案：\`loom run --spec-dir ${this.specDir} --approve-pipeline\``);
    lines.push(`- 调整步骤：手动编辑本文件后执行 \`loom run --spec-dir ${this.specDir} --approve-pipeline\``);
    lines.push('');
    return lines.join('\n');
  }

  // ── 校验与修正 ───────────────────────────────────────────

  _validateAndFix(stepIds, signals, { skipClosure = false, skipGate = false, skipMandatory = false } = {}) {
    const catalog = this.workflow?.step_catalog;
    if (!catalog) {
      return stepIds.map(id => ({ id }));
    }

    const rules = this.workflow?.selection_rules || {};
    const mustInclude = rules.must_include || [];
    const maxSteps = rules.max_steps || 10;

    let ids = [...new Set(stepIds)];

    for (const m of mustInclude) {
      if (!ids.includes(m)) ids.push(m);
    }

    if (!skipMandatory) {
      ids = this._ensureMandatorySteps(ids, signals, catalog);
    }

    if (!skipClosure) {
      ids = this._ensureDependencyClosure(ids, signals);
    }
    if (!skipGate) {
      ids = this._ensureGate(ids, signals);
    }
    ids = this._sortSteps(ids);

    // optional 模块（catalog 标注 optional: true）不计入 max_steps。
    // mandatory 步骤始终计入，避免质量门禁被裁掉。
    const nonOptionalCount = ids.filter(id => !catalog[id]?.optional).length;
    if (nonOptionalCount > maxSteps) {
      ids = this._trimOptionals(ids, maxSteps, catalog);
      const finalNonOptional = ids.filter(id => !catalog[id]?.optional).length;
      if (finalNonOptional > maxSteps) {
        throw new Error(`Selected steps exceed max_steps (${maxSteps}): ${finalNonOptional} non-optional / ${ids.length} total [${ids.join(',')}]`);
      }
    }

    return ids.map(id => this._stepFromCatalog(id, catalog, { lightweight: skipClosure }));
  }

  _stepFromCatalog(id, catalog = this.workflow?.step_catalog || {}, { lightweight = false } = {}) {
    const def = catalog[id] || {};
    const requires = lightweight && id === 'executing'
      ? []
      : lightweight && id === 'verification'
        ? ['test-report.md']
        : def.requires || [];
    const outputs = lightweight && id === 'executing'
      ? ['handoffs/executing.json']
      : def.outputs || [];
    const validators = lightweight && id === 'executing'
      ? []
      : def.validators || [];
    const gateVerdict = lightweight && id === 'executing'
      ? undefined
      : def.gate_verdict;
    const evidenceRequired = lightweight && id === 'executing'
      ? false
      : def.evidence_required === true;
    return {
      id,
      skill: def.skill ?? null,
      requires,
      outputs,
      validators,
      gate: def.gate ?? (id === 'approved' ? 'human-approval' : undefined),
      gate_verdict: gateVerdict,
      evidence_required: evidenceRequired,
      approval_requires: def.approval_requires || [],
      mandatory: def.mandatory === true,
      optional: def.optional === true,
      description: def.description || ''
    };
  }

  _ensureMandatorySteps(ids, signals, catalog) {
    const result = [...ids];
    const hasStructuredSpec = signals?.hasSpecAndReqs === true;
    for (const [id, def] of Object.entries(catalog || {})) {
      if (def?.mandatory !== true || result.includes(id)) continue;
      const needsStructuredSpec = (def.requires || []).includes('spec.md') && (def.requires || []).includes('requirements.json');
      if (needsStructuredSpec && !hasStructuredSpec) continue;
      result.push(id);
    }
    return result;
  }

  _ensureDependencyClosure(ids, signals) {
    const catalog = this.workflow?.step_catalog || {};
    const result = [...ids];
    let changed = true;
    let iterations = 0;

    while (changed && iterations < 10) {
      changed = false;
      iterations++;
      for (const id of [...result]) {
        const def = catalog[id];
        if (!def?.requires) continue;
        for (const req of def.requires) {
          if (this._fileExists(req)) continue;
          const producer = this._findProducer(req, catalog);
          if (producer && !result.includes(producer)) {
            result.push(producer);
            changed = true;
          }
        }
      }
    }
    return result;
  }

  _fileExists(filename) {
    if (!this.specDir) return false;
    return this.fs.existsSync(join(this.specDir, filename));
  }

  _findProducer(filename, catalog) {
    for (const [id, def] of Object.entries(catalog)) {
      if (def.outputs?.includes(filename)) return id;
    }
    return null;
  }

  _ensureGate(ids, signals) {
    const risk = this._assessRisk(signals);
    if (ids.includes('approved')) return ids;
    const rules = this.workflow?.selection_rules || {};
    if (risk === 'low' && rules.never_skip_gates !== true) return ids;
    if (!ids.includes('planning')) return ids;

    const result = [];
    for (const id of ids) {
      result.push(id);
      if (id === 'planning') {
        result.push('approved');
      }
    }
    return result;
  }

  _sortSteps(ids) {
    return ids.sort((a, b) => {
      const ia = STEP_ORDER.indexOf(a);
      const ib = STEP_ORDER.indexOf(b);
      if (ia < 0 && ib < 0) return 0;
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
  }

  // optional 模块裁剪优先级（越靠前越先被裁掉）：
  //   detail-expansion → analyze-artifacts → converge
  //   converge 最靠近验证关口、价值最高，最后裁。
  //   omission-hunter 由 converge 内部触发，不作为独立 step 裁剪。
  static OPTIONAL_TRIM_ORDER = ['detail-expansion', 'analyze-artifacts', 'converge'];

  _trimOptionals(ids, maxSteps, catalog) {
    const optionalIds = new Set(
      Object.entries(catalog || {})
        .filter(([, def]) => def?.optional === true)
        .map(([id]) => id)
    );
    let result = [...ids];
    for (const candidate of PipelineSelector.OPTIONAL_TRIM_ORDER) {
      if (result.length <= maxSteps) break;
      if (!optionalIds.has(candidate)) continue;
      const idx = result.indexOf(candidate);
      if (idx < 0) continue;
      result.splice(idx, 1);
    }
    return result;
  }
}
