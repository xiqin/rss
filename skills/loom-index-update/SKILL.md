---
name: loom-index-update
description: >
  Synchronize graph backend index, structured memory, and entry docs with code after verification passes.
  Use when: verified code changes need graph index sync, memory updates, or entry documentation refresh.
when_to_use: Sync graph backend, structured memory, and entry docs after verified code changes.
argument-hint: <spec_dir or sync scope>
user-invocable: true
---

# 图后端与记忆同步 Skill

## 触发条件

- 功能测试和 completion verification 通过后自动触发。
- 用户手动要求同步图后端、更新记忆或更新文档。

## 前置条件

1. 代码变更已完成。
2. `loom-verification-before-completion` 已通过，或用户明确要求只同步图后端/记忆。

## 执行流程

### Step 1：检测变更范围

1. 运行 `git diff --name-only HEAD` 确认变更文件。
2. 按 `references/update-checklist.md` 判断是否需要同步图后端或结构化记忆。

### Step 2：同步图后端

先读取 `.loom/graph.config.json` 确认当前图后端；配置不存在时默认 codegraph（向后兼容）。

```bash
loom index            # 同步当前图后端；后端不可用时跳过
loom index --check    # 检查图后端状态；后端不可用时跳过
```

**图后端可用**时，AI 通过 loom 暴露的固定 MCP 工具按需查询（不直接调用后端专属工具名）：

- `loom_graph_status` — 查询后端能力、新鲜度和可用性
- `loom_graph_query` — 统一图查询入口（capability：explore / definition / references / impact 等）
- `loom_graph_sync` — 同步或检查索引

> 当后端是 codegraph 时，`loom_graph_*` 内部委派给 `codegraph_explore` 等 MCP 工具；AI 不需要也不应该直接引用 `codegraph_*` 工具名。

图后端不可用（后端为 `none`、marker 不存在或 `freshness=unavailable`）时，在报告中注明“图后端不可用，图索引同步跳过”，不中断流水线。

**降级规则**：

- 后端不支持 `impact` 时，用 `references`、`explore` 或源码搜索降级，并报告“影响范围可能不完整”。
- 后端 `freshness` 不是 `fresh` 时，不得直接把其结论作为阻断判断依据，需用当前源码和 git diff 校验关键结论。
- 后端类型是 `knowledge-base` 时，不得用于精确调用链或 breaking change 影响范围判断。

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
loom memory add --type 决策 --content "选择 codegraph 作为默认图后端"
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

- `assets/report-graph-template.md`（图后端可用，路径 A）
- `assets/report-no-graph-template.md`（图后端不可用，路径 B）

## 约束

- 只同步图后端和记忆文件，不修改业务代码。
- 图后端查询结果必须与实际代码一致；`freshness` 不是 `fresh` 时以源码为准。
- 新增表名、路由路径、方法签名必须与源码完全一致。
- 统一调 `loom index`；图后端不可用时跳过，不生成任何 Markdown 索引。

## 完成条件

同步完成后输出报告；图后端不可用时必须明确注明已跳过。
