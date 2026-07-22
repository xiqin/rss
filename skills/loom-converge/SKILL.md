---
name: loom-converge
description: >
  After implementation and before final verification, compare current code/tests against the intent inventory
  (requirements.json + traceability.json). Classify each requirement/behavior as covered, missing, partial,
  contradicts, or unrequested. Append missing/partial/contradicts as new tasks back to executing. Repeat until
  converged: zero blocker findings. Outputs convergence-report.json. Use when: executing produced test-report.md
  but before loom-verification-before-completion.
when_to_use: After executing test-reporter PASS and before verification, to catch implementation drift.
argument-hint: <spec directory containing requirements.json, traceability.json, plan.md, tasks/>
user-invocable: true
---

# 收敛（converge）

## 触发条件

- `executing` 阶段已产出 `test-report.md` 且 verdict 为 PASS。
- 即将进入 `verification`，但尚未把代码事实对照意图清单做收敛。
- `requirements.json` 与 `traceability.json` 存在。

## 非触发条件

- `test-report.md` 仍为 FAIL 或未产出。
- quickfix / chore 等无 spec 的流程。

## 执行流程

### Step 1：运行收敛

调用 loom MCP 工具 `loom_converge`（参数 `spec_dir`、`round`）。

工具读取 `requirements.json`、`traceability.json`，对每个 behavior 分类为 covered/missing/partial/contradicts/unrequested，输出 `convergence-report.json`。返回 `ok:false` 表示有 blocker（missing/contradicts），需要回流 executing。

> 说明：`scripts/converge.mjs` 是该工具的实现，运行在 loom MCP 服务器进程内。不要在用户项目里用 `node skills/...` 调用（部署后路径会断裂）。

### Step 2：逐 behavior 分类

对每个 `REQ-xxx-Bnn` behavior，依据 `traceability.json` 的 `tests`/`evidence` 与实际代码/测试文件，分类为：

- `covered`：tests 引用真实存在的测试文件，且 evidence 引用真实日志，且 behavior 的 acceptance 被测试覆盖。
- `missing`：traceability 中无 tests 或 evidence，或引用文件不存在。
- `partial`：有 tests 但未覆盖 acceptance 全部分支（例如只测 happy-path，未测 invalid-input）。
- `contradicts`：实现与 spec/requirements 描述冲突，或测试断言与 acceptance 相反。
- `unrequested`：代码中实现了 `requirements.json` 没有声明的行为或公开 API 变更。

### Step 3：生成 findings

每个 `missing` / `partial` / `contradicts` / `unrequested` 生成一条 finding：

```json
{
  "id": "F-conv-001",
  "kind": "missing",
  "severity": "blocker",
  "message": "REQ-001-B03 (authorization) has no test reference in traceability.json",
  "requirement_id": "REQ-001",
  "behavior_id": "REQ-001-B03",
  "artifact": "traceability.json",
  "suggested_fix": { "action": "create_task", "details": "add task T2 to implement authorization test for REQ-001-B03" }
}
```

### Step 4：追加新 task 回流

对所有 `missing` / `partial` / `contradicts`，生成新 task 文件 `tasks/T*.md`，frontmatter 包含：

- `requirements`: 对应 `REQ-xxx`
- `behavior_ids`: 对应 `REQ-xxx-Bnn`
- `owns`: 建议修改的文件（从 finding 的 location 或现有代码推断）
- `depends_on`: 依赖的原 task

把新 task 追加到 `plan.md` 的 task 表。更新 `traceability.json` 把新 task 加入对应 behavior 的 `tasks`。

### Step 5：更新 `convergence-report.json`

```json
{
  "stage": "converge",
  "round": 1,
  "status": "converged|needs_another_round",
  "classification": {
    "REQ-001-B01": "covered",
    "REQ-001-B02": "covered",
    "REQ-001-B03": "missing"
  },
  "findings": ["..."],
  "new_tasks": ["T2", "T3"],
  "coverage": {
    "behavior_coverage": "67%",
    "acceptance_coverage": "55%"
  },
  "created_at": "2026-07-20T18:30:00Z"
}
```

### Step 6：回流判定

- 若存在任何 `blocker` finding（`missing` / `contradicts`）：状态为 `needs_another_round`，状态机不允许进入 `verification`；回到 `executing` 处理新 task。
- 若只有 `partial` 且用户显式接受：可标记 `accepted_partial` 并进入 verification，但必须在报告中记录。
- 若全部 `covered` 且无 `unrequested` blocker：状态为 `converged`，允许进入 verification。

### Step 7：迭代

回到 `executing` 实现新 task 后，重新运行 `loom-converge`。每轮 `round` 递增。建议最多 3 轮；超过 3 轮未收敛时 escalate。

## 产物根目录

`convergence-report.json` 写入 `specs/<date+feature>/`。新 task 写入 `specs/<date+feature>/tasks/`。

## 约束

- 不得删除或修改 `requirements.json` 中已确认的 behavior；只能追加 task。
- 不得用"代码看起来覆盖了"作为 covered 判定；必须有 tests + evidence 引用真实文件。
- `unrequested` 若涉及必要的基础设施或重构，可降级为 `info`，但必须在报告中说明。
- 每轮 converge 必须记录 round 号与 findings 变化，便于审计。
- 新 task 不得复用已有 T 号；递增分配。

## 完成条件

- `convergence-report.json` 状态为 `converged`，无 blocker findings。
- 所有 behavior 分类为 `covered` 或显式接受的 `partial`。
- 无 `contradicts` 残留。
- handoff 记录收敛轮次与最终 coverage。
