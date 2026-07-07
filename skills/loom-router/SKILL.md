---
name: loom-router
description: >
  Route a user request to the appropriate loom capability without replacing pipeline selection.
  Use when: a user request needs intent classification before choosing a skill, pipeline selector, QA, review, debugging, or branch finishing path.
---

# loom 入口路由

`loom-router` 是轻量入口分流层，只判断当前请求应该进入哪个 loom 能力。它不生成 `dynamic_steps`，不写 `pipeline.state.json`，不替代 `loom-pipeline-selector`。

## 触发条件

- 用户提出新请求，但还不清楚应使用哪个 loom skill。
- 用户问“这个任务应该走什么流程”。
- 请求可能属于 bug、功能开发、代码审查、QA、分支收尾、索引更新、架构改进、技能编写或 loom 使用咨询之一。
- 当前会话需要判断继续当前上下文、写 handoff、压缩，还是开 fresh session。

## 非触发条件

- 已经处在明确的 pipeline stage 中，并且下一步由 `pipeline.state.json` / `progress.md` 决定。
- 用户已经明确指定要运行某个 skill。
- `loom-pipeline-selector` 已完成选择且用户已确认，后续应按 pipeline 状态执行。

## 职责边界

### router 负责

- 识别请求入口类型。
- 解释推荐路径和理由。
- 判断是否需要先澄清、先复现、先审查、先 QA，或交给 `loom-pipeline-selector`。
- 给出上下文卫生建议：继续当前会话、写 handoff、压缩，或开 fresh session。

### router 禁止

- 禁止直接写 `pipeline.state.json`。
- 禁止生成或持久化 `dynamic_steps`。
- 禁止绕过 `loom-pipeline-selector` 的用户确认门禁。
- 禁止把自己变成第二套 pipeline planner。

## 路由表

| 用户请求类型 | 推荐入口 | 说明 |
| --- | --- | --- |
| 新功能、需求、跨模块改动 | `loom-pipeline-selector` | router 只说明应进入开发流水线；具体 steps 由 selector 选择并等待用户确认。 |
| 需求含糊、设计取舍多 | `loom-brainstorming` | 先澄清 shared understanding，再进入 spec / plan。 |
| bug、测试失败、异常行为 | `loom-systematic-debugging` | 先构造 red-capable feedback loop，再考虑修复。 |
| 明确行为变更或 bug 修复 | `loom-test-driven-development` | 在实现阶段使用 seam gate 和红绿重构。 |
| 准备发起审查 | `loom-requesting-code-review` | 先做 Standards + Spec 双轴预审查，再生成审查请求。 |
| 收到审查反馈 | `loom-receiving-code-review` | 分类处理、修复或 push back。 |
| 新功能验收或 release 验收 | `loom-qa` | 生成/执行 QA 用例并输出报告。 |
| 开发分支已验证完成 | `loom-finishing-a-development-branch` | 选择 merge、PR、keep 或 discard。 |
| 代码已变更且验证通过 | `loom-index-update` | 同步 codegraph、memory 和必要入口文档。 |
| 多个独立任务可并行 | `loom-dispatching-parallel-agents` | 仅在无共享文件冲突且已有确认 plan 时使用。 |
| 需要编写或修改 skill | `loom-writing-skills` | 检查职责边界、触发条件、完成标准和 context load。 |
| 用户询问 loom 能力 | `loom-using-loom` | 解释框架、skills 和 pipeline。 |

## 执行流程

### Step 1：分类请求

用一句话标注请求类型，例如：`bug 调试`、`新功能开发`、`代码审查`、`QA 验收`、`分支收尾`、`loom 咨询`。

### Step 2：说明推荐路径

输出推荐入口、原因和下一步。开发型任务必须说明：具体流水线仍由 `loom-pipeline-selector` 选择，且需要用户确认后才会写入状态。

### Step 3：判断是否需要阻塞执行

以下情况必须先停下，不直接实现：

- 需求关键行为不清楚。
- bug 没有可运行的失败信号。
- 要审查的 diff 或 fixed point 不明确。
- pipeline selector 尚未展示步骤并获得用户确认。
- 阶段切换前还没有写 handoff。

### Step 4：给出上下文卫生建议

- 当前澄清链路、同一 bug 的反馈环、同一小任务：继续当前会话。
- spec、plan、executing、verification 阶段结束：先写 handoff，再压缩旧上下文。
- 每个独立 issue 实现、prototype 探索、并行 subagent、高风险实验、严重上下文污染：开 fresh session 或隔离 subagent。

## 输出格式

```markdown
## 路由建议

- 类型：<请求类型>
- 推荐入口：<skill 或 pipeline selector>
- 原因：<1-3 条>
- 下一步：<要执行或要用户确认的动作>
- 上下文策略：<继续当前会话 | 写 handoff 后推进 | fresh session/subagent>
```

## 完成条件

- 已明确请求类型。
- 已给出推荐入口和理由。
- 如果是开发型任务，已明确后续由 `loom-pipeline-selector` 选择 steps。
- 已说明是否需要用户确认、补充信息、handoff、压缩或 fresh session。
