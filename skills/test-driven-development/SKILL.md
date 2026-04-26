---
name: test-driven-development
description: >
  测试驱动开发。使用 TDD 的红-绿-重构循环开发功能。
  Use when: implementing new features with a test-first approach.
---

# 测试驱动开发（TDD）

## 核心循环

```
红（Red）→ 绿（Green）→ 重构（Refactor）
```

1. **红**：先写一个失败的测试
2. **绿**：写最少的代码让测试通过
3. **重构**：优化代码结构，保持测试通过

## 执行流程

### Step 1：理解需求

1. 读取 `specs/<feature>/spec.md` 获取需求
2. 读取 `specs/<feature>/plan.md` 获取实现计划
3. 明确当前 task 的测试范围

### Step 2：红（写失败测试）

1. 为当前功能编写测试用例
2. 测试应验证 spec.md 中定义的预期行为
3. 运行测试，确认测试失败

```bash
go test ./path/to/ -v -run TestXxx
```

### Step 3：绿（写最少代码）

1. 编写最少的代码让测试通过
2. 不要过度设计
3. 运行测试，确认测试通过

```bash
go test ./path/to/ -v -run TestXxx
```

### Step 4：重构（优化代码）

1. 在测试保护下优化代码
2. 消除重复、改善命名
3. 运行测试，确认测试仍然通过

```bash
go test ./path/to/ -v -run TestXxx
go build ./... && go vet ./...
```

### Step 5：重复

对下一个功能点重复以上循环。

## 测试编写规范

### 测试文件命名

- 测试文件与源文件同目录，以 `_test.go` 结尾
- 测试函数以 `Test` 开头，后接方法名

### 测试结构

```go
func TestXxxService_MethodName(t *testing.T) {
    // 1. 准备（Arrange）
    repo := test.GetTestRepo()
    svc := NewXxxService(repo)

    // 2. 执行（Act）
    result, err := svc.MethodName(params...)

    // 3. 断言（Assert）
    if err != nil {
        t.Fatalf("expected no error, got %v", err)
    }
    if result == nil {
        t.Fatal("expected result, got nil")
    }
}
```

### 测试覆盖

- 正常流程：验证正确行为
- 异常流程：验证错误处理
- 边界条件：验证边界值处理

## 约束

- 每个新功能必须先写测试
- 测试失败时禁止写实现代码
- 测试通过后方可进入下一个功能
- 所有测试必须可独立运行
