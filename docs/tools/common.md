# 工具适配公共内容

本文档包含 rss 框架在各工具中的公共配置和使用说明，各工具适配文档应引用此文件而非重复内容。

## 核心流水线

```
brainstorming → writing-plans → git-worktree → subagent-dev → index-update
```

| Step | 阶段 | 说明 | 输出 |
|------|------|------|------|
| 1 | brainstorming | 需求头脑风暴，探索 2-3 种实现方案 | `specs/<date+feature>/spec.md` |
| 2 | writing-plans | 按分层拆解 task（Model→Service→Controller→Router） | `specs/<date+feature>/plan.md` |
| 3 | git-worktree | 创建隔离分支 | feature 分支 |
| 4 | subagent-driven-development | Subagent 隔离派发 + 双审查 | 源码 + 测试报告 |
| 5 | index-update | 工程索引同步 | ENGINEERING-INDEX.md |

## 项目规则

- **宪章**：`.claude/memory/constitution.md`（由 `/rss-init-project` 自动生成）
- **工程约束**：`.claude/rules/project-structure.md`（由 `/rss-init-project` 自动生成）

所有开发活动必须遵守以上两份文件。

## 编码红线

1. 禁止在 Controller 中写业务逻辑
2. 禁止硬编码配置值
3. 禁止 SQL 拼接（必须参数化）
4. 禁止修改自动生成文件
5. 项目特定的红线由宪章定义

## 文件结构

```
项目根目录/
├── .claude/
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

1. 用户打开 AI 编程工具
2. 加载 `CLAUDE.md`
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

### 常见问题

**Skill 未触发**
- 检查 SKILL.md 的 description 中是否包含正确的关键词
- 确认文件路径正确

**Hooks 未执行**
- 检查 hooks 配置文件格式
- 确认脚本有执行权限

**命令未识别**
- 检查命令文件是否在 `commands/` 目录
- 确认文件名与命令名匹配

## 最佳实践

1. **详细描述需求**：在 prompt 中提供完整上下文
2. **引用项目规则**：在 prompt 中引用 `constitution.md` 和 `project-structure.md`
3. **分步执行**：每个流水线步骤单独触发
4. **验证输出**：AI 生成的代码需要人工验证
