---
name: loom-finishing-a-development-branch
description: >
  Clean up a feature branch after verification: merge, create PR, keep, or discard. Follows conventional commits.
  Use when: a development branch has passed verification and needs merge, PR, keep, or discard handling.
when_to_use: Finish a verified development branch by choosing merge, PR, keep, or discard handling.
argument-hint: <branch or spec_dir>
user-invocable: true
---

# 开发分支收尾

## 触发条件

- `loom-verification-before-completion` 验证通过
- `loom-index-update` 索引已更新
- 用户确认所有开发工作已完成

## 完成条件与下一步

- 分支已合并到主分支 / PR 已创建 / 分支已保留
- 功能开发流程结束

## 公告

开始时宣布："我正在使用 loom-finishing-a-development-branch skill 来完成这项工作。"

## 执行流程

### Step 1：确认开发完成

1. 所有 task 已完成
2. 所有测试通过
3. codegraph 状态已确认（不可用时已注明跳过）
4. 无 BLOCKER
5. 测试报告已生成（来自 test-reporter）

### Step 2：检查分支状态

```bash
git status
git diff --stat
```

- [ ] 确认所有变更已暂存
- [ ] 确认没有意外的文件变更
- [ ] 确认不在主/主分支上

### Step 3：运行最终验证

<!-- loom:generate:rule:build-vet-test-cmd -->
**构建/检查/测试命令**

读取 `.loom/rules/constitution.md` 中的 BUILD_CMD/VET_CMD/TEST_CMD 并执行验证。
<!-- /loom:generate:rule:build-vet-test-cmd -->

### Step 4：展示选项

向用户展示以下选项：

```
## 分支完成选项

**1. Merge（合并）** - 直接合并到主分支
**2. Pull Request** - 创建 PR 供审查
**3. Keep（保留）** - 保持分支，稍后继续
**4. Discard（丢弃）** - 丢弃所有变更

请选择？
```

### Step 5：提交变更（如有未提交的变更）

如果分支上还有未提交的变更，先提交：

```bash
git add <specific-files>
git commit -m "$(cat <<'EOF'
feat: <功能描述>

- 变更 1
- 变更 2

Co-Authored-By: AI Assistant
EOF
)"
```

### Step 6：执行用户选择

1. **Merge**: `git checkout <branch> && git merge --no-ff feature/<date>-<name> && git push origin <branch>`
2. **Pull Request**: `git push -u origin feature/<date>-<name>` → `gh pr create --title "feat: <描述>" --body "..."`
3. **Keep**: 保持分支状态，提醒用户稍后继续
4. **Discard**: `git checkout <branch> && git branch -D feature/<date>-<name>`

## 提交信息规范

<!-- loom:generate:rule:conventional-commits -->
**Conventional Commits 格式**

提交信息必须遵循 Conventional Commits 格式：`<type>(<scope>): <subject>`

- **feat**: 新功能
- **fix**: Bug 修复
- **refactor**: 重构（不改变行为）
- **docs**: 文档
- **test**: 测试
- **chore**: 构建/工具变更
<!-- /loom:generate:rule:conventional-commits -->

## 约束

- 提交前必须运行完整验证
- 提交信息必须清晰描述变更内容
- 禁止提交敏感信息（密钥、密码等）

<!-- loom:generate:rule:no-main-branch -->
**禁止在主分支实现**

没有明确用户同意，永远不要在 main/master 分支上开始实现。
<!-- /loom:generate:rule:no-main-branch -->
