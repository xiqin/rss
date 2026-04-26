# GitHub Copilot 适配

## 安装

### 方式 1：直接引用

在 `.github/copilot-instructions.md` 中引用 rss 内容：

```markdown
# Copilot Instructions

本项目使用 rss（Requirement-Driven Software Engineering）AI 工程化框架。

## 核心流水线

1. brainstorming → 生成 spec.md
2. writing-plans → 生成 plan.md
3. git-worktree → 创建隔离分支
4. subagent-dev → 派发 subagent 编码
5. index-update → 同步工程索引

## 项目规则

- **宪章**：.claude/memory/constitution.md
- **工程约束**：.claude/rules/project-structure.md

## 编码红线

1. 禁止在 Controller 中写业务逻辑
2. 禁止使用 fmt.Println（必须用 Zap）
3. 禁止硬编码配置值
4. 禁止 SQL 拼接（必须参数化）
5. 禁止修改自动生成文件
6. 禁止手动修改 wire_gen.go

## 技术栈

- Go 1.24 + Gin + GORM + MySQL
- Zap 日志
- Google Wire DI
- Redis 缓存

详见 /path/to/rss/skills/ 和 /path/to/rss/docs/
```

### 方式 2：插件配置

rss 使用 `.github/copilot-plugin.json`（如果 Copilot 支持插件）：

```json
{
  "name": "rss",
  "description": "Requirement-Driven Software Engineering",
  "instructions": "https://github.com/<org>/rss/blob/main/CLAUDE.md"
}
```

## 使用方式

### 手动触发

在 Copilot Chat 中手动触发流程：

```
请帮我做需求头脑风暴：我想实现用户账号绑定列表功能
```

```
请帮我拆解实现计划：根据 spec.md 拆分 task
```

```
请帮我审查代码：检查当前实现是否符合项目规范
```

### 自动触发

Copilot 会根据 `copilot-instructions.md` 中的规则自动提供建议。

## 文件结构

```
项目根目录/
├── .github/
│   └── copilot-instructions.md  # Copilot 指令
├── .claude/
│   ├── memory/
│   │   ├── constitution.md      # 项目宪章
│   │   └── MEMORY.md            # 记忆文件
│   ├── rules/
│   │   └── project-structure.md # 工程结构约束
│   └── skills/                  # Skills（供参考）
├── CLAUDE.md                    # 项目入口
├── ENGINEERING-INDEX.md         # 工程索引
└── specs/
    └── <date+feature>/
```

## 适配说明

### 与 Claude Code 的差异

| 特性 | Claude Code | GitHub Copilot |
|------|-------------|----------------|
| Skill 调用 | Skill() 工具 | 手动触发 |
| Hooks | 自动执行 | 无 |
| 斜杠命令 | 支持 | 不支持 |
| 上下文管理 | 自动 | 手动 |

### 最佳实践

1. **详细描述需求**：Copilot 不自动加载 skill，需要在 prompt 中提供完整上下文
2. **引用项目规则**：在 prompt 中引用 `constitution.md` 和 `project-structure.md`
3. **分步执行**：每个流水线步骤单独触发
4. **验证输出**：Copilot 生成的代码需要人工验证

## 自定义

### 项目级指令

编辑 `.github/copilot-instructions.md` 添加项目特有规则。

### 引用 Skills

在指令文件中引用 rss skills 的内容：

```markdown
## brainstorming 流程

请按照以下流程进行需求分析：
1. 读取项目宪章
2. 探索 2-3 种实现方案
3. 输出 spec.md
...
```

## 调试

### 检查指令加载

在 Copilot Chat 中输入：

```
@workspace 请描述本项目的开发流程
```

### 常见问题

**Copilot 不遵循规则**
- 确认 `.github/copilot-instructions.md` 格式正确
- 检查指令是否足够详细
- 在 prompt 中显式引用规则

**上下文丢失**
- 在每次对话中重新提供上下文
- 使用 `@workspace` 前缀引用项目文件

**输出不符合规范**
- 在 prompt 中提供具体示例
- 检查 `copilot-instructions.md` 中的编码红线
