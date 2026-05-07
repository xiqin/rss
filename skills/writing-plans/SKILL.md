---
name: writing-plans
description: >
  拆解实现计划。当有 spec 设计文档后，拆分为可执行的 task 列表。
  Use when: a spec design document exists and needs to be broken into bite-sized implementation tasks.
---

# 实现计划拆解

## 触发条件

- brainstorming 完成，`specs/<date+feature>/spec.md` 已存在
- 用户确认设计方案后自动触发

## 状态输出

执行开始时：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■□□□] Step 2/5 — 计划拆解 (writing-plans)
 skill:   writing-plans
 功能:    <功能名>
 status:  ▶ 开始执行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

执行结束时：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■□□□] Step 2/5 — 计划拆解 (writing-plans)
 status:  ✅ 完成 (N 个 task)
 下一步:  等待用户确认 → Step 3: git-worktree
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 输出路径

保存到 `specs/<date+feature>/plan.md`。

## 执行流程

### Step 1：读取 spec

读取 `specs/<date+feature>/spec.md`，提取所有功能点、接口定义、数据模型。

### Step 2：读取项目约束

1. 读取 `.claude/memory/constitution.md`（宪章）
2. 读取 `.claude/rules/project-structure.md`（工程结构）
3. 如果存在 `.claude/templates/subagent-context.md`，读取它用于后续 task 上下文

### Step 3：按分层拆分 task

**读取 `.claude/rules/project-structure.md` 中定义的架构分层，按依赖顺序（底层→上层）拆分 task：**

#### 层级 1：数据模型层 task
- 新建/修改业务数据模型
- 数据访问方法

#### 层级 2：业务逻辑层 task
- 新建/修改业务逻辑服务
- 包含校验、流程编排

#### 层级 3：接口层 task
- 新建/修改接口处理
- 只做参数绑定 + 调用业务逻辑 + 返回响应

#### 层级 4：路由层 task
- 新建/修改路由
- 按项目路由注册规范注册

#### 层级 5：配置/其他 task
- 新增配置项
- 数据库 DDL 脚本
- 契约文档

### Step 4：为每个 task 编写详细内容

**每个 task 必须包含以下全部字段，禁止省略：**

```markdown
### Task N: <功能点名称>

- **层级**: 数据模型层 / 业务逻辑层 / 接口层 / 路由层 / 配置
- **复杂度**: 简单 / 中等 / 复杂
- **依赖**: Task X, Task Y（无则写"无"）
- **涉及文件**:
  - 创建: `path/to/new/file.<ext>`
  - 修改: `path/to/existing/file.<ext>`（在具体位置添加方法）
- **实现步骤**:
  1. 在 `path/to/file.<ext>` 中创建结构体/类（按项目语言编写具体代码，无占位符）
  2. 添加方法（按项目语言编写具体代码）
- **单元测试**:
  - 测试文件: `path/to/file_test.<ext>`
  - 测试用例:（按项目语言编写具体测试代码）
- **验证命令**:
  ```bash
  <TEST_CMD 对应的单文件测试命令>
  ```
- **commit**: `feat(xxx): <描述>`
```

### Step 5：检查清单

输出 plan 后，自检：
- [ ] 所有 task 的依赖关系无循环
- [ ] 每个 task 可独立编译验证
- [ ] 代码示例可直接复制运行（无占位符）
- [ ] 分层顺序正确（按 project-structure.md 定义的依赖顺序，从底层到上层）
- [ ] 遵守编码红线（读取 constitution.md，无违反）

## 编码红线（task 中绝对禁止）

**读取 `.claude/memory/constitution.md` 中的编码红线，以下为通用红线（项目宪章可能有额外条目）：**

1. 在接口层中写业务逻辑
2. 使用语言默认的调试打印——必须用项目日志组件
3. 硬编码配置值（密码、密钥、URL）
4. 手写 SQL 拼接（必须参数化）
5. 修改自动生成的代码文件
6. 手动修改依赖注入生成文件

## 技术上下文（task 中必须参考）

从宪章和工程结构中提取：
- **测试基础设施**：如何获取测试 Repository
- **响应格式**：项目统一响应格式
- **错误处理**：项目统一错误处理
- **缓存**：缓存使用方式
- **日志**：日志使用方式
- **分页**：分页查询方式
- **路由注册**：路由注册方式
- **配置**：配置管理方式

## 完成条件与下一步

plan.md 保存完毕后，同时更新 `specs/<date+feature>/progress.md`，**等待用户确认 plan**。

用户确认后，**必须立即触发 git-worktree**（using-git-worktrees skill）。
