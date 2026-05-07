# Claude Code 适配

> 公共内容参见 [`common.md`](common.md)

## 安装

### 插件配置

rss 使用 `.claude-plugin/plugin.json` 作为插件配置：

```json
{
  "name": "rss",
  "description": "Requirement-Driven Software Engineering",
  "version": "1.0.0"
}
```

### Skills 加载

Claude Code 自动加载 `.claude/skills/` 目录中的所有 SKILL.md 文件。

### Hooks

rss 使用 `hooks/hooks.json` 配置会话钩子：

```json
{
  "sessionStart": {
    "command": "hooks/session-start",
    "description": "Session 开始时加载项目上下文"
  }
}
```

## 使用方式

### Skill 工具

在 Claude Code 中使用 Skill 工具调用：

```
Skill("brainstorming")
```

### 斜杠命令

rss 提供以下斜杠命令：

- `/rss-brainstorm` — 开始需求头脑风暴
- `/rss-write-plan` — 拆解实现计划
- `/rss-execute-plan` — 执行实现计划
- `/rss-init-project` — 项目初始化
- `/rss-import-rules` — 导入项目自定义规则

## 自定义

### 项目级 Skills

参见 [common.md#项目级-skills](common.md#项目级-skills)

### 覆盖 rss Skills

参见 [common.md#覆盖-rss-skills](common.md#覆盖-rss-skills)

### 自定义 Hooks

参见 [common.md#自定义-hooks](common.md#自定义-hooks)

## 调试

### 检查 Skill 加载

在 Claude Code 中查看已加载的 skills。

### 检查 Hooks 执行

查看 hooks 是否正确执行，检查 `hooks/session-start` 的输出。

### 常见问题

参见 [common.md#常见问题](common.md#常见问题)
