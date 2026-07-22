# Step Catalog 完整说明

`workflow.yaml > step_catalog` 定义的可用步骤池。

所有 requires、outputs 和 gate verdict 都是相对 `specDir`（即 `specs/<date+feature>/`）的路径，不是项目根目录路径。

## 步骤列表

### brainstorming
- skill: `loom-brainstorming`
- requires: 无
- outputs: `spec.md`, `requirements.json`, `handoffs/brainstorming.json`
- 跳过条件: 根因明确 + 改动范围已知

### detail-expansion
- skill: `loom-detail-expansion`
- requires: `spec.md`, `requirements.json`
- outputs: `requirements.json`, `handoffs/detail-expansion.json`
- validators: `detail-expansion-pass`
- **mandatory**: true（有 spec/requirements.json 时不可跳过）
- 跳过条件: 无 spec/requirements.json（如纯配置类 quickfix/chore）
- 作用: 按 15 固定维度把 `requirements.json` 中的 REQ 展开为可独立验证的 Behavior Obligation，补齐 `test_plan` 与 `applicability`；requires-clarification 残留时阻断

### planning
- skill: `loom-writing-plans`
- requires: `spec.md`, `requirements.json`
- outputs: `plan.md`, `tasks/`, `traceability.json`, `handoffs/planning.json`
- validators: `planning-artifacts`
- 跳过条件: 单文件改动 + 无架构影响

### analyze-artifacts
- skill: `loom-analyze-artifacts`
- requires: `spec.md`, `requirements.json`, `plan.md`, `tasks/`, `traceability.json`
- outputs: `handoffs/analyze-artifacts.json`（`artifact-analysis.json` 由 validator 生成，不要求 advance 前预先存在）
- validators: `artifact-analysis-pass`
- **mandatory**: true（有 spec/requirements.json 时不可跳过）
- 跳过条件: 无 spec/requirements.json 的轻量流程
- 作用: planning 后审批前跨产物一致性只读分析（15 项维度），输出 `artifact-analysis.json`，blocker findings 阻断 approved gate

### git-worktree
- skill: `loom-using-git-worktrees`
- requires: `plan.md`, `traceability.json`
- outputs: 无（创建分支）
- 跳过条件: 已在 worktree 内 / 用户偏好直接改

### executing
- skill: `loom-subagent-driven-development`
- requires: `plan.md`, `tasks/`, `traceability.json`
- outputs: `test-report.md`, `traceability.json`, `handoffs/executing.json`
- gate_verdict: `test-report.md`
- validators: `task-state-closure`, `requirement-task-closure`
- **mandatory**: true（不可跳过）

### converge
- skill: `loom-converge`
- requires: `spec.md`, `requirements.json`, `plan.md`, `tasks/`, `traceability.json`, `test-report.md`
- outputs: `handoffs/converge.json`（`convergence-report.json` 由 validator 生成；`findings/` 仅在触发 omission-hunter 时产生）
- validators: `convergence-pass`
- **mandatory**: true（有 spec/requirements.json 时不可跳过）
- 跳过条件: 无 spec/requirements.json 的轻量流程
- 作用: executing 后 verification 前对照意图清单，把 missing/partial/contradicts 生成新 task 回流 executing，直到收敛；内部可触发 `loom-omission-hunter` 做对抗式审查

### omission-hunter（converge 内部调用，非独立 pipeline step）
- skill: `loom-omission-hunter`
- 作用: 只读对抗式审查，从 behavior 反查"应该存在但不存在"的代码/测试/预期副作用/禁止副作用/失败场景/公共 API 变更/不变量保护/可观测性。输出 `findings/omission-hunter.json`，blocker 回流到 converge

### verification
- skill: `loom-verification-before-completion`
- requires: `test-report.md`, `traceability.json`, `convergence-report.json`
- outputs: `verify-report.md`, `handoffs/verification.json`
- gate_verdict: `verify-report.md`
- validators: `verification-artifacts`
- **mandatory**: true（不可跳过）

### synced
- skill: `loom-index-update`
- requires: `verify-report.md`
- outputs: 无
- 跳过条件: 图后端未启用 + 无记忆更新

### code-review-request / review-gate / code-review-response
- skill: `loom-requesting-code-review` / (human-approval gate) / `loom-receiving-code-review`
- requires: `verify-report.md` → `review-request.md` → `review-feedback.md`
- outputs: `review-request.md` → (gate) → `review-response.md`

## 依赖闭包

```
brainstorming → spec.md, requirements.json
      ↓
detail-expansion → requirements.json（补齐 behaviors）
      ↓
planning → plan.md, tasks/, traceability.json
      ↓
analyze-artifacts → artifact-analysis.json（validator 生成）
      ↓
[approved gate]
      ↓
git-worktree（可选）
      ↓
executing → test-report.md
      ↓
converge → convergence-report.json（validator 生成；findings/ 按需）
      ↓
verification → verify-report.md
      ↓
synced
```

选 executing 必须有 plan.md 和 tasks/，若不存在则自动补 planning（若无 spec.md 再补 brainstorming，无 requirements.json 补 detail-expansion）。
选 analyze-artifacts 必须有 plan.md + tasks/ + traceability.json，自动补 planning。
选 converge 必须有 test-report.md，自动补 executing。

## gate 位置

- `approved`：analyze-artifacts 之后，git-worktree/executing 之前（medium/high risk 必插）
- `detail-expansion-pass` validator：detail-expansion 出口（behavior 清单完整性）
- `artifact-analysis-pass` validator：analyze-artifacts 出口（跨产物一致性，blocker=0）
- `test-report.md` verdict PASS：executing 出口
- `convergence-pass` validator：converge 出口（意图清单收敛，blocker=0）
- `verify-report.md` verdict PASS：verification 出口
- `review-gate`：code-review-request 之后，code-review-response 之前

## validator 列表

| validator | 作用阶段 | 检查内容 |
|-----------|---------|---------|
| `planning-artifacts` | planning | traceability.json 每个 REQ/behavior 映射到 task |
| `detail-expansion-pass` | detail-expansion | 15 维度覆盖、test_plan 非空、无 requires-clarification 残留 |
| `artifact-analysis-pass` | analyze-artifacts | 跨产物一致性 15 项检查，blocker=0 |
| `task-state-closure` | executing | 每个 tasks/Tn.md 有对应 task-states/Tn.state.json 且 status=done |
| `requirement-task-closure` | executing | spec.md 每个 REQ-xxx 至少出现在一个 task 的 frontmatter |
| `convergence-pass` | converge | 意图清单收敛，missing/partial 的 behavior 已补齐 tests/evidence |
| `verification-artifacts` | verification | 测试报告/证据/REQ 覆盖一致 |
