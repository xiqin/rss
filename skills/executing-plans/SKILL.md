---
name: executing-plans
description: >
  执行计划。按计划文件逐任务执行实现。
  Use when: executing a structured implementation plan.
  Trigger keywords: 执行计划, 按计划执行, run plan.
---

# 执行计划

## 触发条件

- `plan.md` 已存在
- 用户确认计划后

## 执行流程

### Step 1：读取计划

1. 读取 `specs/<feature>/plan.md`
2. 提取所有 task
3. 分析依赖关系

### Step 2：按顺序执行

严格按 task 编号顺序执行：

1. 先执行无依赖的 task
2. 等依赖 task 完成后再执行后续 task
3. 每个 task 完成后验证

### Step 3：每个 Task 执行

```
对于每个 Task：
1. 读取 task 完整内容
2. 理解实现步骤
3. 编写代码
4. 编写测试
5. 运行测试
6. 验证编译
```

### Step 4：逐任务验证

每个 task 完成后：

```bash
go test ./path/to/ -v -run TestXxx
go build ./... && go vet ./...
```

### Step 5：全量验证

所有 task 完成后：

```bash
go build ./... && go vet ./... && go test ./... -v -count=1
```

## 状态追踪

在执行过程中更新进度：

```markdown
## 执行进度

| Task | 状态 | 完成时间 |
|------|------|---------|
| Task 1 | ✅ 完成 | HH:mm |
| Task 2 | ✅ 完成 | HH:mm |
| Task 3 | ▶ 进行中 | — |
| Task 4 | ⏳ 等待 | — |
```

## 约束

- 严格按 task 顺序执行
- 每个 task 必须通过测试才能继续
- 遇到依赖缺失时停止并提示
- 遇到模糊不清时停止并询问用户

## 完成条件与下一步

所有 task 完成且测试通过后，触发 code-review 进行代码审查。
