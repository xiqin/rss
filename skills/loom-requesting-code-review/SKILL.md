---
name: loom-requesting-code-review
description: >
  Prepare a code review request with change summary, self-test results, and focus areas for reviewers.
  Use when: verified changes are ready for reviewer handoff or a PR needs a review request summary.
when_to_use: Prepare a review request after verification, including change summary, tests, and reviewer focus areas.
argument-hint: <spec_dir or PR context>
user-invocable: true
---

# 请求代码审查

## 触发条件

- verification-before-completion 通过后，需要人工代码审查时
- 用户主动要求发起代码审查
- 分支开发完成、准备合并前

## 完成条件与下一步

- 审查请求已生成并发送
- 下一步：等待审查反馈 → 使用 `loom-receiving-code-review` 处理反馈

## 预审查清单

在请求审查前，确保：

- [ ] 所有变更已提交
- [ ] 编译通过（BUILD_CMD）
- [ ] 静态分析通过（VET_CMD）
- [ ] 所有测试通过（TEST_CMD）
- [ ] 代码符合项目编码红线
- [ ] codegraph 状态已确认（可用时直接查询 `.codegraph/`，否则注明图查询已跳过）
- [ ] 已完成 Standards + Spec 双轴预审查，或已说明跳过某一轴的原因

## 执行流程

### Step1：准备审查材料

1. 确认所有变更已完成
2. 运行验证确保代码质量（读取宪章中的 BUILD_CMD、VET_CMD、TEST_CMD 并执行）

### Step2：双轴预审查

请求人工审查前，先对当前 diff 做本地预审查。必须先确定 fixed point，例如用户指定的 commit/branch/tag、PR base、`main` 或 `HEAD~1`；fixed point 不明确时先问用户。

#### Standards 轴

检查代码是否符合项目标准和通用工程质量：

- `.loom/rules/constitution.md`、ADR、CONTRIBUTING、CODING_STANDARDS 等项目规范。
- 架构分层、模块边界、命名、错误处理、日志、配置、安全和性能。
- 测试质量：是否测行为、是否覆盖边界、是否避免实现耦合。
- 固定坏味道基线：重复、过长函数、霰弹式修改、循环依赖、全局状态、过度 mock、临时兼容层、未解释的复杂度。

#### Spec 轴

检查实现是否忠实满足来源需求：

- 从 commit message、PR 描述、`specs/<date+feature>/spec.md`、`plan.md`、issue/PRD 或用户原始请求定位 spec 来源。
- 对照验收标准、Requirement ID、边界条件和不做范围。
- 缺少 spec 来源时，明确写“Spec 轴跳过：未找到来源”，或向用户请求来源；不得凭想象补需求。

输出必须分成两个独立区块，不合并、不重排：

```markdown
## Standards

- <finding 或 无发现>

## Spec

- <finding、跳过原因 或 无发现>

## 预审查摘要

- Standards findings: <数量>，worst: <最严重问题或 none>
- Spec findings: <数量/跳过>，worst: <最严重问题或 none>
```

若任一轴发现 blocker，先修复并重新验证，再生成审查请求。

### Step3：整理变更摘要

```bash
git diff --stat
git log --oneline -10
```

### Step4：生成审查请求

```markdown
# 代码审查请求

**功能：** <feature-name>
**分支：** feature/<date>-<feature-name>

## 变更统计

<git diff --stat 输出>

## 主要变更

1. <变更说明 1>
2. <变更说明 2>

## 重点关注

1. 架构设计：xxx
2. 安全性：xxx
3. 性能：xxx

## 自测情况

- [x] 编译通过（BUILD_CMD）
- [x] 静态分析通过（VET_CMD）
- [x] 测试通过（TEST_CMD）
- [x] 代码符合编码红线
- [x] codegraph 已同步，或已注明索引查询跳过

## 变更详情

| 文件          | 变更类型 | 说明            |
| ------------- | -------- | --------------- |
| path/to/file1 | 新增     | XxxService 实现 |
| path/to/file2 | 修改     | 新增方法        |

## 审查重点

- [ ] 架构合规性
- [ ] 代码质量
- [ ] 安全性检查
- [ ] 性能影响
```

## 约束

- 审查请求必须包含完整的变更摘要
- 必须标注重点关注项
- 必须提供自测情况
- Findings 必须优先于总结，且包含文件/行号或明确的证据来源。
- 缺少 spec 来源时不得伪造 Spec findings。
