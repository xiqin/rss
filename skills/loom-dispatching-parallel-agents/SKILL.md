---
name: loom-dispatching-parallel-agents
description: >
  Dispatch multiple independent tasks to parallel subagents when no shared file conflicts exist.
  Use when: a confirmed plan has independent tasks that can run concurrently without touching shared files.
---

# 并行派发

## 适用场景

当多个任务之间没有依赖关系时，可以并行执行以提高效率。

**限制条件：** 仅当多个 task 之间**无依赖、无共享文件修改**时才可并行。若 task 间有文件冲突，必须退回到 loom-subagent-driven-development 的串行模式。

**模型选择：** 并行任务通常使用便宜模型（cheap model），因为它们大多是机械实现任务。

**会话边界：** 每个并行任务必须使用独立 fresh subagent。派发前必须有确认过的 task 边界和必要 handoff；不要把主会话原始上下文复制给所有 subagent。

## 执行流程

### Step 1：分析任务依赖

1. 读取 `specs/<date+feature>/plan.md` 中的 Task 概览，读取 `specs/<date+feature>/tasks/` 目录下的各 task 文件
2. 分析任务之间的依赖关系
3. 找出可并行的任务组

```markdown
## 依赖关系分析

| Task                 | 依赖      | 可并行组 | 复杂度 |
| -------------------- | --------- | -------- | ------ |
| Task 1 (Module A)    | 无        | 组 1     | 简单   |
| Task 2 (Module B)    | 无        | 组 1     | 简单   |
| Task 3 (Module C)    | Task 1    | 组 2     | 中等   |
| Task 4 (Module D)    | Task 2    | 组 2     | 中等   |
| Task 5 (Integration) | Task 3, 4 | 组 3     | 复杂   |
```

### Step 2：创建并行组

将可并行的任务分组：

```
组 1: [Task 1, Task 2] → 并行执行（使用 cheap model）
组 2: [Task 3, Task 4] → 等组 1 完成后并行执行（使用 standard model）
组 3: [Task 5] → 等组 2 完成后执行（使用 capable model）
```

### Step 3：并行派发

对同一组的任务，同时派发 subagent：

```
派发 Task 1 subagent (cheap) ──→ ┐
                                  ├→ 全部完成后进入组 2
派发 Task 2 subagent (cheap) ──→ ┘
```

模型选择：并行任务通常使用便宜模型（机械实现），集成/复杂任务使用标准/强模型。

## 并行派发模板

```
并行派发以下独立任务（使用 cheap model）：

## Task N: <任务名>
<完整 task 内容>

## Task M: <任务名>
<完整 task 内容>

## 约束
- 每个 subagent 独立工作，互不干扰
- 如发现与其他任务有冲突，立即报告
- 完成后输出创建/修改的文件列表
- 使用 cheap model（除非任务复杂）
```

## 约束

- 只有真正独立的任务才能并行
- 并行任务不能修改同一文件
- 必须等待所有并行 subagent 完成后才能继续
- 并行任务的结果需要合并验证
- 根据任务复杂度选择模型（cheap/standard/capable）
- 每个并行 subagent 只接收自己的 task、必要 spec 片段、subagent-context 和相关 handoff
