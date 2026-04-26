# 进度追踪规范（core/progress-tracker.md）

## progress.md

每个功能开发过程中，维护 `specs/<date+feature>/progress.md`，可视化流水线状态。

### 文件格式

```markdown
# <功能名> — 开发流水线

**开始时间：** YYYY-MM-DD HH:mm
**当前阶段：** Step N/5

| Step | 阶段 | 状态 | 开始时间 | 完成时间 | 备注 |
|------|------|------|---------|---------|------|
| 1 | brainstorming | ✅ 完成 | HH:mm | HH:mm | |
| 2 | writing-plans | ✅ 完成 | HH:mm | HH:mm | |
| 3 | git-worktree | ✅ 完成 | HH:mm | HH:mm | 分支: feature/xxx |
| 4 | subagent-dev | ▶ 进行中 | HH:mm | — | task 3/8 |
| 5 | index-update | ⏳ 等待 | — | — | |

## Skill 调用记录

| 时间 | Skill | 触发原因 | 结果 |
|------|-------|---------|------|
| HH:mm | brainstorming | 用户提出需求 | ✅ 已完成 |
| HH:mm | writing-plans | 设计确认，开始拆 plan | ✅ 已完成 |
| HH:mm | subagent-dev | plan 确认，开始编码 | ▶ 执行中 |
```

### 状态值

| 状态 | 含义 |
|------|------|
| ⏳ 等待 | 尚未开始 |
| ▶ 进行中 | 正在执行 |
| ✅ 完成 | 已完成 |
| ❌ 失败 | 执行失败 |

### 更新规则

- 每个 skill 开始执行时：更新对应行状态为 `▶ 进行中`，填写开始时间
- 每个 skill 执行结束时：更新状态为 `✅ 完成`，填写完成时间
- 在 Skill 调用记录中追加一行
- 如果某步骤失败：状态改为 `❌ 失败`，备注写失败原因

### 进度条（状态横幅中使用）

```
■■■■□  Step 4/5 进行中
■■■■■  Step 5/5 完成
```
