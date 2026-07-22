---
name: loom-omission-hunter
description: >
  Read-only adversarial reviewer that looks for what SHOULD exist but doesn't, by cross-checking Behavior
  Obligations against code, tests, expected side effects, forbidden side effects, failure scenarios, and
  public API changes. Focuses on negative space: events that should not repeat, permissions that should not
  be bypassed, partial writes that should not happen, old APIs that should not change, swallowed exceptions,
  leaked secrets. Outputs findings.json. Use when: executing or converge needs an independent omission sweep.
when_to_use: After executing or as part of converge, when a dedicated omission pass is needed before verification.
argument-hint: <spec directory containing requirements.json, traceability.json, tasks/>
user-invocable: true
---

# 遗漏猎人（omission-hunter）

## 触发条件

- `executing` 已产出代码与 `test-report.md`，但 `loom-converge` 之前或之后需要一次专门寻找"应存在但不存在"的对抗式审查。
- 怀疑实现只覆盖了 happy-path，边界/权限/失败/禁止行为可能被漏掉。
- 需要独立视角，不依赖实现 agent 的自我报告。

## 非触发条件

- 还没有代码或测试可审查。
- quickfix / chore 等无 spec 的流程。

## 执行流程

### Step 1：运行遗漏猎人

调用 loom MCP 工具 `loom_omission_hunt`（参数 `spec_dir`）。

工具只读检查 `requirements.json`、`traceability.json`，对每个 behavior 做负空间检查，输出 `findings/omission-hunter.json`。返回 `ok:false` 表示有 blocker，需回流到 `loom-converge`。

> 说明：`scripts/omission-hunt.mjs` 是该工具的实现，运行在 loom MCP 服务器进程内。不要在用户项目里用 `node skills/...` 调用（部署后路径会断裂）。

### Step 2：对每个 Behavior 做负空间检查

对每个 `REQ-xxx-Bnn`，对照 `requirements.json` 的 `category` 与 `acceptance`，检查以下"应存在但不存在"：

1. **代码符号**：behavior 应在某个代码符号中实现。若 `traceability.json` 无 `code_refs` 或引用的符号不存在，报 `missing code reference`。
2. **测试**：behavior 应有对应测试。若 `traceability.json` 无 `tests` 或测试文件不存在，报 `missing test`。
3. **预期副作用**：涉及写/状态变更的 behavior 应有可观察的副作用（日志、事件、DB 记录）。若代码没有对应日志/事件/写入，报 `missing expected side effect`。
4. **禁止副作用**：`forbidden-behavior` category 的 behavior 应有保护代码（权限检查、限流、输入校验）。若保护缺失，报 `missing forbidden-behavior guard`。
5. **失败场景**：涉及外部依赖的 behavior 应有超时/重试/回滚。若没有，报 `missing failure handling`。
6. **公共 API 变更**：若 diff 修改了公共 API，但 `requirements.json` 没有 compatibility 类型 behavior，报 `unrequested public API change`。
7. **不变量保护**：涉及并发/原子性的 behavior 应有锁/事务/CAS。若没有，报 `missing invariant guard`。
8. **可观测性**：`observability` 类型的 behavior 应有指标/日志/trace。若没有，报 `missing observability`。

### Step 3：生成 findings

每条 finding 形如：

```json
{
  "id": "F-omit-001",
  "kind": "missing",
  "severity": "blocker",
  "message": "REQ-001-B03 (authorization) expects a permission check, but no guard code found in UserService.update",
  "requirement_id": "REQ-001",
  "behavior_id": "REQ-001-B03",
  "artifact": "src/services/user-service.js",
  "location": { "file": "src/services/user-service.js", "symbol": "update" },
  "suggested_fix": { "action": "create_task", "details": "add authorization guard to UserService.update" }
}
```

### Step 4：输出 `findings/omission-hunter.json`

```json
{
  "stage": "omission-hunter",
  "status": "pass|blocked",
  "findings": ["..."],
  "checked_behaviors": 12,
  "blocker_count": 2,
  "created_at": "2026-07-20T19:00:00Z"
}
```

### Step 5：阻断规则

- `blocker` finding：状态 `blocked`，必须回流到 `loom-converge` 生成新 task。
- `error` finding：默认阻断，用户可 override。
- `warning` / `info`：不阻断。

## 产物根目录

`findings/omission-hunter.json` 写入 `specs/<date+feature>/findings/`。

## 约束

- 只读，不修改代码或测试。
- 不 invent 需求；只对照 `requirements.json` 已声明 behavior。
- 不得用"代码看起来 OK"作为结论；每条 finding 必须有具体 location。
- 优先关注负空间：不应发生的事件、不应泄露的数据、不应破坏的旧 API、不应吞掉的异常。
- 与 `loom-converge` 配合：omission-hunter 发现问题后由 converge 追加 task。

## 完成条件

- 产出 `findings/omission-hunter.json`。
- 所有 blocker findings 已回流到 converge 处理或显式 override。
- handoff 记录遗漏数与处理结果。
