---
name: using-rss
description: >
  rss 框架使用指南。当用户首次使用 rss 或询问如何使用时触发。
  Use when: introducing the rss framework and its capabilities.
---

# Using rss — Requirement-Driven Software Engineering

rss 是一个基于 superpowers 增强的 AI 工程化框架，提供 5 步流水线、项目宪章、5 维审查、进度追踪等能力。

## 核心流水线

```
brainstorming → writing-plans → git-worktree → subagent-dev → index-update
```

### 流水线阶段

| Step | 阶段 | 说明 | 输出 |
|------|------|------|------|
| 1 | brainstorming | 需求头脑风暴，探索 2-3 种实现方案 | `specs/<date+feature>/spec.md` |
| 2 | writing-plans | 按分层拆解 task | `specs/<date+feature>/plan.md` |
| 3 | git-worktree | 创建隔离分支 | feature 分支 |
| 4 | subagent-driven-development | Subagent 隔离派发 + 双审查 | 源码 + 测试报告 |
| 5 | index-update | 工程索引同步 | ENGINEERING-INDEX.md |

### 阶段串联规则

- brainstorming 完成 → 等待用户确认 → writing-plans
- writing-plans 完成 → 等待用户确认 → git-worktree
- git-worktree 完成 → 触发 subagent-dev
- subagent-dev 完成 → 触发 index-update
- index-update 完成 → 通知可以提交

**严令禁止跳过任何步骤。**

## 项目规则

项目规则存储在 `.claude/memory/constitution.md`（宪章）和 `.claude/rules/project-structure.md`（工程约束）中。

首次使用请运行 `/rss-init-project` 自动生成这些文件。

## Skills 调用方式

- 使用 Skill 工具调用：`Skill("brainstorming")`
- 使用斜杠命令：`/rss-brainstorm`、`/rss-write-plan`、`/rss-execute-plan`

## 进度追踪

每个功能开发维护 `specs/<date+feature>/progress.md`，可视化流水线状态。

## 状态横幅

每个阶段输出状态横幅：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [<进度条>] Step N/5 — <阶段名称>
 功能:    <功能名>
 status:  ▶ 开始执行 | ✅ 完成 | ❌ 失败
 下一步:  → Step N+1: <下一阶段>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 5 维审查

rss 使用 5 维审查替代通用 code review：

1. 架构合规 — BLOCKER — 分层是否正确
2. 代码质量 — BLOCKER — 编码规范、错误处理
3. 安全风险 — BLOCKER — SQL 注入、认证、输入验证
4. 性能隐患 — WARNING — N+1 查询、缓存
5. 规范一致性 — WARNING — 命名、响应格式

详见 `core/review-framework.md`。

## 与 superpowers 的关系

rss 继承 superpowers 的插件基础设施，替换/增强核心 skills 为 rss 版本：

- 增强：brainstorming、writing-plans、subagent-driven-development
- 新增：index-update、init-project
- 继承：TDD、debugging、verification、git-worktrees 等通用 skills
