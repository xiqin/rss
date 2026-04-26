---
name: rss-analyze
description: >
  [DEPRECATED] 需求分析技能。已被 brainstorming 取代，保留用于向后兼容。
  请使用 brainstorming skill 进行需求分析。
---

# 需求分析技能（已废弃）

> **此 skill 已被 `brainstorming` 取代。** 请使用 `brainstorming` 进行需求分析。
>
> brainstorming 提供了更完整的能力：
> - 探索 2-3 种实现方案及 trade-off
> - 输出 `specs/<date+feature>/spec.md`（包含接口设计、数据模型、业务规则）
> - 支持需求澄清和批量提问

## 向后兼容

如果项目中已有基于 rss-analyze 的流程（`tasks.md`），此 skill 仍可使用，但建议迁移到 brainstorming + writing-plans 的组合：

```
旧流程：rss-analyze → tasks.md → coding
新流程：brainstorming → spec.md → writing-plans → plan.md → subagent-dev
```

## 执行流程（仅供参考）

### Step 1：判断需求类型
- **新增类**：全新功能 → 参考 `REFERENCE/new-requirement.md`
- **修改类**：在已有功能上修改 → 参考 `REFERENCE/modify-requirement.md`

### Step 2：按 spec 格式输出需求分析

### Step 3：需求澄清

### Step 4：输出任务拆分
