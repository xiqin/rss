---
name: loom-analyze-artifacts
description: >
  Read-only cross-artifact consistency analysis after planning and before approval. Verifies that spec.md,
  requirements.json, plan.md, tasks/Tn.md, traceability.json are mutually consistent: no duplicate/ambiguous
  requirements, every behavior mapped to a task, no orphan tasks, no coverage gaps, no contradictions.
  Outputs artifact-analysis.json with coverage% and severity. CRITICAL/HIGH findings block the approval gate.
  Use when: planning produced plan.md + tasks + traceability.json, before the user approves the plan.
when_to_use: After loom-writing-plans produces plan.md and traceability.json, before the approved gate.
argument-hint: <spec directory containing spec.md, requirements.json, plan.md, tasks/, traceability.json>
user-invocable: true
---

# 跨产物一致性分析（analyze-artifacts）

## 触发条件

- `specs/<date+feature>/plan.md`、`tasks/`、`traceability.json`、`requirements.json`、`spec.md` 均已存在。
- 即将进入 `approved` gate，但还没人做过跨产物一致性检查。

## 非触发条件

- quickfix / chore / hotfix 等无 spec/plan 的轻量流程。
- 已在 verification 阶段（那时改用 `loom-converge`）。

## 执行流程

### Step 1：运行分析

调用 loom MCP 工具 `loom_analyze_artifacts`（参数 `spec_dir`）。

工具只读分析 `spec.md`、`requirements.json`、`plan.md`、`tasks/T*.md`、`traceability.json`、`.loom/rules/constitution.md`（若存在），执行下列检查并输出 `artifact-analysis.json`。返回 `ok:false` 表示有 blocker finding。

### Step 2：跨产物一致性检查

按以下维度逐项检查，每条 finding 记录 `{ id, kind, severity, message, requirement_id?, behavior_id?, task_id?, artifact, suggested_fix }`。

1. **重复需求**：`spec.md` 中两个 `REQ-xxx` 实际描述同一行为。
2. **歧义需求**：`spec.md` 有两种解释且未选定一种。
3. **欠规格**：`requirements.json` 缺少 spec 中的 `REQ-xxx`，或某 REQ 的 `required_categories` 未覆盖。
4. **behavior 缺失**：`requirements.json` 的 `required_categories` 没有 behavior 实现。
5. **task 未映射**：`plan.md` 引用的 task 文件不存在，或 `tasks/` 中文件未在 `plan.md` 列出。
6. **behavior 未映射到 task**：`requirements.json` 的某 behavior 在所有 task frontmatter `behavior_ids` 中都未出现。
7. **task 引用未知 behavior**：task 的 `behavior_ids` 不在 `requirements.json` 中。
8. **task 引用未知 requirement**：task 的 `requirements` 不在 `spec.md` 中。
9. **traceability 缺 REQ/behavior**：`traceability.json` 缺少 `spec.md` / `requirements.json` 中的 REQ 或 behavior。
10. **traceability 引用未知 REQ/behavior**：`traceability.json` 出现 `requirements.json` 没有的 REQ/behavior。
11. **traceability task 引用不存在**：`traceability.json` 的 tasks 不对应真实 `tasks/T*.md`。
12. **依赖环**：task `depends_on` 构成环。
13. **owns 冲突**：多个 task 声明同一 `owns` 文件。
14. **constitution 冲突**：task 计划修改的路径与 `.loom/rules/constitution.md` 的分层/禁止目录冲突。
15. **非功能要求遗漏**：`requirements.json` 声明 `performance` / `security` / `observability` 类型，但没有任何 task 或 behavior 覆盖对应维度。

### Step 3：计算 coverage

```json
{
  "requirement_coverage": "已映射 task 的 REQ 数 / spec REQ 总数",
  "behavior_coverage": "已映射 task 的 behavior 数 / requirements behavior 总数",
  "required_category_coverage": "已覆盖的 required_categories 数 / 声明总数",
  "traceability_req_coverage": "traceability 中 REQ 数 / requirements REQ 数",
  "traceability_behavior_coverage": "traceability 中 behavior 数 / requirements behavior 数"
}
```

### Step 4：severity 分级

- `blocker`：缺 REQ/behavior 映射、依赖环、traceability 缺 REQ、task 引用未知 behavior、constitution 冲突。
- `error`：歧义、owns 冲突、traceability task 引用不存在、非功能要求遗漏。
- `warning`：重复描述、欠规格但已部分覆盖。
- `info`：建议改进，不阻断。

### Step 5：输出 `artifact-analysis.json`

```json
{
  "stage": "analyze-artifacts",
  "status": "pass|blocked",
  "coverage": {
    "requirement_coverage": "100%",
    "behavior_coverage": "92%",
    "required_category_coverage": "88%",
    "traceability_req_coverage": "100%",
    "traceability_behavior_coverage": "92%"
  },
  "findings": [
    {
      "id": "F-001",
      "kind": "missing",
      "severity": "blocker",
      "message": "requirements.json REQ-003 required category authorization has no behavior",
      "requirement_id": "REQ-003",
      "artifact": "requirements.json",
      "suggested_fix": {
        "action": "update_requirement",
        "details": "add REQ-003-B03 with category authorization"
      }
    }
  ],
  "created_at": "2026-07-20T18:00:00Z"
}
```

### Step 6：阻断规则

- 任何 `blocker` finding：状态为 `blocked`，状态机不允许进入 `approved`。
- 任何 `error` finding：默认阻断，但用户可在分析报告中显式 override（写入 `overrides` 字段并附理由）。
- `warning` / `info`：不阻断，但必须在 handoff 中记录。

## 产物根目录

`artifact-analysis.json` 写入 `specs/<date+feature>/`。

## 约束

- 只读分析，不修改 spec/plan/tasks/traceability/requirements。
- 不 invent 新 task；只报告问题。
- 发现的问题由用户或 `loom-writing-plans` 修复后重新分析，直到无 blocker。
- 不得用"看起来 OK"作为结论；每项检查必须有明确 pass/fail。

## 完成条件

- 产出 `specs/<date+feature>/artifact-analysis.json`。
- coverage 字段全部填写。
- 所有 blocker findings 已被处理或显式 override。
- handoff 记录分析结果。
