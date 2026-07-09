# loom — Weave Specs into Execution

AI 工程化框架。把需求、规范、上下文、执行过程"织"成一套稳定工程流程。

## loom 是什么

- 一套 **skills + commands + hooks** 的集合，注入到 AI 编程工具中
- 一条 **按任务类型自适应的开发流水线**：根据 `feature / bugfix / hotfix / refactor / quickfix / chore / qa / pm-prototype` 自动选择对应步骤
- 一个 **CLI 工具**（`loom`），负责安装、更新、诊断、卸载，以及流水线执行（`run`/`status`/`tasks`/`index`）、证据导出（`evidence`）、结构化记忆（`memory`）和 MCP server（`mcp-serve`）
- 一个 **项目初始化器**（`/loom-init-project` 或 `loom init-project`），自动扫描项目生成宪章、结构化记忆和 agent 入口

从需求描述出发，经过头脑风暴、计划拆解、隔离开发、代码审查，最终交付。

## 支持工具矩阵

| 工具           | 支持等级 | 入口文件                          | Skills | Hooks | Plugin | MCP 配置 |
| -------------- | -------- | --------------------------------- | ------ | ----- | ------ | -------- |
| Claude Code    | full     | `CLAUDE.md`                       | ✅     | ✅    | ✅     | ✅       |
| Codex          | full     | `AGENTS.md`                       | ✅     | ✗     | ✗      | ✅       |
| Cursor         | full     | `.cursor/rules/*.mdc`             | ✅     | ✗     | ✗      | ✅       |
| GitHub Copilot | full     | `.github/copilot-instructions.md` | ✅     | ✗     | ✗      | ✗        |
| OpenCode       | full     | `AGENTS.md`                       | ✅     | ✅    | ✅     | ✅       |

- **full**：完整支持，适配器已实现
- **Hooks**：当前完整 hook 运行时主要由 Claude Code 插件接入；OpenCode 适配器已注册插件和 MCP，但 `config/tools.schema.json` 中仍标记 `hooksSupport: false`，后续生命周期扩展见 `docs/evolution-roadmap.md`
- **适配器契约**：工具能力、安装范围、配置面、loom-managed 产物和版本探测方式以 `config/tools.schema.json` 的 `contract` 为单一源，并生成到 `src/generated/tooling.js` 的 `ADAPTER_CONTRACTS`；`loom doctor` 会基于契约输出一致性和版本诊断

## 安装

### 前置条件

- Node.js >= 22
- （可选）[codegraph](https://github.com/colbymchenry/codegraph) — 装了则 `loom index` 自动委派给它做 AST 级图索引，并注册其 MCP server；未装则跳过图查询能力

### 方式一：一键安装脚本

```bash
git clone https://github.com/xiqin/loom.git
cd loom
bash install.sh --tool claude-code
```

远程一键安装：

```bash
# Unix
curl -fsSL https://raw.githubusercontent.com/xiqin/loom/main/install.sh | bash -s -- --tool claude-code

# Windows PowerShell
irm https://raw.githubusercontent.com/xiqin/loom/main/install.ps1 -OutFile install.ps1; .\install.ps1 -Tool claude-code
```

### 方式二：npm 安装

```bash
npm i -g loom-engineering
loom install --tool claude-code
```

### 安装选项

| Flag               | 作用                                     |
| ------------------ | ---------------------------------------- |
| `--tool <targets>` | 目标工具（必填，逗号分隔或 "all"）       |
| `--dry-run`        | 预览，不实际写入                         |
| `--from-release`   | 从 GitHub release tag 下载（可重现安装） |
| `--version <ver>`  | 指定下载版本（配合 `--from-release`）    |

### 安装后验证

```bash
loom doctor    # 诊断安装状态
loom list      # 列出可用 skills 和 commands
```

### MCP 性能开关

loom 的 MCP server 支持通过环境变量控制工具暴露和运行统计。需要把变量配置到客户端启动 `loom mcp-serve` 的 MCP server 配置里，而不是只在普通 shell 会话里临时设置。

| 变量              | 建议值 | 作用                                                                                                                                                    |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOOM_LAZY_TOOLS` | `1`    | 启用 MCP 工具懒加载，默认只暴露基础工具，按需加载 pipeline/context/memory/session 工具组，减少工具定义带来的上下文开销。                                |
| `LOOM_TELEMETRY`  | `1`    | 开启 loom MCP 工具调用统计，记录调用次数、耗时、响应字节数和估算响应 token；可通过 `loom_telemetry` 工具查看，MCP server 退出时也会向 stderr 输出摘要。 |

配置示例：

Claude Code (`~/.claude.json`):

```jsonc
{
  "mcpServers": {
    "loom": {
      "command": "loom",
      "args": ["mcp-serve"],
      "env": {
        "LOOM_LAZY_TOOLS": "1",
        "LOOM_TELEMETRY": "1",
      },
    },
  },
}
```

```jsonc
// OpenCode: mcp.loom.environment
{
  "mcp": {
    "loom": {
      "type": "local",
      "command": ["loom", "mcp-serve"],
      "enabled": true,
      "environment": {
        "LOOM_LAZY_TOOLS": "1",
        "LOOM_TELEMETRY": "1",
      },
    },
  },
}
```

修改 MCP 配置后需要重启对应客户端，运行中的 MCP server 不会自动继承新环境变量。

### 初始化项目上下文

在 Codex/Claude/OpenCode 中直接触发 `loom-init-project` skill 即可；脚本由 skill 自动运行，不需要用户手动调用。

也可以使用 CLI：

```bash
loom init-project
```

## 卸载

### 卸载

```bash
# 脚本卸载
bash uninstall.sh --tool claude-code
.\uninstall.ps1 -Tool claude-code

# CLI 卸载
loom uninstall --tool claude-code
```

卸载只清理用户级安装的文件（用户目录下的 skills、commands、plugin 注册），不碰项目目录中的任何文件。

### 恢复

如果误卸载，重新安装即可：

```bash
loom install --tool claude-code
```

## 版本与发布策略

- 遵循 [Semantic Versioning](https://semver.org/)
- 版本号在 `package.json` 中定义，通过 `scripts/sync-version.mjs` 同步到所有元数据文件
- 每个生成的文件包含 `loom:version=x.y.z` 标记，用于检测已安装版本
- `loom update` 自动比较版本号，仅在版本不同时更新
- `loom doctor` 显示当前安装状态和版本

### 版本检查

```bash
loom doctor
# 输出示例：
#   Tool: claude-code
#   Version: 2.0.1
#   Status: installed
```

## 流水线

流水线由 `.loom/workflow.yaml` 集中定义。支持两种模式：

- **类型模式**：`loom run --type <feature|bugfix|hotfix|refactor|chore|quickfix>` — 按预设类型选择固定流水线
- **智能模式**：`loom run --auto --request "<需求描述>"` — AI 自主分析需求，从 step_catalog 中选择最优步骤组合

智能模式经过三段决策：规则短路（0 token）→ AI fallback（可选）→ 规则兜底。首次选择只返回结果，不初始化；执行前会向用户说明选择来源、风险等级和步骤顺序，并等待用户明确确认。确认后把 `dynamic_steps` 写入 `pipeline.state.json`，并在自动生成的 `progress.md` 中记录当前阶段和动态步骤，便于 AI 在没有对话上下文时继续执行。

如需先审查或手动调整步骤，也可以独立使用 `loom select` 子命令生成 `pipeline-plan.md`：

```bash
loom select --spec-dir specs/feat --request "重构状态管理，跨模块改动"
```

阶段完成时使用 handoff 记录压缩后的交接摘要，便于后续阶段或无上下文续跑读取；`progress.md` 会自动刷新 Handoffs 摘要，不要手动编辑：

```bash
loom handoff write --spec-dir specs/feat --stage planning --status done --summary "计划已确认" --artifacts plan.md,tasks/
loom handoff write --spec-dir specs/feat --task T1 --summary "导出认证服务接口" --artifacts src/auth/service.ts
loom status --spec-dir specs/feat
```

MCP 客户端可调用 `loom_write_handoff` 写入相同结构的 stage 或 task handoff。`stage` 与 `task_id` 二选一，常用字段包括 `status`、`summary`、`artifacts` 和自定义 `data`；`status` 允许值为 `done`、`partial`、`blocked`、`failed`。

合规历史可以通过 `loom evidence` 规范化为 `loom.evidence.v1` 视图，用于本地检查、CI 导出或 PR 报告输入：

```bash
loom evidence --json --hash-artifacts
loom evidence --jsonl --out .loom/evidence/evidence.jsonl
loom evidence --format markdown --out .loom/evidence/report.md
loom evidence --format html --out .loom/evidence/report.html
loom evidence --trends --out .loom/evidence/trends.json
```

### 流水线类型

| 类型           | 适用场景                       | 包含步骤                                                                                                          |
| -------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `feature`      | 新功能开发                     | brainstorming → planning → approved → git-worktree → executing → verification → code-review → synced             |
| `bugfix`       | 已定位的 bug 修复              | planning → approved → executing → verification → code-review → synced                                             |
| `hotfix`       | 生产紧急问题                   | approved → executing → verification                                                                               |
| `refactor`     | 代码重构                       | brainstorming → planning → approved → executing → verification → code-review → synced                             |
| `quickfix`     | 单文件小改动、已知 bug 小修复  | executing → verification                                                                                          |
| `chore`        | 依赖升级、配置调整、文档更新等 | executing → verification                                                                                           |
| `qa`           | QA 验收测试                    | qa-analysis → qa-design → qa-approved → qa-execution → qa-signoff → qa-report                                      |
| `pm-prototype` | PM 原型探索                    | brainstorming → spec-approved → prototype                                                                          |

AI 收到任务后会先判断类型并告知用户，必须等用户明确确认后再初始化或读取对应流水线执行。未指定类型时默认使用 `feature`。`code-review` 为对抗审查段（code-review-request → review-gate → code-review-response），低风险流水线（hotfix/quickfix/chore）跳过。

### feature 流水线步骤

| Step | 阶段                        | 说明                                                      | 输出                                         |
| ---- | --------------------------- | --------------------------------------------------------- | -------------------------------------------- |
| 1    | brainstorming               | 需求头脑风暴，探索 2-3 种实现方案                         | `specs/<date+feature>/spec.md`               |
| 2    | writing-plans               | 按分层拆解 task                                           | `specs/<date+feature>/plan.md`               |
| 3    | git-worktree                | 创建隔离分支                                              | feature 分支                                 |
| 4    | subagent-driven-development | Subagent 隔离派发 + 双审查                                | 源码 + 测试报告                              |
| 5    | verification                | 完成前验证，Spec覆盖/类型一致性/编译测试                  | 验证报告                                     |
| 6    | code-review-request         | 双轴预审查（Standards + Spec），生成审查请求             | `review-request.md`                          |
| 7    | review-gate                 | 人工 gate，等待审查者反馈                                 | —                                            |
| 8    | code-review-response        | 处理审查反馈，修复 BLOCKER，push back 不合理建议          | `review-response.md`                         |
| 9    | index-update                | codegraph 同步与结构化记忆更新（无 codegraph 时跳过索引） | codegraph 图索引 / `.loom/memory/store.json` |

### 代码审查

<!-- loom:generate:review-summary -->
### 6 维审查

| 维度 | 关键检查项 |
|------|----------|
| 架构合规 | 是否遵循项目架构分层（从 constitution.md 读取）、是否存在跨层调用 |
| 代码质量 | 是否使用了项目禁止的调试函数、SQL 是否参数化（防注入） |
| 安全风险 | SQL 注入检查、认证/授权是否正确 |
| 性能隐患 | N+1 查询检查、分页查询是否使用框架分页组件 |
| 规范一致性 | 命名是否符合项目规范、响应格式是否统一 |
| 变更影响范围 | 本次变更的函数、接口、类型是否被其他模块引用（codegraph 可用时查 codegraph_impact/codegraph_callers，否则用源码搜索补充判断）、公开接口的参数签名是否变化（新增必填参数、删除字段、类型变更） |
<!-- /loom:generate:review-summary -->

## Skills（18 个）

<!-- loom:generate:skills-catalog -->
6 流水线 + 4 辅助 + 7 通用 + 1 测试 Skill，共 18 个

**核心流水线 Skills：**

| Skill                               | 输出                           | 说明                                               |
| ----------------------------------- | ------------------------------ | -------------------------------------------------- |
| loom-brainstorming | `specs/<date+feature>/spec.md` | 需求头脑风暴, +可视化伴侣、设计自检、用户审查 Gate |
| loom-writing-plans | `specs/<date+feature>/plan.md` | 分层拆解 task, +模型选择、类型一致性检查 |
| loom-using-git-worktrees | feature 分支 | 创建隔离分支, +测试基线验证 |
| loom-subagent-driven-development | 源码 + 测试报告 | Subagent 派发 + 双重审查,独立模板文件、4种状态处理 |
| loom-verification-before-completion | 验证报告 | 完成前验证, +Spec覆盖、类型一致性、编译测试 |
| loom-index-update | codegraph 同步 + 结构化记忆 | codegraph 同步 |

**辅助 Skills：**

| Skill             | 说明                               |
| ----------------- | ---------------------------------- |
| loom-init-project | 项目初始化（扫描 + 生成宪章/记忆/入口） |
| loom-router | 轻量入口路由（分流到 skill 或 pipeline selector，不写流水线状态） |
| loom-pipeline-selector | 开发流水线步骤选择（确认后写入 dynamic_steps） |
| loom-using-loom | loom 框架使用指南（本 skill） |

**通用 Skills：**

| Skill                               | 说明                                              |
| ----------------------------------- | ------------------------------------------------- |
| loom-test-driven-development | TDD 测试驱动开发，+流程图、好/坏示例、常见借口表 |
| loom-systematic-debugging | 系统化调试, +4阶段流程图、条件等待、纵深防御 |
| loom-requesting-code-review | 请求代码审查, +预审查清单、审查模板 |
| loom-receiving-code-review | 接受代码审查, +响应模板、流程图 |
| loom-dispatching-parallel-agents | 并行 agent 派发, +模型选择、并发工作流图 |
| loom-writing-skills | 编写自定义 skills, +方法论深度、流程图 |
| loom-finishing-a-development-branch | 分支完成流程 , +选项展示（Merge/PR/Keep/Discard） |

**测试 Skills：**

| Skill      | 输出                           | 说明                                                        |
| ---------- | ------------------------------ | ----------------------------------------------------------- |
| loom-qa | `qa/<date+target>/qa-report.md` | QA 验收流水线，测试人员使用：新功能验证 + 回归 + 集成测试 + 持久化用例库 |

> 完整定义详见 `skills/loom-using-loom/SKILL.md` 或 `.loom/skills/` 目录
<!-- /loom:generate:skills-catalog -->

## License

MIT
