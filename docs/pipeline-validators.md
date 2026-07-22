# 流水线验证器（Pipeline Validators）

## 概述

Loom 流水线用声明式 validator 替代"只看 PASS 文本"。每个阶段离开前，状态机运行一组确定性 validator；任一失败则阻断推进。validator 在 `templates/workflow.yaml` 的 step 上通过 `validators` 字段声明，也可由 `step_catalog` 或状态机隐式追加。

## validator 注册表

`src/core/pipeline-engine.js` 的 `ADVANCE_VALIDATORS` 注册表：

| validator id | 生效阶段 | 说明 |
|--------------|----------|------|
| `task-state-closure` | `executing` | 每个 `tasks/Tn.md` 都有对应 `task-states/Tn.state.json` 且 status 为 done，无多余/缺失 |
| `requirement-task-closure` | `executing` | `spec.md` 中每个 `REQ-xxx` 至少被一个 task frontmatter `requirements` 引用 |
| `planning-artifacts` | `planning` | `traceability.json` 存在，每个 REQ/behavior 至少映射到一个 task（tests/evidence 可空） |
| `verification-artifacts` | `verification`（显式声明） | `test-report.md`/`verify-report.md` PASS 覆盖每个 REQ，`requirements.json`/`traceability.json` 闭环，引用文件真实存在 |

## workflow.yaml 声明

feature / refactor 主线在对应 step 上显式声明：

```yaml
- id: planning
  validators: [planning-artifacts]
- id: executing
  validators: [task-state-closure, requirement-task-closure]
- id: verification
  validators: [verification-artifacts]
```

quickfix / chore / hotfix / bugfix 等轻量流程不在 verification 声明 `verification-artifacts`，避免无 spec/plan/test-report 的流程被 full validator 阻断。

`step_catalog` 也声明同样的 validators，由 `tests/templates.test.js` 的 `keeps step_catalog validators aligned with pipeline validators` 测试防漂移。

## 审批门禁

`approve()` 除常规检查外：

- `approval_requires`：human-approval gate 通过前必须存在的文件。feature/bugfix/refactor 的 `review-gate` 声明 `approval_requires: [review-feedback.md]`。
- `review-feedback.md` verdict 校验：必须 `verdict: PASS`，不能含 `BLOCKER` / `FAIL` / `CHANGES_REQUESTED` 等阻断标记。
- 审批指纹：`approvalArtifactPaths()` 收集审批时的关键 artifact sha256，写入 stage history。后续 `advance()` 通过 `checkApprovalFreshness` 检测变化并阻断。
- `APPROVAL_FINGERPRINT_EXCLUDES`：`traceability.json` 被排除，因为 executing 阶段允许合法更新该账本。

## handoff 指纹

`state-store.writeHandoff()` 记录 artifact 指纹用于检测 stale handoff。`MUTABLE_LEDGER_ARTIFACTS` 排除 `traceability.json`，避免执行期合法更新被误判为 stale。

## 产物校验脚本

| 脚本 | 说明 |
|------|------|
| `skills/loom-writing-plans/scripts/validate-plan.mjs` | plan/tasks/requirements/traceability 一致性；task `behavior_ids` 校验；依赖环；owns 冲突 |
| `skills/loom-verification-before-completion/scripts/verify-artifacts.mjs` | test-report/verify-report PASS + REQ 覆盖；requirements/traceability 闭环；引用文件存在 |
| `src/core/requirements.js` | requirements.json 生成/校验；behavior status 状态机 |
| `src/core/traceability.js` | traceability.json 生成/校验；REQ/behavior 级闭环；引用文件解析 |
| `src/core/implementation-packets.js` | implementation packet 生成/校验；stale 检测 |
| `src/core/receipts.js` | 结构化收据构建/写入/校验；git tree/commit 绑定 |
| `src/core/evaluators.js` | 并行 evaluator：requirements / architecture / security-test |

## 防漂移测试

| 测试 | 说明 |
|------|------|
| `tests/templates.test.js` | workflow 与 schema feature 状态/迁移一致；结构化账本产物；CLI scripts；step_catalog validators 对齐 |
| `tests/e2e/pipeline-flow.test.js` | 真实 workflow 端到端；负例覆盖 task state 缺失、REQ 未映射、traceability 缺失/引用不存在、审批失效、review-gate 空/阻断审批、planning traceability 缺映射、executing 合法更新 traceability |
| `tests/skills/workflow-scripts.test.js` | plan/verification/requirements/traceability/packet/receipt/evaluator 单元测试 |
| `tests/eval/false-pass-fixtures.test.js` | 10 个历史故障 fixture 回归基准 |

## CI 硬门槛

`npm test` 通过即 CI 硬门槛。任何负例 fixture 失败都会让 CI fail，防止 false PASS 进入主干。
