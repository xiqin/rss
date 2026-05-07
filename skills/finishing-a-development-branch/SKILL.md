---
name: finishing-a-development-branch
description: >
  开发分支收尾。完成开发后，整理分支并准备合并。
  Use when: feature development is complete and branch needs to be cleaned up.
  Trigger keywords: 完成开发, 收尾, 合并分支, 准备提交.
---

# 开发分支收尾

## 执行流程

### Step 1：确认开发完成

1. 所有 task 已完成
2. 所有测试通过
3. 索引文件已更新
4. 无 BLOCKER

### Step 2：检查分支状态

```bash
git status
git diff --stat
```

- [ ] 确认所有变更已暂存
- [ ] 确认没有意外的文件变更

### Step 3：运行最终验证

读取 `.claude/memory/constitution.md` 中的 BUILD_CMD、VET_CMD、TEST_CMD，依次执行。

- [ ] 编译通过
- [ ] vet 通过
- [ ] 测试全部通过

### Step 4：提交变更

```bash
git add <specific-files>
git commit -m "$(cat <<'EOF'
feat: <功能描述>

- 变更 1
- 变更 2

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Step 5：推送分支（如需要）

```bash
git push -u origin feature/<date>-<feature-name>
```

### Step 6：创建 PR（如需要）

```bash
gh pr create --title "feat: <功能描述>" --body "$(cat <<'EOF'
## Summary
- 变更 1
- 变更 2

## Test plan
- [x] 编译通过
- [x] 测试通过
- [x] 代码审查通过
EOF
)"
```

## 提交信息规范

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Type：**
- `feat`：新功能
- `fix`：修复
- `refactor`：重构
- `docs`：文档
- `test`：测试
- `chore`：杂项

## 约束

- 提交前必须运行完整验证
- 提交信息必须清晰描述变更内容
- 禁止提交敏感信息（密钥、密码等）
