---
name: receiving-code-review
description: >
  接受代码审查。处理审查反馈，按要求修复问题。
  Use when: receiving and responding to code review feedback.
  Trigger keywords: 审查反馈, review 意见, 修改审查问题.
---

# 接受代码审查

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

对每个审查意见回复：

```markdown
## 审查反馈处理

### 已修复

| # | 意见 | 修复内容 |
|---|------|---------|
| 1 | Controller 有业务逻辑 | 已移到 Service |
| 2 | 缺少参数校验 | 已添加 |

### 已讨论

| # | 意见 | 决定 | 理由 |
|---|------|------|------|
| 1 | 建议添加缓存 | 暂不添加 | 当前访问量低 |
```

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
