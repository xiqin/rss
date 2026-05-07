# rss — Requirement-Driven Software Engineering

> AI 工程化框架，基于 superpowers 增强。

## 核心流水线

```
brainstorming → writing-plans → git-worktree → subagent-dev → index-update
```

## 项目规则

- **宪章**：`.claude/memory/constitution.md`（由 `/rss-init-project` 自动生成）
- **工程约束**：`.claude/rules/project-structure.md`（由 `/rss-init-project` 自动生成）

**所有开发活动必须遵守以上两份文件。**

## 快速开始

1. 安装 rss 框架（参见 `docs/installation.md`）
2. 首次使用请运行 `/rss-init-project` 扫描项目并生成配置
3. 使用 `/rss-brainstorm` 开始需求分析，生成 `specs/<date+feature>/spec.md`
4. 使用 `/rss-write-plan` 拆解实现计划，生成 `plan.md`
5. 使用 `/rss-execute-plan` 派发 subagent 执行编码
6. 编码完成后自动触发 index-update 同步工程索引

## Skills 清单

所有 skills 通过 `/` 命令或 Skill 工具调用。详见 `skills/` 目录。

### 核心流水线 Skills

| Skill | 说明 | 输出 |
|-------|------|------|
| brainstorming | 需求头脑风暴 | `specs/<date+feature>/spec.md` |
| writing-plans | 分层拆解 task | `specs/<date+feature>/plan.md` |
| git-worktree | 创建隔离分支 | feature 分支 |
| subagent-driven-development | Subagent 隔离派发 + 双审查 | 源码 + 测试报告 |
| index-update | 工程索引同步 | ENGINEERING-INDEX.md |

### 辅助 Skills

| Skill | 说明 |
|-------|------|
| init-project | 项目初始化（扫描 + 生成宪章/结构） |
| using-rss | rss 框架使用指南 |

### 通用 Skills（继承 superpowers）

| Skill | 说明 |
|-------|------|
| test-driven-development | TDD 测试驱动开发 |
| systematic-debugging | 系统性调试 |
| verification-before-completion | 完成前验证 |
| using-git-worktrees | Git worktree 管理 |
| finishing-a-development-branch | 分支完成流程 |
| requesting-code-review | 请求代码审查 |
| receiving-code-review | 接收代码审查 |
| dispatching-parallel-agents | 并行 agent 派发 |
| writing-skills | 编写自定义 skills |
| executing-plans | 执行计划 |

## 流水线状态横幅

每个阶段输出状态横幅：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■■□□] Step 3/5 — git-worktree
 功能:    feature-name
 status:  ▶ 开始执行
 下一步:  → Step 4: subagent-dev
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 完成工作后更新

代码变更后同步更新：

1. `ENGINEERING-INDEX.md` — 新增/删除了模块、路由、控制器、服务
2. `.claude/memory/MEMORY.md` — 踩坑、用户偏好、变更要点
3. `CLAUDE.md` — 引入了新的约定或命令

## 记忆

持久化记录在 `.claude/memory/MEMORY.md`，新会话时先读此文件。
