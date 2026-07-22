# loom — Weave Specs into Execution

## 核心流水线

流水线由 `.loom/workflow.yaml` 集中定义，支持两种模式：

- **类型模式**：`loom run --type <feature|bugfix|hotfix|refactor|chore|quickfix>` — 按预设类型选择固定流水线
- **智能模式**：`loom run --auto --request "<需求描述>"` — AI 自主分析需求，从 step_catalog 中选择最优步骤组合

智能模式三段决策：规则短路（0 token）→ AI fallback（可选）→ 规则兜底。首次选择只返回结果，不初始化；执行前必须向用户说明选择来源、风险等级和步骤顺序，并等待用户明确确认。确认后把 `dynamic_steps` 写入 `pipeline.state.json`，并在 `progress.md` 中记录当前阶段和动态步骤，便于无上下文续跑。

示例：

```
brainstorming → writing-plans → git-worktree → subagent-dev → verification → code-review → index-update
```

## 项目规则

- **工程约束**：`.loom/rules/constitution.md`（由 `/loom-init-project` 自动生成，包含架构和目录约束）

**所有开发活动必须遵守以上两份文件。**

## 快速开始

1. 安装 loom 框架（参见 `docs/installation.md`）
2. 首次使用请运行 `/loom-init-project` 扫描项目并生成配置
3. 使用 `/loom-brainstorm` 开始需求分析，生成 `specs/<date+feature>/spec.md`
4. 使用 `/loom-write-plan` 拆解实现计划，生成 `plan.md`
5. 使用 `/loom-execute-plan` 派发 subagent 执行编码
6. 编码完成后依次触发对抗审查（code-review-request → review-gate → code-review-response）和 index-update 同步 codegraph 和结构化记忆

## Skills 清单

<!-- loom:generate:skills-catalog -->
8 流水线 + 4 辅助 + 7 通用 + 1 测试 Skill，共 22 个

**核心流水线 Skills：**

| Skill                               | 输出                           | 说明                                               |
| ----------------------------------- | ------------------------------ | -------------------------------------------------- |
| loom-brainstorming | `specs/<date+feature>/spec.md` | 需求头脑风暴, +可视化伴侣、设计自检、用户审查 Gate |
| loom-detail-expansion | `specs/<date+feature>/requirements.json` | 按 15 维度展开 Behavior Obligation，补齐 test_plan 与 applicability |
| loom-writing-plans | `specs/<date+feature>/plan.md` | 分层拆解 task, +模型选择、类型一致性检查 |
| loom-analyze-artifacts | `specs/<date+feature>/artifact-analysis.json` | planning 后审批前跨产物一致性只读分析 |
| loom-using-git-worktrees | feature 分支 | 创建隔离分支, +测试基线验证 |
| loom-subagent-driven-development | 源码 + 测试报告 | Subagent 派发 + 双重审查,独立模板文件、4种状态处理 |
| loom-converge | `specs/<date+feature>/convergence-report.json` | executing 后 verification 前对照意图清单，missing/partial 回流 executing |
| loom-omission-hunter | `specs/<date+feature>/findings/omission-hunter.json` | 只读对抗式审查，负空间检查（应存在但不存在） |
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

## 流水线状态输出

每个阶段只输出当前执行的 skill：

```text
执行中：loom-using-git-worktrees
```

执行步骤与下一步流转以 `.loom/workflow.yaml` 为准。

## 完成工作后更新

代码变更后同步更新：

1.  — 新增/删除了模块、路由、控制器、服务
2.  `.loom/memory/MEMORY.md` — 踩坑、用户偏好、变更要点
3.  `{{ENTRY_FILE}}` — 引入了新的约定或命令

## 记忆

持久化记录在 `.loom/memory/MEMORY.md`，新会话时先读此文件。
