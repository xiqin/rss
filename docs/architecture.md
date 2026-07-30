# 架构

loom 项目的代码架构和模块组织。

## 目录结构

```
loom/
├── bin/loom.js              # CLI 入口
├── src/
│   ├── cli.js              # CLI 命令注册（commander）
│   ├── commands/           # CLI 命令实现
│   │   ├── init-project.js # loom init-project（项目上下文初始化）
│   │   ├── install.js      # loom install
│   │   ├── uninstall.js    # loom uninstall
│   │   ├── update.js       # loom update
│   │   ├── doctor.js       # loom doctor
│   │   ├── list.js         # loom list
│   │   ├── run.js          # loom run（流水线执行引擎）
│   │   ├── select.js      # loom select（AI 自主流程选择）
│   │   ├── status.js       # loom status（流水线状态）
│   │   ├── evidence.js     # loom evidence（统一证据视图）
│   │   ├── dashboard.js    # loom dashboard（团队 HTML 看板）
│   │   ├── plugins.js      # loom plugins list / plan / marketplace-template / marketplace-sync（生态扩展）
│   │   ├── tasks.js        # loom tasks（任务并行批次分析）
│   │   ├── index.js        # loom index（codegraph 委派；无 codegraph 时跳过）
│   │   ├── start.js        # loom start（输出可粘贴的项目状态）
│   │   ├── memory.js       # loom memory（结构化记忆）
│   │   └── mcp-serve.js    # loom mcp-serve（MCP server）
│   ├── adapters/           # 工具适配器（user-level）
│   │   ├── base.js         # BaseAdapter 基类
│   │   ├── claude-code.js  # Claude Code 适配器
│   │   ├── cursor.js       # Cursor 适配器
│   │   ├── copilot.js      # Copilot 适配器
│   │   ├── cursor-converter.js # Cursor rules 转换
│   │   ├── opencode.js     # OpenCode 适配器
│   │   └── codex.js        # Codex 适配器
│   ├── core/               # 核心逻辑
│   │   ├── pipeline-engine.js    — 流水线状态机
│   │   ├── pipeline-selector.js  — AI 自主流程选择
│   │   ├── state-store.js        — 状态持久化
│   │   ├── artifact-checker.js   — 产物完整性检查
│   │   ├── memory-store.js       — 结构化记忆
│   │   ├── skill-loader.js       — Skill 渐进式披露
│   │   ├── context-index.js      — 上下文文件分节
│   │   ├── compliance-tracker.js — Skill 质量度量
│   │   ├── evidence-store.js     — compliance history 规范化证据视图、趋势指标
│   │   ├── lock.js               — 文件锁
│   │   ├── installer.js          — 安装器
│   │   ├── failure-diagnostics.js — 失败诊断
│   │   ├── task-lock.js          — 任务锁
│   │   └── fs-interface.js       — 文件系统抽象
│   └── generated/          # 自动生成
│       └── tooling.js      # 从 tools.schema.json 生成
├── config/                 # Schema 定义
│   ├── tools.schema.json   # 工具定义
│   ├── hooks.schema.json   # Hook 系统定义
│   ├── pipeline.schema.json # 流水线状态机
│   ├── review.schema.json  # 审查框架
│   ├── templates.schema.json # 模板定义
│   ├── model-selection.schema.json # 模型选择策略
│   └── shared-rules.json   # 共享规则定义
├── skills/                 # Skills 定义
├── commands/               # Commands 定义
├── hooks/                  # Hook 系统
│   ├── hooks.json          # Hook 注册表
│   ├── run-hook.js         # Hook runner
│   ├── session-start       # Shell wrapper
│   └── handlers/           # Hook 处理器
│       └── session-start.cjs
├── templates/              # 项目模板
├── .claude-plugin/         # 插件元数据
├── scripts/                # 构建脚本
│   ├── generate-incremental.mjs # 增量生成总入口（npm run generate）
│   ├── generate-tooling.mjs
│   ├── generate-plugin-meta.mjs
│   ├── generate-skills-catalog.mjs
│   ├── generate-review-summary.mjs
│   ├── generate-model-selection.mjs
│   ├── generate-shared-rules.mjs
│   ├── generate-progress-rules.mjs
│   ├── sync-version.mjs
│   ├── common.sh           # Shell 公共函数（install.sh 等）
│   └── common.ps1          # PowerShell 公共函数
└── tests/                  # 测试套件
```

## 核心模块

### CLI 层

```
bin/loom.js → src/cli.js → src/commands/*.js
```

- `bin/loom.js`：Node.js 入口，加载 `src/cli.js`
- `src/cli.js`：使用 commander 注册命令
- `src/commands/`：每个命令一个文件，命令通过动态 `import()` 懒加载

**命令分组：**

| 分组       | 命令                                               |
| ---------- | -------------------------------------------------- |
| 项目初始化 | `init-project`                                     |
| 安装管理   | `install` / `update` / `uninstall`                 |
| 诊断       | `doctor` / `list`                                  |
| 执行引擎   | `run` / `select` / `status` / `evidence` / `dashboard` / `tasks` / `index` / `start` |
| 生态扩展   | `plugins list` / `plugins plan` / `plugins marketplace-template` / `plugins marketplace-sync` |
| 结构化记忆 | `memory add\|list\|export\|merge\|remove\|archive` |
| MCP        | `mcp-serve`                                        |

### 适配器层

```
src/core/installer.js → src/adapters/<tool>.js → src/adapters/base.js
```

- `BaseAdapter`：基类，提供 `_copySkills`、`_copyCommands`、`_copyDir` 等公共方法
- 每个工具一个适配器，实现 `toolName`、`getUserDir()`、`getSkillsDir()`、`getCommandsDir()`
- `installer.js`：通过 `ADAPTER_MAP` 注册适配器，提供 `getUserAdapter(tool)`、`USER_TOOL_IDS`
- `config/tools.schema.json`：通过 `contract` 描述 adapter 能力、安装范围、配置面、loom-managed 产物和版本探测方式，并生成 `ADAPTER_CONTRACTS`；`loom doctor` 会基于该契约输出配置面、managed artifacts、版本探测和 capability 一致性诊断，`loom doctor --json` 会把同一诊断结构输出为 `loom.doctor.v1` 供 CI、Web UI 和交互式 doctor 复用，`loom doctor --fix-plan` 会基于该报告写出非破坏性的 `loom.doctor-fix-plan.v1` 修复计划

### 核心层

```
src/core/installer.js          — 适配器注册与获取（ADAPTER_MAP、getUserAdapter）
src/core/pipeline-engine.js    — 流水线状态机：初始化、推进、审批、失败、恢复
src/core/pipeline-selector.js  — AI 自主流程选择：信号收集、规则短路、AI fallback、规则兜底
src/core/state-store.js        — pipeline.state.json + task-states/ 持久化，支持 dynamic_steps
src/core/artifact-checker.js   — 产物存在性 + 占位符扫描 + 阶段推断
src/core/lock.js               — PID 文件锁（.loom-run.lock）
src/core/memory-store.js       — 结构化记忆 JSON 存储
src/core/skill-loader.js       — SKILL.md 渐进式披露（L0/L1/L2）
src/core/context-index.js      — 上下文文件按 ## 切节（L0/L1）
src/core/compliance-tracker.js — Skill 质量度量（遵守率追踪）
src/core/evidence-store.js     — compliance history → loom.evidence.v1 规范化视图、artifact sha256、导出文件、报告渲染和趋势指标
src/core/failure-diagnostics.js — 失败诊断与恢复建议
src/core/task-lock.js          — 任务级并发锁
src/core/fs-interface.js       — 文件系统抽象层（NodeFileSystem + InMemoryFileSystem）
```

`loom dashboard` 复用 `EvidenceStore` 与 `MemoryStore`，把 `.loom/compliance/history.json` 和 `.loom/memory/store.json` 汇总为 `.loom/reports/team-dashboard.html`。它不启动 Web 服务，适合作为 PR、发布或团队例会前的静态 HTML 协作入口；`--spec-dir` 可把看板限制到单个需求范围。`--repos` 可传入逗号分隔的多个仓库根目录，命令会分别读取每个仓库的 `.loom/compliance/history.json` 和 `.loom/memory/store.json`，再聚合为同一份跨仓库看板。`--web` 会额外写出 `loom.dashboard.v1` JSON 数据文件，并在 HTML 中声明数据文件和刷新间隔，供静态托管页面轮询最新 dashboard 数据。

`loom plugins list` 读取 `.loom/plugins/*.json`，以只读方式发现第三方插件 manifest，并标准化输出 `steps`、`adapters`、`hooks` 和 `reporters` 扩展点。该命令不会动态加载第三方代码，当前定位是插件 API 的发现和校验边界；无效 manifest 会单独列入结果，避免破坏有效插件列表。

`loom plugins plan` 会把已发现的 manifest 汇总为 `.loom/plugins/plugin-plan.json`，使用 `loom.plugin-plan.v1` 描述有效插件、扩展点和无效 manifest。计划明确 `dynamicLoading:false` 与 `manual-review`，因此只是执行引擎接入前的审计工件，不会加载或执行第三方插件代码。

`loom plugins marketplace-template` 生成 `.loom/marketplace/mcp-marketplace.json` remote MCP marketplace 草稿，声明 server endpoint、能力范围、认证环境变量、信任边界和各客户端配置落点。该命令只写本地模板，不联网、不发布、不加载远程代码，默认不覆盖已有文件。

`loom plugins marketplace-sync` 读取 marketplace 草稿并写出 `.loom/marketplace/mcp-marketplace.sync.json` 的 `loom.mcp-marketplace-sync.v1` 本地同步计划，同时追加 `.loom/compliance/marketplace-sync.jsonl` 审计记录。它不联网、不发布、不修改客户端配置，只校验远程 URL 的 HTTPS 要求和 `trust.codeExecution:false` 安全边界，失败时生成 high risk 审计并让 CLI 返回失败退出码。

`loom doctor --fix-plan` 复用 `loom.doctor.v1` 诊断数据，写出 `.loom/doctor/fix-plan.json` 的 `loom.doctor-fix-plan.v1` 修复计划。计划会列出安装缺失工具、补齐 `.loom` project health、刷新 stale subagent context、检查 adapter contract 漂移和可选 codegraph 配置等建议动作，并明确 `autoApply:false`、`mutatesFiles:false`、`requiresReview:true`。该命令只写计划文件，不自动执行修复动作。

**安装流程** (`loom install --tool <target>`)：

1. 通过 `getUserAdapter(tool)` 获取适配器
2. 调用 `adapter.install(loomRoot, version)`
3. 复制 skills（含 `SKILL.md` 的子目录）到用户目录
4. 复制 commands（`.md` 文件）到用户目录
5. 注册插件（Claude Code / OpenCode）

**卸载流程** (`loom uninstall --tool <target>`)：

1. 通过 `getUserAdapter(tool)` 获取适配器
2. 调用 `adapter.uninstall(loomRoot)`
3. 删除 loom 安装的 skills 子目录
4. 删除 loom 安装的 commands 文件
5. 注销插件配置

## 数据流

### 安装数据流

```
CLI (loom install --tool <target>)
  → getUserAdapter(tool) → adapter
  → adapter.install(loomRoot, version)
    → _copySkills() → 复制 skills 到 getUserDir()/skills/
    → _copyCommands() → 复制 commands 到 getCommandsDir()
    → _postInstall() → 工具特定后处理
    → _registerPlugin() → 插件系统注册（Claude Code / OpenCode）
```

### 卸载数据流

```
CLI (loom uninstall --tool <target>)
  → getUserAdapter(tool) → adapter
  → adapter.uninstall(loomRoot)
    → _removeSkills() → 删除 loom 安装的 skills
    → _removeCommands() → 删除 loom 安装的 commands
    → _removeGlobalInstructions() → 清理工具特定配置（Copilot）
```

## Hook 系统

```
hooks/session-start (shell wrapper)
  → hooks/run-hook.js session-start
    → loadHooks() → hooks.json
    → findHook() → flattenHooks() → hook definition
    → supportsPlatform() → platform check
    → _require(handlerPath) → .cjs handler
    → withTimeout(handler, timeoutMs) → execute
    → fallback handling (skip/warn/error/retry)
```

`hooks/hooks.json` 当前采用按生命周期事件分组的注册表，例如 `SessionStart: [ ... ]`。`hooks/run-hook.js` 同时支持旧版平铺数组和新版事件对象：

- `runHook(hookId)` / `node hooks/run-hook.js <hook-id>`：按 hook id 执行单个 handler，兼容现有 shell wrapper。
- `runHookEvent(eventName)` / `node hooks/run-hook.js --event <event-name>`：执行某个生命周期事件下注册的所有 handler，并汇总状态。

handler 会收到 `{ event, payload, hook }`，无参数的旧 handler 仍可继续运行。

handler 可以返回治理裁决对象，例如 `{ status: 'ok' }`、`{ status: 'warned', message }` 或 `{ status: 'blocked', message }`。`blocked` / `failed` 裁决会被 runner 视为失败，配合 `blocking: true` 和 `fallback: "error"` 可用于阻断高风险操作。当前内置 `user-prompt-audit` handler 注册在 `UserPromptSubmit`，会记录用户请求、风险分类和 pipeline/debug/QA/approval 流程建议；`pre-tool-use-audit` handler 注册在 `PreToolUse`，会审计 shell 命令并阻断未确认的高风险删除、重置和磁盘操作；`post-tool-use-audit` handler 注册在 `PostToolUse`，会记录工具名、输入摘要、退出状态、产物路径、错误摘要和风险结果；`permission-audit` handler 注册在 `PermissionRequest` / `PermissionDenied`，会把权限请求与拒绝记录追加到 `.loom/compliance/history.json`；`subagent-audit` handler 注册在 `SubagentStart` / `SubagentStop`，会记录 subagent 会话、任务 ID、task-state 路径和 handoff 路径；`task-audit` handler 注册在 `TaskCreated` / `TaskCompleted`，会记录任务元数据、任务文件、task-state、handoff、产物和失败原因；`worktree-audit` handler 注册在 `WorktreeCreate` / `WorktreeRemove`，会记录隔离工作区路径、分支、base branch、commit、清理状态和残留风险；`compaction-audit` handler 注册在 `PreCompact` / `PostCompact`，会记录压缩前后上下文摘要，并在 payload 提供 `specDir` 时写入 `handoffs/compact-pre.json` 或 `handoffs/compact-post.json`；`file-changed-audit` handler 注册在 `FileChanged`，会记录变更路径、风险分类和 context/codegraph/generate/secret-scan 同步建议。

### 企业治理 Policy

`loom policy check` 读取 `.loom/policy.json`，用 `sensitivePaths` 和 `secretPatterns` 扫描 `--files` / `--file` 指定的变更文件，并把检查结果追加到 `.loom/compliance/policy-audit.jsonl`。该命令是 `audit:high` 的一部分，供本地发布前检查和 GitHub Actions 复用；后续 policy 可继续扩展到工具白名单、命令权限、网络访问和 managed settings。

### Fallback 策略

| 策略    | 行为                      | 退出码 |
| ------- | ------------------------- | ------ |
| `skip`  | 静默跳过                  | 0      |
| `warn`  | 输出警告，继续执行        | 0      |
| `error` | 输出错误，终止            | 1      |
| `retry` | 重试 N 次后仍失败则 error | 1      |

## Schema 驱动

loom 使用 JSON Schema 定义配置：

- `tools.schema.json` → `scripts/generate-tooling.mjs` → `src/generated/tooling.js`
- `hooks.schema.json` → 驱动 `hooks/run-hook.js`
- `pipeline.schema.json` → 驱动流水线状态机
- `review.schema.json` → 驱动审查框架
- `templates.schema.json` → 驱动模板渲染和验证
- `model-selection.schema.json` → 驱动模型选择策略
- `shared-rules.json` → 驱动共享规则生成

修改 schema 后需要重新生成（增量生成总入口）：

```bash
npm run generate          # 增量生成所有产物（generate-incremental.mjs）
npm run generate:force    # 强制全量重新生成
npm run generate:check    # 只检查是否过期（用于 CI）
npm run sync-version      # 同步版本号
```

## 测试架构

```
tests/
├── commands/       # CLI 命令测试
├── adapters/       # 适配器测试
├── hooks/          # Hook 系统测试
├── unit/           # 核心模块单元测试
├── integration/    # 集成测试
├── e2e/            # 端到端流水线测试
├── scripts/        # 生成脚本测试
└── skills/         # Skill 与脚本测试
```

测试框架：vitest。运行：

```bash
npm test            # 运行所有测试
npm run test:watch  # 监听模式
```

### 执行引擎

```
src/core/
├── pipeline-engine.js    — 状态机控制器（检查产物→推进阶段→校验→阻断）
├── pipeline-selector.js  — AI 自主流程选择（信号收集→短路/AI/兜底→校验修正）
├── state-store.js        — 每 spec 独立的 pipeline.state.json + task-states/*.state.json
├── lock.js               — PID 文件锁（.loom-run.lock）防重复启动
├── artifact-checker.js   — 产物存在性 + 内容校验 + 阶段推断
├── fs-interface.js       — 文件系统抽象层（NodeFileSystem + InMemoryFileSystem）
├── skill-loader.js       — SKILL.md 渐进式披露（L0 摘要 / L1 完整 / L2 单节）
├── memory-store.js       — 结构化记忆 JSON 存储
├── context-index.js      — 上下文文件按 ## 切节（L0 目录 / L1 单节）
├── compliance-tracker.js — Skill 质量度量（遵守率追踪）
├── failure-diagnostics.js — 失败诊断与恢复建议
└── task-lock.js          — 任务级并发锁

src/commands/
├── run.js                — loom run (init / advance / approve / fail / recover / task-state)
├── select.js             — loom select (AI 自主流程选择，可选输出 pipeline-plan.md)
├── status.js             — loom status (单 spec 详情 / 全景视图)
├── tasks.js              — loom tasks (任务文件归属分析 → 安全并行批次)
├── index.js              — loom index (codegraph 委派；无 codegraph 时跳过，--check 查状态)
└── start.js              — loom start (输出可粘贴进任意 AI 会话的项目状态)
```

### codegraph 集成

`loom index` 是 codegraph 索引同步入口：

```
loom index
  → codegraphAvailable(root)?  (.codegraph/ 存在 或 `codegraph --version` 成功)
    ├─ 是 → 委派 `codegraph sync`（--check → `codegraph status`）
    └─ 否 → 跳过索引更新，不生成静态 Markdown 索引
```

- **codegraph**（https://github.com/colbymchenry/codegraph）是**外部独立工具**，非 npm 依赖：tree-sitter AST → SQLite 图，零配置，索引存项目内 `.codegraph/`。
- **建图**：`loom init-project` 只写入图后端配置，不自动执行 `codegraph init`；需要索引时由用户按需手动运行。
- **MCP**：安装时各 adapter 的 `_ensureMcpConfig` 在 codegraph CLI 可用时注册 `codegraph serve --mcp`，AI 会话可实时调 `codegraph_*` 工具查图。
- **无后端**：codegraph 缺失时跳过图查询能力，影响范围分析改用源码搜索和人工判断。
- **诊断**：`loom doctor` 的 index 检查识别 `.codegraph/`，存在则报告 codegraph 后端，否则报告索引更新已跳过。

**状态隔离设计：**

```
specs/2026-05-27+user-auth/
  pipeline.state.json     ← 只由管理该 spec 的 loom run 进程写
  .loom-run.lock          ← PID 文件锁
  task-states/
    T1.state.json         ← 只由 T1 的 subagent 写
    T2.state.json
  handoffs/
    planning.json         ← 阶段交接摘要
    T1.json
    T2.json
  progress.md             ← 由 state-store 增量更新（只读视图，阶段变化追加变更日志）
```

每一层的写入者唯一，不需要锁、不需要事务。

handoff 是跨阶段、跨 task 的上下文压缩入口：阶段结束时写 `handoffs/<stage>.json`，task 完成时写 `handoffs/<task-id>.json`。CLI 使用 `loom handoff write --spec-dir <dir> --stage <stage> ...` 或 `--task <id>`；MCP 使用 `loom_write_handoff` 或 `loom_stage_checkpoint`。写入后 `state-store` 会自动刷新 `progress.md` 的 Handoffs 摘要，`loom status --spec-dir <dir>` 会展示 `status`、`summary` 和 artifacts；`status` 只允许 `done`、`partial`、`blocked`、`failed`。阶段 handoff 写入后，宿主 AI 先调用自身的上下文压缩能力，再用 `loom_advance_pipeline compression_confirmed=true` 或 `loom run --advance --compression-confirmed` 推进。

### 结构化记忆

```
src/core/memory-store.js  — JSON 文件存储（.loom/memory/store.json）
src/commands/memory.js    — loom memory add/list/export/merge/remove/archive
```

Memory 条目除 `type`、`content`、`author`、`tags` 和 `context` 外，还可记录 `source`、`confidence`、`scope`、`expires_at`、`stage`、`files` 和 `links`。`links` 用于关联 spec、PR、commit、task 和 handoff，`loom memory list` 与 MCP `loom_get_memory` 可按这些字段检索；过期条目默认隐藏，必要时用 `--include-expired` 显示。`MEMORY.md` 变为只读导出视图，由 `loom memory export` 生成。

### MCP Server

```
src/mcp/
├── server.js             — stdio transport JSON-RPC 服务（tools/list 剥掉内部 group 字段）
├── tools.js              — MCP 工具定义 + 执行 + CAPABILITY_GROUPS 分组目录
└── session-store.js      — 连接级 spec 绑定（loom_attach_spec）
```

配置方式：

```json
{ "mcpServers": { "loom": { "command": "loom", "args": ["mcp-serve"] } } }
```

Codex 使用 TOML 配置：

```toml
[mcp_servers.loom]
command = "loom"
args = ["mcp-serve"]
```

工具按 `group` 分组（pipeline / context / memory / session / meta）：

| group    | 工具                                                                                                                               | 用途                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| meta     | `loom_list_capabilities` / `loom_load_tool_group`                                                                                  | 分组能力目录 + 按需加载工具组             |
| context  | `loom_get_context` / `loom_get_skill_context`                                                                                      | 上下文文件 + Skill 渐进式披露（L0/L1/L2） |
| pipeline | `loom_get_project_status` / `loom_get_pipeline_context` / `loom_advance_pipeline` / `loom_approve_gate` / `loom_update_task_state` / `loom_select_pipeline` / `loom_adjust_pipeline` / `loom_write_handoff` / `loom_stage_checkpoint` | 流水线状态机 + AI 流程选择 + 运行时调整 + handoff 写入 |
| memory   | `loom_get_memory` / `loom_add_memory`                                                                                              | 结构化记忆读写                            |
| session  | `loom_attach_spec`                                                                                                                 | 连接级 spec 绑定                          |

### 上下文渐进式披露（Context 工程）

`src/core/context-index.js` 把 markdown 上下文文件按 `##` 切节，避免整文件进上下文：

```
loom_get_context(doc)            → L0 目录：节标题 + token 估算（不含正文）
loom_get_context(doc, section)   → L1 详情：按标题模糊匹配返回单节全文
```

- `doc` 键：`constitution` / `memory` （→ `.loom/` 下路径）。
- 每节软上限 `SECTION_TOKEN_BUDGET=1500`，超出在 outline 标 `oversized`。
- `loom start` 输出宪章**目录**（节标题）而非整篇，引导 AI 用 `loom_get_context` 按需取。
- `loom_list_capabilities` 配合分组，让模型只加载相关工具组（"先给目录，按需翻"）。

### Skill 渐进式披露

`src/core/skill-loader.js` 对 SKILL.md 实现三层加载，避免 18 个 skill 全量注入：

```
loom_get_skill_context()                → L0：所有 skill 的 name + description + section 标题 + 触发条件
loom_get_skill_context(skill)           → L1：单个 skill 的 SKILL.md 完整内容
loom_get_skill_context(skill, section)  → L2：单个 skill 的某个 ## 节
```

- `loom start` 输出 Skill L0 摘要，引导 AI 按需加载。
- Cursor 适配器默认使用紧凑模式（`compact`），MDC 文件只含 L0 摘要 + MCP 引用，环境变量 `LOOM_CURSOR_FULL_SKILL=1` 可切回全量。

### Skill 质量度量

```
src/core/compliance-tracker.js  — 读 verify-report + stage_history，写 .loom/compliance/history.json
```

`loom doctor` 展示高风险 skill 列表（遵守率 < 80%）。
