# Loom 项目架构文档与阅读指南

> 本文档整合 `docs/architecture.md` 与 `docs/system-design.md`，并补充一份分层阅读路线，供新接触本仓库的人快速上手。
> 版本基准：`package.json@2.4.0`（运行时 `Node.js >= 22`，ESM）。

---

## 0. 一句话理解

**Loom 是一个「AI 工程化框架」**——通过 `skills + commands + hooks + MCP server` 的集合，把"需求 → 计划 → 隔离开发 → 审查 → 验证 → 索引同步"这套工程流程以**流水线状态机**的形式注入到各类 AI 编码工具（Claude Code / Cursor / Copilot / Codex / OpenCode），让 AI 像在流水线上作业一样可控、可审计、可恢复。

核心抽象只有三个：

1. **流水线状态机**（`pipeline-engine`）——驱动开发的阶段流转与门禁；
2. **适配器**（`adapters/*`）——把同一套 skills 翻译到不同 AI 工具的目录约定；
3. **渐进式披露**（`skill-loader` / `context-index`）——解决 AI 上下文窗口有限的问题。

---

## 1. 顶层目录结构

```
loom/
├── bin/loom.js              CLI 入口（shebang，转发到 src/cli.js）
├── src/
│   ├── cli.js               commander 命令注册（动态 import 懒加载子命令）
│   ├── commands/            21 个 CLI 子命令实现（一文件一命令）
│   ├── core/                16 个核心模块（状态机、存储、锁、加载器…）
│   ├── adapters/            8 个工具适配器（base + 5 个后端 + cursor-converter + config-utils）
│   ├── mcp/                 MCP server（server/tools/session-store/telemetry）
│   └── generated/tooling.js 从 tools.schema.json 自动生成
├── config/                  7 个 JSON Schema / 规则定义（驱动机器与生成）
├── skills/                  18 个 Skill 目录（每个含 SKILL.md + 可选 references/assets/scripts）
├── commands/                （发布时用于落地的命令目录，当前仅 .gitkeep）
├── hooks/                   Hook 系统：hooks.json + run-hook.js + handlers/
├── templates/               项目初始化模板（constitution/memory/agents/product/subagent-context）
├── scripts/                 构建/生成脚本与公共 shell/ps1
├── tests/                   测试套件（unit/integration/e2e/adapters/commands/hooks/scripts/skills）
├── docs/                     已有 10 篇文档（架构、系统设计、安装、技能参考…）
├── .claude-plugin/, .claude/, .codegraph/  各工具的本地元数据/索引
├── plugin.mjs                插件入口（被 Claude Code / OpenCode 加载）
├── install.sh / install.ps1 / uninstall.*  一键安装/卸载脚本
├── LOOM.md                  项目内 loom 上下文入口（AI 会话先读此文件）
├── README.md                对外说明
└── opencode.json            OpenCode 配置（watcher 忽略等）
```

> 注意：仓库本身**就是 loom 框架的源码**，安装后会在用户目录复制 `skills/` 与 `commands/`；项目内 `.loom/` 则是用户项目使用 loom 时生成的运行时数据（本仓库自身不把 `.loom/` 纳入版本）。

---

## 2. 技术栈与依赖约束

| 维度 | 选型 | 备注 |
|------|------|------|
| 运行时 | Node.js >= 22，ESM（`"type": "module"`） | 旧文档写 >=18，实际已升到 22 |
| CLI | `commander ^14` | 子命令动态 `import()` 懒加载 |
| YAML | `js-yaml ^4.2` | 解析 `.loom/workflow.yaml` |
| MCP | 手写 JSON-RPC 2.0 over stdio | **无 MCP SDK 依赖** |
| 测试 | `vitest @4.1` + `@vitest/coverage-v8` | `npm test` / `npm run test:coverage` |
| 持久化 | JSON 文件 + 原子写入（tmp+rename） | 无数据库 |
| 可选外部工具 | `codegraph`（AST 图索引）、`git` | 缺失时优雅降级 |

**关键设计约束**：无数据库、无 MCP SDK、记忆上限 50 条、合规历史上限 500 条、单节 token 预算 1500、PID+token 文件锁防并发、MCP 会话随进程退出失效。

---

## 3. 分层架构

```
┌──────────────────── AI 工具层 ───────────────────────┐
│  Claude Code / Cursor / Copilot / Codex / OpenCode   │
└───────┬───────────────────────────────────┬──────────┘
        │ MCP (JSON-RPC/stdio)              │ CLI
┌───────▼───────────┐            ┌──────────▼──────────┐
│   MCP Server 层    │            │      CLI 层          │
│  server/tools/     │            │  cli.js(commander)  │
│  session-store/    │            │  commands/*.js(15)   │
│  telemetry         │            │                     │
└───────┬───────────┘            └──────────┬──────────┘
        │                                    │
┌───────▼────────────────────────────────────▼─────────┐
│                   核心引擎层（src/core）              │
│  pipeline-engine  pipeline-selector  state-store    │
│  artifact-checker  memory-store  skill-loader        │
│  context-index  compliance-tracker  lock/task-lock    │
│  installer  failure-diagnostics  fs-interface  markdown
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                   适配器层（src/adapters）           │
│  base  claude-code  codex  copilot  cursor           │
│  opencode  cursor-converter  config-utils            │
└─────────────────────────────────────────────────────┘
```

### 模块依赖层级（被依赖热度）

```
L0 叶子:   fs-interface.js
L1:        artifact-checker, compliance-tracker, context-index,
           lock, memory-store, state-store, task-lock, failure-diagnostics, markdown
L2:        skill-loader(→context-index)  pipeline-selector(→fs-interface)
L3 顶层:   pipeline-engine(→state-store, lock, artifact-checker, compliance-tracker)
```

---

## 4. 数据流与存储

### 4.1 运行时数据布局（项目使用 loom 后生成）

```
.loom/
├── memory/store.json          单一真实来源（MEMORY.md 是其只读导出视图）
├── memory/sessions/           会话归档
├── compliance/history.json    合规率历史（≤500），也是 evidence 规范化输入
└── rules/constitution.md      项目宪章（架构/目录约束）

specs/<date+feature>/
├── pipeline.state.json        流水线状态（含 dynamic_steps）
├── progress.md                自动生成的只读进度视图
├── spec.md / plan.md          需求规格 / 实现计划
├── tasks/T1.md, T2.md         任务文件
├── task-states/T1.state.json  任务状态
├── handoffs/<stage|task>.json 阶段/任务交接摘要
├── test-report.md / verify-report.md   gate_verdict 报告
└── .loom-run.lock             PID 文件锁
```

**状态隔离设计**：每一层的写入者唯一（`pipeline.state.json` 由管理该 spec 的 `loom run` 进程独占写；`T*.state.json` 由对应 subagent 独占写），因此**不需要事务**。

### 4.2 核心实体

| 实体 | 关键字段 | 约束 |
|------|----------|------|
| PipelineState | spec_dir, pipeline_type, dynamic_steps, current_stage, stage_history | type ∈ feature/bugfix/hotfix/refactor/chore/quickfix/qa/pm-prototype |
| TaskState | task_id, status, retry_count, agent_session_id, blocker | status ∈ pending/executing/reviewing/done/failed/blocked |
| MemoryEntry | id(8位), type, content, author, tags, created_at | ≤50 条；type ∈ user/feedback/project/reference |
| Handoff | stage 或 task_id, status, summary, artifacts, data | status ∈ done/partial/blocked/failed |

---

## 5. 流水线：状态机与门禁

### 5.1 状态机

```
brainstorming → planning → approved(gate) → git-worktree → executing
   → verification → code-review-request → review-gate(gate) → code-review-response → synced
   ↑                  └─ blocker_found → executing (增量修复)
   └─ 任何阶段 error → failed → (user_retries) → 回到合适阶段
```

### 5.2 流水线类型（`loom run --type <type>`）

| 类型 | 步骤序列 | 适用 |
|------|----------|------|
| feature | brainstorming→planning→approved→git-worktree→executing→verification→code-review→synced | 新功能 |
| bugfix | planning→approved→executing→verification→code-review→synced | 已定位 bug |
| hotfix | approved→executing→verification（max_retries=1） | 生产紧急 |
| refactor | brainstorming→planning→approved→executing→verification→code-review→synced | 重构（不开新分支） |
| quickfix | executing→verification | 单文件小改 |
| chore | executing→verification | 依赖/配置/文档 |
| qa | qa-analysis→qa-design→qa-approved→qa-execution→qa-signoff→qa-report | QA 验收（两次人工 gate） |

`code-review` 段含三步：code-review-request（双轴预审查+发请求）→ review-gate（人工 gate）→ code-review-response（处理反馈）。低风险流水线（hotfix/quickfix/chore）跳过。

### 5.3 智能选择模式（`loom run --auto --request "<text>"` 或 MCP `loom_select_pipeline`）

`pipeline-selector.js` 三段决策：
1. **规则短路**（0 token）：关键词命中 → 固定步骤；
2. **AI fallback**：信号模糊时由 AI 从 `step_catalog` 选步骤；
3. **规则兜底**：无 AI / AI 失败 → 按风险等级生成基础流程。

护栏：`must_include` / `dependency_closure` / `never_skip_gates` / `max_steps`。**首次只返回结果不写状态**；AI 必须向用户打印"选择来源 / 风险等级 / 步骤顺序 / 理由"并等待明确确认，之后才能通过 `loom run --auto` 或 MCP `loom_select_pipeline initialize=true` 写入 `pipeline.state.json`。需要人工审查时用 `loom select` 生成 `pipeline-plan.md` 再 `--approve-pipeline`。

### 5.4 门禁执行顺序（`engine.advance()`）

```
1. failed?                  → 拒绝推进
2. human-approval gate?     → 要求 --approve
3. outputs 完整性?          → 文件存在 + 无占位符
4. gate_verdict 报告裁定?   → verdict === PASS
5. 存在 next step?          → 否则流水线已结束
6. handoff 阶段已压缩?      → 否则要求先 compress，再确认推进
7. 下一阶段 requires 前置?  → 文件/目录存在
8. 全部通过 → store.transition(next)
```

**门禁类型**：human-approval（`--approve`）、gate_verdict（报告 verdict===PASS）、产物完整性（outputs + 占位符扫描）、上下文压缩确认（`compression_confirmed=true`）、前置条件（requires）。

**占位符检测**：`TBD/TODO/FIXME/XXX`（大小写敏感）、`implement later/fill in details/placeholder text`（不敏感）、`{{VAR}}` 未渲染变量。

---

## 6. CLI 命令与 MCP 工具

### 6.1 CLI（`bin/loom.js → src/cli.js → src/commands/*.js`）

| 分组 | 命令 |
|------|------|
| 项目初始化 | `init-project` |
| 安装管理 | `install` / `update` / `uninstall` |
| 诊断 | `doctor` / `list` / `start` |
| 执行引擎 | `run` / `select` / `status` / `evidence` / `dashboard` / `tasks` / `index` / `handoff write` |
| 结构化记忆 | `memory add\|list\|export\|merge\|remove\|archive` |
| 生态扩展 | `plugins list` / `plugins plan` / `plugins marketplace-template` / `plugins marketplace-sync` |
| MCP | `mcp-serve` |

`loom evidence` 会把 `.loom/compliance/history.json` 规范化为 `loom.evidence.v1`，支持文本、JSON、JSONL、风险/类型/verdict/spec 过滤、`--hash-artifacts` 产物哈希、`--out` 独立导出文件、`--format markdown|html` 生成 PR/HTML 报告输入，以及 `--trends` 输出失败率、风险分布、平均耗时和失败原因 Top N。`loom dashboard` 会进一步把 evidence 趋势和结构化 memory 汇总成 `.loom/reports/team-dashboard.html`，支持 `--spec-dir` 输出单需求范围的团队看板，也支持 `--repos ../a,../b` 聚合多个仓库的 evidence 与 memory；`--web` 会额外生成 `loom.dashboard.v1` JSON 数据文件，供静态托管页面按 `--refresh` 间隔轮询。

`loom plugins list` 会扫描 `.loom/plugins/*.json`，列出第三方插件 manifest 中声明的 `steps`、`adapters`、`hooks` 和 `reporters` 扩展点。该命令当前只做发现和校验，不加载第三方代码。`loom plugins plan` 会生成 `.loom/plugins/plugin-plan.json`，用 `loom.plugin-plan.v1` 汇总有效插件、扩展点和无效 manifest，并明确 `dynamicLoading:false` 与 `manual-review`，作为执行引擎接入前的审计工件。`loom plugins marketplace-template` 会生成 `.loom/marketplace/mcp-marketplace.json` remote MCP marketplace 草稿，声明 endpoint、能力范围、认证环境变量、信任边界和各客户端配置落点，默认不覆盖已有模板。`loom plugins marketplace-sync` 会生成 `.loom/marketplace/mcp-marketplace.sync.json` 本地同步计划，并追加 `.loom/compliance/marketplace-sync.jsonl` 审计记录；该命令不联网、不发布、不写客户端配置，只校验 HTTPS endpoint 和 `trust.codeExecution:false`。

### 6.2 MCP 工具（`src/mcp/tools.js`，按 group 懒加载）

| group | 工具 |
|-------|------|
| meta | `loom_list_capabilities` / `loom_load_tool_group` |
| context | `loom_get_context` / `loom_get_skill_context` |
| pipeline | `loom_get_project_status` / `loom_get_pipeline_context` / `loom_advance_pipeline` / `loom_approve_gate` / `loom_update_task_state` / `loom_select_pipeline` / `loom_adjust_pipeline` / `loom_write_handoff` / `loom_stage_checkpoint` |
| memory | `loom_get_memory` / `loom_add_memory` |
| session | `loom_attach_spec` |

环境开关：`LOOM_LAZY_TOOLS=1`（按需加载工具组）、`LOOM_TELEMETRY=1`（调用统计，`loom_telemetry` 查询）。

---

## 7. Skills 体系（18 个）

```
6 流水线 + 4 辅助 + 7 通用 + 1 QA = 18 个 skill
```

| 类别 | Skill |
|------|-------|
| 流水线 | brainstorming · writing-plans · using-git-worktrees · subagent-driven-development · verification-before-completion · index-update |
| 辅助 | init-project · router · pipeline-selector · using-loom |
| 通用 | test-driven-development · systematic-debugging · requesting-code-review · receiving-code-review · dispatching-parallel-agents · writing-skills · finishing-a-development-branch |
| 测试 | qa |

**SKILL.md 结构**：YAML frontmatter（`name` / `description: Use when: …`）+ 正文按 `## 触发条件` / `## 执行流程` / `## …` 组织，支持 `references/` 与 `assets/` 子目录。Cursor 适配器默认转紧凑模式（仅 L0 摘要 + MCP 引用），`LOOM_CURSOR_FULL_SKILL=1` 切全量。

---

## 8. Schema 驱动与代码生成

`config/*.schema.json` 与 `shared-rules.json` 是"单一真实来源"，由 `scripts/generate-*.mjs` 增量生成出代码/文档片段：

| Schema | 生成入口 | 产物 |
|--------|----------|------|
| tools.schema.json | `generate-tooling.mjs` | `src/generated/tooling.js`（工具元数据、`ADAPTER_MAP`、`ADAPTER_CONTRACTS`） |
| — | `generate-skills-catalog.mjs` | README/LOOM.md 中的 skills 目录块 |
| — | `generate-review-summary.mjs` | README 中的 6 维审查表 |
| model-selection.schema.json | `generate-model-selection.mjs` | 模型选择注入 skill |
| shared-rules.json | `generate-shared-rules.mjs` | 共享规则注入 |
| — | `generate-progress-rules.mjs` | progress 规则 |
| — | `sync-version.mjs` | 同步版本号到所有元数据 |
| — | `generate-plugin-meta.mjs` | 插件元数据 |

```
npm run generate         # 增量（pretest 钩子会自动跑）
npm run generate:force   # 强制全量
npm run generate:check   # CI 检查是否过期
```

带 `<!-- loom:generate:* -->…<!-- /loom:generate:* -->` 的标记块由生成器维护，**不要手改**。

---

## 9. Hook 系统与适配器

**Hook 系统**（`hooks/`）：`hooks.json` 生命周期事件注册表 → `run-hook.js` runner → `handlers/*.cjs` 处理器。Runner 同时支持按 hook id 执行单个 handler，以及按事件名执行该事件下的多个 handler。handler 可返回 `ok` / `warned` / `skipped` / `blocked` / `failed` 裁决；`blocked` 会按失败处理。当前 `UserPromptSubmit` 已注册 `user-prompt-audit`，用于记录用户请求、风险分类和 pipeline/debug/QA/approval 流程建议；`PreToolUse` 已注册 `pre-tool-use-audit`，用于审计并阻断未确认的高风险 shell 命令；`PostToolUse` 已注册 `post-tool-use-audit`，用于记录工具名、输入摘要、退出状态、产物路径、错误摘要和风险结果；`PermissionRequest` / `PermissionDenied` 已注册 `permission-audit`，用于把权限请求与拒绝写入 `.loom/compliance/history.json`；`SubagentStart` / `SubagentStop` 已注册 `subagent-audit`，用于记录 subagent 会话、任务状态和 handoff 关联；`TaskCreated` / `TaskCompleted` 已注册 `task-audit`，用于记录任务元数据、任务文件、task-state、handoff、产物和失败原因；`WorktreeCreate` / `WorktreeRemove` 已注册 `worktree-audit`，用于记录隔离工作区路径、分支、base branch、清理状态和残留风险；`PreCompact` / `PostCompact` 已注册 `compaction-audit`，用于记录压缩前后上下文摘要，并在 spec 场景写入 compact handoff；`FileChanged` 已注册 `file-changed-audit`，用于记录变更路径、风险分类和 context/codegraph/generate/secret-scan 同步建议。Fallback：`skip`(0) / `warn`(0) / `error`(1) / `retry`(N)。

**适配器**（`src/adapters/`）：`BaseAdapter` 提供 `_copySkills/_copyCommands/_copyDir/_postInstall/_registerPlugin/_ensureMcpConfig` 等公共方法；各后端实现 `toolName/getUserDir/getSkillsDir/getCommandsDir`，并集成 session-start hook（Claude Code）或原生 event hook（OpenCode）共用 `hooks/handlers/health-check.cjs`。`config/tools.schema.json` 中的 `contract` 字段是适配器契约单一源，描述每个工具的能力、安装范围、配置面、loom-managed 产物和版本探测方式，生成到 `ADAPTER_CONTRACTS` 并由 adapter registry 测试校验与运行时 `capabilities` 一致；`loom doctor` 会基于该契约输出配置面、managed artifacts、版本探测和 capability 一致性诊断，`loom doctor --json` 会输出 `loom.doctor.v1` 机器可读报告，覆盖工具安装、项目 health、codegraph 状态和 skill compliance；`loom doctor --fix-plan` 会写出 `loom.doctor-fix-plan.v1` 非破坏性修复计划，只列建议动作，不自动修改项目文件。

| 适配器 | 入口 | 配置位置 |
|--------|------|----------|
| claude-code | `CLAUDE.md` | `~/.claude/settings.json`（MCP + hooks + plugin） |
| cursor | `.cursor/rules/*.mdc` | `~/.cursor/mcp/mcp.json` |
| copilot | `.github/copilot-instructions.md` | Markdown 注入（无 hooks/MCP） |
| codex | `AGENTS.md` | `~/.codex/config.toml`（MCP + Markdown） |
| opencode | `AGENTS.md` | `~/.config/opencode/opencode.json`（MCP + plugin + event hooks） |

---

## 10. 渐进式披露（Context 工程）

| 调用 | 行为 |
|------|------|
| `loom_get_context(doc)` | L0：节标题 + token 估算（不含正文） |
| `loom_get_context(doc, section)` | L1：模糊匹配返回单节全文（软上限 1500 token，超出标 `oversized`） |
| `loom_get_skill_context()` | L0：所有 skill 的 name+description+section 标题+触发条件 |
| `loom_get_skill_context(skill)` | L1：单个 SKILL.md 全文 |
| `loom_get_skill_context(skill, section)` | L2：单节 |
| `loom_list_capabilities` | 返回分组目录，引导按需 `loom_load_tool_group` |

`loom start` 只输出宪章**目录**与 skill **L0 摘要**，引导 AI 用 `loom_get_context` / `loom_get_skill_context` 按需取——这是 loom 在限量上下文下保持高信号的核心策略。

---

## 11. codegraph 集成（可选）

`loom init-project` 只写入图后端配置，不自动执行 `codegraph init`。需要索引时由用户按需运行 `loom index` 或手动创建 `.codegraph/`；AI 可调 `codegraph_*` 实时查图做影响范围分析，缺失时改用源码搜索补充判断。`loom doctor` 的 index 检查会报告后端状态。

---

## 12. 测试与脚本

- **测试**：`tests/{unit,integration,e2e,adapters,commands,hooks,scripts,skills,utils}` + `templates.test.js`。`npm test`（pretest 会先跑增量生成）、`npm run test:watch`、`npm run test:coverage`、`npm audit --audit-level=high`。
- **发布**：`prepack` / `prepublishOnly` 链路：`generate:force → generate-plugin-meta → sync-version → npm test`。

---

## 13. 阅读指南（推荐顺序）

### 第 0 步：建立全局印象（10 分钟）
1. `README.md` ——定位、支持矩阵、安装、流水线概览；
2. `LOOM.md`——AI 会话入口的精简版；
3. `docs/architecture.md` 顶部"目录结构"与"核心模块"两段。

### 第 1 步：理解流水线主线（30 分钟，最核心）
1. `config/pipeline.schema.json`——状态机、流转、门禁的形式定义；
2. `src/core/pipeline-engine.js`——状态机控制器的实现；
3. `src/commands/run.js`——CLI 如何暴露 init/advance/approve/fail/recover；
4. `src/core/state-store.js` + `artifact-checker.js`——状态持久化与门禁校验；
5. `src/core/pipeline-selector.js`——智能选择三段决策；
6. 回看 `docs/system-design.md` §5（流程图）对照。

### 第 2 步：理解渐进式披露（20 分钟）
1. `src/core/skill-loader.js`——SKILL.md 三层（L0/L1/L2）；
2. `src/core/context-index.js`——上下文文件按 `##` 切节；
3. `src/mcp/tools.js` 中 `loom_get_skill_context` / `loom_get_context` 分发；
4. `src/commands/start.js`——`loom start` 如何只输出目录与 L0。

### 第 3 步：理解 MCP 协议层（20 分钟）
1. `src/mcp/server.js`——JSON-RPC 2.0 over stdio、握手、tools/list（剥掉内部 group）；
2. `src/mcp/tools.js`——16 个工具定义 + `CAPABILITY_GROUPS` 分组 + `executeToolCall`；
3. `src/mcp/session-store.js`——`loom_attach_spec` 连接级 spec 绑定；
4. `src/mcp/telemetry.js`——`LOOM_TELEMETRY=1` 统计。

### 第 4 步：理解适配器与安装（20 分钟）
1. `src/core/installer.js`——`ADAPTER_MAP` / `getUserAdapter` / `USER_TOOL_IDS`；
2. `src/adapters/base.js`——公共复制/注册逻辑；
3. `src/adapters/claude-code.js`（最完整：MCP+hooks+plugin）与 `opencode.js`；
4. `src/commands/install.js` / `uninstall.js` / `update.js`；
5. `install.sh` / `install.ps1`——远程一键安装路径。

### 第 5 步：理解 Skills 与 Hooks（按需）
1. `skills/loom-using-loom/SKILL.md`——框架自用指南，是 skill 体例的最佳示例；
2. 任选一个流水线 skill（如 `skills/loom-subagent-driven-development/SKILL.md`）看 frontmatter + 执行流程 + references/assets；
3. `hooks/hooks.json` + `hooks/run-hook.js` + `hooks/handlers/health-check.cjs`——hook 运行链路；
4. `skills/loom-writing-skills/SKILL.md` + `scripts/generate-skills-catalog.mjs`——如何写新 skill 并接入目录生成。

### 第 6 步：理解生成机制（维护者必读）
1. `scripts/generate-incremental.mjs`——增量生成总入口，理解 `<!-- loom:generate:* -->` 标记块的依赖图与缓存（`.generate-cache.json`）；
2. `package.json` 的 `scripts.generate*` 与 `prepack`/`prepublishOnly` 链；
3. 修改 `config/*.schema.json` 后必须 `npm run generate`（或 `:force`）。

### 第 7 步：验证理解（动手）
1. `npm install && npm test`（pretest 会触发增量生成，若提示过期说明生成链有问题）；
2. `node bin/loom.js doctor` 在本仓库运行看自检输出；
3. `node bin/loom.js list` 查看 skills/commands 清单；
4. 阅读一个 `tests/integration/` 用例了解端到端预期。

---

## 14. 常用速查

```bash
npm test                 # 跑全部测试（先增量生成）
npm run generate:check   # CI：检查生成产物是否过期
node bin/loom.js doctor  # 诊断安装与项目健康
node bin/loom.js list    # 列出 skills / commands
node bin/loom.js start   # 输出可粘贴的项目状态
# MCP 调试：
LOOM_TELEMETRY=1 LOOM_LAZY_TOOLS=1 node bin/loom.js mcp-serve
```

**修改时的红线**：
- 不要手改带 `<!-- loom:generate -->` 标记的块，改源头后 `npm run generate`；
- 不要手改 `src/generated/tooling.js`，改 `config/tools.schema.json` 后生成；
- 不要手改 `progress.md`，它由 `state-store` 增量重建；
- `MEMORY.md` 是只读导出，改记忆请用 `loom memory add` 写入 `store.json`；需要关联 spec、PR、commit、task、handoff、阶段或文件范围时，用 `--spec-dir`、`--pr`、`--commit`、`--task`、`--handoff`、`--stage`、`--files` 等结构化字段。
