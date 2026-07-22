---
name: loom-brainstorming
description: >
  Explore 2-3 implementation options with trade-offs when the user describes a new feature or requirement.
  Use when: the user asks for a new feature design, implementation options, or technical trade-off analysis.
when_to_use: Explore implementation options, trade-offs, or requirements for a new feature before writing a plan.
argument-hint: <feature request or product idea>
user-invocable: true
---

# 需求头脑风暴

## 触发条件

- 用户提出新需求、功能描述或 PRD。
- 用户询问设计方案、实现路径或技术 trade-off。
- 需求存在关键歧义、涉及多角色/权限/业务规则，或验收标准不清。

## 非触发条件

- 单文件 typo、文案、配置微调或用户已给出明确验收标准的小改动。
- 根因已明确且范围很小的 bug 修复；这类任务应交给 `loom-pipeline-selector` 命中 quickfix/bugfix 流程。

## 执行流程

## 产物根目录

本阶段应创建或使用 `specs/<date+feature>/` 作为 `specDir`。所有阶段产物都必须写入该目录内；禁止在项目根目录写 `spec.md`、`progress.md` 或 `handoffs/`。

### Step 1：理解需求

1. 若存在 `.loom/rules/product.md`，先读取，作为产品定位、目标用户和原型约束的视角依据（PM / pm-prototype 流水线）。
2. 若存在 `.loom/rules/constitution.md`，读取其中架构、目录和编码约束。
3. 修改类需求先分析现有实现和影响范围。
4. 明确边界：做什么、不做什么。

### Step 2：可视化伴侣（可选）

如果预计涉及模型、布局、架构图等可视化内容，单独询问用户是否使用浏览器展示。详细流程见 `references/visual-companion.md`。

### Step 3：探索 2-3 种方案

每个方案包含：方案名称、架构思路、数据流、trade-off、实现步骤。以推荐方案开头并解释原因；如果范围跨多个独立子系统，先建议拆分。

### Step 4：澄清与 shared understanding

先区分问题来源：能通过读取代码、文档、spec 或现有约定回答的问题，必须先自行探索，不要问用户。

对简单需求，把待决议项集中展示给用户，优先给多选项：

```markdown
## 待决议项

| #   | 问题           | 选项                              |
| --- | -------------- | --------------------------------- |
| 1   | 数据存储方式？ | A: 关系型数据库 / B: 文档型数据库 |
```

对复杂需求进入一问一答澄清：

1. 沿最阻塞的设计分支提一个问题。
2. 每次只问一个问题。
3. 给出推荐答案和理由。
4. 等待用户反馈后再问下一个问题。
5. 用户确认 shared understanding 前，不写最终 spec，不进入实现。

### Step 5：输出 spec.md 与 requirements.json

用户确认方案后，写入 `specs/<date+feature>/spec.md` 和 `specs/<date+feature>/requirements.json`。文件夹命名格式：`<YYYY-MM-DD>+<功能名>`，如 `2026-04-26+user-management`。

使用 `assets/spec-template.md` 作为结构模板，并按项目类型删去不适用章节。

`requirements.json` 必须与 `spec.md` 的所有 `REQ-xxx` 一一对应。每个 requirement 必须包含：

- `id`：如 `REQ-001`。
- `status`：初始为 `failing`。
- `types`：需求类型，如 `functional`、`input`、`authorization`、`write`、`state`、`security`、`performance`、`observable`、`recovery`。
- `required_categories`：该需求必须覆盖的行为维度，如 `happy-path`、`invalid-input`、`authorization`、`atomicity`、`state-transition`、`observability`。
- `acceptance`：需求级验收标准。
- `behaviors`：可独立验证的行为义务，ID 使用 `REQ-xxx-Bnn`，每条必须有 `category`、`description`、`status`、`acceptance`。

行为维度必须从以下白名单选择：`happy-path`、`boundary`、`invalid-input`、`authorization`、`state-transition`、`idempotency`、`concurrency`、`atomicity`、`external-failure`、`compatibility`、`security`、`performance`、`observability`、`recovery`、`forbidden-behavior`。

不得只生成默认 `functional` / `happy-path`。如果需求涉及输入、权限、写操作、状态变化、幂等、并发、外部依赖、安全、性能、可观测性或恢复，必须在 `types` / `required_categories` 和 `behaviors` 中显式体现。

### Step 6：Spec 自审

- 占位符：不得残留 `TBD`、`TODO` 或未完成段落。
- 一致性：架构、功能、接口、数据模型不能互相矛盾。
- 范围：聚焦单个实现计划；过大时拆分。
- 歧义：有两种解释时选定一种并写清楚。
- 结构化需求：`spec.md` 的每个 `REQ-xxx` 必须出现在 `requirements.json`，每个 `required_categories` 必须有对应 behavior。

### Step 7：用户审查 Gate

自审通过后让用户审查 spec。用户要求修改时，修复并重新自审；只有用户批准后才继续 writing-plans。

### Step 8：阶段交接与压缩

用户批准 spec 后，写入 `specs/<date+feature>/handoffs/brainstorming.json`，至少包含：

```json
{
  "stage": "brainstorming",
  "status": "done",
  "summary": "已确认的方案和关键取舍摘要",
  "artifacts": ["spec.md", "requirements.json"],
  "decisions": ["用户已选择的关键方案"],
  "open_questions": []
}
```

阶段结束后压缩 brainstorming 原始讨论、方案比较和搜索输出；下一阶段必须重新读取 `specs/<date+feature>/spec.md`、`specs/<date+feature>/requirements.json`、`specs/<date+feature>/progress.md`、`specs/<date+feature>/handoffs/brainstorming.json` 和必要规则文件，不依赖旧对话全文。

## 约束

- 每个方案必须有 trade-off。
- 禁止模糊描述，如"大概"、"可能"、"差不多"。
- 数值必须有单位，如"2 秒内"、"100 条/页"。
- 接口/API 设计必须遵循项目约定。
- YAGNI：删除不必要功能。
- 复杂需求未达成 shared understanding 前，不得进入 planning 或 implementation。
- 不要把可通过代码探索回答的问题转嫁给用户。

## 完成条件

`specs/<date+feature>/spec.md` 与 `specs/<date+feature>/requirements.json` 保存、自审完成、用户批准，并完成 `specs/<date+feature>/handoffs/brainstorming.json`。
