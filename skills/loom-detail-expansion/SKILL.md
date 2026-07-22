---
name: loom-detail-expansion
description: >
  Expand each requirement into verifiable Behavior Obligations across 15 fixed dimensions (happy-path, boundary,
  invalid-input, authorization, state-transition, idempotency, concurrency, atomicity, external-failure,
  compatibility, security, performance, observability, recovery, forbidden-behavior) before planning.
  Use when: brainstorming produced requirements.json and spec is approved, but behaviors are still placeholders
  or only happy-path; before loom-writing-plans.
when_to_use: After brainstorming approval and before planning, when requirements.json behaviors are incomplete
  or do not cover the required dimensions for each REQ type.
argument-hint: <spec directory containing spec.md and requirements.json>
user-invocable: true
---

# 行为义务展开（detail-expansion）

## 触发条件

- `specs/<date+feature>/spec.md` 与 `specs/<date+feature>/requirements.json` 已存在并经用户批准。
- `requirements.json` 中某些 REQ 的 `behaviors` 仍为默认 `REQ-xxx-B01`（happy-path 占位），未按需求 `types` 覆盖全部必需维度。
- 即将进入 `loom-writing-plans`，需要先把每个 REQ 拆成可独立验证、可分配到 task 的行为义务。

## 非触发条件

- `requirements.json` 已显式覆盖每个 REQ 的所有 `required_categories`，且每个 behavior 都有具体 `description` 与 `acceptance`。
- quickfix / chore / hotfix 等无 spec 的轻量流程。

## 执行流程

### Step 0：运行校验

调用 loom MCP 工具 `loom_detail_expansion_check`（参数 `spec_dir`）。

工具会读取 `requirements.json`，对每个 REQ 检查：所有 `required_categories` 都有对应 behavior、每个 behavior 有 `test_plan`、无 `requires-clarification` 残留、description 非占位文案。返回 `ok:false` 表示有缺口需要补齐。

> 说明：`scripts/check-detail-expansion.mjs` 是该工具的实现，运行在 loom MCP 服务器进程内，可直接 import loom 仓库的 core 模块。不要在用户项目里用 `node skills/...` 调用（部署后路径会断裂）。

### Step 1：读取现有账本

读取 `specs/<date+feature>/spec.md`、`specs/<date+feature>/requirements.json`、必要时的 `specs/<date+feature>/handoffs/brainstorming.json`。禁止重新展开用户已显式确定的 behavior；只补充缺失维度或细化占位 description。

### Step 2：按需求类型确定必需维度

对每个 REQ，根据其 `types` 与 `required_categories`，合并出必须覆盖的 `category` 集合：

- `functional` → `happy-path`
- `input` → `invalid-input`
- `authorization` / `auth` → `authorization`
- `write` / `mutation` → `atomicity`
- `state` → `state-transition`
- `idempotent` → `idempotency`
- `concurrent` → `concurrency`
- `external` → `external-failure`
- `security` → `security`
- `performance` → `performance`
- `observable` → `observability`
- `recovery` → `recovery`
- `forbidden-behavior`：所有涉及写、权限、外部副作用或旧 API 的 REQ 都应额外考虑一个 `forbidden-behavior` 维度，用于"不应发生"的负空间。

### Step 3：逐维度展开 Behavior Obligation

对每个必需维度，若 `requirements.json` 中没有对应 `category` 的 behavior，追加新的 `REQ-xxx-Bnn`：

- `id`：递增 `Bnn`，保持 `REQ-xxx-Bnn` 格式。
- `category`：固定维度之一。
- `description`：具体到可被代码实现与测试验证的单一行为。禁止"系统应正常"、"接口应稳定"等模糊描述。
- `status`：初始 `failing`。
- `acceptance`：可测量、可观察的验收项列表。每个 acceptance 必须可由一个或多个测试用例证明，例如：
  - 正常路径：输入 X 时返回 Y，状态 Z 为 W。
  - 边界：输入 N-1/0/N 时分别返回 A/B/C。
  - 幂等：同一请求重复调用 K 次，副作用计数为 1。
  - 失败回滚：外部依赖超时后，已写入的部分记录被回滚，数据库无脏数据。

### Step 4：为每个 Behavior 标注 `applicability`

每个必需维度必须显式标注：

- `applicable`：已生成 behavior。
- `not-applicable`：明确说明为何不适用，例如"本 REQ 只读取公开数据，无权限维度"。
- `requires-clarification`：阻塞 planning，必须回到 brainstorming 或询问用户澄清。

`requires-clarification` 的 behavior 不得进入 planning。状态机层面由 `loom-analyze-artifacts` 在 planning 前阻断。

### Step 5：补齐 `test_plan` 占位

为每个 behavior 写最小 `test_plan`：

```json
{
  "id": "REQ-001-B02",
  "category": "invalid-input",
  "test_plan": {
    "strategy": "property-based + boundary value",
    "inputs": ["empty string", "max length +1", "non-utf8"],
    "expected": ["400 Bad Request", "400 Bad Request", "400 Bad Request"],
    "coverage_target": "100% branches of validateInput"
  }
}
```

没有 `test_plan` 的 behavior 不得进入 planning。

### Step 6：更新 `requirements.json`

把展开后的 behavior 写回 `specs/<date+feature>/requirements.json`。不允许删除用户已显式确认的 behavior；只能追加或细化。

### Step 7：自审

- 每个 REQ 的 `required_categories` 都有对应 behavior，或显式标注 `not-applicable`。
- 每个 behavior 的 `description` 可被一个 task 实现、可被一个测试验证。
- 没有 `requires-clarification` 残留。
- 每个 behavior 有非空 `test_plan`。

### Step 8：交接

写入 `specs/<date+feature>/handoffs/detail-expansion.json`：

```json
{
  "stage": "detail-expansion",
  "status": "done",
  "summary": "已把 N 个 REQ 展开为 M 个 behavior，覆盖 K 个维度",
  "artifacts": ["requirements.json"],
  "expanded_behaviors": ["REQ-001-B01", "REQ-001-B02", "..."],
  "blocked_behaviors": []
}
```

## 产物根目录

所有产物写入 `specs/<date+feature>/`。禁止在项目根写 `requirements.json` 或 `detail-expansion.json`。

## 约束

- 不得把"系统应正确"、"接口应可用"等无法测试的描述作为 behavior。
- 不得只生成 happy-path；涉及输入、权限、写、状态、并发、外部依赖、安全、性能、可观测、恢复的 REQ 必须显式展开对应维度。
- 不得删除或修改用户已确认的 behavior；只能追加或细化。
- `requires-clarification` 必须在交接前清零或显式 escalate。
- 每个 behavior 必须可分配到至少一个 task。

## 完成条件

- `requirements.json` 每个 REQ 的 `required_categories` 都有对应 behavior 或 `not-applicable` 说明。
- 每个 behavior 有具体 `description`、`acceptance` 与 `test_plan`。
- 无 `requires-clarification` 残留。
- 完成 `handoffs/detail-expansion.json`。
