/**
 * pipeline-engine.js — 流水线执行引擎
 *
 * 核心逻辑：读取 workflow.yaml → 根据当前 spec 状态判断阶段 →
 * 检查前置产物 → 执行阶段（或等待人工干预） → 校验产物 → 推进下一阶段
 *
 * 引擎本身不执行 AI 任务；它是一个状态机控制器，负责：
 *   1. 状态判断和推进
 *   2. 产物校验门禁
 *   3. 阻断和上报
 *   4. 提供给 MCP Server 调用的 API
 */

import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { NodeFileSystem } from './fs-interface.js';
import { PipelineStateStore } from './state-store.js';
import { SpecLock } from './lock.js';
import { ComplianceTracker } from './compliance-tracker.js';
import { compareFingerprints, fingerprintDeclaredPaths } from './fingerprints.js';
import { verifyArtifacts } from '../../skills/loom-verification-before-completion/scripts/verify-artifacts.mjs';
import { runDetailExpansionCheck } from '../../skills/loom-detail-expansion/scripts/check-detail-expansion.mjs';
import { runAnalyzeArtifacts } from '../../skills/loom-analyze-artifacts/scripts/analyze-artifacts.mjs';
import { runConverge } from '../../skills/loom-converge/scripts/converge.mjs';
import { validateTraceabilityFile } from './traceability.js';
import {
  checkPreconditions, checkStageOutputs,
  isReportPassing,
  inferStageFromArtifacts
} from './artifact-checker.js';

const CONTEXT_PRESERVE = [
  'spec.md',
  'plan.md',
  'tasks/',
  'test-report.md',
  'verify-report.md',
  'pipeline.state.json',
  'progress.md',
  'handoffs/'
];

const APPROVAL_FINGERPRINT_EXCLUDES = new Set([
  'traceability.json'
]);

const STAGE_RECOMMENDED_READS = {
  brainstorming: [
    '.loom/rules/product.md',
    '.loom/rules/constitution.md',
    'progress.md'
  ],
  'detail-expansion': [
    'spec.md',
    'requirements.json',
    'progress.md',
    'handoffs/brainstorming.json'
  ],
  planning: [
    'spec.md',
    'requirements.json',
    'progress.md',
    'handoffs/brainstorming.json',
    'handoffs/detail-expansion.json',
    '.loom/rules/constitution.md',
    '.loom/contexts/subagent-context.md'
  ],
  'analyze-artifacts': [
    'spec.md',
    'requirements.json',
    'plan.md',
    'tasks/',
    'traceability.json',
    'progress.md',
    'handoffs/planning.json'
  ],
  'git-worktree': [
    'spec.md',
    'plan.md',
    'progress.md',
    'handoffs/planning.json'
  ],
  executing: [
    'spec.md',
    'plan.md',
    'tasks/',
    'progress.md',
    'handoffs/planning.json',
    '.loom/contexts/subagent-context.md'
  ],
  converge: [
    'spec.md',
    'requirements.json',
    'plan.md',
    'tasks/',
    'traceability.json',
    'test-report.md',
    'progress.md',
    'handoffs/executing.json'
  ],
  verification: [
    'spec.md',
    'test-report.md',
    'convergence-report.json',
    'progress.md',
    'handoffs/executing.json',
    'handoffs/converge.json',
    '.loom/rules/constitution.md'
  ],
  synced: [
    'verify-report.md',
    'progress.md',
    'handoffs/verification.json',
    '.loom/memory/MEMORY.md'
  ]
};

function summarizeHandoffs(handoffs) {
  return handoffs.map(h => ({
    id: h.stage || h.task_id || null,
    stage: h.stage || null,
    task_id: h.task_id || null,
    status: h.status || null,
    summary: h.summary || h.notes || h.description || null,
    artifacts: h.artifacts || h.outputs || h.files || h.changed_files || [],
    written_at: h.written_at || null
  }));
}

function taskIdFromFilename(filename) {
  return filename.replace(/\.md$/i, '');
}

function listTaskIds(specDir, fs) {
  const tasksDir = join(specDir, 'tasks');
  if (!fs.existsSync(tasksDir)) return [];
  return fs.readdirSync(tasksDir)
    .filter(f => /^T\d+\.md$/i.test(f))
    .map(taskIdFromFilename)
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
}

function extractRequirementIds(content) {
  return [...new Set([...content.matchAll(/\bREQ-\d{3,}\b/g)].map(match => match[0]))];
}

function parseTaskRequirementIds(content) {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/m)?.[1] || '';
  const inline = frontmatter.match(/^requirements\s*:\s*\[([^\]]*)\]/m)?.[1];
  if (inline) {
    return inline
      .split(',')
      .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  const block = frontmatter.match(/^requirements\s*:\s*\n((?:\s*-\s*[^\n]+\n?)+)/m)?.[1];
  if (!block) return [];
  return block
    .split('\n')
    .map(line => line.match(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/)?.[1]?.trim())
    .filter(Boolean);
}

function checkRequirementTaskClosure(specDir, fs) {
  const specPath = join(specDir, 'spec.md');
  if (!fs.existsSync(specPath)) return { ok: true };

  const requirementIds = extractRequirementIds(fs.readFileSync(specPath, 'utf-8'));
  if (requirementIds.length === 0) return { ok: true };

  const tasksDir = join(specDir, 'tasks');
  const mapped = new Set();
  if (fs.existsSync(tasksDir)) {
    for (const taskId of listTaskIds(specDir, fs)) {
      const content = fs.readFileSync(join(tasksDir, `${taskId}.md`), 'utf-8');
      for (const id of parseTaskRequirementIds(content)) mapped.add(id);
    }
  }

  const unmapped = requirementIds.filter(id => !mapped.has(id));
  return { ok: unmapped.length === 0, unmapped };
}

function checkTaskStateClosure(specDir, store, fs) {
  const expected = listTaskIds(specDir, fs);
  if (expected.length === 0) return { ok: true };

  const states = store.readAllTasks();
  const byId = new Map(states.map(t => [t.task_id, t]));
  const expectedSet = new Set(expected);
  const missing = expected.filter(id => !byId.has(id));
  const notDone = expected
    .map(id => byId.get(id))
    .filter(Boolean)
    .filter(t => t.status !== 'done')
    .map(t => `${t.task_id}:${t.status || 'unknown'}`);
  const extra = states
    .filter(t => /^T\d+$/i.test(t.task_id || '') && !expectedSet.has(t.task_id))
    .map(t => t.task_id);

  return {
    ok: missing.length === 0 && notDone.length === 0 && extra.length === 0,
    missing,
    notDone,
    extra
  };
}

function approvalArtifactPaths(currentStep, nextStep, specDir, fs) {
  const candidates = [
    ...(currentStep?.requires || []),
    ...(currentStep?.approval_requires || []),
    ...(currentStep?.outputs || []),
    ...(nextStep?.requires || []),
    'spec.md',
    'requirements.json',
    'plan.md',
    'artifact-analysis.json',
    'review-request.md',
    'review-feedback.md',
    'qa-cases.md',
    'manual-checklist.md'
  ];
  return [...new Set(candidates)]
    .filter(path => !APPROVAL_FINGERPRINT_EXCLUDES.has(path.replace(/\/$/, '')))
    .filter(path => fs.existsSync(join(specDir, path.replace(/\/$/, ''))));
}

function checkApprovalRequirements(specDir, currentStep, fs) {
  const approvalRequires = currentStep?.approval_requires || [];
  if (approvalRequires.length === 0) return { ok: true };
  return checkStageOutputs(specDir, approvalRequires, fs);
}

function parseVerdict(content) {
  const match = content.match(/^\s*verdict\s*:\s*([^\r\n#]+)/im);
  return match ? match[1].trim().toUpperCase() : null;
}

function checkReviewFeedbackApproval(specDir, currentStep, fs) {
  if (!currentStep?.approval_requires?.includes('review-feedback.md')) return { ok: true };
  const feedbackPath = join(specDir, 'review-feedback.md');
  if (!fs.existsSync(feedbackPath)) return { ok: true };

  const content = fs.readFileSync(feedbackPath, 'utf8');
  const verdict = parseVerdict(content);
  const blockers = content.match(/\b(BLOCKER|FAIL|FAILED|CHANGES_REQUESTED|CHANGE_REQUESTED|REQUEST_CHANGES|REJECTED)\b/gi) || [];
  if (verdict === 'PASS' && blockers.length === 0) return { ok: true };

  const reasons = [];
  if (!verdict) reasons.push('missing verdict');
  else if (verdict !== 'PASS') reasons.push(`verdict: ${verdict}`);
  if (blockers.length > 0) reasons.push(`blocking markers: ${[...new Set(blockers.map(b => b.toUpperCase()))].join(', ')}`);
  return { ok: false, verdict, blockers: [...new Set(blockers.map(b => b.toUpperCase()))], reasons };
}

function checkApprovalFreshness(state, specDir, projectRoot, fs) {
  const stale = [];
  for (const entry of state?.stage_history || []) {
    if (!entry.approval_fingerprints) continue;
    const changes = compareFingerprints(entry.approval_fingerprints, { specDir, projectRoot, fs });
    if (changes.length > 0) stale.push({ stage: entry.stage, changes });
  }
  return { ok: stale.length === 0, stale };
}

const ADVANCE_VALIDATORS = {
  'planning-artifacts': ({ specDir, stage }) => {
    if (stage !== 'planning') return { ok: true };
    const errors = [];
    const result = validateTraceabilityFile(specDir, errors, { required: true, requireEvidence: false });
    if (errors.length === 0) return { ok: true };
    return {
      ok: false,
      error: `Stage "${stage}" planning artifact validation failed: ${errors.join('; ')}`,
      hint: 'planning 阶段必须通过 traceability.json 的确定性校验，确保每个 REQ 和 behavior 都已映射到 task；tests/evidence 可在 executing 阶段补齐。'
    };
  },
  'task-state-closure': ({ specDir, store, fs, stage }) => {
    if (stage !== 'executing') return { ok: true };
    const taskCheck = checkTaskStateClosure(specDir, store, fs);
    if (taskCheck.ok) return { ok: true };
    const details = [];
    if (taskCheck.missing?.length) details.push(`missing task states: ${taskCheck.missing.join(', ')}`);
    if (taskCheck.notDone?.length) details.push(`unfinished task states: ${taskCheck.notDone.join(', ')}`);
    if (taskCheck.extra?.length) details.push(`unexpected task states: ${taskCheck.extra.join(', ')}`);
    return {
      ok: false,
      error: `Stage "${stage}" task state closure failed: ${details.join('; ')}`,
      hint: '每个 tasks/Tn.md 必须有对应 task-states/Tn.state.json，且 status 必须为 done；多余 task state 也需要清理或补齐 task 文件。'
    };
  },
  'requirement-task-closure': ({ specDir, fs, stage }) => {
    if (stage !== 'executing') return { ok: true };
    const closure = checkRequirementTaskClosure(specDir, fs);
    if (closure.ok) return { ok: true };
    return {
      ok: false,
      error: `Stage "${stage}" requirement-task closure failed: unmapped requirements: ${closure.unmapped.join(', ')}`,
      hint: 'spec.md 中每个 REQ-xxx 都必须出现在至少一个 tasks/Tn.md 的 frontmatter requirements 列表中。'
    };
  },
  'verification-artifacts': ({ specDir, stage }) => {
    if (stage !== 'verification') return { ok: true };
    const verification = verifyArtifacts({ specDir });
    if (verification.ok) return { ok: true };
    return {
      ok: false,
      error: `Stage "${stage}" verification artifact validation failed: ${verification.errors.join('; ')}`,
      warnings: verification.warnings,
      hint: '执行完成前必须通过 loom-verification-before-completion 的确定性产物校验，确保测试报告、证据和 REQ 覆盖一致。'
    };
  },
  'detail-expansion-pass': ({ specDir, stage }) => {
    if (stage !== 'detail-expansion') return { ok: true };
    const result = runDetailExpansionCheck(specDir);
    if (result.ok) return { ok: true };
    return {
      ok: false,
      error: `Stage "${stage}" detail-expansion check failed: ${(result.errors || []).join('; ')}`,
      warnings: result.warnings || [],
      hint: '每个 behavior 必须有非空 test_plan、非 placeholder 的 description、且 status 不为 requires-clarification；每个 REQ 的 required_categories 必须全部覆盖。'
    };
  },
  'artifact-analysis-pass': ({ specDir, stage }) => {
    if (stage !== 'analyze-artifacts') return { ok: true };
    const result = runAnalyzeArtifacts(specDir);
    if (result.ok) return { ok: true };
    return {
      ok: false,
      error: `Stage "${stage}" artifact analysis failed: ${(result.errors || []).join('; ')}`,
      hint: '跨产物一致性检查发现 blocker：spec/requirements/tasks/traceability 之间存在缺失、未映射或冲突。请按 findings 列表逐项修复后重新运行 analyze-artifacts。'
    };
  },
  'convergence-pass': ({ specDir, stage, store }) => {
    if (stage !== 'converge') return { ok: true };
    const state = store?.read?.() || {};
    const round = (state.metadata?.convergence_round || 0) + 1;
    const result = runConverge(specDir, round);
    if (result.ok) return { ok: true, clear_convergence_round: true };
    if (round >= 3) {
      return {
        ok: false,
        error: `Stage "${stage}" convergence check failed after ${round} rounds: ${(result.errors || []).join('; ')}`,
        hint: 'converge 已达到最多 3 轮仍未收敛。请标记 failed，重新拆分任务或扩大修复范围。'
      };
    }
    return {
      ok: false,
      retry_target: 'executing',
      convergence_round: round,
      error: `Stage "${stage}" convergence check failed: ${(result.errors || []).join('; ')}`,
      hint: '意图清单收敛检查发现 blocker：存在 missing tests/evidence 的 behavior。请把 missing/partial 回流 executing 生成新 task，补齐后再重新运行 converge。'
    };
  }
};

function validatorIdsForStep(step, stage) {
  const ids = [...(step?.validators || [])];
  if (stage === 'executing') ids.push('task-state-closure', 'requirement-task-closure');
  return [...new Set(ids)];
}

function runAdvanceValidators(context) {
  const passed = { ok: true };
  for (const id of validatorIdsForStep(context.step, context.stage)) {
    const validator = ADVANCE_VALIDATORS[id];
    if (!validator) {
      return { ok: false, error: `Unknown validator "${id}"`, hint: '检查 workflow.yaml 中 validators 声明是否拼写正确，或先实现对应 validator。' };
    }
    const result = validator(context);
    if (!result.ok) return { validator: id, ...result };
    Object.assign(passed, result);
  }
  return passed;
}

// ── Workflow 解析 ──────────────────────────────────────────────────────────

/**
 * 解析 workflow.yaml：使用 js-yaml（YAML 1.2 标准）解析，
 * 规范化 pipelines 结构使每个 pipeline 为步骤数组。
 */
function normalizePipelines(parsed) {
  if (!parsed.pipelines || typeof parsed.pipelines !== 'object') return;
  for (const [name, value] of Object.entries(parsed.pipelines)) {
    if (Array.isArray(value)) continue; // 已是步骤数组
    if (value && typeof value === 'object' && Array.isArray(value.steps)) {
      parsed.pipelines[name] = value.steps;
    } else {
      parsed.pipelines[name] = [];
    }
  }
}

export function loadWorkflow(projectRoot, fs = new NodeFileSystem(), { requirePipelines = true } = {}) {
  const wfPath = join(projectRoot, '.loom', 'workflow.yaml');
  if (!fs.existsSync(wfPath)) return null;

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(wfPath, 'utf-8'), { schema: yaml.DEFAULT_SAFE_SCHEMA });
  } catch (err) {
    const detail = err.mark ? ` (line ${err.mark.line + 1})` : '';
    throw new Error(`YAML syntax error in ${wfPath}${detail}: ${err.reason || err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      `Failed to parse workflow from ${wfPath}. ` +
      `Check indentation (2-space) and YAML structure.`
    );
  }

  if (!parsed.pipelines) {
    if (!requirePipelines) {
      parsed.pipelines = {};
      parsed.defaults ||= {};
      return parsed;
    }
    throw new Error(
      `Failed to parse any pipelines from ${wfPath}. ` +
      `Check indentation (2-space) and structure (pipelines: <name>: steps: - id: ...).`
    );
  }

  normalizePipelines(parsed);

  if (Object.keys(parsed.pipelines).length === 0) {
    throw new Error(
      `Failed to parse any pipelines from ${wfPath}. ` +
      `Check indentation (2-space) and structure (pipelines: <name>: steps: - id: ...).`
    );
  }

  // 结构校验：每个 pipeline 是数组，每个 step 有 id
  for (const [name, steps] of Object.entries(parsed.pipelines)) {
    if (!Array.isArray(steps)) {
      throw new Error(`Pipeline "${name}" must be a list of steps in ${wfPath}`);
    }
    for (const step of steps) {
      if (!step || !step.id) {
        throw new Error(`Pipeline "${name}" has a step missing "id" in ${wfPath}`);
      }
    }
  }

  return parsed;
}

// ── PipelineEngine ─────────────────────────────────────────────────────────

export class PipelineEngine {
  /**
   * @param {string} projectRoot  项目根目录
   * @param {string} specDir      specs/<date+feature> 的绝对路径
   */
  constructor(projectRoot, specDir, { fs, requirePipelines = true } = {}) {
    this.projectRoot = resolve(projectRoot);
    this.specDir = resolve(specDir);
    this.fs = fs || new NodeFileSystem();
    this.store = new PipelineStateStore(this.specDir, { fs: this.fs, projectRoot: this.projectRoot });
    this.lock = new SpecLock(this.specDir, { fs: this.fs });
    this.workflow = loadWorkflow(this.projectRoot, this.fs, { requirePipelines });
  }

  // ── 状态查询（无副作用）───────────────────────────────────────────────────

  /** 获取完整快照 */
  snapshot() {
    return this.store.snapshot();
  }

  /** 获取当前阶段 */
  currentStage() {
    const state = this.store.read();
    if (state) return state.current_stage;
    return inferStageFromArtifacts(this.specDir, this.fs);
  }

  /** 获取流水线步骤定义 */
  getSteps(pipelineType = null) {
    if (!this.workflow) return [];
    const state = this.store.read();
    if (state?.dynamic_steps?.length) {
      return state.dynamic_steps;
    }
    const type = pipelineType || state?.pipeline_type || this.workflow.defaults.pipeline_type;
    return this.workflow.pipelines[type] || [];
  }

  /** 获取当前阶段之后的下一步 */
  nextStep(currentStageId = null) {
    const stage = currentStageId || this.currentStage();
    const steps = this.getSteps();
    const idx = steps.findIndex(s => s.id === stage);
    if (idx < 0 || idx >= steps.length - 1) return null;
    return steps[idx + 1];
  }

  /** 判断是否是 human-approval gate */
  isGate(stageId = null) {
    const stage = stageId || this.currentStage();
    const steps = this.getSteps();
    const step = steps.find(s => s.id === stage);
    return step?.gate === 'human-approval';
  }

  // ── 带副作用的操作（需要 lock）──────────────────────────────────────────

  /**
   * 初始化流水线
   * @param {string|null} [pipelineType]
   * @param {{ dynamicSteps?: object[] }} [opts] AI 自主选择模式时传入
   * @returns {{ ok: boolean, state?: object, error?: string }}
   */
  initialize(pipelineType = null, { dynamicSteps } = {}) {
    const type = pipelineType || this.workflow?.defaults?.pipeline_type || 'feature';
    const version = this._readVersion();
    const steps = dynamicSteps || this.getSteps(type);
    const firstStage = steps[0]?.id || 'brainstorming';
    const state = this.store.init(type, version, firstStage, dynamicSteps || null);
    return { ok: true, state };
  }

  /**
   * 执行中调整步骤（如发现改动超出预期）
   * - 已进入过的阶段不可删除
   * - 新步骤追加到尾部
   * @param {object[]} newRemainingSteps
   * @returns {{ ok: boolean, dynamic_steps?: object[], error?: string }}
   */
  adjust(newRemainingSteps) {
    const state = this.store.read();
    if (!state) return { ok: false, error: 'Pipeline not initialized', hint: '执行 loom run --spec-dir <spec目录> 初始化流水线' };

    const entered = new Set([
      ...(state.stage_history || []).map(h => h.stage),
      state.current_stage
    ]);

    const currentDynamic = state.dynamic_steps || this.getSteps(state.pipeline_type);
    const enteredInOrder = currentDynamic.filter(s => entered.has(s.id));
    const newRemaining = newRemainingSteps.filter(s => !entered.has(s.id));

    const merged = [...enteredInOrder, ...newRemaining];
    this.store.setDynamicSteps(merged);
    return { ok: true, dynamic_steps: merged };
  }

  /**
   * 尝试推进到下一阶段
   * @param {{ compressionConfirmed?: boolean }} [opts]
   * @returns {{ ok: boolean, from?: string, to?: string, error?: string, missing?: string[] }}
   */
  advance({ compressionConfirmed = false } = {}) {
    const state = this.store.read();
    if (!state) return { ok: false, error: 'Pipeline not initialized. Run: loom run --init', hint: '执行 loom run --spec-dir <spec目录> 初始化流水线' };

    const current = state.current_stage;

    // 失败状态不能自动推进
    if (current === 'failed') {
      return { ok: false, error: 'Pipeline is in failed state. Use: loom run --recover <stage>', hint: '执行 loom run --spec-dir <spec目录> --recover <阶段名> 从失败恢复' };
    }

    const approvalFreshness = checkApprovalFreshness(state, this.specDir, this.projectRoot, this.fs);
    if (!approvalFreshness.ok) {
      const details = approvalFreshness.stale
        .map(a => `${a.stage}: ${a.changes.map(c => `${c.path} ${c.reason}`).join(', ')}`)
        .join('; ');
      return { ok: false, error: `Stale approval detected: ${details}`, stale_approvals: approvalFreshness.stale, hint: '审批后关键产物已变化；请重新审查并通过对应人工 gate。' };
    }

    const staleHandoffs = this.store.findStaleHandoffs();
    if (staleHandoffs.length > 0) {
      const details = staleHandoffs
        .map(h => `${h.id}: ${h.changes.map(c => `${c.path} ${c.reason}`).join(', ')}`)
        .join('; ');
      return { ok: false, error: `Stale handoff detected: ${details}`, hint: '相关事实已变化；重新读取源码/规格并刷新对应 handoff，无需恢复原始长对话。' };
    }

    // 如果当前是 gate，必须由用户确认（不能自动跳过）
    if (this.isGate(current)) {
      return { ok: false, error: `Stage "${current}" is a human-approval gate. Use: loom run --approve`, hint: '执行 loom run --spec-dir <spec目录> --approve 通过审批门禁' };
    }

    // 从 step 定义读当前阶段产物
    const steps = this.getSteps();
    const currentStep = steps.find(s => s.id === current);
    const outputCheck = checkStageOutputs(this.specDir, currentStep?.outputs ?? [], this.fs);
    if (!outputCheck.ok) {
      const reasons = [];
      if (outputCheck.missing.length > 0) reasons.push(`missing: ${outputCheck.missing.join(', ')}`);
      if (outputCheck.withPlaceholders.length > 0) reasons.push(`placeholders in: ${outputCheck.withPlaceholders.join(', ')}`);
      return { ok: false, error: `Stage "${current}" outputs incomplete: ${reasons.join('; ')}`, hint: `确保当前阶段的产物文件已创建且无 TBD/TODO/FIXME/XXX 占位符。缺失: ${outputCheck.missing.join(', ')}，有占位符: ${outputCheck.withPlaceholders.join(', ')}` };
    }

    // 声明式 verdict 门禁（gate_verdict 在当前 step 声明）
    if (currentStep?.gate_verdict) {
      if (!isReportPassing(this.specDir, currentStep.gate_verdict, this.fs, { requireEvidence: currentStep.evidence_required === true })) {
        return { ok: false, error: `${currentStep.gate_verdict} lacks a valid PASS verdict or evidence receipt.`, hint: `确认报告为 PASS；若本阶段要求证据，还需提供 evidence-command / exit-code / file / sha256，且日志哈希必须匹配。` };
      }
    }

    const validatorCheck = runAdvanceValidators({
      stage: current,
      step: currentStep,
      specDir: this.specDir,
      projectRoot: this.projectRoot,
      store: this.store,
      fs: this.fs
    });
    if (!validatorCheck.ok) {
      if (validatorCheck.retry_target) {
        if (this._requiresStageCompression(currentStep, current) && !compressionConfirmed) {
          return {
            ...validatorCheck,
            compression_required: true,
            required_action: 'compress_closed_stage_context',
            hint: `${validatorCheck.hint} 已写入阶段 handoff 后，先压缩已结束阶段上下文，再以 compression_confirmed=true 回流到 ${validatorCheck.retry_target}。`
          };
        }
        this.store.transition(validatorCheck.retry_target, {
          history: {
            retry_from: current,
            validator: validatorCheck.validator,
            reason: validatorCheck.error,
            status: 'retry'
          },
          data: {
            ...(validatorCheck.convergence_round ? { convergence_round: validatorCheck.convergence_round } : {})
          }
        });
        return {
          ok: true,
          from: current,
          to: validatorCheck.retry_target,
          retry: true,
          validator: validatorCheck.validator,
          convergence_round: validatorCheck.convergence_round,
          reason: validatorCheck.error
        };
      }
      return validatorCheck;
    }

    if (validatorCheck.clear_convergence_round) {
      this.store.updateMetadata({ convergence_round: undefined });
    }

    // 当前阶段产物完整后再判断是否有下一步，确保终止阶段也受 outputs/verdict 门禁约束。
    const next = this.nextStep(current);
    if (!next) {
      const completed = this.store.completeCurrentStage({ history: { terminal: true } });
      if (!completed?.alreadyCompleted && current === 'verification') this._recordCompliance(current);
      return { ok: true, complete: true, stage: current, alreadyComplete: completed?.alreadyCompleted === true };
    }

    if (this._requiresStageCompression(currentStep, current) && !compressionConfirmed) {
      return {
        ok: false,
        error: `Stage "${current}" requires context compression before advancing.`,
        hint: '已写入阶段 handoff 后，先调用宿主环境的 compress 压缩已结束阶段原始上下文，再以 compression_confirmed=true 调用 loom_advance_pipeline，或用 CLI --compression-confirmed。',
        compression_required: true,
        required_action: 'compress_closed_stage_context'
      };
    }

    // 检查下一阶段的前置条件（requires 在 next step 声明）
    const preCheck = checkPreconditions(this.specDir, next.requires ?? [], this.fs);
    if (!preCheck.ok) {
      return { ok: false, error: `Preconditions for "${next.id}" not met: ${preCheck.missing.join(', ')}`, hint: `先完成前置条件中缺少的产物: ${preCheck.missing.join(', ')}` };
    }

    // 推进
    this.store.transition(next.id);
    this._recordCompliance(current);
    return { ok: true, from: current, to: next.id };
  }

  /**
   * 审批通过（针对 human-approval gate）
   */
  approve() {
    const state = this.store.read();
    if (!state) return { ok: false, error: 'Pipeline not initialized', hint: '执行 loom run --spec-dir <spec目录> 初始化流水线' };

    if (!this.isGate(state.current_stage)) {
      return { ok: false, error: `Stage "${state.current_stage}" is not a gate. No approval needed.`, hint: '当前阶段不是审批门禁，可以直接推进' };
    }
    const staleHandoffs = this.store.findStaleHandoffs();
    if (staleHandoffs.length > 0) {
      return { ok: false, error: 'Cannot approve: an upstream handoff is stale', stale_handoffs: staleHandoffs, hint: '刷新受影响的 spec/plan handoff 后再审批。' };
    }

    const next = this.nextStep();
    if (!next) return { ok: false, error: 'No next step after gate', hint: '检查 workflow.yaml 中 gate 后的步骤配置' };

    const steps = this.getSteps();
    const currentStep = steps.find(s => s.id === state.current_stage);
    const approvalCheck = checkApprovalRequirements(this.specDir, currentStep, this.fs);
    if (!approvalCheck.ok) {
      const reasons = [];
      if (approvalCheck.missing.length > 0) reasons.push(`missing: ${approvalCheck.missing.join(', ')}`);
      if (approvalCheck.withPlaceholders.length > 0) reasons.push(`placeholders in: ${approvalCheck.withPlaceholders.join(', ')}`);
      return { ok: false, error: `Approval requirements for "${state.current_stage}" not met: ${reasons.join('; ')}`, hint: `通过该人工 gate 前必须补齐 approval_requires 产物且无占位符。缺失: ${approvalCheck.missing.join(', ')}，有占位符: ${approvalCheck.withPlaceholders.join(', ')}` };
    }
    const reviewFeedbackCheck = checkReviewFeedbackApproval(this.specDir, currentStep, this.fs);
    if (!reviewFeedbackCheck.ok) {
      return {
        ok: false,
        error: `Review feedback for "${state.current_stage}" is not approved: ${reviewFeedbackCheck.reasons.join('; ')}`,
        hint: 'review-feedback.md 必须包含 verdict: PASS，且不能包含 BLOCKER、FAIL、CHANGES_REQUESTED 等阻断标记。'
      };
    }
    const approvalArtifacts = approvalArtifactPaths(currentStep, next, this.specDir, this.fs);
    const approvalFingerprints = fingerprintDeclaredPaths(approvalArtifacts, {
      specDir: this.specDir,
      projectRoot: this.projectRoot,
      fs: this.fs
    });

    this.store.transition(next.id, {
      history: {
        approval: 'user_confirmed',
        approval_fingerprints: approvalFingerprints,
        approved_at: new Date().toISOString()
      }
    });
    return { ok: true, from: state.current_stage, to: next.id };
  }

  /**
   * 从失败状态恢复到指定阶段
   */
  recover(targetStage) {
    const state = this.store.read();
    if (!state) return { ok: false, error: 'Pipeline not initialized', hint: '执行 loom run --spec-dir <spec目录> 初始化流水线' };
    if (state.current_stage !== 'failed') {
      return { ok: false, error: `Pipeline is in "${state.current_stage}", not "failed"`, hint: '只有处于 failed 状态的流水线才能 recover' };
    }

    const steps = this.getSteps();
    const valid = steps.find(s => s.id === targetStage);
    if (!valid) return { ok: false, error: `"${targetStage}" is not a valid stage`, hint: `可用阶段: ${steps.map(s => s.id).join(', ')}` };

    this.store.transition(targetStage, { history: { recovery_from: 'failed' } });
    return { ok: true, from: 'failed', to: targetStage };
  }

  /**
   * 标记当前阶段失败
   */
  markFailed(reason) {
    const state = this.store.read();
    if (!state) return { ok: false, error: 'Pipeline not initialized', hint: '执行 loom run --spec-dir <spec目录> 初始化流水线' };
    this.store.fail(reason, state.current_stage);
    this._recordCompliance(state.current_stage, false, reason);
    return { ok: true, stage: state.current_stage, reason };
  }

  /**
   * 获取给 AI 的阶段上下文摘要（MCP 用）
   */
  getStageContext() {
    const state = this.store.read();
    if (!state) return null;

    const steps = this.getSteps();
    const currentStep = steps.find(s => s.id === state.current_stage);
    const nextStep = this.nextStep();
    const tasks = this.store.readAllTasks();
    const handoffs = this.store.readAllHandoffs();
    const recommendedReads = [
      ...(currentStep?.requires || []),
      ...(STAGE_RECOMMENDED_READS[state.current_stage] || []),
      'pipeline.state.json',
      'progress.md'
    ];

    return {
      spec_dir: this.specDir,
      pipeline_type: state.pipeline_type,
      current_stage: state.current_stage,
      current_skill: currentStep?.skill || null,
      current_step: currentStep ? {
        id: currentStep.id,
        skill: currentStep.skill || null,
        requires: currentStep.requires || [],
        outputs: currentStep.outputs || [],
        gate_verdict: currentStep.gate_verdict || null,
        evidence_required: currentStep.evidence_required === true,
        gate: currentStep.gate || null
      } : null,
      is_gate: this.isGate(),
      next_stage: nextStep?.id || null,
      next_step: nextStep ? {
        id: nextStep.id,
        skill: nextStep.skill || null,
        requires: nextStep.requires || [],
        outputs: nextStep.outputs || [],
        gate_verdict: nextStep.gate_verdict || null,
        gate: nextStep.gate || null
      } : null,
      defaults: this.workflow?.defaults || {},
      handoffs_summary: summarizeHandoffs(handoffs),
      recommended_reads: [...new Set(recommendedReads)],
      compression_policy: {
        preserve: CONTEXT_PRESERVE,
        compress_after_stage: true,
        mandatory_before_next_stage: true,
        write_stage_handoff: `handoffs/${state.current_stage}.json`,
        guidance: '阶段结束后必须先写 handoff（自动保存输入/产物指纹），再压缩原始讨论和长日志。handoff 仅作导航，源码、规格和可校验证据优先；下一阶段按 requirement id 与变更路径定向读取。'
      },
      tasks_summary: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'pending').length,
        executing: tasks.filter(t => t.status === 'executing').length,
        done: tasks.filter(t => t.status === 'done').length,
        failed: tasks.filter(t => t.status === 'failed').length,
        blocked: tasks.filter(t => t.status === 'blocked').length
      },
      started_at: state.started_at,
      updated_at: state.updated_at
    };
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  _readVersion() {
    try {
      const pkg = JSON.parse(this.fs.readFileSync(join(this.projectRoot, 'package.json'), 'utf-8'));
      return pkg.version || '2.0.0';
    } catch { return '2.0.0'; }
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

  _requiresStageCompression(step, stage) {
    return Boolean(step?.outputs?.includes(`handoffs/${stage}.json`));
  }

  _recordCompliance(stage, passed = true, reason = '') {
    try {
      const tracker = new ComplianceTracker(this.projectRoot, { fs: this.fs });
      if (passed) {
        tracker.recordFromVerifyReport(this.specDir);
      } else {
        tracker.record(this.specDir, stage, this._stageToSkill(stage), false, [reason]);
      }
    } catch {}
  }
}
