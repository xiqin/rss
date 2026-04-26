# 安装指南

## Claude Code

### 方式 1：手动安装

1. 下载 rss 框架

```bash
git clone https://github.com/<org>/rss.git
```

2. 复制到项目

```bash
cp -r rss/.claude-plugin ./
cp -r rss/skills ./.claude/skills/
cp -r rss/commands ./.claude/commands/
cp -r rss/hooks ./.claude/hooks/
cp -r rss/templates ./.claude/templates/
cp -r rss/core ./.claude/core/
```

3. 初始化项目

```
/rss-init-project
```

### 方式 2：引用安装

在项目的 `CLAUDE.md` 中引用 rss 框架：

```markdown
# My Project

> 使用 rss AI 工程化框架。
> Skills 路径：/path/to/rss/skills/

## 开发流程

按 rss 框架的 5 步流水线执行。
```

## OpenCode

1. 下载 rss 框架
2. 复制 `.opencode/plugin.json` 到项目
3. 在 OpenCode 配置中引用 skills 路径

## Cursor

1. 下载 rss 框架
2. 复制 `.cursor-plugin/plugin.json` 到项目
3. 在 Cursor 配置中引用 skills 路径

## GitHub Copilot

1. 下载 rss 框架
2. 创建 `.github/copilot-instructions.md` 引用 rss 内容：

```markdown
# Copilot Instructions

本项目使用 rss AI 工程化框架，开发流程如下：

1. brainstorming → 生成 spec.md
2. writing-plans → 生成 plan.md
3. git-worktree → 创建隔离分支
4. subagent-dev → 派发 subagent 编码
5. index-update → 同步工程索引

详见 /path/to/rss/skills/
```

## 验证安装

```bash
# 检查插件配置
cat .claude-plugin/plugin.json

# 检查 skills 目录
ls -la .claude/skills/

# 测试 Skill 工具
# 在 Claude Code 中输入：/rss-init-project
```

## 首次使用

安装完成后，运行 `/rss-init-project` 扫描项目并生成配置：

```
/rss-init-project
```

这将生成：
- `.claude/memory/constitution.md`（项目宪章）
- `.claude/rules/project-structure.md`（工程结构）
- `.claude/memory/MEMORY.md`（记忆文件）
- `.claude/templates/subagent-context.md`（子 agent 上下文）

检查生成的文件，完善 `[TODO]` 部分。
