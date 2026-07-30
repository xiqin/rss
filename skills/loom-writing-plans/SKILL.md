---
name: loom-writing-plans
description: >
  Break a confirmed spec into ordered, independently-verifiable task files with dependency analysis.
  Use when: an approved spec must be decomposed into ordered, testable implementation tasks.
when_to_use: Decompose an approved spec into ordered, independently verifiable implementation tasks.
argument-hint: <spec_dir>
user-invocable: true
---

# 实现计划拆解

## 触发条件

- `specs/<date+feature>/spec.md` 与 `specs/<date+feature>/requirements.json` 已存在并经用户确认。
- 需要把 spec 拆为可独立验证的 task 文件。

## 输出

- `specs/<date+feature>/plan.md`：摘要 + Task 概览。
- `specs/<date+feature>/tasks/T1.md`、`T2.md`...：每个 task 一个独立文件。
- `specs/<date+feature>/traceability.json`：REQ 与 behavior 到 task/test/evidence 的结构化追踪账本；planning 阶段至少写入 REQ/behavior 到 task 的初始映射，tests/evidence 可先为空并由 executing 补齐。
- `specs/<date+feature>/handoffs/planning.json`：规划阶段交接摘要。

## 产物根目录

本阶段的 `specDir` 是 `specs/<date+feature>/`。所有阶段产物都必须写入该目录内；禁止在项目根目录写 `spec.md`、`plan.md`、`tasks/`、`progress.md` 或 `handoffs/`。

使用 `assets/plan-template.md` 和 `assets/task-template.md` 作为输出模板。

## 执行流程

1. 读取 `specs/<date+feature>/spec.md` 与 `specs/<date+feature>/requirements.json`，提取功能点、接口、数据模型、边界场景、Requirement ID 和 behaviors。
2. 读取 `.loom/rules/constitution.md`；如存在，读取 `.loom/contexts/subagent-context.md`。
3. 先规划文件结构：创建/修改哪些文件、每个文件职责、哪些文件一起变化。
4. 按项目实际分层和依赖顺序拆 task：数据/模型 → 业务逻辑 → 接口/UI → 路由/配置 → 集成。
5. 写 `specs/<date+feature>/plan.md` 概览，再为每个 task 写完整 `specs/<date+feature>/tasks/TN.md`。
6. 写 `specs/<date+feature>/traceability.json`，把每个 `REQ-xxx` 及其 `REQ-xxx-Bnn` behavior 映射到负责的 task；planning 阶段不允许遗漏 behavior。
7. 自检并运行自动校验。
8. 写入 `specs/<date+feature>/handoffs/planning.json`，摘要说明 task 拆分、依赖顺序、关键接口约束、REQ/behavior 映射、并行/串行边界和主要产物。

如果 spec 涵盖多个独立子系统，建议拆成多个计划；每个计划都应能产出可工作、可测试的独立软件。

## Task 粒度

- 每个 task 是一个可独立验证的交付物。
- 每个 task 包含层级、复杂度、依赖、涉及文件、Requirement ID 验收映射、TDD 步骤、测试说明。
- **每个 task 文件必须声明 YAML frontmatter**，包含 `owns`（独占写入的文件/目录）、`reads`（只读依赖）、`depends_on`（前置 task）、`requirements`（覆盖的 `REQ-xxx`）、`behavior_ids`（覆盖的 `REQ-xxx-Bnn`）、`complexity`。这些字段驱动 `loom tasks` 命令的冲突检测、批次调度和 traceability 初始映射。
- 依赖必须无循环；有循环依赖时拆开或合并。
- 后续 task 使用的类型、方法签名和属性名必须与前序 task 匹配。
- 每个 spec Requirement ID 必须至少映射到一个 task；task 不得使用 spec 中不存在的 Requirement ID。
- `requirements.json` 中每个 behavior 必须至少映射到一个 task；task 不得使用 `requirements.json` 中不存在的 `behavior_ids`。
- **`owns` 集合不得有交集**：两个 task 不能同时 owns 同一文件/目录，否则不能并行执行。

## traceability.json 初始账本

planning 阶段必须生成 `specs/<date+feature>/traceability.json`。结构示例：

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

- planning 阶段至少填写 `tasks`；`tests` 与 `evidence` 可为空，由 executing 阶段补齐真实测试和证据。
- 每个 `REQ-xxx` 必须出现，且每个 `REQ-xxx-Bnn` behavior 必须出现。
- `traceability.json` 里的 task 引用必须对应真实 `tasks/TN.md`。
- 不允许用一个 REQ 级映射替代 behavior 级映射；behavior 级遗漏会在 verification 阶段阻断。

## 自动校验

完成 `specs/<date+feature>/plan.md`、`specs/<date+feature>/tasks/Tn.md` 和 `specs/<date+feature>/traceability.json` 后运行：

调用 MCP 工具 `loom_validate_plan`，参数：`spec_dir: "specs/<date+feature>"`。

不要在用户项目或全局 opencode skill 目录中直接执行 `node <skill-dir>/scripts/validate-plan.mjs`。该脚本是 loom MCP 服务器进程内的工具实现，直接执行部署后的 skill 脚本会因为相对导入脱离 npm 包运行时而失败。

工具返回 `ok: false` 时，先修复计划文件，再进入用户确认 gate。

如已安装 loom CLI，追加运行冲突检测（有冲突则必须修改 owns 声明或调整并行策略）：

```bash
loom tasks --spec-dir specs/<date+feature> --validate
```

## 上下文交接

planning 完成后，拆分过程、中间推理和探索性搜索输出可以压缩；executing 阶段只应依赖 `specs/<date+feature>/spec.md`、`specs/<date+feature>/requirements.json`、`specs/<date+feature>/plan.md`、`specs/<date+feature>/tasks/`、`specs/<date+feature>/traceability.json`、`specs/<date+feature>/progress.md`、`specs/<date+feature>/handoffs/brainstorming.json`、`specs/<date+feature>/handoffs/planning.json` 和必要规则文件。

## 检查清单

<!-- loom:generate:rule:placeholder-scan-ban -->
**占位符扫描禁止**

禁止使用以下占位符，发现即视为未完成：TBD、TODO、implement later、fill in details、Similar to Task N、"add appropriate error handling"
<!-- /loom:generate:rule:placeholder-scan-ban -->

- [ ] `specs/<date+feature>/plan.md` 包含摘要和 Task 概览表。
- [ ] 每个 task 文件包含完整字段和可执行步骤。
- [ ] 每个 task 的 `requirements` 与 `behavior_ids` 覆盖 `requirements.json` 中对应 REQ/behavior。
- [ ] `specs/<date+feature>/traceability.json` 包含每个 REQ/behavior 到 task 的初始映射。
- [ ] task 可独立编译或验证。
- [ ] 分层顺序来自 constitution.md。
- [ ] 遵守 constitution.md 编码红线。

<!-- loom:generate:model-selection -->
## 模型选择策略

使用最强大的模型来处理每个角色，以节省成本并提高效率：

**机械实现任务**（隔离函数、1-2 个文件、Requirement ID 与验收映射完整、上下文无 UNKNOWN）：使用快速、便宜的模型。只有事实已落盘且不存在接口/安全判断时，才把任务视为机械实现

**集成和判断任务**（多文件协调、模式匹配、调试）：使用标准模型

**架构、设计和审查任务**：使用可用的最强模型

**任务复杂度信号：**

- 触及 1-2 个文件、Requirement ID/验收映射完整、无 UNKNOWN、无公开接口或安全影响 → 便宜模型
- 任一关键事实为 UNKNOWN、handoff 指纹过期或源码与 handoff 冲突 → 标准模型
- 触及多个文件且有集成问题 → 标准模型
- 需要设计判断或广泛的代码库理解 → 最强模型
<!-- /loom:generate:model-selection -->

## 完成条件

`specs/<date+feature>/plan.md`、所有 `specs/<date+feature>/tasks/TN.md`、`specs/<date+feature>/traceability.json`、自动校验和 `specs/<date+feature>/handoffs/planning.json` 完成。
