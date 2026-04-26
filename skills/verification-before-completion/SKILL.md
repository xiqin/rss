---
name: verification-before-completion
description: >
  完成前验证。在宣布任务完成前，执行完整性检查确保所有工作已完成。
  Use when: before declaring a task or feature complete.
---

# 完成前验证

## 验证清单

在宣布任务完成前，必须执行以下检查：

### 1. 编译验证

```bash
go build ./...
```

- [ ] 编译通过，无错误
- [ ] 无编译警告

### 2. 静态分析

```bash
go vet ./...
```

- [ ] vet 通过，无警告

### 3. 测试验证

```bash
go test ./... -v -count=1
```

- [ ] 所有测试通过
- [ ] 无跳过的测试（除非有正当理由）

### 4. 代码审查

- [ ] 遵守编码红线
- [ ] 无业务逻辑在 Controller
- [ ] 无 `fmt.Println`
- [ ] 无硬编码配置
- [ ] 无 SQL 拼接
- [ ] 错误处理正确
- [ ] 日志格式规范

### 5. 功能验证

- [ ] spec.md 中的所有功能已实现
- [ ] 接口可正常调用
- [ ] 响应格式正确
- [ ] 错误处理正确

### 6. 文档同步

- [ ] ENGINEERING-INDEX.md 已更新
- [ ] MEMORY.md 已更新（如需要）
- [ ] 进度追踪已更新

## 执行流程

### Step 1：运行编译和测试

```bash
go build ./... && go vet ./... && go test ./... -v -count=1
```

### Step 2：检查代码质量

对照编码红线逐一检查。

### Step 3：对照 spec 验证

读取 `specs/<feature>/spec.md`，确认所有功能已实现。

### Step 4：确认文档同步

检查索引文件是否已更新。

### Step 5：输出验证报告

```markdown
## 完成前验证报告

**功能：** xxx
**验证时间：** YYYY-MM-DD HH:mm

### 检查结果

| 检查项 | 状态 | 说明 |
|--------|------|------|
| go build | ✅ | 编译通过 |
| go vet | ✅ | 无警告 |
| go test | ✅ | 全部通过 |
| 编码红线 | ✅ | 无违规 |
| 功能完整性 | ✅ | 全部实现 |
| 文档同步 | ✅ | 已更新 |

**结论：** ✅ 可以提交
```

## 约束

- 所有检查必须通过才能提交
- 任何一项失败都需要先修复
- 不允许跳过检查
