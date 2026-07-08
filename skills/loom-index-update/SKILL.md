---
name: loom-index-update
description: >
  Synchronize codegraph index, structured memory, and entry docs with code after verification passes.
  Use when: verified code changes need codegraph sync, memory updates, or entry documentation refresh.
when_to_use: Sync codegraph, structured memory, and entry docs after verified code changes.
argument-hint: <spec_dir or sync scope>
user-invocable: true
---

# codegraph 与记忆同步 Skill

## 触发条件

- 功能测试和 completion verification 通过后自动触发。
- 用户手动要求同步 codegraph、更新记忆或更新文档。

## 前置条件

1. 代码变更已完成。
2. `loom-verification-before-completion` 已通过，或用户明确要求只同步 codegraph/记忆。

## 执行流程

### Step 1：检测变更范围

1. 运行 `git diff --name-only HEAD` 确认变更文件。
2. 按 `references/update-checklist.md` 判断是否需要同步 codegraph 或结构化记忆。

### Step 2：同步 codegraph

检测到 codegraph（`.codegraph/` 存在或 CLI 在 PATH）时，`loom index` 委派给它；codegraph 不可用时跳过图索引同步：

```bash
loom index            # 同步 codegraph；无 codegraph 时跳过
loom index --check    # 检查 codegraph 状态；无 codegraph 时跳过
```

**codegraph 可用**时，AI 直接通过 MCP 工具按需查询：

```bash
codegraph init        # 仅首次：项目内尚无 .codegraph/ 时建图（loom init-project 已自动执行）
```

codegraph 基于 tree-sitter AST 解析，提取符号、路由、调用链并存入 SQLite，通过 MCP 实时查询：

- `codegraph_search` — 按名称搜索符号
- `codegraph_context` — 查询符号上下文
- `codegraph_trace` / `codegraph_callers` / `codegraph_callees` — 查询调用链
- `codegraph_impact` — 确认改动影响半径
- `codegraph_files` / `codegraph_explore` — 查询模块结构

codegraph 不可用时，在报告中注明“未启用 codegraph，图索引同步跳过”。

### Step 3：更新结构化 Memory

Memory 的单一真实来源是 `.loom/memory/store.json`。`MEMORY.md` 是 `loom memory export` 生成的只读视图，**禁止手动编辑 `MEMORY.md`**。

**判断写入目标：**

| 内容类型                                      | 写入方式                                                             |
| --------------------------------------------- | -------------------------------------------------------------------- |
| 本次会话的关键结论（决策/踩坑/偏好/状态变更） | `loom_add_memory` 或 `loom memory add --type <类型> --content "..."` |
| 技术选型、架构决定，需要保留背景和原因        | `type=adr`，`context` 写背景和原因                                   |
| 实际遇到的坑，含根因和解决方式                | `type=踩坑`，content 写“问题 + 根因 + 解决方式”                      |
| 用户明确表达的工作习惯、风格偏好、禁止事项    | `type=偏好`                                                          |
| 技术栈或当前阶段变化                          | `type=状态`                                                          |
| 本次会话有重要内容需要归档                    | `loom memory archive --slug <slug> --file <session.md>`              |

**命令示例：**

```
loom memory add --type 决策 --content "选择 codegraph 作为唯一图索引后端"
loom memory export
```

**会话归档规则：**

- 触发条件：本次会话产生 2 条以上重要内容，或单条内容较长（>200 字）。
- 通过 `loom memory archive --slug <feature-slug> --file <session.md>` 写入归档。
- 需要提交导出视图时运行 `loom memory export`。

**不写入的情况：**

- 一般性代码变更（无决策、无踩坑、无偏好变化）→ 不更新 memory。
- 临时调试信息、过程性日志 → 不写入。

### Step 4：必要时更新入口文件

只有引入新约定、新命令、入口程序变化或开发流程调整时，才更新入口文件。一般性代码变更不更新。

### Step 5：输出报告

报告模板见：

- `assets/report-codegraph-template.md`（路径 A）
- `assets/report-manual-template.md`（路径 B）

## 约束

- 只同步 codegraph 和记忆文件，不修改业务代码。
- codegraph 查询结果必须与实际代码一致。
- 新增表名、路由路径、方法签名必须与源码完全一致。
- 统一调 `loom index`；无 codegraph 时跳过，不生成任何 Markdown 索引。

## 完成条件

同步完成后输出报告；codegraph 不可用时必须明确注明已跳过。
