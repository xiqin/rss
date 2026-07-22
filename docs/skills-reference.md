---
title: Skills 参考
description: loom 全部技能快速参考
---

# Skills 参考

> **本文件由各 SKILL.md 自动汇总，内容可能滞后于实际 skills。最新定义请直接参考 `skills/` 目录中各 SKILL.md。**

## 核心流水线 Skills

### brainstorming

- **用途**：需求头脑风暴
- **触发**：用户提出需求、功能描述、PRD
- **输出**：`specs/<date+feature>/spec.md`
- **下一步**：等待用户确认 → writing-plans

### writing-plans

- **用途**：拆解实现计划
- **触发**：spec.md 已存在，用户确认方案
- **输出**：`specs/<date+feature>/plan.md`
- **下一步**：等待用户确认 → git-worktree

### subagent-driven-development

- **用途**：Subagent 隔离派发
- **触发**：plan.md 已存在，git worktree 已创建
- **输出**：源码 + 测试报告
- **下一步**：index-update

### detail-expansion

- **用途**：按 15 固定维度把 `REQ-xxx` 展开为可独立验证的 Behavior Obligation
- **触发**：brainstorming 产出 `spec.md` 与 `requirements.json` 后，planning 前
- **脚本**：`node skills/loom-detail-expansion/scripts/check-detail-expansion.mjs --spec-dir <dir>`
- **输出**：更新后的 `requirements.json`，补齐每个 behavior 的 `category` / `test_plan` / `applicability`
- **下一步**：writing-plans

### analyze-artifacts

- **用途**：planning 后 approved 前只读跨产物一致性分析
- **触发**：planning 产出 `plan.md` / `tasks/` / `traceability.json` 后，等待用户审批前
- **脚本**：`node skills/loom-analyze-artifacts/scripts/analyze-artifacts.mjs --spec-dir <dir>`
- **输出**：`artifact-analysis.json`（含 findings 与 coverage%，blocker 阻断 approved gate）
- **下一步**：blocker 阻断 approved gate，无 blocker 则进入 approved

### converge

- **用途**：executing 后 verification 前对照意图清单收敛
- **触发**：executing 产出 `test-report.md` PASS，进入 verification 前
- **脚本**：`node skills/loom-converge/scripts/converge.mjs --spec-dir <dir> --round <N>`
- **输出**：`convergence-report.json`；missing / partial / contradicts 生成新 task 回流 executing，最多 3 轮
- **下一步**：零 blocker 后进入 verification

### omission-hunter

- **用途**：只读对抗式审查，专门检查“应该存在但不存在”的实现与测试
- **触发**：converge 内部调用，或独立运行于已实现代码
- **脚本**：`node skills/loom-omission-hunter/scripts/omission-hunt.mjs --spec-dir <dir>`
- **输出**：`findings/omission-hunter.json`（含 findings 与 blocker_count）
- **下一步**：blocker 回流到 converge 生成新 task

### index-update

- **用途**：codegraph 同步
- **触发**：代码变更完成后
- **输出**：codegraph 同步（可用时）、结构化 memory 更新、MEMORY.md 导出视图（按需）
- **下一步**：工作完成，可以提交

## 辅助 Skills

### init-project

- **用途**：项目初始化
- **触发**：`/loom-init-project` 命令
- **输出**：宪章、结构化记忆、子 agent 上下文、agent 入口文件

### router

- **用途**：轻量入口路由
- **触发**：用户请求需要先判断应进入哪个 loom 能力
- **边界**：不写 `pipeline.state.json`，不生成 `dynamic_steps`，开发型任务交给 `pipeline-selector`
- **输出**：推荐 skill / pipeline selector、理由、下一步和上下文策略

### pipeline-selector

- **用途**：AI 自主流程选择
- **触发**：用户未指定 `--type`，或调用 `loom run --auto` / MCP `loom_select_pipeline`
- **输出**：选择结果；初始化后持久化到 `pipeline.state.json` 的 `dynamic_steps`，并反映在 `progress.md`
- **决策**：规则短路 → AI fallback → 规则兜底
- **护栏**：must_include、dependency_closure、never_skip_gates、max_steps
- **下一步**：向用户说明选择结果并等待明确确认后执行；如需人工审查，可先用 `loom select` 生成 `pipeline-plan.md` 再 `loom run --approve-pipeline`

## 通用 Skills（继承 superpowers 框架）

### test-driven-development

- **用途**：测试驱动开发
- **触发**：需要 TDD 方式开发
- **循环**：确认 seam → 红 → 绿 → 重构

### systematic-debugging

- **用途**：系统化调试
- **触发**：遇到 bug、测试失败、运行异常
- **方法**：建立 red-capable feedback loop → 复现/最小化 → 收集信息 → 形成假设 → 验证 → 修复

### verification-before-completion

- **用途**：完成前验证
- **触发**：宣布任务完成前
- **检查**：编译、测试、代码质量、功能完整性、文档同步

### using-git-worktrees

- **用途**：Git 工作树隔离
- **触发**：开始新功能开发
- **输出**：feature 分支

### finishing-a-development-branch

- **用途**：开发分支收尾
- **触发**：开发完成
- **流程**：验证 → 提交 → 推送 → 创建 PR

### requesting-code-review

- **用途**：请求代码审查
- **触发**：准备审查
- **输出**：Standards + Spec 双轴预审查结果和审查请求材料

### receiving-code-review

- **用途**：接受代码审查
- **触发**：收到审查反馈
- **流程**：理解反馈 → 分类处理 → 修复 → 回复

### dispatching-parallel-agents

- **用途**：并行派发
- **触发**：多个独立任务可并行
- **流程**：分析依赖 → 创建并行组 → 并行派发

### writing-skills

- **用途**：编写新 skill
- **触发**：创建自定义 skill
- **格式**：frontmatter + 触发条件 + 执行流程

## Skill 文件结构

```
skills/
  <skill-name>/
    SKILL.md          # 必需：skill 主文件
    REFERENCE/        # 可选：参考文件
      *.md
```

## 结构化账本与收据 CLI

除各 skill 外，`scripts/` 提供 5 个独立 CLI 用于主动生成 / 校验结构化产物：

| CLI | npm script | 用途 |
| --- | --- | --- |
| `scripts/requirements-json.mjs` | `requirements:generate` / `requirements:check` | 从 `spec.md` 生成 `requirements.json`；校验 REQ / behaviors / category / types 一致性 |
| `scripts/traceability-json.mjs` | `traceability:generate` / `traceability:check` | 从 `requirements.json` + `tasks/` 生成 `traceability.json`；校验 REQ / behavior 到 task / test / evidence 闭环 |
| `scripts/implementation-packets.mjs` | `packets:generate` / `packets:check` | 为单个 task 生成冻结的 `implementation-packets/T*.json`；校验 packet 是否 stale |

4 个新 skill 各自带 `scripts/*.mjs`（详见各 skill 目录），可独立运行做只读分析。收据（`receipts/`）由 `src/core/receipts.js` 的 `buildReceipt` / `writeReceipt` 生成，绑定 `git_tree` / `git_commit` / `diff_sha256`。

> `config/*.schema.json` 仅作为文档与测试 fixture 保留，skill 运行时不依赖；校验逻辑硬编码在各 skill 的 `scripts/*.mjs` 与 `src/core/*.js` 中。

## SKILL.md 格式

```markdown
---
name: <skill-name>
description: >
  简短描述。Use when: <触发条件>.
when_to_use: 更精确的触发条件，面向 Agent Skills 标准。
argument-hint: <用户参数提示>
user-invocable: true
---

# <Skill 标题>

## 触发条件

...

## 执行流程

...
```

## Frontmatter 字段

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | skill 名称，必须与目录名一致 |
| `description` | 是 | 简短描述，用于工具选择和目录生成，仍需包含 `Use when:` |
| `when_to_use` | 是 | 更精确的标准触发语义，供支持 Agent Skills 的客户端使用 |
| `argument-hint` | 是 | slash command 或可调用 skill 的参数提示，例如 `<spec_dir>` |
| `user-invocable` | 是 | 当前内置 skill 均为 `true`，表示可被用户显式调用 |

当前先落地最小兼容字段集。`allowed-tools`、`disallowed-tools`、`model`、`effort`、`context`、skill 局部 hooks 和 eval 将按路线图继续补齐。
