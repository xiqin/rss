/**
 * tools.js — MCP 工具定义
 *
 * 工具按 group 分组（pipeline / context / memory / session / meta），
 * 配合 loom_list_capabilities 做"虚拟 Skill"按需加载，减少上下文占用。
 * 每个工具是一个纯函数，接收参数返回结果，不持有状态。
 */

import { resolve, join, sep, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeFileSystem } from '../core/fs-interface.js';
import { PipelineEngine } from '../core/pipeline-engine.js';
import { HANDOFF_STATUSES, PipelineStateStore, scanAllSpecs } from '../core/state-store.js';
import { MemoryStore } from '../core/memory-store.js';
import { SpecLock } from '../core/lock.js';
import { resolvePipelineDir } from '../core/spec-dir.js';
import { loadContextIndex, DOC_KEYS } from '../core/context-index.js';
import { SkillLoader } from '../core/skill-loader.js';
import { PipelineSelector } from '../core/pipeline-selector.js';
import { getSnapshot } from './telemetry.js';
import { runDetailExpansionCheck } from '../../skills/loom-detail-expansion/scripts/check-detail-expansion.mjs';
import { runAnalyzeArtifacts } from '../../skills/loom-analyze-artifacts/scripts/analyze-artifacts.mjs';
import { runConverge } from '../../skills/loom-converge/scripts/converge.mjs';
import { runOmissionHunt } from '../../skills/loom-omission-hunter/scripts/omission-hunt.mjs';
import { validatePlan } from '../../skills/loom-writing-plans/scripts/validate-plan.mjs';
import { verifyArtifacts } from '../../skills/loom-verification-before-completion/scripts/verify-artifacts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');
const DEFAULT_STATUS_LIMIT = 10;
const DEFAULT_HANDOFF_LIMIT = 5;

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function limitArray(items, limit) {
  const max = positiveInt(limit, items.length);
  return {
    items: items.slice(0, max),
    truncated: items.length > max,
    omitted: Math.max(0, items.length - max)
  };
}

function compactHandoff(handoff) {
  if (!handoff) return null;
  return {
    id: handoff.stage || handoff.task_id || null,
    stage: handoff.stage || null,
    task_id: handoff.task_id || null,
    status: handoff.status || null,
    summary: handoff.summary || handoff.notes || handoff.description || null,
    artifacts: handoff.artifacts || handoff.outputs || handoff.files || handoff.changed_files || [],
    written_at: handoff.written_at || null
  };
}

function summarizePipelineContext(ctx, { handoffLimit = DEFAULT_HANDOFF_LIMIT } = {}) {
  const handoffs = limitArray(ctx.handoffs_summary || [], handoffLimit);
  return {
    spec_dir: ctx.spec_dir,
    pipeline_type: ctx.pipeline_type,
    current_stage: ctx.current_stage,
    current_skill: ctx.current_skill,
    current_step: ctx.current_step,
    is_gate: ctx.is_gate,
    next_stage: ctx.next_stage,
    next_step: ctx.next_step,
    handoffs_summary: handoffs.items,
    handoffs_truncated: handoffs.truncated,
    handoffs_omitted: handoffs.omitted,
    recommended_reads: ctx.recommended_reads,
    compression_policy: ctx.compression_policy,
    constraints: ctx.constraints,
    forbidden_actions: ctx.forbidden_actions,
    tasks_summary: ctx.tasks_summary,
    started_at: ctx.started_at,
    updated_at: ctx.updated_at,
    detail: 'summary'
  };
}

/**
 * 把 specDir 解析为绝对路径，并强制限制在 projectRoot 内。
 * MCP 工具的 spec_dir 来自 AI 输入，未经校验会被 "../../etc" 逃逸到项目外读写。
 */
function safeResolveSpecDir(projectRoot, specDir) {
  const root = resolve(projectRoot);
  const abs = resolvePipelineDir(root, specDir);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`spec_dir escapes project root: ${specDir}`);
  }
  return abs;
}

/** 在 spec 锁保护下执行写操作；拿不到锁则带重试等待 */
async function withSpecLock(absSpecDir, fn, fsImpl) {
  const lock = new SpecLock(absSpecDir, { fs: fsImpl });
  const res = await lock.acquireWithRetry();
  if (!res.acquired) {
    return { error: `spec is locked by PID ${res.pid} (started: ${res.startedAt || 'unknown'})` };
  }
  try { return fn(); }
  finally { lock.release(); }
}

// ── 工具定义 ───────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'loom_list_capabilities',
    group: 'meta',
    description: 'START HERE. Returns a grouped catalog of loom capabilities (pipeline, context, memory, retrieval) so you can load only the tools relevant to the task instead of scanning every tool.',
    inputSchema: {
      type: 'object',
      properties: {
        project_root: { type: 'string', description: 'Project root directory (optional if attached)' }
      }
    }
  },
  {
    name: 'loom_get_context',
    group: 'context',
    description: 'Progressive disclosure of context files. Without a section, returns the OUTLINE (L0: section titles + token sizes). With a section, returns that section full text (L1). Auto-falls back to the WHOLE file (with a "fallback" field) when a level would yield empty content — so you never lose info. Use this instead of reading whole constitution/index/memory files.',
    inputSchema: {
      type: 'object',
      properties: {
        doc: { type: 'string', description: `Context doc key: ${DOC_KEYS.join(', ')}` },
        section: { type: 'string', description: 'Section title to fetch full text (omit for outline)' },
        full: { type: 'boolean', description: 'Escape hatch: return the WHOLE file (use if outline/section seems to drop info, e.g. content before the first heading)' },
        project_root: { type: 'string', description: 'Project root directory (optional if attached)' }
      },
      required: ['doc']
    }
  },
  {
    name: 'loom_get_project_status',
    group: 'pipeline',
    description: 'Get the loom status of the current project: active pipelines, stages, task summaries, and health issues.',
    inputSchema: {
      type: 'object',
      properties: {
        project_root: { type: 'string', description: 'Project root directory (optional if attached)' },
        limit: { type: 'number', description: 'Max pipelines to return (default 10)' },
        active_only: { type: 'boolean', description: 'Only return pipelines that are not in terminal stages' },
        detail: { type: 'string', enum: ['summary', 'full'], description: 'summary/default returns compact pipeline rows; full includes task and handoff snapshots' }
      }
    }
  },
  {
    name: 'loom_get_pipeline_context',
    group: 'pipeline',
    description: 'Get the current pipeline stage context for a spec: stage, skill, tasks, defaults. Use this to understand what to do next.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' },
        detail: { type: 'string', enum: ['summary', 'full'], description: 'summary/default returns compact context; full returns all handoff summaries' },
        handoff_limit: { type: 'number', description: 'Max handoff summaries in summary mode (default 5)' }
      }
    }
  },
  {
    name: 'loom_select_pipeline',
    group: 'pipeline',
    description: 'AI 自主流程选择：根据用户需求 + 信号选择步骤组合（规则短路 → AI fallback → 规则兜底）。首次调用必须只返回建议不写状态，并向用户展示 steps、风险、来源和理由；只有用户明确确认后才可传 initialize=true 写入状态。',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: '用户原始需求描述' },
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' },
        initialize: { type: 'boolean', description: 'false/default: 仅返回建议，不写状态。true: 仅限用户已明确确认所展示流水线后使用，把选中的 steps 写入 pipeline.state.json (dynamic_steps) 并初始化流水线。' }
      },
      required: ['request']
    }
  },
  {
    name: 'loom_advance_pipeline',
    group: 'pipeline',
    description: 'Advance the pipeline to the next stage after the caller has compressed the closed-stage raw context. Validates artifacts before advancing. Returns error if preconditions not met.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' },
        compression_confirmed: { type: 'boolean', description: 'Set true only after the host agent has called its context compression tool for the closed stage.' }
      }
    }
  },
  {
    name: 'loom_approve_gate',
    group: 'pipeline',
    description: 'Approve a human-approval gate (e.g. after user confirms plan). Only works when current stage is a gate.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' }
      }
    }
  },
  {
    name: 'loom_update_task_state',
    group: 'pipeline',
    description: 'Update a single task state. Only the responsible subagent should call this.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' },
        task_id: { type: 'string', description: 'Task ID (e.g. T1)' },
        status: { type: 'string', enum: ['pending', 'executing', 'reviewing', 'done', 'failed', 'blocked'] },
        blocker: { type: 'string', description: 'Blocker reason (when status is blocked)' }
      },
      required: ['task_id', 'status']
    }
  },
  {
    name: 'loom_write_handoff',
    group: 'pipeline',
    description: 'Write a stage or task handoff JSON file under specs/<date+feature>/handoffs/ and refresh progress.md. Use after a stage/task completes before advancing.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' },
        stage: { type: 'string', description: 'Stage id, e.g. brainstorming/planning/executing/verification' },
        task_id: { type: 'string', description: 'Task id, e.g. T1. Use either stage or task_id, not both.' },
        status: { type: 'string', enum: HANDOFF_STATUSES, description: 'done | partial | blocked | failed', default: 'done' },
        summary: { type: 'string', description: 'Short handoff summary' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'Artifact paths to show in progress.md' },
        data: { type: 'object', description: 'Additional JSON fields to merge into the handoff' }
      }
    }
  },
  {
    name: 'loom_stage_checkpoint',
    group: 'pipeline',
    description: 'Compact stage checkpoint: write a stage handoff, refresh progress.md, and return a compact context. If advance=true is passed, advancement is intentionally not performed; the caller must compress context first, then call loom_advance_pipeline with compression_confirmed=true.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' },
        stage: { type: 'string', description: 'Stage id, e.g. brainstorming/planning/executing/verification' },
        status: { type: 'string', enum: HANDOFF_STATUSES, description: 'done | partial | blocked | failed', default: 'done' },
        summary: { type: 'string', description: 'Short handoff summary' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'Artifact paths to show in progress.md' },
        data: { type: 'object', description: 'Additional JSON fields to merge into the handoff' },
        advance: { type: 'boolean', description: 'Deprecated. Advancement is blocked until the caller compresses context and calls loom_advance_pipeline with compression_confirmed=true.' },
        context_detail: { type: 'string', enum: ['summary', 'full'], description: 'summary/default returns compact context; full returns the engine context' },
        handoff_limit: { type: 'number', description: 'Max handoff summaries in returned context (default 5)' }
      },
      required: ['stage']
    }
  },
  {
    name: 'loom_adjust_pipeline',
    group: 'pipeline',
    description: '执行中调整步骤（如发现改动跨模块）。已完成的阶段不可删除，新步骤追加到尾部。返回更新后的 dynamic_steps。',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' },
        new_remaining_steps: {
          type: 'array',
          description: '追加的步骤对象数组 [{id, skill?, description?}]',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              skill: { type: 'string' },
              description: { type: 'string' }
            },
            required: ['id']
          }
        }
      },
      required: ['new_remaining_steps']
    }
  },
  {
    name: 'loom_get_memory',
    group: 'memory',
    description: 'Read project memory entries with structured filters: type, tag, scope, stage, related spec/task/file and expiration.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter: 决策, 踩坑, 偏好, 状态, adr' },
        tag: { type: 'string', description: 'Filter by tag' },
        scope: { type: 'string', description: 'Filter by applicability scope' },
        stage: { type: 'string', description: 'Filter by pipeline stage' },
        file: { type: 'string', description: 'Filter by related file path' },
        spec_dir: { type: 'string', description: 'Filter by related spec directory' },
        pr: { type: 'string', description: 'Filter by related pull request' },
        commit: { type: 'string', description: 'Filter by related commit' },
        task: { type: 'string', description: 'Filter by related task id' },
        handoff: { type: 'string', description: 'Filter by related handoff artifact' },
        include_expired: { type: 'boolean', description: 'Include expired memory entries' },
        limit: { type: 'number', description: 'Max entries (default 10)' },
        project_root: { type: 'string', description: 'Project root directory (optional if attached)' }
      }
    }
  },
  {
    name: 'loom_add_memory',
    group: 'memory',
    description: 'Write a new memory entry with source, confidence, scope, expiration and links to spec/PR/commit/task/handoff/file.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['决策', '踩坑', '偏好', '状态', 'adr'], description: 'Memory type' },
        content: { type: 'string', description: 'One-line description' },
        context: { type: 'string', description: 'Background/reason (optional, for ADRs)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for retrieval' },
        source: { type: 'string', description: 'Source of this memory, e.g. issue, PR, review, session' },
        confidence: { type: 'number', description: 'Confidence from 0 to 1' },
        scope: { type: 'string', description: 'Applicability scope, e.g. project | spec | file | team' },
        expires_at: { type: 'string', description: 'Expiration timestamp for temporary memory' },
        spec_dir: { type: 'string', description: 'Related spec directory' },
        pr: { type: 'string', description: 'Related pull request id or URL' },
        commit: { type: 'string', description: 'Related commit SHA' },
        task: { type: 'string', description: 'Related task id' },
        handoff: { type: 'string', description: 'Related handoff artifact' },
        stage: { type: 'string', description: 'Related pipeline stage' },
        files: { type: 'array', items: { type: 'string' }, description: 'Related file paths' },
        project_root: { type: 'string', description: 'Project root directory (optional if attached)' }
      },
      required: ['type', 'content']
    }
  },
  {
    name: 'loom_attach_spec',
    group: 'session',
    description: 'Bind this session to a specific spec directory. Subsequent calls can omit spec_dir.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory' },
        project_root: { type: 'string', description: 'Project root directory' }
      },
      required: ['spec_dir']
    }
  },
  {
    name: 'loom_load_tool_group',
    group: 'meta',
    description: 'Load a group of tools into the session. Use after loom_list_capabilities to activate the tool group you need (e.g. pipeline, context, memory, session).',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Group name: context, pipeline, memory, session' }
      },
      required: ['group']
    }
  },
  {
    name: 'loom_get_skill_context',
    group: 'context',
    description: 'Progressive disclosure of skill files. Without a skill name, returns L0 summaries of ALL skills (name, summary, triggers, section titles — ~1.2K tokens total). With a skill name, returns the L1 full content of that skill. With skill name + section, returns just that section. Use this instead of loading all skill files into context.',
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Skill name (e.g. brainstorming, writing-plans). Omit for L0 summaries of all skills.' },
        section: { type: 'string', description: 'Section title within a skill (e.g. 执行流程). Only valid when skill is specified.' },
        full: { type: 'boolean', description: 'Return the whole SKILL.md. Default false returns essentials only to save context.' }
      }
    }
  },
  {
    name: 'loom_telemetry',
    group: 'meta',
    description: 'Get telemetry snapshot for the current MCP session: tool call counts, cumulative time per tool. Only available when LOOM_TELEMETRY=1 is set.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'loom_validate_plan',
    group: 'pipeline',
    description: '校验 planning 阶段产物：plan.md、tasks/Tn.md、traceability.json、REQ/behavior 到 task 的映射、task 依赖图与 owns 冲突。用于 writing-plans 阶段进入用户确认 gate 前。',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' }
      }
    }
  },
  {
    name: 'loom_detail_expansion_check',
    group: 'pipeline',
    description: '检查 requirements.json 中每个 REQ 的 required_categories 都有对应 behavior、每个 behavior 有 test_plan、无 requires-clarification 残留。用于 detail-expansion 阶段（brainstorming 后 planning 前）校验行为维度是否完整展开。',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' }
      }
    }
  },
  {
    name: 'loom_analyze_artifacts',
    group: 'pipeline',
    description: '只读跨产物一致性分析（planning 后 approved 前）。检查 spec/requirements/plan/tasks/traceability 的重复、歧义、欠规格、behavior 缺失、task 未映射、依赖环、owns 冲突等，输出 artifact-analysis.json。blocker 阻断 approved gate。',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' }
      }
    }
  },
  {
    name: 'loom_converge',
    group: 'pipeline',
    description: '实现后对照意图清单（executing 后 verification 前）。把每个 behavior 分类为 covered/missing/partial/contradicts/unrequested，输出 convergence-report.json。missing/partial/contradicts 需回流 executing 生成新 task，直到 converged。',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' },
        round: { type: 'number', description: 'Convergence round number (default 1)' }
      }
    }
  },
  {
    name: 'loom_omission_hunt',
    group: 'pipeline',
    description: '只读对抗式负空间审查（converge 中调用）。检查每个 behavior 的 tests/evidence 引用文件存在，对 forbidden-behavior/concurrency/atomicity/observability 类提示人工审查，输出 findings/omission-hunter.json。blocker 回流到 converge。',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' }
      }
    }
  },
  {
    name: 'loom_verify_artifacts',
    group: 'pipeline',
    description: '完成前机械性产物校验：test-report.md、verify-report.md、requirements.json、traceability.json、progress.md 占位符和证据引用。用于 verification-before-completion 阶段人工判断前。',
    inputSchema: {
      type: 'object',
      properties: {
        spec_dir: { type: 'string', description: 'Path to spec directory (optional if attached)' }
      }
    }
  }
];

const TOOL_SECURITY_DEFAULT = {
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  loom: {
    risk: 'medium',
    effects: ['state'],
    writes: [],
    requiresUserConfirmation: false,
  },
};

const READ_ONLY = {
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  loom: {
    risk: 'low',
    effects: ['read'],
    writes: [],
    requiresUserConfirmation: false,
  },
};

const SESSION_WRITE = {
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  loom: {
    risk: 'low',
    effects: ['session'],
    writes: ['mcp-session'],
    requiresUserConfirmation: false,
  },
};

const TOOL_SECURITY = {
  loom_list_capabilities: READ_ONLY,
  loom_get_context: READ_ONLY,
  loom_get_project_status: READ_ONLY,
  loom_get_pipeline_context: READ_ONLY,
  loom_get_memory: READ_ONLY,
  loom_get_skill_context: READ_ONLY,
  loom_telemetry: READ_ONLY,

  loom_load_tool_group: SESSION_WRITE,
  loom_attach_spec: SESSION_WRITE,

  loom_select_pipeline: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'medium',
      effects: ['read', 'state'],
      writes: ['pipeline.state.json when initialize=true', 'progress.md when initialize=true'],
      requiresUserConfirmation: 'when initialize=true',
    },
  },
  loom_advance_pipeline: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'medium',
      effects: ['state', 'file'],
      writes: ['pipeline.state.json', 'progress.md', '.loom/compliance/history.json'],
      requiresUserConfirmation: false,
    },
  },
  loom_approve_gate: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'medium',
      effects: ['state', 'approval'],
      writes: ['pipeline.state.json', 'progress.md'],
      requiresUserConfirmation: true,
    },
  },
  loom_update_task_state: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'medium',
      effects: ['state', 'file'],
      writes: ['task-states/<task>.state.json', 'progress.md'],
      requiresUserConfirmation: false,
    },
  },
  loom_write_handoff: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'medium',
      effects: ['file'],
      writes: ['handoffs/<stage-or-task>.json', 'progress.md'],
      requiresUserConfirmation: false,
    },
  },
  loom_stage_checkpoint: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'medium',
      effects: ['file'],
      writes: ['handoffs/<stage>.json', 'progress.md'],
      requiresUserConfirmation: false,
    },
  },
  loom_adjust_pipeline: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'high',
      effects: ['state', 'workflow'],
      writes: ['pipeline.state.json', 'progress.md'],
      requiresUserConfirmation: true,
    },
  },
  loom_add_memory: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'low',
      effects: ['file', 'memory'],
      writes: ['.loom/memory/store.json'],
      requiresUserConfirmation: false,
    },
  },
  loom_validate_plan: READ_ONLY,
  loom_detail_expansion_check: READ_ONLY,
  loom_analyze_artifacts: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'low',
      effects: ['read', 'file'],
      writes: ['artifact-analysis.json'],
      requiresUserConfirmation: false,
    },
  },
  loom_converge: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'medium',
      effects: ['read', 'file'],
      writes: ['convergence-report.json'],
      requiresUserConfirmation: false,
    },
  },
  loom_omission_hunt: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    loom: {
      risk: 'low',
      effects: ['read', 'file'],
      writes: ['findings/omission-hunter.json'],
      requiresUserConfirmation: false,
    },
  },
  loom_verify_artifacts: READ_ONLY,
};

for (const tool of TOOL_DEFINITIONS) {
  Object.assign(tool, TOOL_SECURITY[tool.name] || TOOL_SECURITY_DEFAULT);
}

/**
 * 分组级"虚拟 Skill"描述（②）。模型先调 loom_list_capabilities 读这份目录，
 * 判断任务需要哪一组，再按需使用该组工具——而非把每个工具的细节都吃进上下文。
 */
export const CAPABILITY_GROUPS = {
  context: {
    title: '上下文（渐进式披露）',
    when: '需要项目宪章 / 结构化记忆里的某块信息时。先取目录（不带 section）看有什么，再按节召回，避免整文件进上下文。',
    tools: ['loom_get_context', 'loom_get_skill_context'],
  },
  pipeline: {
    title: '流水线（状态机）',
    when: '推进开发流程、查当前阶段该做什么、推进/审批/更新任务状态时。强调"状态感知"：先读 pipeline context 了解现状，再决定动作。',
    tools: ['loom_get_project_status', 'loom_get_pipeline_context', 'loom_select_pipeline', 'loom_advance_pipeline', 'loom_approve_gate', 'loom_update_task_state', 'loom_write_handoff', 'loom_stage_checkpoint', 'loom_adjust_pipeline', 'loom_validate_plan', 'loom_detail_expansion_check', 'loom_analyze_artifacts', 'loom_converge', 'loom_omission_hunt', 'loom_verify_artifacts'],
  },
  memory: {
    title: '结构化记忆',
    when: '需要历史决策 / 踩坑 / 偏好，或要记录新结论时。读用 loom_get_memory，写用 loom_add_memory。',
    tools: ['loom_get_memory', 'loom_add_memory'],
  },
  retrieval: {
    title: '多路检索（codegraph，外部 MCP）',
    when: '需要符号定义、调用链、改动影响半径时。codegraph 可用时优先用其 codegraph_* 工具（search / context / trace / callers / callees / impact / explore），原则：精确到代码块，宁可多检索一次。',
    tools: ['codegraph_search', 'codegraph_context', 'codegraph_trace', 'codegraph_callers', 'codegraph_callees', 'codegraph_impact', 'codegraph_explore'],
    external: true,
  },
  session: {
    title: '会话绑定',
    when: '开始处理某个 spec 时先 attach，后续调用可省略 spec_dir。',
    tools: ['loom_attach_spec'],
  },
  meta: {
    title: '元工具（能力目录 / 遥测）',
    when: '查看 loom 能力目录、加载工具组、查询会话遥测数据时。',
    tools: ['loom_list_capabilities', 'loom_load_tool_group', 'loom_telemetry'],
  },
};

function readContextResource(uri, doc, projectRoot, fsImpl) {
  const idx = loadContextIndex(join(projectRoot, '.loom'), doc, fsImpl);
  if (!idx) throw new Error(`Context resource not found: ${uri}`);
  return {
    uri,
    mimeType: 'text/markdown',
    text: idx.full().content,
  };
}

function readFileResource(uri, path, mimeType, fsImpl) {
  if (!fsImpl.existsSync(path)) throw new Error(`Resource not found: ${uri}`);
  return {
    uri,
    mimeType,
    text: fsImpl.readFileSync(path, 'utf-8'),
  };
}

function decodeSpecPath(value) {
  try { return decodeURIComponent(value); }
  catch { throw new Error(`Invalid encoded spec_dir: ${value}`); }
}

function decodeResourceId(value) {
  let decoded;
  try { decoded = decodeURIComponent(value); }
  catch { throw new Error(`Invalid encoded resource id: ${value}`); }
  if (!/^[A-Za-z0-9_.-]+$/.test(decoded) || decoded.includes('..')) {
    throw new Error(`Invalid resource id: ${decoded}`);
  }
  return decoded;
}

export function readMcpResource(uri, sessionStore, sessionId, { fs, projectRoot } = {}) {
  if (!uri) throw new Error('Missing resource uri');
  const fsImpl = fs || new NodeFileSystem();

  if (uri === 'loom://skills/catalog') {
    const skills = new SkillLoader(SKILLS_DIR, { fs: fsImpl }).listSummaries();
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ skills }, null, 2),
      }],
    };
  }

  const root = sessionStore.resolveProjectRoot(sessionId, projectRoot);
  if (uri === 'loom://memory') {
    return { contents: [readContextResource(uri, 'memory', root, fsImpl)] };
  }

  const contextMatch = uri.match(/^loom:\/\/context\/([^/]+)$/);
  if (contextMatch) {
    const doc = decodeURIComponent(contextMatch[1]);
    if (!DOC_KEYS.includes(doc)) {
      throw new Error(`Unknown context resource: ${doc}. One of: ${DOC_KEYS.join(', ')}`);
    }
    return { contents: [readContextResource(uri, doc, root, fsImpl)] };
  }

  const specResourceMatch = uri.match(/^loom:\/\/spec\/(.+)\/(state|progress)$/);
  if (specResourceMatch) {
    const specDir = safeResolveSpecDir(root, decodeSpecPath(specResourceMatch[1]));
    const [, , kind] = specResourceMatch;
    const file = kind === 'state' ? 'pipeline.state.json' : 'progress.md';
    const mimeType = kind === 'state' ? 'application/json' : 'text/markdown';
    return { contents: [readFileResource(uri, join(specDir, file), mimeType, fsImpl)] };
  }

  const handoffMatch = uri.match(/^loom:\/\/spec\/(.+)\/handoffs\/([^/]+)$/);
  if (handoffMatch) {
    const specDir = safeResolveSpecDir(root, decodeSpecPath(handoffMatch[1]));
    const handoffId = decodeResourceId(handoffMatch[2]);
    return {
      contents: [readFileResource(
        uri,
        join(specDir, 'handoffs', `${handoffId}.json`),
        'application/json',
        fsImpl
      )],
    };
  }

  throw new Error(`Unknown resource uri: ${uri}`);
}

// ── 工具执行 ───────────────────────────────────────────────────────────────

export async function executeToolCall(toolName, args, sessionStore, sessionId, { fs } = {}) {
  const fsImpl = fs || new NodeFileSystem();
  const specDir = sessionStore.resolveSpecDir(sessionId, args.spec_dir);
  const projectRoot = sessionStore.resolveProjectRoot(sessionId, args.project_root);

  switch (toolName) {

    case 'loom_list_capabilities': {
      const root = args.project_root || projectRoot;
      const codegraphReady = existsSync(join(root, '.codegraph'));
      const groups = Object.entries(CAPABILITY_GROUPS)
        .filter(([key]) => key !== 'retrieval' || codegraphReady)
        .map(([key, g]) => ({
          group: key,
          title: g.title,
          when: g.when,
          tools: g.tools,
          external: Boolean(g.external),
        }));
      return {
        hint: 'Pick the group that matches the task, then call only those tools. For context files, prefer loom_get_context over reading whole files.',
        codegraph_available: codegraphReady,
        groups,
      };
    }

    case 'loom_get_context': {
      if (!args.doc) return { error: `Missing doc. One of: ${DOC_KEYS.join(', ')}` };
      const root = args.project_root || projectRoot;
      const idx = loadContextIndex(join(root, '.loom'), args.doc, fsImpl);
      if (!idx) return { error: `Context doc not found: ${args.doc}` };
      // 回退闸：显式 full 或全局开关 → 整篇原文（绕过分节，防前言丢失）
      if (args.full || process.env.LOOM_CONTEXT_FULL) return idx.full();

      // L0 目录路径
      if (!args.section) {
        const out = idx.outline();
        // 自动兜底：文档无任何 ## 节 → 目录为空，正文全在前言区会丢失 → 回全文
        if (out.section_count === 0) return { ...idx.full(), fallback: 'no-sections' };
        return out;
      }

      // L1 取节路径
      const section = idx.getSection(args.section);
      // 命中且有正文 → 正常分级返回（省 token）
      if (section && section.content && section.content.trim()) return section;
      // 文档根本无分节 → 没法匹配，回全文兜底
      if (idx.sections.length === 0) return { ...idx.full(), fallback: 'no-sections' };
      // 命中但正文为空 → 回全文兜底，避免空响应丢信息
      if (section) return { ...idx.full(), fallback: 'empty-section', requested_section: args.section };
      // 有节但没匹配上 = 大概率拼错节名 → 给目录廉价重试，不整篇 dump
      return {
        error: `Section "${args.section}" not found in ${args.doc}`,
        available_sections: idx.outline().sections.map(s => s.title),
      };
    }

    case 'loom_get_project_status': {
      const root = args.project_root || projectRoot;
      const allSpecs = scanAllSpecs(root, { fs: fsImpl });
      const filteredSpecs = args.active_only
        ? allSpecs.filter(s => s.pipeline?.current_stage !== 'synced' && s.pipeline?.current_stage !== 'done')
        : allSpecs;
      const limitedSpecs = limitArray(filteredSpecs, positiveInt(args.limit, DEFAULT_STATUS_LIMIT));
      // health checks
      const issues = [];
      const constPath = join(root, '.loom', 'rules', 'constitution.md');
      if (existsSync(constPath)) {
        const c = readFileSync(constPath, 'utf-8');
        const ph = c.match(/\{\{[A-Z_]+\}\}/g);
        if (ph) issues.push(`constitution.md has ${ph.length} unrendered placeholders`);
      }
      if (!existsSync(join(root, '.loom', 'workflow.yaml'))) {
        issues.push('Missing .loom/workflow.yaml');
      }
      return {
        project_root: root,
        active_pipelines: filteredSpecs.length,
        total_pipelines: allSpecs.length,
        returned_pipelines: limitedSpecs.items.length,
        truncated: limitedSpecs.truncated,
        omitted_pipelines: limitedSpecs.omitted,
        detail: args.detail === 'full' ? 'full' : 'summary',
        pipelines: args.detail === 'full'
          ? limitedSpecs.items
          : limitedSpecs.items.map(s => ({
            spec_dir: s.spec_dir,
            stage: s.pipeline?.current_stage,
            pipeline_type: s.pipeline?.pipeline_type,
            tasks_total: s.tasks.length,
            tasks_done: s.tasks.filter(t => t.status === 'done').length,
            tasks_blocked: s.tasks.filter(t => t.status === 'blocked').length,
            handoffs_total: s.handoffs.length,
            updated_at: s.pipeline?.updated_at
          })),
        read_more_hint: limitedSpecs.truncated ? 'Pass a larger limit or detail:"full" only when needed.' : null,
        health_issues: issues
      };
    }

    case 'loom_get_pipeline_context': {
      if (!specDir) return { error: 'No spec_dir. Call loom_attach_spec first or pass spec_dir.' };
      const engine = new PipelineEngine(projectRoot, safeResolveSpecDir(projectRoot, specDir), { fs: fsImpl });
      const ctx = engine.getStageContext();
      if (!ctx) return { error: 'Pipeline not initialized' };
      const currentStep = engine.getSteps().find(s => s.id === ctx.current_stage);
      ctx.constraints = {
        must_produce: currentStep?.outputs || [],
        must_not_skip: currentStep?.skill ? [currentStep.skill] : [],
        requires_files: currentStep?.requires || [],
      };
      ctx.forbidden_actions = [
        'Do not skip the current stage skill',
        'Do not advance without producing required outputs',
        'Do not start the next stage before compressing closed-stage raw context',
      ];
      if (args.detail === 'full') return { ...ctx, detail: 'full' };
      return summarizePipelineContext(ctx, { handoffLimit: args.handoff_limit });
    }

    case 'loom_select_pipeline': {
      if (!args.request) return { error: 'request is required' };
      const absSpec = specDir ? safeResolveSpecDir(projectRoot, specDir) : null;
      const selector = new PipelineSelector(projectRoot, absSpec, { fs: fsImpl });
      const result = await selector.select(args.request);

      if (!args.initialize) return result;

      if (!absSpec) return { error: 'spec_dir is required when initialize=true' };
      return await withSpecLock(absSpec, () => {
        const engine = new PipelineEngine(projectRoot, absSpec, { fs: fsImpl, requirePipelines: false });
        const initResult = engine.initialize(null, { dynamicSteps: result.steps });
        return { ...result, initialized: true, state: initResult.state };
      }, fsImpl);
    }

    case 'loom_advance_pipeline': {
      if (!specDir) return { error: 'No spec_dir' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      return await withSpecLock(abs, () => new PipelineEngine(projectRoot, abs, { fs: fsImpl }).advance({ compressionConfirmed: args.compression_confirmed === true }), fsImpl);
    }

    case 'loom_approve_gate': {
      if (!specDir) return { error: 'No spec_dir' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      return await withSpecLock(abs, () => new PipelineEngine(projectRoot, abs, { fs: fsImpl }).approve(), fsImpl);
    }

    case 'loom_update_task_state': {
      if (!specDir) return { error: 'No spec_dir' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      const store = new PipelineStateStore(abs, { fs: fsImpl, projectRoot });
      const patch = { status: args.status };
      if (args.blocker) patch.blocker = args.blocker;
      if (args.status === 'failed') {
        const current = store.readTask(args.task_id);
        if (current) patch.retry_count = (current.retry_count || 0) + 1;
      }
      const state = store.updateTask(args.task_id, patch);
      return { ok: true, task: state };
    }

    case 'loom_write_handoff': {
      if (!specDir) return { error: 'No spec_dir' };
      if (!args.stage && !args.task_id) return { error: 'stage or task_id is required' };
      if (args.stage && args.task_id) return { error: 'Use only one of stage or task_id' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      return await withSpecLock(abs, () => {
        const store = new PipelineStateStore(abs, { fs: fsImpl, projectRoot });
        const payload = {
          ...(args.data || {}),
          status: args.status || args.data?.status || 'done',
          ...(args.summary ? { summary: args.summary } : {}),
          ...(args.artifacts ? { artifacts: args.artifacts } : {})
        };
        if (args.stage) {
          store.writeStageHandoff(args.stage, payload);
          return {
            ok: true,
            path: `handoffs/${args.stage}.json`,
            handoff: compactHandoff(store.readHandoff(args.stage)),
            next_required_action: 'compress closed-stage raw context before advancing or starting the next stage'
          };
        }
        store.writeHandoff(args.task_id, payload);
        return {
          ok: true,
          path: `handoffs/${args.task_id}.json`,
          handoff: compactHandoff(store.readHandoff(args.task_id)),
          next_required_action: 'use this compact handoff to locate artifacts, then verify signatures against current source'
        };
      }, fsImpl);
    }

    case 'loom_stage_checkpoint': {
      if (!specDir) return { error: 'No spec_dir' };
      if (!args.stage) return { error: 'stage is required' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      return await withSpecLock(abs, () => {
        const engine = new PipelineEngine(projectRoot, abs, { fs: fsImpl });
        const initialCtx = engine.getStageContext();
        if (!initialCtx) return { error: 'Pipeline not initialized' };
        if (args.stage !== initialCtx.current_stage) {
          return { error: `checkpoint stage "${args.stage}" does not match current stage "${initialCtx.current_stage}"` };
        }

        const store = new PipelineStateStore(abs, { fs: fsImpl, projectRoot });
        const payload = {
          ...(args.data || {}),
          status: args.status || args.data?.status || 'done',
          ...(args.summary ? { summary: args.summary } : {}),
          ...(args.artifacts ? { artifacts: args.artifacts } : {})
        };
        store.writeStageHandoff(args.stage, payload);

        const advance = args.advance
          ? {
              ok: false,
              skipped: true,
              compression_required: true,
              required_action: 'compress_closed_stage_context',
              hint: 'stage_checkpoint 已写入 handoff；现在调用宿主环境 compress，之后调用 loom_advance_pipeline 并传 compression_confirmed=true。'
            }
          : { ok: true, skipped: true };
        const ctx = engine.getStageContext();
        const currentStep = ctx ? engine.getSteps().find(s => s.id === ctx.current_stage) : null;
        if (ctx) {
          ctx.constraints = {
            must_produce: currentStep?.outputs || [],
            must_not_skip: currentStep?.skill ? [currentStep.skill] : [],
            requires_files: currentStep?.requires || [],
          };
          ctx.forbidden_actions = [
            'Do not skip the current stage skill',
            'Do not advance without producing required outputs',
            'Do not start the next stage before compressing closed-stage raw context',
          ];
        }

        return {
          ok: true,
          path: `handoffs/${args.stage}.json`,
          handoff_summary: {
            stage: args.stage,
            status: payload.status,
            summary: payload.summary || null,
            artifacts: payload.artifacts || []
          },
          advance,
          context: ctx
            ? (args.context_detail === 'full' ? { ...ctx, detail: 'full' } : summarizePipelineContext(ctx, { handoffLimit: args.handoff_limit }))
            : null,
          next_required_action: 'compress closed-stage raw context, then call loom_advance_pipeline with compression_confirmed=true'
        };
      }, fsImpl);
    }

    case 'loom_adjust_pipeline': {
      if (!specDir) return { error: 'No spec_dir' };
      if (!args.new_remaining_steps?.length) return { error: 'new_remaining_steps is required and must not be empty' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      return await withSpecLock(abs, () => {
        const engine = new PipelineEngine(projectRoot, abs, { fs: fsImpl });
        const result = engine.adjust(args.new_remaining_steps);
        return result;
      }, fsImpl);
    }

    case 'loom_get_memory': {
      const memStore = new MemoryStore(join(projectRoot, '.loom'), { fs: fsImpl });
      return memStore.list({
        type: args.type,
        tag: args.tag,
        scope: args.scope,
        stage: args.stage,
        file: args.file,
        specDir: args.spec_dir,
        pr: args.pr,
        commit: args.commit,
        task: args.task,
        handoff: args.handoff,
        includeExpired: args.include_expired,
        limit: args.limit || 10,
      });
    }

    case 'loom_add_memory': {
      const memStore = new MemoryStore(join(projectRoot, '.loom'), { fs: fsImpl });
      const entry = memStore.add(args.type, args.content, {
        context: args.context,
        tags: args.tags,
        source: args.source,
        confidence: args.confidence,
        scope: args.scope,
        expiresAt: args.expires_at,
        specDir: args.spec_dir,
        pr: args.pr,
        commit: args.commit,
        task: args.task,
        handoff: args.handoff,
        stage: args.stage,
        files: args.files,
      });
      return { ok: true, entry };
    }

    case 'loom_attach_spec': {
      sessionStore.attach(sessionId, args.spec_dir, args.project_root || projectRoot);
      return { ok: true, attached: args.spec_dir };
    }

    case 'loom_load_tool_group': {
      const group = args.group;
      if (!CAPABILITY_GROUPS[group]) return { error: `Unknown group: ${group}. Available: ${Object.keys(CAPABILITY_GROUPS).join(', ')}` };
      sessionStore.loadGroup(sessionId, group);
      const toolNames = CAPABILITY_GROUPS[group].tools.filter(t => TOOL_DEFINITIONS.some(td => td.name === t));
      return { ok: true, group, loaded_tools: toolNames };
    }

    case 'loom_get_skill_context': {
      const loader = new SkillLoader(SKILLS_DIR, { fs: fsImpl });

      // 无 skill 参数 → L0 全量摘要
      if (!args.skill) {
        const summaries = loader.listSummaries();
        return {
          level: 'L0',
          total_skills: summaries.length,
          total_tokens: summaries.reduce((sum, s) => sum + s.tokens, 0),
          hint: 'Call with skill name to get essentials, skill + section for a single section, or full:true only when the whole skill is required.',
          skills: summaries,
        };
      }

      // 有 skill + section → L1 单节
      if (args.section) {
        const section = loader.getSkillSection(args.skill, args.section);
        if (!section) {
          const summary = loader.getSummary(args.skill);
          return {
            error: `Section "${args.section}" not found in skill "${args.skill}"`,
            available_sections: summary ? summary.sections : [],
          };
        }
        return { level: 'L1', ...section };
      }

      if (!args.full) {
        const essentials = loader.getSkillEssentials(args.skill);
        if (!essentials) return { error: `Skill not found: ${args.skill}. Call without args to list all skills.` };
        return { level: 'L0.5', ...essentials };
      }

      // 显式 full:true → L1 完整 skill
      const full = loader.getFullSkill(args.skill);
      if (!full) return { error: `Skill not found: ${args.skill}. Call without args to list all skills.` };
      return { level: 'L1', ...full };
    }

    case 'loom_telemetry': {
      return getSnapshot();
    }

    case 'loom_detail_expansion_check': {
      if (!specDir) return { error: 'No spec_dir. Call loom_attach_spec first or pass spec_dir.' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      const r = runDetailExpansionCheck(abs);
      return {
        ok: r.ok,
        errors: r.errors || [],
        warnings: r.warnings || [],
        stats: r.stats,
        error: r.error || null,
      };
    }

    case 'loom_validate_plan': {
      if (!specDir) return { error: 'No spec_dir. Call loom_attach_spec first or pass spec_dir.' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      const r = validatePlan({ specDir: abs });
      return {
        ok: r.ok,
        errors: r.errors || [],
        warnings: r.warnings || [],
        plan_path: r.planPath,
        tasks_dir: r.tasksDir,
        task_files: r.taskFiles || [],
      };
    }

    case 'loom_analyze_artifacts': {
      if (!specDir) return { error: 'No spec_dir. Call loom_attach_spec first or pass spec_dir.' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      const r = runAnalyzeArtifacts(abs);
      return {
        ok: r.ok,
        error: r.error || null,
        errors: r.errors || [],
        report: r.report,
      };
    }

    case 'loom_converge': {
      if (!specDir) return { error: 'No spec_dir. Call loom_attach_spec first or pass spec_dir.' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      const round = positiveInt(args.round, 1);
      const r = runConverge(abs, round);
      return {
        ok: r.ok,
        error: r.error || null,
        errors: r.errors || [],
        report: r.report,
      };
    }

    case 'loom_omission_hunt': {
      if (!specDir) return { error: 'No spec_dir. Call loom_attach_spec first or pass spec_dir.' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      const r = runOmissionHunt(abs);
      return {
        ok: r.ok,
        error: r.error || null,
        errors: r.errors || [],
        report: r.report,
      };
    }

    case 'loom_verify_artifacts': {
      if (!specDir) return { error: 'No spec_dir. Call loom_attach_spec first or pass spec_dir.' };
      const abs = safeResolveSpecDir(projectRoot, specDir);
      const r = verifyArtifacts({ specDir: abs });
      return {
        ok: r.ok,
        errors: r.errors || [],
        warnings: r.warnings || [],
        spec_dir: r.specDir,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
