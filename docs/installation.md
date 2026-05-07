# 安装指南

## CLI 安装（推荐）

### 1. 全局安装 CLI

```bash
npm i -g rss-engineering
```

### 2. 初始化项目

在项目根目录运行：

```bash
rss init --tool claude-code
```

这会将 skills、commands、hooks、templates 复制到 `.claude/` 目录，并生成 `CLAUDE.md`。

支持的工具：
- `--tool claude-code` — Claude Code（默认）
- `--tool cursor` — Cursor
- `--tool copilot` — GitHub Copilot

### 3. 初始化项目配置

在 Claude Code 中运行：

```
/rss-init-project
```

这会扫描项目并生成：
- `.claude/memory/constitution.md`（项目宪章）
- `.claude/rules/project-structure.md`（工程结构）
- `.claude/memory/MEMORY.md`（记忆文件）
- `.claude/templates/subagent-context.md`（子 agent 上下文）

## 更新

```bash
rss update
```

## 诊断

```bash
rss doctor
```

## 列出可用 Skills

```bash
rss list
```

## Git Hook 配置（可选）

配置 post-merge hook，在 git pull 后自动同步 assets：

```bash
git config core.hooksPath .githooks
```
