# Loom 系统设计文档

> 基于代码反向工程生成 | v3.0.2 | 2026-07-07

---

## 1. 系统概述

### 1.1 定位

Loom 是 AI 工程化框架，基于**技能（Skill）+ 流水线（Pipeline）**驱动，为 AI 编码助手（Claude Code、Cursor、Copilot、Codex、OpenCode）提供结构化工作流。

### 1.2 核心问题

| 问题 | 解法 |
|------|------|
| AI 上下文窗口有限 | 渐进式披露（L0 摘要 → L1 详情） |
| AI 编码缺乏流程约束 | 流水线状态机 + 门禁机制 |
| 多 AI 工具格式不统一 | 适配器模式（5 种后端） |
| 并发写入冲突 | 文件锁（PID + token） |
| 长会话上下文丢失 | 结构化记忆存储 |

### 1.3 技术栈

- **运行时**：Node.js >= 22，ESM 模块
- **依赖**：commander ^14.0.0（CLI），js-yaml ^4.2.0（YAML 解析）
- **协议**：MCP（Model Context Protocol）JSON-RPC 2.0 over stdio
- **测试**：Vitest ^4.1.8 + v8 覆盖率
- **持久化**：JSON 文件 + 文件系统（无数据库）

---

## 2. 架构设计

### 2.1 服务分层

```
┌─────────────────────────────────────────────────────┐
│                   AI 工具层                          │
│  Claude Code / Cursor / Copilot / Codex / OpenCode  │
└──────────────┬──────────────────┬───────────────────┘
               │ MCP协议           │ CLI命令
┌──────────────▼────────┐ ┌───────▼──────────────────┐
│    MCP Server 层       │ │     CLI 层               │
│  server.js             │ │  cli.js (commander)       │
│  tools.js (17工具)     │ │  commands/*.js (21命令)   │
│  session-store.js      │ │                           │
└──────────┬────────────┘ └───────────┬───────────────┘
           │                          │
┌──────────▼──────────────────────────▼───────────────┐
│                   核心引擎层                         │
│  pipeline-engine  state-store  artifact-checker      │
│  memory-store  skill-loader  context-index           │
│  compliance-tracker  lock  installer                 │
│  fs-interface                                        │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│                   适配器层                           │
│  base.js  claude-code  codex  copilot  cursor        │
│  opencode  cursor-converter                          │
└──────────────────────────────────────────────────────┘
```

### 2.2 模块职责表

| 层级 | 模块 | 职责 |
|------|------|------|
| CLI | cli.js | 命令分发入口，动态加载所有子命令 |
| CLI | commands/run.js | 流水线执行：推进、审批、失败、恢复 |
| CLI | commands/install.js | 安装 loom 到目标 AI 工具 |
| CLI | commands/doctor.js | 诊断安装和项目健康 |
| CLI | commands/init-project.js | 初始化 .loom/ 目录和配置 |
| CLI | commands/memory.js | 结构化记忆管理（CRUD + 导出 + 合并） |
| CLI | commands/mcp-serve.js | 启动 MCP 服务器 |
| CLI | commands/start.js | 输出项目 loom 状态和上下文 |
| CLI | commands/status.js | 显示流水线当前状态 |
| CLI | commands/evidence.js | 从 compliance history 导出统一 evidence 视图 |
| CLI | commands/handoff.js | 写入阶段或任务 handoff |
| CLI | commands/tasks.js | 分析任务文件归属 |
| CLI | commands/index.js | 同步 codegraph 图索引 |
| MCP | mcp/server.js | JSON-RPC 2.0 服务器，stdio 传输 |
| MCP | mcp/tools.js | 16 个工具定义 + executeToolCall 分发 |
| MCP | mcp/session-store.js | 会话绑定（spec_dir + 工具分组延迟加载） |
| Core | pipeline-engine.js | 流水线状态机：初始化、推进、审批、失败、恢复 |
| Core | pipeline-selector.js | AI 自主流程选择：信号收集、规则短路、AI fallback、规则兜底、校验修正 |
| Core | state-store.js | 流水线状态 + 任务状态持久化（JSON 文件），支持 dynamic_steps |
| Core | artifact-checker.js | 产物完整性检查（存在性 + 占位符扫描） |
| Core | compliance-tracker.js | 合规率追踪和历史记录 |
| Core | evidence-store.js | compliance history 到 `loom.evidence.v1` 的规范化、过滤、汇总、JSONL 导出、报告渲染和趋势指标 |
| Core | memory-store.js | 结构化记忆 CRUD + Markdown 导出 |
| Core | skill-loader.js | SKILL.md 渐进式披露（L0 摘要 / L1 全文） |
| Core | context-index.js | 上下文文件渐进式披露（outline / section） |
| Core | lock.js | 文件锁（PID + token，防并发） |
| Core | installer.js | 适配器安装/卸载协调 |
| Core | failure-diagnostics.js | 失败诊断与恢复建议 |
| Core | task-lock.js | 任务级并发锁 |
| Core | fs-interface.js | 文件系统抽象（NodeFS / InMemoryFS） |
| Adapter | base.js | 适配器基类，定义安装/卸载接口 |
| Adapter | claude-code.js | Claude Code 适配器（settings.json + hooks） |
| Adapter | cursor.js | Cursor 适配器（.mdc 规则文件） |
| Adapter | copilot.js | GitHub Copilot 适配器（.github/copilot-instructions.md） |
| Adapter | codex.js | OpenAI Codex 适配器（AGENTS.md + MCP config.toml） |
| Adapter | opencode.js | OpenCode 适配器（opencode.json + 插件） |
| Adapter | cursor-converter.js | SKILL.md → .mdc 格式转换 |

### 2.3 依赖方向图

```
cli.js
  └→ commands/*.js
       ├→ core/pipeline-engine.js ─→ core/state-store.js
       │                           ─→ core/lock.js
       │                           ─→ core/artifact-checker.js
       │                           ─→ core/compliance-tracker.js
       ├→ core/pipeline-selector.js ─→ core/fs-interface.js
       ├→ core/installer.js ─→ adapters/*.js（动态加载）
       ├→ core/memory-store.js
       ├→ core/context-index.js
       └→ core/skill-loader.js ─→ core/context-index.js

mcp/server.js
  └→ mcp/tools.js ─→ core/*（几乎所有核心模块）
  └→ mcp/session-store.js（无 core 依赖）
```

**核心模块依赖层级**：

```
Level 0（叶子）:  fs-interface.js
Level 1:          artifact-checker, compliance-tracker, context-index,
                  lock, memory-store, state-store, task-lock,
                  failure-diagnostics
Level 2:          skill-loader（→ context-index）
                  pipeline-selector（→ fs-interface）
Level 3（顶层）:  pipeline-engine（→ state-store, lock, artifact-checker, compliance-tracker）
```

**被依赖热度**：fs-interface(7) > pipeline-engine(2) = installer(4) = state-store(2) = memory-store(2)

---

## 3. 数据模型

### 3.1 存储架构

项目无数据库，所有持久化通过 JSON 文件：

```
.loom/
├── memory/
│   ├── store.json           # 结构化记忆（单一真实来源）
│   ├── MEMORY.md            # 只读导出视图
│   └── sessions/            # 会话归档
├── compliance/
│   └── history.json         # 合规率历史（最多 500 条），evidence-store 的输入
└── rules/
    └── constitution.md      # 项目宪章，包含架构和目录结构

specs/<date+feature>/
├── pipeline.state.json      # 流水线状态
├── progress.md              # 进度文件（自动生成）
├── spec.md                  # 需求规格
├── plan.md                  # 实现计划
├── tasks/                   # 任务文件目录
│   ├── T1.md
│   └── T2.md
├── task-states/             # 任务状态
│   └── T1.state.json
├── handoffs/                # 任务交接
│   └── T1.json
├── test-report.md           # 测试报告
├── verify-report.md         # 验证报告
└── .loom-run.lock           # 运行锁
```

### 3.2 ER 图描述（实体-关系）

```
┌──────────────┐     1:N     ┌──────────────────┐
│  Pipeline    │────────────→│  StageHistory    │
│  State       │             │  - stage         │
│              │             │  - entered_at     │
│  - spec_dir  │             │  - exited_at      │
│  - type      │             │  - status         │
│  - current   │             │  - approval        │
│  - started   │             └──────────────────┘
│  - updated   │
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────────┐     1:1     ┌──────────────────┐
│  TaskState       │────────────→│  Handoff         │
│  - task_id       │             │  - task_id        │
│  - status        │             │  - written_at     │
│  - retry_count   │             │  - context        │
│  - agent_session │             └──────────────────┘
│  - last_review   │
│  - blocker       │
└──────────────────┘

┌──────────────────┐     1:N     ┌──────────────────┐
│  MemoryStore     │────────────→│  Entry           │
│  - entries[]     │             │  - id (8位UUID)   │
│  - sessions[]    │             │  - type           │
│                  │             │  - content        │
│                  │             │  - author         │
│                  │             │  - tags           │
│                  │             │  - context        │
│                  │             │  - created_at     │
└──────────────────┘             └──────────────────┘

┌──────────────────┐     1:N     ┌──────────────────┐
│  Compliance      │────────────→│  HistoryRecord   │
│  Tracker         │             │  - spec_dir       │
│                  │             │  - timestamp      │
│                  │             │  - stage          │
│                  │             │  - skill          │
│                  │             │  - passed         │
│                  │             │  - violations[]   │
└──────────────────┘             └──────────────────┘

┌──────────────────┐
│  SpecLock        │
│  - pid           │
│  - startedAt     │
│  - token         │
└──────────────────┘

┌──────────────────┐
│  Session (MCP)   │
│  - sessionId     │
│  - specDir       │
│  - projectRoot   │
│  - attachedAt    │
│  - loadedGroups  │
└──────────────────┘
```

### 3.3 核心字段与约束

**PipelineState**：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| spec_dir | string | 必填 | 规格目录绝对路径 |
| pipeline_type | enum | feature/bugfix/hotfix/refactor/pm-prototype/chore/qa | 流水线类型 |
| dynamic_steps | array | 可选 | AI 选择的动态步骤列表（优先于 pipeline_type 步骤） |
| current_stage | enum | brainstorming/planning/approved/git-worktree/executing/verification/code-review-request/review-gate/code-review-response/synced/failed | 当前阶段 |
| started_at | ISO8601 | 必填 | 启动时间 |
| updated_at | ISO8601 | 必填 | 最后更新时间 |
| stage_history | array | 必填 | 阶段变更历史 |
| loom_version | string | 必填 | 创建时的 loom 版本 |

**TaskState**：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| task_id | string | 必填，唯一 | 任务 ID（如 T1） |
| status | enum | pending/executing/reviewing/done/failed/blocked | 任务状态 |
| retry_count | integer | >= 0 | 重试次数 |
| agent_session_id | string | 可选 | 关联的 AI 会话 |
| last_reviewer_result | object | 可选 | 最近一次 review 结果 |
| blocker | string | 可选 | 阻塞原因 |

**MemoryEntry**：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | string | 8 位 UUID，唯一 | 条目标识 |
| type | string | 常用值：决策/踩坑/偏好/状态/adr | 记忆类型，当前实现允许自定义字符串 |
| content | string | 必填 | 记忆内容 |
| author | string | 自动检测（git config user.name） | 作者 |
| tags | array | 可选 | 标签 |
| created_at | ISO8601 | 必填 | 创建时间 |

### 3.4 JSON Schema 配置模型

| 文件 | 实体 | 核心字段 |
|------|------|----------|
| hooks.schema.json | HookRegistry | lifecycleEvents, event-indexed hooks, id, entry, platforms, timeoutMs, blocking, idempotent, fallback(skip/warn/error/retry), policy, handler decision(ok/warned/skipped/blocked/failed), compliance audit history, user prompt risk suggestions, post-tool result audit, subagent/task/handoff links, task lifecycle artifacts, worktree cleanup status, compaction handoff, file-change sync suggestions |
| pipeline.schema.json | PipelineState | states(8个), transitions(15条), progressFileFormat |
| review.schema.json | ReviewDimension | architecture/code-quality/security/performance/conformance/impact-scope; Severity: BLOCKER/WARNING/SUGGESTION |
| tools.schema.json | ToolContract | id, adapter, displayName, supportLevel, platforms, hooksSupport, entryFilename, contract(capabilities, installScopes, configSurfaces, managedArtifacts, versionProbe) |
| model-selection.schema.json | Tier | mechanical/integration/architecture; Signal: condition→tier 映射 |
| templates.schema.json | Template | id, sourceFile, outputPath, requiredVariables, optionalVariables |
| shared-rules.json | Rule | id, heading, content, injectTo, notes |

---

## 4. 接口设计

### 4.1 MCP 协议端点

| JSON-RPC 方法 | 功能 | 鉴权 |
|---------------|------|------|
| initialize | 握手初始化，返回协议版本和 tools/resources/prompts 能力 | 无 |
| notifications/initialized | 客户端初始化完成通知 | 无 |
| tools/list | 列出可用工具（支持延迟加载过滤），每个工具携带 `annotations` 和 `loom` 风险元数据 | 无 |
| tools/call | 调用指定工具 | 无 |
| resources/list | 列出固定资源入口，例如 constitution、memory、skill catalog | 无 |
| resources/templates/list | 列出模板化资源入口，例如 spec state、progress、handoff | 无 |
| resources/read | 读取只读资源内容；当前支持 constitution、memory、skill catalog、spec state、progress、handoff | 无 |
| prompts/list | 列出标准 Loom prompts，例如 feature 启动、写计划、验证、请求审查 | 无 |
| prompts/get | 获取标准 prompt 消息模板，并校验必填参数 | 无 |
| ping | 心跳检测 | 无 |

**协议版本**：默认 `2025-11-25`，兼容 `2025-06-18`

**资源与提示可发现性**：`initialize` 声明 `resources` 和 `prompts` 能力；当前已实现 `resources/list`、`resources/templates/list`、`resources/read`、`prompts/list`、`prompts/get`。`resources/read` 覆盖 constitution、memory、skill catalog，以及模板化 spec 资源 `state`、`progress`、`handoffs/{id}`；spec 路径读取会经过项目根目录沙箱校验。

**工具安全元数据**：

- `annotations.readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` 对齐 MCP 工具注解习惯，供客户端做基础治理。
- `loom.risk` 标记 `low` / `medium` / `high`。
- `loom.effects` 标记读、会话状态、文件、流水线状态、审批或 workflow 影响。
- `loom.writes` 列出可能写入的文件或状态对象。
- `loom.requiresUserConfirmation` 标记需要明确用户确认的操作，或说明条件式确认规则。

### 4.2 MCP 工具清单

| 工具名 | 分组 | 请求参数 | 响应 | 说明 |
|--------|------|----------|------|------|
| loom_list_capabilities | meta | 无 | 能力目录（分组列表） | START HERE 入口 |
| loom_get_context | context | doc, section?, full? | 文档 outline 或 section 内容 | 渐进式披露上下文文件 |
| loom_get_skill_context | context | skill?, section? | L0 摘要或 L1 全文 | 渐进式披露技能文件 |
| loom_get_project_status | pipeline | spec_dir | 流水线状态 | 获取项目 loom 状态 |
| loom_get_pipeline_context | pipeline | spec_dir | StageContext 对象 | 获取当前阶段上下文 |
| loom_advance_pipeline | pipeline | spec_dir, project_root?, compression_confirmed? | AdvanceResult | 压缩确认后推进流水线（加锁） |
| loom_approve_gate | pipeline | spec_dir | transition 结果 | 通过人工审批门禁（加锁） |
| loom_update_task_state | pipeline | spec_dir, task_id, status | 更新结果 | 更新任务状态 |
| loom_select_pipeline | pipeline | request, spec_dir?, initialize? | 选择结果；initialize=true 时写入 dynamic_steps | AI 自主流程选择（规则短路 / AI / 兜底） |
| loom_adjust_pipeline | pipeline | spec_dir, new_remaining_steps | 调整结果 | 执行中追加步骤（保留已完成） |
| loom_write_handoff | pipeline | spec_dir?, stage?, task_id?, status?, summary?, artifacts?, data? | 写入结果 | 写入 stage 或 task handoff，并刷新 progress.md；status 允许 done/partial/blocked/failed |
| loom_stage_checkpoint | pipeline | spec_dir?, stage, status?, summary?, artifacts?, data? | checkpoint 结果 | 写 stage handoff 并返回紧凑上下文；推进前必须先压缩 |
| loom_get_memory | memory | spec_dir?, type?, limit? | Entry 列表 | 读取记忆条目 |
| loom_add_memory | memory | spec_dir, type, content, context? | 新 Entry | 写入记忆条目 |
| loom_attach_spec | session | spec_dir, project_root? | 绑定结果 | 绑定会话到 spec 目录 |
| loom_load_tool_group | session | group | 加载结果 | 按需加载工具分组 |

### 4.3 CLI 命令清单

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| loom init-project | | | 初始化 .loom/ 上下文 |
| loom install | | --tool \<targets\> | 安装到 AI 工具 |
| loom update | | | 更新安装 |
| loom uninstall | | --tool \<targets\> | 卸载 |
| loom doctor | | --tool, --json, --fix-plan, --fix-plan-out | 诊断安装、adapter contract 一致性和项目健康；`--json` 输出 `loom.doctor.v1`，`--fix-plan` 写出非破坏性的 `loom.doctor-fix-plan.v1` 修复计划 |
| loom list | | | 列出可用 skills 和 commands |
| loom run | | --spec-dir, --advance, --compression-confirmed, --approve, --fail, --recover, --task, --task-status, --context, --verdict, --auto, --request, --approve-pipeline | 流水线执行引擎 |
| loom select | | --spec-dir, --request, --json | AI 自主流程选择，可选输出 pipeline-plan.md 供人工审查 |
| loom handoff write | | --spec-dir, --stage 或 --task, --status, --summary, --artifacts, --data | 写入阶段或任务 handoff，并刷新 progress.md |
| loom status | | | 显示流水线状态 |
| loom evidence | | --json, --jsonl, --type, --risk, --verdict, --spec-dir, --limit, --hash-artifacts, --format, --trends, --top, --out | 导出统一 evidence 视图，可附加 artifact sha256，写入 JSON/JSONL/Markdown/HTML 文件，并输出趋势指标 |
| loom dashboard | | --out, --spec-dir, --limit, --repos, --web, --data-out, --refresh | 从一个或多个仓库的 evidence 与 memory 生成本地 HTML 团队看板；`--web` 额外写出 `loom.dashboard.v1` JSON 数据文件 |
| loom plugins list | | --dir, --json | 发现 `.loom/plugins/*.json` manifest，并列出 step、adapter、hook、reporter 扩展点 |
| loom plugins plan | | --dir, --out, --json | 生成 `loom.plugin-plan.v1` 声明式插件接入计划，不加载或执行第三方代码 |
| loom plugins marketplace-template | | --out, --name, --id, --server-name, --url, --transport, --force, --json | 生成 remote MCP marketplace 配置模板，默认不覆盖已有文件 |
| loom plugins marketplace-sync | | --source, --out, --audit-out, --json | 从 marketplace 模板生成本地同步计划和 JSONL 审计记录，不联网、不写客户端配置 |
| loom policy check | | --policy, --files, --file, --out | 按 policy 扫描敏感路径和 secret，并写入 JSONL 审计记录 |
| loom tasks | | --spec-dir | 分析任务归属 |
| loom index | | | 同步 codegraph 图索引 |
| loom start | | | 输出项目 loom 状态 |
| loom memory add | | --type, --content, --source, --confidence, --scope, --expires-at, --spec-dir, --pr, --commit, --task, --handoff, --stage, --files | 添加可追溯记忆条目 |
| loom memory list | | --type, --tag, --scope, --stage, --file, --spec-dir, --pr, --commit, --task, --handoff, --include-expired, --limit | 按结构化元数据检索记忆条目 |
| loom memory export | | | 导出 MEMORY.md |
| loom memory merge | | --from | 合并存储 |
| loom memory remove | | --id | 删除条目 |
| loom memory archive | | --slug | 归档会话 |
| loom mcp-serve | | | 启动 MCP 服务器 |

### 4.4 适配器注册方式

| 适配器 | 注册位置 | 配置格式 |
|--------|----------|----------|
| Claude Code | ~/.claude/settings.json → mcpServers.loom | { command: "loom", args: ["mcp-serve"] } |
| Cursor | ~/.cursor/mcp/mcp.json → mcpServers.loom | { command: "loom", args: ["mcp-serve"] } |
| OpenCode | ~/.config/opencode/opencode.json → mcp.loom | { type: "local", command: ["loom", "mcp-serve"] } |
| Codex | ~/.codex/config.toml → mcp_servers.loom | command = "loom", args = ["mcp-serve"] |
| Copilot | .github/copilot-instructions.md | Markdown 规则注入 |
| Codex | ~/.codex/config.toml + AGENTS.md | MCP server + Markdown 规则注入 |

---

## 5. 核心流程

### 5.1 流水线状态机

```
                    ┌──────────────┐
                    │ brainstorming │
                    └──┬───────┬───┘
               确认spec  │       │ error
                       ▼       ▼
                 ┌──────────┐ ┌───────┐
                 │ planning  │ │failed │◄──────────────┐
                 └──┬────┬──┘ └──┬──┬──┘               │
            确认plan │    │error  │  │ user_retries     │
                    ▼    └───────┘  │                   │
              ┌──────────┐          │                   │
              │ approved  │──────────┤                   │
              │ (gate)    │          │                   │
              └──┬───────┘          │                   │
         触发执行 │                  │                   │
                 ▼                  │                   │
          ┌─────────────┐           │                   │
          │ git-worktree │──────────┤                   │
          └──┬──────────┘           │                   │
        创建分支 │                    │                   │
              ▼                     │                   │
         ┌───────────┐              │                   │
    ┌──→│ executing  │──────────────┤                   │
    │   └──┬────────┘              │                   │
    │      │ all_tasks_done        │                   │
    │      ▼                       │                   │
    │  ┌─────────────┐             │                   │
    │  │ verification │────────────┤                   │
    │  └──┬──────┬───┘             │                   │
    │     │      │ blocker_found   │                   │
    │     │ PASS  └────────────────┘                   │
    │     ▼          (增量修复模式)                     │
    │  ┌────────┐                                     │
    │  │ synced │──────────────────────────────────────┘
    │  └────────┘   (verification failed → critical)
    │
    └── verification → executing (blocker_found, 增量修复)
```

### 5.2 七种流水线类型 + 动态选择

**类型模式**（`loom run --type <type>`）：

| 类型 | 步骤序列 | 特点 |
|------|----------|------|
| feature | brainstorming → planning → approved → git-worktree → executing → verification → code-review → synced | 完整流程，含分支隔离和对抗审查 |
| bugfix | planning → approved → executing → verification → code-review → synced | 跳过头脑风暴和分支创建，保留对抗审查 |
| hotfix | approved → executing → verification | 最小步骤，max_retries=1，紧急跳过对抗审查 |
| refactor | brainstorming → planning → approved → executing → verification → code-review → synced | 有方案对比，不开新分支，保留对抗审查 |
| pm-prototype | brainstorming → spec-approved → prototype | PM 专用，直出 HTML 原型 |
| chore | executing → verification | 低风险改动，无需审批和对抗审查 |
| qa | qa-analysis → qa-design → qa-approved → qa-execution → qa-signoff → qa-report | QA 验收流水线，含两次 human-approval gate |

凡 step.outputs 声明 `handoffs/<stage>.json` 的阶段，都必须在推进前写入对应阶段 handoff；终止阶段同样先校验 outputs，再返回流水线已结束。阶段 handoff 写入后，宿主 AI 必须立即调用当前环境的上下文压缩能力压缩旧阶段原始对话和长日志，再以 `compression_confirmed=true` 调用 MCP `loom_advance_pipeline`，或用 CLI `loom run --advance --compression-confirmed` 推进。`loom_stage_checkpoint` 只负责写 handoff 和返回紧凑上下文，不在同一次调用内推进，避免跳过可插入的自动压缩点。未声明 handoff output 的阶段不会触发上下文压缩门禁。

**动态选择模式**（`loom run --auto --request "<text>"` 或 MCP `loom_select_pipeline`）：

PipelineSelector 从 `step_catalog` 中按需组合步骤，三段决策：

1. **规则短路**：关键词命中 → 固定步骤，0 token
2. **AI fallback**：信号模糊 + aiClient 注入 → AI 从 catalog 选步骤
3. **规则兜底**：无 AI 或 AI 失败 → 按风险等级生成基础流程

选择结果经 `_validateAndFix` 校验：must_include、dependency_closure、never_skip_gates、max_steps。默认首次选择必须只返回结果，不写状态；AI 工具向用户打印选择来源、风险等级、步骤顺序和理由，并等待用户明确确认后，才能通过 `loom run --auto` 或 MCP `loom_select_pipeline initialize=true` 写入 `pipeline.state.json` 的 `dynamic_steps`；`progress.md` 自动记录当前阶段和动态步骤，供后续无上下文续跑。需要先审查或手动调整时，可用 `loom select` 生成 `pipeline-plan.md` 后再 `--approve-pipeline`。

### 5.3 门禁执行顺序（advance 流程）

```
engine.advance() 执行检查（严格顺序）：

1. 当前状态是否 failed？         → 是：拒绝推进
2. 当前是否 human-approval gate？ → 是：拒绝，要求 --approve
3. 当前阶段 outputs 完整性？     → 检查文件存在 + 无占位符
4. gate_verdict 报告裁定？      → 检查 verdict === PASS
5. 是否存在 next step？         → 否：拒绝（流水线已结束）
6. 当前阶段若声明 handoff output，是否已确认上下文压缩？ → 否：拒绝，要求先压缩再确认
7. 下一阶段 requires 前置条件？  → 检查文件/目录存在
8. 全部通过 → store.transition(nextStage)
```

### 5.4 门禁类型

| 门禁类型 | 声明方式 | 触发位置 | 通过方式 |
|----------|----------|----------|----------|
| human-approval | step.gate: human-approval | approved, spec-approved, qa-approved, qa-signoff | 用户执行 --approve |
| gate_verdict | step.gate_verdict: \<filename\> | executing(test-report.md), verification(verify-report.md) | 报告 verdict === PASS |
| 产物完整性 | step.outputs + checkStageOutputs() | 所有阶段 | 文件存在 + 无占位符 |
| 上下文压缩 | step.outputs 含 handoffs/&lt;stage&gt;.json | 阶段推进前 | 宿主 AI 调用 compress 后传 `compression_confirmed=true` |
| 前置条件 | step.requires + checkPreconditions() | 阶段入口 | 文件/目录存在 |

**占位符检测规则**：`TBD`, `TODO`, `FIXME`, `XXX`（大小写敏感），`implement later`, `fill in details`, `placeholder text`（大小写不敏感），`{{VAR}}`（未渲染模板变量）。

### 5.5 MCP 请求处理时序

```
AI工具              MCP Server               Core模块
  │                     │                       │
  │─ initialize ──────→│                       │
  │←─ capabilities ────│                       │
  │                     │                       │
  │─ tools/call ───────→│                       │
  │  (loom_advance_     │                       │
  │   pipeline)         │─ resolveSpecDir ─────→│ session-store
  │                     │─ safeResolve ────────→│ fs-interface
  │                     │─ withSpecLock ───────→│ lock
  │                     │─ advance() ──────────→│ pipeline-engine
  │                     │                       │  ├→ state-store.read()
  │                     │                       │  ├→ artifact-checker.checkStageOutputs()
  │                     │                       │  ├→ artifact-checker.isReportPassing()
  │                     │                       │  ├→ artifact-checker.checkPreconditions()
  │                     │                       │  └→ state-store.transition()
  │                     │                       │     └→ _rebuildProgress()
  │                     │                       │
  │←─ result ──────────│                       │
  │                     │                       │
```

### 5.6 渐进式披露流程

```
AI工具              MCP Server               SkillLoader / ContextIndex
  │                     │                       │
  │─ loom_list_         │                       │
  │  capabilities ─────→│                       │
  │←─ 分组目录 ─────────│                       │
  │                     │                       │
  │─ loom_get_skill_    │                       │
  │  context ──────────→│─ listSummaries() ────→│ → L0: name+description+sections+triggers
  │←─ L0 摘要(~1.2K token)                     │    约100-200 token/skill
  │                     │                       │
  │─ loom_get_skill_    │                       │
  │  context            │─ getFullSkill() ─────→│ → L1: 完整 SKILL.md
  │  (skill=xxx) ──────→│                       │
  │←─ L1 全文 ─────────│                       │
  │                     │                       │
  │─ loom_get_skill_    │                       │
  │  context            │─ getSkillSection() ──→│ → L1: 单个 section
  │  (skill=xxx,        │                       │
  │   section=yyy) ────→│                       │
  │←─ L1 单节 ─────────│                       │
```

### 5.7 安装流程时序

```
用户               CLI                    Installer              Adapter
  │                  │                       │                      │
  │─ loom install ──→│                       │                      │
  │  --tool claude   │─ new Installer() ────→│                      │
  │                  │─ install("claude") ──→│                      │
  │                  │                       │─ import(adapter) ───→│
  │                  │                       │─ adapter.install() ─→│
  │                  │                       │                      │─ 写 settings.json
  │                  │                       │                      │─ 注册 hooks
  │                  │                       │                      │─ 复制 skill 文件
  │                  │                       │←─ 安装结果 ──────────│
  │                  │←─ 结果 ───────────────│                      │
  │←─ 完成 ──────────│                       │                      │
```

---

## 6. 外部依赖

### 6.1 运行时依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| commander | ^12.0.0 | CLI 命令解析和注册 |
| js-yaml | ^4.2.0 | workflow.yaml 解析 |

### 6.2 开发依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| vitest | ^4.1.8 | 测试框架 |
| @vitest/coverage-v8 | ^4.1.8 | 测试覆盖率 |

### 6.3 可选外部工具

| 工具 | 用途 | 检测方式 |
|------|------|----------|
| codegraph | 代码依赖追踪、MCP 检索 | base.js: `which codegraph` |
| git | 分支管理、worktree、作者检测 | 多处 `git` 命令调用 |

### 6.4 AI 工具集成

| 工具 | 集成方式 | 配置文件 |
|------|----------|----------|
| Claude Code | MCP Server + Hooks + SKILL.md | ~/.claude/settings.json |
| Cursor | MCP Server + .mdc 规则 | ~/.cursor/mcp/mcp.json |
| OpenCode | MCP Server + 插件系统 | ~/.config/opencode/opencode.json |
| GitHub Copilot | Markdown 规则注入 | .github/copilot-instructions.md |
| OpenAI Codex | MCP Server + Markdown 规则注入 | ~/.codex/config.toml + AGENTS.md |

### 6.5 关键设计约束

| 约束 | 说明 |
|------|------|
| 无数据库 | 所有持久化通过 JSON 文件 + 原子写入（tmp + rename） |
| 无 MCP SDK | 直接实现 JSON-RPC 2.0 over stdio，无第三方 MCP 依赖 |
| 内存上限 | 记忆条目最多 50 条，合规历史最多 500 条 |
| Section Token 预算 | 单节 1500 token，超出标记 oversized |
| 文件锁 | PID + token 机制，防并发写入同一 spec |
| 会话生命周期 | MCP 会话绑定随进程退出失效，无跨会话持久化 |
