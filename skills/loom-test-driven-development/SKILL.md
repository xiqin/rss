---
name: loom-test-driven-development
description: >
  Implement features using strict Red-Green-Refactor TDD cycle. No production code without a failing test first.
  Use when: implementing behavior where tests can define expected outcomes before production code changes.
when_to_use: Implement behavior through a strict red-green-refactor TDD loop.
argument-hint: <behavior or test seam>
user-invocable: true
---

# 测试驱动开发（TDD）

## 核心循环

```text
红（Red）→ 绿（Green）→ 重构（Refactor）
```

1. **红**：先写一个失败的测试。
2. **绿**：写最少的代码让测试通过。
3. **重构**：优化代码结构，保持测试通过。

## 铁律

- 没有失败的测试在先，不写生产代码。
- 测试文件必须持久化到项目标准测试目录，不得作为临时验证后删除。
- 先写了代码？删除它，从红开始。
- 写测试前必须确认 seam：测试要通过哪个 public boundary 验证行为。

## 使用场景

默认用于新功能、bug 修复、重构和行为变更。一次性原型、生成代码或纯配置变更可以先询问用户是否例外。

## 执行流程

当前 task 的需求产物必须从 `specs/<date+feature>/` 读取；不要在项目根目录读取或生成 `spec.md`、`plan.md`、`tasks/` 等 loom 阶段产物。

### Step 1：理解需求

读取 `specs/<date+feature>/spec.md`、`specs/<date+feature>/plan.md` 和当前 `specs/<date+feature>/tasks/TN.md`，明确当前 task 的测试范围。

### Step 2：确认 seam

写测试前先列出候选 seam，并说明每个 seam 对应的 public boundary，例如 CLI 命令、HTTP API、组件交互、公开函数、持久化副作用或事件输出。

必须向用户或当前已批准 spec/plan 对齐以下内容：

1. 选择哪个 seam。
2. 该 seam 验证的用户可观察行为是什么。
3. 为什么不测试内部实现细节。

未确认 seam 时，不得写测试。若用户不在场且 spec/plan 已明确 public boundary，可基于已批准产物确认 seam，并在输出中记录依据。

### Step 3：红

1. 为当前行为写测试。
2. 运行项目约定的单文件测试命令。
3. 确认测试因缺少目标行为而失败，而不是拼写、导入或测试本身错误。

测试立即通过说明测了已有行为；修正测试。

### Step 4：绿

写最少代码让测试通过，只实现当前测试覆盖的行为。不要顺手扩展功能、重构无关代码或添加未来配置。

### Step 5：重构

仅在测试绿色后重构。消除重复、改善命名，并重新运行相关测试。需要时执行 constitution.md 中的 BUILD_CMD、VET_CMD、TEST_CMD。

### Step 6：重复

对下一个行为点重复红绿重构。

## 测试规范

- 名称描述真实行为。
- 一个测试验证一件事。
- 结构遵循 Arrange / Act / Assert。
- 覆盖正常流程、异常流程和边界条件。
- 默认测试真实代码，仅在不可避免时 mock。
- 通过 public seam 验证行为，不绑定私有函数、内部状态或实现顺序。

示例、理由和反模式见：

- `references/examples-and-rationale.md`
- `references/testing-anti-patterns.md`
- `references/common-excuses.md`

## 红旗

- 先写代码后写测试。
- 测试在实现之后添加。
- 无法解释测试为什么失败。
- 无法解释测试 seam。
- 依赖手动测试替代自动测试。
- 为"就这一次"跳过 TDD 找理由。
- 想保留未验证代码作为参考。

出现红旗时，删除未验证实现，从红开始。

## 完成清单

- [ ] 每个新行为都有测试。
- [ ] 每个测试都有明确 seam，且 seam 是 public boundary。
- [ ] 每个测试在实现前因预期原因失败。
- [ ] 实现是让测试通过的最小代码。
- [ ] 所有相关测试通过。
- [ ] 测试文件持久化在项目标准测试目录。
- [ ] 输出干净，无新增错误或警告。

## 最终规则

```text
生产代码 -> 测试存在且先失败
否则 -> 不是 TDD
```
