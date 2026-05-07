---
name: requesting-code-review
description: >
  请求代码审查。准备审查请求，整理变更摘要。
  Use when: requesting code review from team members or preparing PR for review.
  Trigger keywords: 请求审查, 发起 review, 准备审查, 提交审查.
---

# 请求代码审查

## 执行流程

### Step 1：准备审查材料

1. 确认所有变更已完成
2. 运行验证确保代码质量（读取宪章中的 BUILD_CMD、VET_CMD、TEST_CMD 并执行）

### Step 2：整理变更摘要

```bash
git diff --stat
git log --oneline -10
```

### Step 3：生成审查请求

```markdown
## 代码审查请求

**功能：** <feature-name>
**分支：** feature/<date>-<feature-name>
**变更范围：**

### 变更摘要

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| path/to/file1 | 新增 | XxxService 实现 |
| path/to/file2 | 修改 | 新增方法 |

### 重点关注

1. 架构设计：xxx
2. 安全性：xxx
3. 性能：xxx

### 自测情况

- [x] 编译通过
- [x] 测试通过
- [x] 代码自查
```

### Step 4：等待反馈

- 监听审查反馈
- 及时回复审查意见
- 按要求修复问题

## 约束

- 审查请求必须包含完整的变更摘要
- 必须标注重点关注项
- 必须提供自测情况
