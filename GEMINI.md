# rss — Requirement-Driven Software Engineering

> AI 工程化框架，基于 superpowers 增强。

## 核心流水线

brainstorming → writing-plans → git-worktree → subagent-dev → index-update

## 项目规则

- **宪章**：`.claude/memory/constitution.md`（由 `/rss-init-project` 自动生成）
- **工程约束**：`.claude/rules/project-structure.md`（由 `/rss-init-project` 自动生成）

## 快速开始

1. 首次使用请运行 `/rss-init-project` 扫描项目并生成配置
2. 使用 `/rss-brainstorm` 开始需求分析
3. 使用 `/rss-write-plan` 拆解实现计划
4. 使用 `/rss-execute-plan` 派发 subagent 执行编码

## Skills

所有 skills 详见 `skills/` 目录。

### 核心 Skills

- brainstorming — 需求头脑风暴
- writing-plans — 分层拆解 task
- subagent-driven-development — Subagent 隔离派发
- index-update — 工程索引同步
- code-review — 5 维代码审查

### 通用 Skills

- test-driven-development — TDD
- systematic-debugging — 系统调试
- verification-before-completion — 完成前验证
- using-git-worktrees — Git 隔离
- writing-skills — 编写新 skill

## 流水线状态横幅

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■■□□] Step 3/5 — git-worktree
 功能:    feature-name
 status:  ▶ 开始执行
 下一步:  → Step 4: subagent-dev
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
