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
| 执行引擎   | `run` / `select` / `status` / `tasks` / `index` / `start` |
| 结构化记忆 | `memory add\|list\|export\|merge\|remove\|archive` |
| MCP        | `mcp-serve`                                        |

### 适配器层

```
src/core/installer.js → src/adapters/<tool>.js → src/adapters/base.js
```

- `BaseAdapter`：基类，提供 `_copySkills`、`_copyCommands`、`_copyDir` 等公共方法
- 每个工具一个适配器，实现 `toolName`、`getUserDir()`、`getSkillsDir()`、`getCommandsDir()`
- `installer.js`：通过 `ADAPTER_MAP` 注册适配器，提供 `getUserAdapter(tool)`、`USER_TOOL_IDS`

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
src/core/failure-diagnostics.js — 失败诊断与恢复建议
src/core/task-lock.js          — 任务级并发锁
src/core/fs-interface.js       — 文件系统抽象层（NodeFileSystem + InMemoryFileSystem）
```

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
    → findHook() → hook definition
    → supportsPlatform() → platform check
    → _require(handlerPath) → .cjs handler
    → withTimeout(handler, timeoutMs) → execute
    → fallback handling (skip/warn/error/retry)
```

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
└── hooks/          # Hook 系统测试
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
- **建图**：`loom init-project` 检测到 codegraph CLI 时自动跑 `codegraph init`（`--no-codegraph` 跳过）。
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

MEMORY.md 变为只读导出视图，由 `loom memory export` 生成。

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
