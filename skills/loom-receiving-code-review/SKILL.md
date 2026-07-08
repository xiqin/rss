---
name: loom-receiving-code-review
description: >
  Process code review feedback: classify items, implement fixes, push back with reasoning when needed.
  Triggered after receiving review comments on a PR or branch.
  Use when: code review comments have arrived and need triage, fixes, or reasoned disagreement.
when_to_use: Triage review feedback, implement valid fixes, and respond with evidence when pushing back.
argument-hint: <review comments or PR context>
user-invocable: true
---

# 接受代码审查

## 触发条件

- 收到代码审查反馈后触发
- `loom-requesting-code-review` 发出请求后，收到反馈时自动触发

## 完成条件与下一步

- 所有 BLOCKER 和必须修复项已处理
- 审查者确认通过
- 下一步：使用 `loom-finishing-a-development-branch` 收尾分支

## 核心原则

**技术严谨 > 社交舒适。** 验证后再行动，不搞表演性同意。

审查反馈是需要技术评估的输入，不是情感表演的机会。

## 禁止的回复

**永远不要：**
- "你说得对！"（表演性同意）
- "好主意！"（无意义附和）
- "我马上改！"（未验证就行动）

**应该：**
- 重述技术要求
- 提出澄清问题
- 用技术推理 push back
- 直接行动（行动 > 语言）

**正确的反馈回复：**
```
✅ "已修复。[简述改动]"
✅ "好发现 - [具体问题]。已修复于 [位置]。"
✅ [直接修复，通过代码展示]

❌ "你说得对！"
❌ "好主意！"
```

## 反馈来源区分

- **human partner**：理解后直接实施，范围不清时确认，不附和
- **外部审查者**：实施前必须验证技术正确性、兼容性和上下文完整性

> 详细检查清单见 `references/response-templates.md`

## YAGNI 与 Push Back

- 审查者建议"properly implement"时，先 grep 确认是否真的在用；未使用则建议删除
- 建议破坏现有功能、缺乏上下文、违反 YAGNI、与架构决策冲突时，用技术推理 push back
- 不清楚的反馈：**停止实施**，先确认所有不清楚的项

> 完整 YAGNI 检查流程、push back 方式和不清楚反馈示例见 `references/response-templates.md`

## 执行流程

### Step 1：理解审查反馈

1. 逐一阅读审查意见
2. 分类反馈：
   - **必须修复**：BLOCKER
   - **建议修复**：SUGGESTION
   - **讨论**：需要进一步讨论

### Step 2：分类处理

**BLOCKER（必须修复）：**
1. 理解问题
2. 实施修复
3. 验证修复

**SUGGESTION（建议修复）：**
1. 评估建议的合理性
2. 决定采纳或拒绝
3. 如果拒绝，提供理由

**讨论项：**
1. 与审查者沟通
2. 达成共识
3. 按共识处理

### Step 3：实施修复

1. 按审查意见修改代码
2. 运行测试确保修复正确
3. 提交修复

### Step 4：回复审查

使用 `references/response-templates.md` 中的统一模板格式回复审查意见。

### Step 5：再次提交

```bash
git add <modified-files>
git commit -m "fix: 根据审查反馈修复 xxx"
git push
```

## 约束

- BLOCKER 必须全部修复
- SUGGESTION 必须明确回复采纳或拒绝
- 拒绝建议时必须提供理由
- 修复后必须重新运行测试
