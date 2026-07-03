/**
 * state-store.js — 每个 spec 的状态读写
 *
 * 设计原则：状态写入者唯一
 *   - pipeline.state.json  → 只由管理该 spec 的 loom run 进程写
 *   - task-states/TN.state.json → 只由该 task 的 subagent 写（通过 loom task-state 子命令）
 *   - progress.md          → 由 state-store 汇总生成，不由 AI 直接写
 */

import { NodeFileSystem } from './fs-interface.js';
import { escapeMarkdown } from './markdown.js';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { compareFingerprints, fingerprintDeclaredPaths } from './fingerprints.js';

// ── 常量 ───────────────────────────────────────────────────────────────────

export const TASK_STATUSES = ['pending', 'executing', 'reviewing', 'done', 'failed', 'blocked'];
export const HANDOFF_STATUSES = ['done', 'partial', 'blocked', 'failed'];
const TASK_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

// ── 工具函数 ───────────────────────────────────────────────────────────────

/**
 * 读 JSON。
 * - 文件不存在 → 返回 fallback（正常的"未初始化"）
 * - 文件存在但解析失败 → 抛错（损坏状态绝不能被静默当成不存在，否则会被覆盖丢失）
 */
function readJSON(path, fallback = null, fs) {
  if (!fs.existsSync(path)) return fallback;
  let raw;
  try { raw = fs.readFileSync(path, 'utf-8'); }
  catch { return fallback; }
  try { return JSON.parse(raw); }
  catch (err) {
    throw new Error(`Corrupt state file: ${path} (${err.message}). Fix or delete it manually.`);
  }
}

/** 读 JSON，损坏时跳过并告警（用于批量读取 task 列表，单个坏文件不应中断全部）*/
function readJSONLenient(path, fs) {
  try { return JSON.parse(fs.readFileSync(path, 'utf-8')); }
  catch (err) {
    process.stderr.write(`[loom] skipping unreadable state file ${path}: ${err.message}\n`);
    return null;
  }
}

/** 原子写：写临时文件后 rename，避免进程中途崩导致半写 JSON */
function writeJSON(path, data, fs) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const payload = JSON.stringify(data, null, 2) + '\n';
  try {
    fs.writeFileSync(tmp, payload, 'utf-8');
    fs.renameSync(tmp, path); // rename 在同一文件系统上是原子的
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

function now() { return new Date().toISOString(); }

export function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) {
    throw new Error(`Invalid task id: ${taskId}`);
  }
}

export function assertValidTaskStatus(status) {
  if (status !== undefined && !TASK_STATUSES.includes(status)) {
    throw new Error(`Invalid task status: ${status}`);
  }
}

export function assertValidHandoffStatus(status) {
  if (status !== undefined && !HANDOFF_STATUSES.includes(status)) {
    throw new Error(`Invalid handoff status: ${status}`);
  }
}

// ── PipelineStateStore ─────────────────────────────────────────────────────

export class PipelineStateStore {
  /**
   * @param {string} specDir  绝对或相对路径，e.g. "specs/2026-05-27+user-auth"
   */
  constructor(specDir, { fs, projectRoot } = {}) {
    this.specDir = specDir;
    this.projectRoot = resolve(projectRoot || dirname(dirname(specDir)));
    this.statePath = join(specDir, 'pipeline.state.json');
    this.taskStatesDir = join(specDir, 'task-states');
    this.handoffsDir = join(specDir, 'handoffs');
    this.fs = fs || new NodeFileSystem();
  }

  // ── 流水线状态 ────────────────────────────────────────────────────────────

  /** 读取流水线状态，不存在返回 null */
  read() {
    return readJSON(this.statePath, null, this.fs);
  }

  /** 初始化（首次创建）*/
  init(pipelineType = 'feature', loomVersion = '2.0.0', firstStage = 'brainstorming', dynamicSteps = null) {
    if (this.fs.existsSync(this.statePath)) return this.read();
    this.fs.mkdirSync(this.specDir, { recursive: true });
    const state = {
      spec_dir: this.specDir,
      pipeline_type: pipelineType,
      current_stage: firstStage,
      loom_version: loomVersion,
      started_at: now(),
      updated_at: now(),
      stage_history: [],
      metadata: {},
      ...(dynamicSteps ? { dynamic_steps: dynamicSteps } : {})
    };
    writeJSON(this.statePath, state, this.fs);
    this._rebuildProgress();
    return state;
  }

  /** 设置 dynamic_steps（AI 自主选择模式下持久化选择的步骤）*/
  setDynamicSteps(steps) {
    const state = this.read();
    if (!state) return null;
    state.dynamic_steps = steps;
    state.updated_at = now();
    writeJSON(this.statePath, state, this.fs);
    return state;
  }

  /** 读取 dynamic_steps（无则返回 null）*/
  getDynamicSteps() {
    const state = this.read();
    return state?.dynamic_steps || null;
  }

  /** 推进到新阶段 */
  transition(toStage, meta = {}) {
    const state = this.read() || this.init();
    const prevStage = state.current_stage;

    // 记录历史
    state.stage_history.push({
      stage: prevStage,
      entered_at: state.current_stage_started_at || state.started_at,
      exited_at: now(),
      status: 'passed',
      ...meta.history
    });

    state.current_stage = toStage;
    state.current_stage_started_at = now();
    state.updated_at = now();
    if (meta.data) Object.assign(state.metadata, meta.data);

    writeJSON(this.statePath, state, this.fs);
    this._rebuildProgress();
    return state;
  }

  /** 标记当前阶段失败 */
  fail(reason, fromStage = null) {
    const state = this.read();
    if (!state) return;

    state.stage_history.push({
      stage: fromStage || state.current_stage,
      entered_at: state.current_stage_started_at || state.started_at,
      exited_at: now(),
      status: 'failed',
      reason
    });
    state.current_stage = 'failed';
    state.current_stage_started_at = now();
    state.updated_at = now();
    state.failure_reason = reason;

    writeJSON(this.statePath, state, this.fs);
    this._rebuildProgress();
  }

  // ── Task 状态 ─────────────────────────────────────────────────────────────

  /** 初始化单个 task 状态 */
  initTask(taskId, agentSessionId = null) {
    assertValidTaskId(taskId);
    this.fs.mkdirSync(this.taskStatesDir, { recursive: true });
    const path = join(this.taskStatesDir, `${taskId}.state.json`);
    if (this.fs.existsSync(path)) return readJSON(path, null, this.fs);

    const state = {
      task_id: taskId,
      spec_dir: this.specDir,
      status: 'pending',
      retry_count: 0,
      agent_session_id: agentSessionId,
      created_at: now(),
      updated_at: now(),
      last_reviewer_result: null,
      blocker: null
    };
    writeJSON(path, state, this.fs);
    return state;
  }

  /** 更新 task 状态（只有该 task 的负责方调用）*/
  updateTask(taskId, patch) {
    assertValidTaskId(taskId);
    assertValidTaskStatus(patch?.status);
    this.fs.mkdirSync(this.taskStatesDir, { recursive: true });
    const path = join(this.taskStatesDir, `${taskId}.state.json`);
    const state = readJSON(path, null, this.fs) || this.initTask(taskId);
    Object.assign(state, patch, { updated_at: now() });
    writeJSON(path, state, this.fs);
    this._rebuildProgress();
    return state;
  }

  /** 读取所有 task 状态 */
  readAllTasks() {
    if (!this.fs.existsSync(this.taskStatesDir)) return [];
    return this.fs.readdirSync(this.taskStatesDir)
      .filter(f => f.endsWith('.state.json'))
      .map(f => readJSONLenient(join(this.taskStatesDir, f), this.fs))
      .filter(Boolean)
      .sort((a, b) => {
        const na = parseInt(a.task_id?.replace(/\D/g, '') || '0');
        const nb = parseInt(b.task_id?.replace(/\D/g, '') || '0');
        return na - nb;
      });
  }

  /** 读取单个 task 状态 */
  readTask(taskId) {
    assertValidTaskId(taskId);
    const path = join(this.taskStatesDir, `${taskId}.state.json`);
    return readJSON(path, null, this.fs);
  }

  // ── Handoff ────────────────────────────────────────────────────────────────

  writeHandoff(taskId, handoff) {
    assertValidTaskId(taskId);
    assertValidHandoffStatus(handoff?.status);
    this.fs.mkdirSync(this.handoffsDir, { recursive: true });
    const basisPaths = ['spec.md', 'plan.md'];
    if (/^T\d+$/i.test(taskId)) basisPaths.push(`tasks/${taskId}.md`);
    else if (taskId === 'planning' || taskId === 'executing') basisPaths.push('tasks/');
    if (taskId === 'verification') basisPaths.push('test-report.md');
    const artifacts = Array.isArray(handoff.artifacts)
      ? handoff.artifacts.filter(path => !/^(?:handoffs|task-states)\/|^(?:progress\.md|pipeline\.state\.json)$/.test(path))
      : [];
    const fingerprintOptions = { specDir: this.specDir, projectRoot: this.projectRoot, fs: this.fs };

    writeJSON(join(this.handoffsDir, `${taskId}.json`), {
      ...handoff,
      task_id: taskId,
      basis_fingerprints: fingerprintDeclaredPaths(basisPaths, fingerprintOptions),
      artifact_fingerprints: fingerprintDeclaredPaths(artifacts, fingerprintOptions),
      written_at: now()
    }, this.fs);
    this._rebuildProgress();
  }

  writeStageHandoff(stage, handoff) {
    this.writeHandoff(stage, { ...handoff, stage });
  }

  readHandoff(taskId) {
    assertValidTaskId(taskId);
    return readJSON(join(this.handoffsDir, `${taskId}.json`), null, this.fs);
  }

  readAllHandoffs() {
    if (!this.fs.existsSync(this.handoffsDir)) return [];
    return this.fs.readdirSync(this.handoffsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => readJSONLenient(join(this.handoffsDir, f), this.fs))
      .filter(Boolean)
      .sort((a, b) => {
        const at = a.written_at || '';
        const bt = b.written_at || '';
        if (at !== bt) return at.localeCompare(bt);
        return String(a.stage || a.task_id || '').localeCompare(String(b.stage || b.task_id || ''));
      });
  }

  /** Return compact stale facts; hashes stay on disk and are not injected into prompts. */
  findStaleHandoffs() {
    const options = { specDir: this.specDir, projectRoot: this.projectRoot, fs: this.fs };
    const stale = [];
    for (const handoff of this.readAllHandoffs()) {
      const changes = [
        ...compareFingerprints(handoff.basis_fingerprints, options),
        ...compareFingerprints(handoff.artifact_fingerprints, options)
      ];
      if (changes.length > 0) {
        stale.push({ id: handoff.stage || handoff.task_id, changes });
      }
    }
    return stale;
  }

  // ── Progress.md 增量更新 ───────────────────────────────────────────────────

  _rebuildProgress() {
    const pipeline = this.read();
    const tasks = this.readAllTasks();
    const handoffs = this.readAllHandoffs();
    const progressPath = join(this.specDir, 'progress.md');

    // 尝试增量追加：如果已有 progress.md 且 pipeline 阶段未变，只更新变动部分
    if (this.fs.existsSync(progressPath)) {
      const existing = this.fs.readFileSync(progressPath, 'utf-8');
      const incremental = this._tryIncrementalUpdate(existing, pipeline, tasks, handoffs);
      if (incremental) {
        this.fs.writeFileSync(progressPath, incremental, 'utf-8');
        return;
      }
    }

    // 首次生成或结构变化时全量重建
    this.fs.writeFileSync(progressPath, this._buildFullProgress(pipeline, tasks, handoffs), 'utf-8');
  }

  /**
   * 增量更新策略：
   * - Pipeline 阶段变化 → 追加一行变更日志，保留历史记录
   * - Task 状态变化 → 只更新 Tasks 表格区域
   * - 结构无法识别 → 返回 null，走全量重建
   */
  _tryIncrementalUpdate(existing, pipeline, tasks, handoffs) {
    // 检查现有 progress.md 是否是 loom 生成的
    if (!existing.includes('Auto-generated by loom')) return null;

    // 更新 timestamp
    let updated = existing.replace(
      /> Last updated:.*$/m,
      `> Last updated: ${now()}`
    );

    // 如果 pipeline 阶段变化，追加变更日志
    const currentStageMatch = updated.match(/\| Stage \| `([^`]+)` \|/);
    const prevStage = currentStageMatch ? currentStageMatch[1] : null;

    if (pipeline && prevStage !== pipeline.current_stage) {
      // 更新 Pipeline 表格中的 Stage 行
      updated = updated.replace(
        /\| Stage \| `[^`]+` \|/,
        `| Stage | \`${escapeMarkdown(pipeline.current_stage)}\` |`
      );
      updated = updated.replace(
        /\| Updated \| [^|]+ \|/,
        `| Updated | ${pipeline.updated_at?.slice(0, 16).replace('T', ' ')} |`
      );

      // 处理失败状态
      if (pipeline.failure_reason) {
        if (!updated.includes('| Failure |')) {
          updated = updated.replace(
            /\| Updated \| [^|]+ \|/,
            `| Updated | ${pipeline.updated_at?.slice(0, 16).replace('T', ' ')} |\n| Failure | ${escapeMarkdown(pipeline.failure_reason)} |`
          );
        }
      }
    }

    const dynamicSteps = pipeline?.dynamic_steps?.map(s => s.id || String(s)).join(' → ');
    if (dynamicSteps) {
      const row = `| Dynamic Steps | ${escapeMarkdown(dynamicSteps)} |`;
      if (updated.includes('| Dynamic Steps |')) {
        updated = updated.replace(/\| Dynamic Steps \| [^|]+ \|/, row);
      } else {
        updated = updated.replace(/\| Type\s+\| [^|]+ \|/, `$&\n${row}`);
      }
    }

    // 重建 Tasks 表格（task 状态变化频繁，整块替换）
    const taskSectionStart = updated.indexOf('## Tasks');
    if (taskSectionStart >= 0 && tasks.length > 0) {
      const taskBlock = this._buildTaskBlock(tasks);
      // 找到 Tasks section 结束位置（下一个 ## 或文件结尾）
      const afterTasks = updated.indexOf('\n## ', taskSectionStart + 1);
      if (afterTasks > taskSectionStart) {
        updated = updated.slice(0, taskSectionStart) + taskBlock + updated.slice(afterTasks);
      } else {
        updated = updated.slice(0, taskSectionStart) + taskBlock;
      }
    } else if (tasks.length > 0) {
      // 没有 Tasks section，追加
      updated += '\n' + this._buildTaskBlock(tasks);
    }

    // 重建 Handoffs 摘要区，只保留交接概览，避免 progress.md 膨胀。
    const handoffSectionStart = updated.indexOf('## Handoffs');
    if (handoffSectionStart >= 0 && handoffs.length > 0) {
      const handoffBlock = this._buildHandoffBlock(handoffs);
      const afterHandoffs = updated.indexOf('\n## ', handoffSectionStart + 1);
      if (afterHandoffs > handoffSectionStart) {
        updated = updated.slice(0, handoffSectionStart) + handoffBlock + updated.slice(afterHandoffs);
      } else {
        updated = updated.slice(0, handoffSectionStart) + handoffBlock;
      }
    } else if (handoffs.length > 0) {
      updated += '\n' + this._buildHandoffBlock(handoffs);
    }

    return updated;
  }

  _buildTaskBlock(tasks) {
    const lines = [];
    lines.push('## Tasks');
    lines.push('');
    lines.push('| Task | Status | Retries | Updated |');
    lines.push('|------|--------|---------|---------|');

    const statusIcon = {
      pending: '⏳', executing: '▶', reviewing: '🔍',
      done: '✅', failed: '❌', blocked: '🚫'
    };

    for (const t of tasks) {
      const icon = statusIcon[t.status] || '?';
      const retries = t.retry_count ?? 0;
      const updated = t.updated_at?.slice(0, 16).replace('T', ' ') || '-';
      lines.push(`| \`${escapeMarkdown(t.task_id)}\` | ${icon} ${escapeMarkdown(t.status)} | ${escapeMarkdown(retries)} | ${escapeMarkdown(updated)} |`);
    }
    lines.push('');

    const blocked = tasks.filter(t => t.blocker);
    if (blocked.length > 0) {
      lines.push('### Blockers');
      lines.push('');
      for (const t of blocked) {
        lines.push(`- **${escapeMarkdown(t.task_id)}**: ${escapeMarkdown(t.blocker)}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  _buildHandoffBlock(handoffs) {
    const lines = [];
    lines.push('## Handoffs');
    lines.push('');
    lines.push('| Stage/Task | Status | Summary | Artifacts |');
    lines.push('|------------|--------|---------|-----------|');

    for (const h of handoffs) {
      const label = h.stage || h.task_id || '-';
      const status = h.status || '-';
      const summary = h.summary || h.notes || h.description || '-';
      const artifacts = h.artifacts || h.outputs || h.files || h.changed_files || [];
      const artifactText = Array.isArray(artifacts)
        ? artifacts.map(a => typeof a === 'string' ? a : a?.path || a?.name || JSON.stringify(a)).join(', ')
        : String(artifacts || '-');
      lines.push(`| \`${escapeMarkdown(label)}\` | ${escapeMarkdown(status)} | ${escapeMarkdown(summary)} | ${escapeMarkdown(artifactText || '-')} |`);
    }
    lines.push('');

    return lines.join('\n');
  }

  _buildFullProgress(pipeline, tasks, handoffs) {
    const lines = [];
    lines.push('# Progress');
    lines.push('');
    lines.push(`> Auto-generated by loom. Do not edit manually.`);
    lines.push(`> Last updated: ${now()}`);
    lines.push('');

    if (pipeline) {
      lines.push(`## Pipeline`);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| Stage | \`${escapeMarkdown(pipeline.current_stage)}\` |`);
      lines.push(`| Type  | \`${escapeMarkdown(pipeline.pipeline_type)}\` |`);
      if (pipeline.dynamic_steps?.length) {
        const steps = pipeline.dynamic_steps.map(s => s.id || String(s)).join(' → ');
        lines.push(`| Dynamic Steps | ${escapeMarkdown(steps)} |`);
      }
      lines.push(`| Started | ${pipeline.started_at?.slice(0, 16).replace('T', ' ')} |`);
      lines.push(`| Updated | ${pipeline.updated_at?.slice(0, 16).replace('T', ' ')} |`);
      if (pipeline.failure_reason) {
        lines.push(`| Failure | ${escapeMarkdown(pipeline.failure_reason)} |`);
      }
      lines.push('');

      if (pipeline.stage_history?.length > 0) {
        lines.push('### Stage History');
        lines.push('');
        lines.push('| Stage | Status | Exited |');
        lines.push('|-------|--------|--------|');
        for (const h of pipeline.stage_history) {
          const icon = h.status === 'passed' ? '✅' : '❌';
          lines.push(`| \`${escapeMarkdown(h.stage)}\` | ${icon} ${escapeMarkdown(h.status)} | ${escapeMarkdown(h.exited_at?.slice(0, 16).replace('T', ' '))} |`);
        }
        lines.push('');
      }
    }

    if (tasks.length > 0) {
      lines.push(this._buildTaskBlock(tasks));
    }

    if (handoffs.length > 0) {
      lines.push(this._buildHandoffBlock(handoffs));
    }

    return lines.join('\n');
  }

  // ── 汇总快照（用于 loom status）──────────────────────────────────────────

  snapshot() {
    return {
      spec_dir: this.specDir,
      pipeline: this.read(),
      tasks: this.readAllTasks(),
      handoffs: this.readAllHandoffs()
    };
  }
}

// ── 全局扫描（用于 loom status --all）────────────────────────────────────

export function scanAllSpecs(projectRoot, { fs = new NodeFileSystem() } = {}) {
  const specsDir = join(projectRoot, 'specs');
  if (!fs.existsSync(specsDir)) return [];
  return fs.readdirSync(specsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const specDir = join(specsDir, e.name);
      const store = new PipelineStateStore(specDir, { fs });
      try { return store.snapshot(); }
      catch (err) {
        // 单个 spec 损坏不应中断全局扫描
        process.stderr.write(`[loom] skipping spec ${e.name}: ${err.message}\n`);
        return { spec_dir: specDir, pipeline: null, tasks: [], handoffs: [] };
      }
    })
    .filter(s => s.pipeline !== null)  // 只返回有 pipeline.state.json 的
    .sort((a, b) => {
      const da = a.pipeline?.started_at || '';
      const db = b.pipeline?.started_at || '';
      return db.localeCompare(da); // 最新在前
    });
}
