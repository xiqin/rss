# Claude Code 适配

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

### 文件结构

```
项目根目录/
├── .claude/
│   ├── plugin.json              # 插件配置
│   ├── memory/
│   │   ├── constitution.md      # 项目宪章
│   │   └── MEMORY.md            # 记忆文件
│   ├── rules/
│   │   └── project-structure.md # 工程结构约束
│   ├── skills/
│   │   └── <skill>/SKILL.md     # Skills
│   ├── commands/
│   │   └── <command>.md         # 命令定义
│   ├── hooks/
│   │   ├── hooks.json           # Hooks 配置
│   │   └── session-start        # 会话开始钩子
│   ├── templates/
│   │   └── subagent-context.md  # 子 agent 上下文
│   └── core/                    # 核心框架定义
├── CLAUDE.md                    # 项目入口文档
├── ENGINEERING-INDEX.md         # 工程索引
└── specs/
    └── <date+feature>/
        ├── spec.md              # 需求规格
        ├── plan.md              # 实现计划
        ├── progress.md          # 进度追踪
        └── test-report.md       # 测试报告
```

## 会话流程

1. 用户打开 Claude Code
2. Claude 加载 `CLAUDE.md`
3. 执行 `hooks/session-start`
4. 检查项目是否已初始化
5. 如果未初始化，提示运行 `/rss-init-project`

## 自定义

### 项目级 Skills

在 `.claude/skills/` 中创建项目专属 skill：

```
.claude/skills/
  my-project-skill/
    SKILL.md
```

### 覆盖 rss Skills

在 `.claude/skills/` 中创建同名 skill 目录覆盖 rss 默认：

```
.claude/skills/
  writing-plans/
    SKILL.md        # 覆盖 rss 默认的 writing-plans
```

### 自定义 Hooks

编辑 `hooks/hooks.json` 添加更多钩子：

```json
{
  "sessionStart": {
    "command": "hooks/session-start"
  },
  "preCommit": {
    "command": "hooks/pre-commit"
  }
}
```

## 调试

### 检查 Skill 加载

在 Claude Code 中查看已加载的 skills。

### 检查 Hooks 执行

查看 hooks 是否正确执行，检查 `hooks/session-start` 的输出。

### 常见问题

**Skill 未触发**
- 检查 SKILL.md 的 description 中是否包含正确的关键词
- 确认文件路径正确

**Hooks 未执行**
- 检查 `hooks.json` 格式
- 确认 `session-start` 文件有执行权限

**命令未识别**
- 检查命令文件是否在 `commands/` 目录
- 确认文件名与命令名匹配
