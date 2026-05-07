---
name: init-project
description: >
  项目初始化。扫描项目源码，自动生成宪章、工程结构、子 agent 上下文等配置文件。
  Use when: first setting up rss in a project, or when project structure has significantly changed.
  Trigger keywords: init-project, 初始化项目, 扫描项目, 生成配置
---

# 项目初始化 Skill

## 触发条件

- 用户输入 `/rss-init-project`
- 项目中不存在 `.claude/memory/constitution.md`（首次使用自动提示）
- 项目结构发生重大变更后重新生成

## 状态输出

执行开始时：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [init] — 项目初始化 (init-project)
 skill:   init-project
 status:  ▶ 开始执行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

执行结束时：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [init] — 项目初始化 (init-project)
 status:  ✅ 完成
 输出:    4 个配置文件已生成
 下一步:  检查生成的文件，手动完善 [TODO] 部分
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 执行流程

### Step 1: 扫描项目根目录

检测项目基本信息：

| 检测项 | 方法 | 示例 |
|--------|------|------|
| 项目名称 | 目录名 / go module / package.json | wxServiceGo |
| 项目描述 | README.md 首段 | 企微客服管理系统后端 |
| 语言 | go.mod / package.json / requirements.txt / pom.xml | Go 1.24 |
| 框架 | import 分析 | Gin 1.9 |
| ORM | import 分析 | GORM + GORM Gen |
| 数据库 | import 分析 | MySQL 5.7 |
| 缓存 | import 分析 | Redis (go-redis v9) |
| 搜索 | import 分析 | Elasticsearch 9.x |
| 日志 | import 分析 | Zap |
| DI | import 分析 | Google Wire |

**语言检测后，生成对应的构建/测试/检查命令（示例以 Go 为例，其他语言同理）：**

| 语言 | BUILD_CMD | VET_CMD | TEST_CMD |
|------|-----------|---------|----------|
| Go | `go build ./...` | `go vet ./...` | `go test ./... -v -count=1` |
| Python | `python -m py_compile .` | `ruff check .` | `pytest -v` |
| Node.js | `npx tsc --noEmit` | `eslint .` | `npm test` |
| Rust | `cargo build` | `cargo clippy` | `cargo test` |
| Java | `mvn compile` / `gradle build` | `mvn checkstyle:check` / `gradle check` | `mvn test` / `gradle test` |

写入宪章 `{{BUILD_CMD}}`、`{{VET_CMD}}`、`{{TEST_CMD}}` 变量。

### Step 2: 深度分析源码

**2.1 提取错误处理模式**
- 搜索 `error`、`Error`、`err`、`throw`、`panic`、`Result`
- 分析错误处理模式（统一错误码？包装错误？）

**2.2 提取响应格式**
- 搜索 `Response`、`reply`、`json`、`Success`、`Error`
- 分析响应格式（统一结构？错误码体系？）

**2.3 提取日志模式**
- 搜索 `logger`、`log.`、`Info(`、`Error(`、`Debug(`
- 分析日志格式和用法

**2.4 提取 DI 模式**
- 搜索 `wire`、`inject`、`Provide`、`Autowired`、`NewXxx`
- 分析依赖注入方式

**2.5 提取数据库模式**
- 搜索 `gorm`、`sqlalchemy`、`prisma`、`db.`
- 分析数据访问层模式

**2.6 提取编码红线**
- 搜索常见的违规模式
- 从现有代码推断项目规范

### Step 3: 提取目录结构

分析项目目录结构，推断架构模式：

```
项目目录 → 架构分层映射
cmd/          → 入口程序
config/       → 配置管理
internal/
  controllers/ → 控制器层
  service/     → 业务逻辑层
  models/      → 数据模型层
  repository/  → 数据访问层
  middleware/  → 中间件
  routers/     → 路由定义
  utils/       → 工具函数
pkg/          → 公共工具包
```

### Step 4: 生成项目文件

**4.1 `.claude/memory/constitution.md`**（宪章）

从 `templates/constitution.md` 渲染，包含固定编码准则和项目专属原则：

```markdown
# 项目宪章

## 编码行为准则（固定）

1. 先思考，再编码
2. 极简优先
3. 精准手术
4. 目标驱动

## 核心原则（由扫描结果填充）

1. **{{ARCH_PRINCIPLE}}**：{{ARCH_DESC}}
2. **{{DI_PRINCIPLE}}**：{{DI_DESC}}
3. **{{CONFIG_PRINCIPLE}}**：{{CONFIG_DESC}}
4. **{{ERROR_PRINCIPLE}}**：{{ERROR_DESC}}
5. **{{CODEGEN_PRINCIPLE}}**：{{CODEGEN_DESC}}

## 技术栈
...
## 编码红线
...
```

**4.2 `.claude/rules/project-structure.md`**（工程结构）

从 `templates/project-structure.md` 渲染：

```markdown
# 工程结构约束

## 目录结构
{{DIRECTORY_TREE}}

## 架构模式
{{ARCH_PATTERN}}

## 编码红线
{{CODING_REDLINES}}

## 开发流程
{{DEV_FLOW}}
```

**4.3 `.claude/memory/MEMORY.md`**（记忆文件）

从 `templates/memory.md` 渲染，初始化为空模板。

**4.4 `.claude/templates/subagent-context.md`**（子 agent 上下文）

根据分析结果生成精简版项目约束。

### Step 5: 输出报告

```markdown
## 项目初始化报告

**项目名称：** {{PROJECT_NAME}}
**检测到的技术栈：** {{TECH_STACK_SUMMARY}}

### 已生成文件

| 文件 | 状态 | 说明 |
|------|------|------|
| .claude/memory/constitution.md | ✅ 已生成 | 项目宪章，5 项核心原则 |
| .claude/rules/project-structure.md | ✅ 已生成 | 工程结构约束 |
| .claude/memory/MEMORY.md | ✅ 已生成 | 记忆文件（空模板） |
| .claude/templates/subagent-context.md | ✅ 已生成 | 子 agent 精简上下文 |

### 需人工完善的 [TODO]

- [ ] constitution.md 中的「编码红线」需确认是否完整
- [ ] project-structure.md 中的「开发流程」需确认
- [ ] MEMORY.md 需在使用中逐步积累
```

## 模板变量

| 变量 | 来源 | 示例 |
|------|------|------|
| `{{PROJECT_NAME}}` | 目录名 / go module | wxServiceGo |
| `{{PROJECT_DESC}}` | README / 用户输入 | 企微客服管理系统后端 |
| `{{LANGUAGE}}` | go.mod / package.json | Go 1.24 |
| `{{WEB_FRAMEWORK}}` | import 分析 | Gin 1.9 |
| `{{ORM}}` | import 分析 | GORM + GORM Gen |
| `{{DATABASE}}` | import 分析 | MySQL 5.7 |
| `{{CACHE}}` | import 分析 | Redis |
| `{{LOGGING}}` | import 分析 | Zap |
| `{{DI}}` | import 分析 | Google Wire |
| `{{ARCH_PATTERN}}` | 目录结构推断 | Router→Controller→Service→Repository |
| `{{ENTRY_POINTS}}` | cmd/ / main.* 扫描 | cmd/server, cmd/queue |
| `{{TEST_CMD}}` | 语言检测 | go test ./... -v -count=1 |
| `{{BUILD_CMD}}` | 语言检测 | go build ./... |
| `{{VET_CMD}}` | 语言检测 | go vet ./... |
| `{{ERROR_PATTERN}}` | 源码分析 | errs.New(code, msg) |
| `{{RESPONSE_PATTERN}}` | 源码分析 | response.Backend***Response |
| `{{CODING_REDLINES}}` | 模式检测 + 默认 | 自动生成编码红线列表 |
| `{{LOGGING_PATTERN}}` | 源码分析 | logger.Info("描述", zap.String("key", value)) |
| `{{DI_PATTERN}}` | 源码分析 | Google Wire |
| `{{ARCH_PRINCIPLE}}` | 架构推断 | 分层架构 |
| `{{ARCH_DESC}}` | 架构推断 | Router→Controller→Service→Repository |
| `{{DI_PRINCIPLE}}` | DI 检测 | 依赖注入 |
| `{{DI_DESC}}` | DI 检测 | Google Wire 自动生成依赖图 |
| `{{CONFIG_PRINCIPLE}}` | 配置检测 | 配置外置 |
| `{{CONFIG_DESC}}` | 配置检测 | 环境变量 + 配置文件分离 |
| `{{ERROR_PRINCIPLE}}` | 错误处理检测 | 统一错误处理 |
| `{{ERROR_DESC}}` | 错误处理检测 | 统一错误码 + 包装错误 |
| `{{CODEGEN_PRINCIPLE}}` | 代码生成检测 | 代码生成 |
| `{{CODEGEN_DESC}}` | 代码生成检测 | GORM Gen 自动生成 Model |
| `{{CACHE_VERSION}}` | 版本检测 | go-redis v9 |
| `{{LOGGING_VERSION}}` | 版本检测 | Zap v1.27 |
| `{{DI_VERSION}}` | 版本检测 | Wire v0.6 |
| `{{DEV_FLOW}}` | 用户确认 | clone → branch → code → test → PR |
| `{{DIRECTORY_TREE}}` | 目录扫描 | 自动生成目录树 |
| `{{TECH_STACK_SUMMARY}}` | 汇总 | Go 1.24 + Gin + GORM + MySQL |

## 约束

- 已有配置文件时，必须提示用户确认是否覆盖
- 检测到不明确的信息时，使用 `[TODO]` 标记
- 生成的文件必须是完整可用的，不包含未渲染的模板变量
- 禁止修改任何业务代码

## 完成条件与下一步

初始化完成后：

1. 输出报告，列出已生成文件和需人工完善的 [TODO]
2. 提示用户检查并完善生成的文件
3. 后续可使用 `/rss-import-rules` 导入已有项目规则
