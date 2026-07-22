# [功能名称] 实现计划

**目标：** [一句话描述构建什么]

**架构：** [关于方法的 2-3 句话]

**技术栈：** [关键技术/库]

---

## Task 概览

| Task | 名称 | 层级 | 复杂度 | 依赖 | Requirements | Behaviors | 文件 |
| ---- | ---- | ---- | ------ | ---- | ------------ | --------- | ---- |
| T1 | <功能点名称> | <层级> | 简单 | 无 | REQ-001 | REQ-001-B01 | `tasks/T1.md` |
| T2 | <功能点名称> | <层级> | 中等 | T1 | REQ-002 | REQ-002-B01 | `tasks/T2.md` |

## 依赖关系

T1 → T2

## Traceability 初始映射

planning 阶段必须基于 `requirements.json` 生成同目录 `traceability.json`，覆盖每个 `REQ-xxx` 及其 `behaviors`。

```json
{
  "requirements": {
    "REQ-001": {
      "tasks": ["T1"],
      "tests": [],
      "evidence": [],
      "behaviors": {
        "REQ-001-B01": {
          "tasks": ["T1"],
          "tests": [],
          "evidence": []
        }
      }
    }
  }
}
```

- `tasks` 在 planning 阶段必须填写真实 task ID。
- `tests` 与 `evidence` 可先为空，由 executing 阶段补齐。
- 不允许遗漏 `requirements.json` 中的任一 behavior。
