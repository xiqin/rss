# Step Catalog 完整说明

`workflow.yaml > step_catalog` 定义的可用步骤池。

所有 requires、outputs 和 gate verdict 都是相对 `specDir`（即 `specs/<date+feature>/`）的路径，不是项目根目录路径。

## 步骤列表

### brainstorming
- skill: `loom-brainstorming`
- requires: 无
- outputs: `spec.md`
- 跳过条件: 根因明确 + 改动范围已知

### planning
- skill: `loom-writing-plans`
- requires: `spec.md`
- outputs: `plan.md`, `tasks/`
- 跳过条件: 单文件改动 + 无架构影响

### git-worktree
- skill: `loom-using-git-worktrees`
- requires: `plan.md`
- outputs: 无（创建分支）
- 跳过条件: 已在 worktree 内 / 用户偏好直接改

### executing
- skill: `loom-subagent-driven-development`
- requires: `plan.md`, `tasks/`
- outputs: `test-report.md`
- gate_verdict: `test-report.md`
- **mandatory**: true（不可跳过）

### verification
- skill: `loom-verification-before-completion`
- requires: `test-report.md`
- outputs: `verify-report.md`
- gate_verdict: `verify-report.md`
- **mandatory**: true（不可跳过）

### synced
- skill: `loom-index-update`
- requires: `verify-report.md`
- outputs: 无
- 跳过条件: 图后端未启用 + 无记忆更新

## 依赖闭包

```
brainstorming → spec.md
     ↓
planning → plan.md, tasks/
     ↓
git-worktree（可选）
     ↓
executing → test-report.md
     ↓
verification → verify-report.md
     ↓
synced
```

选 executing 必须有 plan.md 和 tasks/，若不存在则自动补 planning（若无 spec.md 再补 brainstorming）。

## gate 位置

- `approved`：planning 之后，executing 之前（medium/high risk 必插）
- `test-report.md` verdict PASS：executing 出口
- `verify-report.md` verdict PASS：verification 出口
