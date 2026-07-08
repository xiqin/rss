---
name: loom-systematic-debugging
description: >
  Structured debugging when facing bugs, test failures, or unexpected runtime behavior.
  Follows a phased approach: reproduce → gather info → hypothesize → verify → fix.
  Use when: diagnosing bugs, failing tests, flaky behavior, or unexplained runtime errors.
when_to_use: Diagnose bugs, failing tests, flaky behavior, or unexplained runtime errors through a structured loop.
argument-hint: <failure or symptom>
user-invocable: true
---

# 系统化调试

## 调试原则

**先找根因，再修问题。** 系统化方法首次修复率约 95%，随机猜测仅 40%。

## 绝对规则

**Phase 1 完成前不许提出解决方案。** 三次修复失败 → 重新审视架构，不是再试一次补丁。

Phase 1 的完成标准不是“看起来知道原因”，而是已经建立一个 red-capable feedback loop：一个已运行过、能暴露失败、足够快、agent 可重复执行的命令、测试、脚本或 harness。

多组件系统：在每个边界插桩，定位数据流在哪里断了。

## 执行流程

> 阶段映射：Step1+2=收集信息 → Step3+4=形成/验证假设 → Step5+6=修复验证

### Step 1：建立反馈环

先构造可运行的 pass/fail 信号，再进入根因分析。可选方式包括：

- failing test
- curl / HTTP script
- CLI fixture
- headless browser script
- captured trace replay
- throwaway harness
- property / fuzz loop
- bisection harness
- differential loop
- 带人工确认点的脚本化检查

完成标准：

1. 命令已经运行过。
2. 当前能失败，或对 flaky bug 明显提高复现率。
3. 失败与用户报告的行为相关，而不是测试拼写、导入或环境错误。
4. 运行足够快，能在修复循环中反复执行。
5. agent 可以独立执行，不依赖未记录的手工步骤。

如果无法建立反馈环，必须停止并说明已尝试的方法、缺失的环境/日志/artifact，以及需要用户提供什么；不得进入修复。

### Step 2：复现并最小化问题

1. 确认问题的复现步骤
2. 记录环境信息（操作系统、版本、配置）
3. 确认问题是否可稳定复现
4. 收紧反馈环：减少依赖、缩短运行时间、缩小输入范围

### Step 3：收集信息

**错误信息**：控制台输出、日志文件、堆栈追踪

**上下文信息**：触发条件、输入数据、系统状态

**对比分析**：最近的代码变更、配置变更、环境变更

### Step 4：缩小范围 + 形成假设

1. **二分法**：不确定哪个变更导致问题 → 使用 git bisect
2. **日志定位**：关键位置添加日志，追踪数据流
3. **单元测试**：编写测试覆盖问题场景

基于收集的信息，列出 3-5 个按可能性排序、可证伪的原因：

```markdown
| #   | 假设           | 依据             | 验证方法       |
| --- | -------------- | ---------------- | -------------- |
| 1   | 数据库连接超时 | 日志显示连接错误 | 检查连接池配置 |
| 2   | 参数解析错误   | 请求参数格式异常 | 检查绑定标签   |
```

逐一验证假设，每次只验证一个：

1. 选择最可能的假设
2. 做最小化改动验证
3. 假设正确 → 进入修复
4. 假设错误 → 验证下一个假设

### Step 5：修复和验证

1. 实施修复
2. 编写回归测试
3. 运行全量测试
4. 确认问题解决
5. 用 Phase 1 的反馈环证明 red → green

详细模式和工具见 references/common-patterns.md

## 调试技术

### 条件等待（Condition-Based Waiting）

当调试异步问题时，不要使用固定 sleep，而是：

1. 设置明确的完成条件
2. 轮询检查条件是否满足
3. 设置合理的超时时间
4. 超时时提供诊断信息

### 纵深防御（Defense in Depth）

建立多层防护来验证假设：

1. 输入验证层：检查输入合法性
2. 业务逻辑层：验证业务规则
3. 数据/状态层：检查数据完整性
4. 输出层：验证输出格式

## 警告信号

出现以下想法意味着你在走捷径，立即回到 Phase 1：

- "先快速修一下" / "quick fix for now"
- "大概是 X，修一下" / "probably X, let me fix that"
- "这个简单" / "this is simple"
- "就试一个东西" / "just try this one thing"
- 没有 red-capable feedback loop 就开始改代码
- 三次修复失败还在猜

**所有这些意味着：停止猜测，回到根因分析。**

## 输出格式

```markdown
## 调试报告

**问题描述：** xxx
**影响范围：** xxx
**复现步骤：**

1. xxx
2. xxx

### 根因分析

- **反馈环：** <已运行命令 / 测试 / harness>
- **失败信号：** <red 输出摘要>

- **直接原因：** xxx
- **根本原因：** xxx

### 修复方案

- **修改文件：** path/to/file
- **修改内容：** xxx
- **回归测试：** 已添加测试覆盖

### 预防措施

- 添加监控告警
- 添加单元测试覆盖
```
