# 工程结构约束

> 本文件由 `/rss-init-project` 自动生成，请根据项目实际情况完善。

## 目录结构

```
{{DIRECTORY_TREE}}
```

## 架构模式

```
{{ARCH_PATTERN}}
```

- Controller：{{CONTROLLER_DESC}}
- Service：{{SERVICE_DESC}}
- Repository：{{REPOSITORY_DESC}}
- 依赖单向流动，禁止循环依赖

## 编码红线

> 以下红线为自动生成，请确认并补充。

{{CODING_REDLINES}}

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| {{LANGUAGE}} | {{LANGUAGE_VERSION}} | 编程语言 |
| {{WEB_FRAMEWORK}} | {{FRAMEWORK_VERSION}} | Web 框架 |
| {{ORM}} | {{ORM_VERSION}} | ORM |
| {{DATABASE}} | {{DATABASE_VERSION}} | 数据库 |
| {{CACHE}} | {{CACHE_VERSION}} | 缓存 |
| {{LOGGING}} | {{LOGGING_VERSION}} | 日志 |
| {{DI}} | {{DI_VERSION}} | 依赖注入 |

## 开发流程（硬性约束）

**任何新增功能或接口，必须严格按以下顺序执行：**

### 第一步：需求设计（brainstorming）
- 头脑风暴设计方案
- 产出 `specs/<date+feature>/spec.md`

### 第二步：计划拆解（writing-plans）
- 按分层拆分 task
- 产出 `specs/<date+feature>/plan.md`

### 第三步：环境隔离（git-worktree）
- 创建隔离分支

### 第四步：编码执行（subagent-dev）
- Subagent 隔离派发 + 双审查

### 第五步：索引更新（index-update）
- 同步工程索引

## 编码要求

- Controller 仅处理 HTTP 请求解析和响应，禁止写业务逻辑
- 错误必须使用项目统一错误处理
- 日志必须使用项目日志组件
- 新增配置项必须同时添加到配置结构体和配置文件
- 分页查询使用项目分页组件
- 缓存使用项目缓存组件
