# /rss-execute-plan

执行实现计划。

## 用法

```
/rss-execute-plan [feature-name]
```

## 功能

执行后 3 步（git-worktree → subagent-dev → index-update）：

1. git-worktree — 创建隔离分支
2. subagent-driven-development — 派发 subagent 编码执行
3. index-update — 同步工程索引

## 前置条件

- `plan.md` 必须存在（由 writing-plans 生成）

## 流程

```
创建分支 → 派发 implementer + reviewer subagent → 全量测试 → 更新索引 → 完成
```

## 示例

```
/rss-execute-plan passport-list
```
