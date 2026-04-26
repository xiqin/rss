---
name: using-git-worktrees
description: >
  Git 工作树隔离。创建隔离的 git 分支进行开发，避免污染主分支。
  Use when: starting a new feature development to create an isolated branch.
  Trigger keywords: 创建分支, 新分支, worktree, 隔离开发.
---

# Git 工作树隔离

## 用途

创建隔离的 git 分支进行开发，保持主分支干净。

## 执行流程

### Step 1：检查当前状态

```bash
git status
```

- [ ] 确认当前在正确的分支（通常为主分支）
- [ ] 确认没有未提交的变更

### Step 2：创建功能分支

分支命名规范：

```
feature/<date>-<feature-name>
```

示例：
- `feature/2026-04-26-passport-list`
- `feature/2026-04-26-user-auth`

```bash
git checkout -b feature/<date>-<feature-name>
```

### Step 3：确认分支状态

```bash
git branch --show-current
```

确认分支已创建并切换成功。

## 状态输出

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■■□□□□□] Step 3/5 — git-worktree
 功能:    <feature-name>
 status:  ✅ 完成
 分支:    feature/<date>-<feature-name>
 下一步:  → Step 4: subagent-dev
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 分支命名规则

- 功能分支：`feature/<date>-<name>`
- 修复分支：`fix/<date>-<name>`
- 重构分支：`refactor/<date>-<name>`
- 文档分支：`docs/<date>-<name>`

## 约束

- 禁止在主分支直接开发
- 每个功能使用独立分支
- 分支名使用小写字母和连字符
- 分支名应简洁明了

## 完成条件与下一步

分支创建完成后，**触发 subagent-driven-development** 进行编码执行。
