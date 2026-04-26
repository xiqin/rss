# /rss-write-plan

拆解实现计划。

## 用法

```
/rss-write-plan [feature-name]
```

## 功能

加载 `skills/writing-plans/SKILL.md`，拆解实现计划：

1. 读取 `specs/<date+feature>/spec.md`
2. 按 Model → Service → Controller → Router 分层拆分 task
3. 输出 `specs/<date+feature>/plan.md`
4. 等待用户确认 plan

## 前置条件

- `spec.md` 必须存在（由 brainstorming 生成）

## 示例

```
/rss-write-plan passport-list
```
