# OpenCode 适配

> 公共内容参见 [`common.md`](common.md)

## 安装

### 插件配置

rss 使用 `.opencode/plugin.json` 作为插件配置：

```json
{
  "name": "rss",
  "description": "Requirement-Driven Software Engineering",
  "version": "1.0.0"
}
```

### Skills 加载

OpenCode 通过配置引用 rss skills 路径。

## 使用方式

### 激活 Skill

在 OpenCode 中使用 `activate_skill` 工具：

```
activate_skill("brainstorming")
```

## 适配说明

### 工具映射

| Claude Code | OpenCode |
|-------------|----------|
| Skill | activate_skill |
| Read | read |
| Write | write |
| Edit | edit |
| Bash | exec |

### Prompt 格式

OpenCode 使用类似的 SKILL.md 格式，但 frontmatter 可能需要调整。

### Hooks

OpenCode 的 hook 机制可能与 Claude Code 不同，需要适配 `hooks/session-start`。

## 自定义

### 项目级配置

在 `.opencode/` 目录中添加项目配置。

### Skill 覆盖

在 `.claude/skills/` 中创建同名 skill 覆盖 rss 默认。

## 调试

### 检查 Skill 加载

在 OpenCode 中查看已加载的 skills。

### 常见问题

参见 [common.md#常见问题](common.md#常见问题)
