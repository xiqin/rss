---
name: subagent-driven-development
description: >
  使用 subagent 派发方式执行编码任务。每个 task 派发独立 subagent，
  每轮编码后派发 reviewer subagent 审查（spec + quality 合并）。
  Use when: executing a plan with isolated subagents and review checkpoints.
---

# Subagent 编码执行

## 触发条件

- `specs/<date+feature>/plan.md` 已存在
- git worktree 已创建
- 用户确认 plan 后自动触发

## 状态输出

执行开始时：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■■■□] Step 4/5 — 编码执行 (subagent-dev)
 skill:   subagent-driven-development
 功能:    <功能名>
 status:  ▶ 开始执行 (N 个 task)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

执行结束时：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■■■□] Step 4/5 — 编码执行 (subagent-dev)
 status:  ✅ 完成 (N/N task PASS, 测试报告已生成)
 下一步:  → Step 5: index-update
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 核心机制

**每个 task 派发 2 个独立 subagent，上下文互不继承：**

```
Task N ──→ implementer ──→ reviewer（spec + quality 合并）──→ PASS/FAIL
                │                       │
                │                 发现问题
                │                       │
                └───────────────────────┘
                    派回 implementer 修复
```

## 派发前准备

### Step 1：读取 plan

从 `specs/<date+feature>/plan.md` 读取所有 task，创建任务追踪列表。

### Step 2：读取项目约束（派发时传入精简上下文）

每个 subagent 注入精简上下文模板：`.claude/templates/subagent-context.md`（约 30-50 行，替代完整宪章 + 工程结构）。

同时传入：`specs/<date+feature>/spec.md` — 需求规格

## 每个 Task 的执行循环

### Phase 1：派发 implementer subagent

**输入上下文：**
- task 完整文本（来自 plan.md）
- `.claude/templates/subagent-context.md`（精简项目约束）
- `specs/<date+feature>/spec.md` 中相关章节

**implementer 的指令模板：**

```
你是项目的编码实现者。

## 任务
<plan.md 中的完整 task 文本>

## 项目约束（必须严格遵守）
<subagent-context.md 全文>

## 实现要求
1. 严格按 task 中的实现步骤编写代码
2. 编写对应的单元测试文件
3. 根据上方项目约束中的构建和测试命令执行（BUILD_CMD、VET_CMD、TEST_CMD 已在 subagent-context.md 模板中渲染为实际命令）
4. 如果 task 有依赖的前置 task，检查相关代码是否已存在

## 输出
列出所有创建/修改的文件路径，附完整代码。
```

### Phase 2：派发 reviewer subagent（spec + quality 合并）

**输入上下文：**
- implementer 的输出（创建/修改的文件列表 + 代码）
- `specs/<date+feature>/spec.md`（完整需求）
- `specs/<date+feature>/plan.md`（当前 task 定义）
- git diff（仅变更部分）
- `.claude/templates/subagent-context.md`（精简项目约束）

**reviewer 指令模板（合并 spec 审查 + 5 维质量审查）：**

```
你是项目的代码审查员，执行规格审查和质量审查。

## Part 1：规格审查

对照 spec.md 和 plan.md 检查：
1. 接口定义、参数、响应结构、业务规则是否全部实现
2. task 中定义的每个步骤是否都已完成
3. 是否有多余的实现（超出 spec 范围）
4. 测试用例是否覆盖 spec 中的关键场景

### SPEC 结果
- **SPEC_COMPLIANT** / **SPEC_DEVIATION**
  - 偏差点: <描述> | 严重度: Critical/Important/Suggestion

## Part 2：5 维质量审查

### 维度 1：架构合规性（BLOCKER）
- Controller 是否包含业务逻辑
- 是否跨层调用
- 依赖是否单向流动

### 维度 2：代码质量（BLOCKER）
- 命名规范、错误处理、日志格式
- 是否使用禁止的函数（如 fmt.Println）

### 维度 3：安全风险（BLOCKER）
- SQL 注入、硬编码、权限校验、信息泄露

### 维度 4：性能隐患（WARNING）
- N+1 查询、循环内 IO、缓存使用

### 维度 5：规范一致性（WARNING）
- 响应格式、错误码、配置、注释

### QUALITY 结果
## BLOCKER (0)
（无）

## WARNING (N)
- W1: ...

## SUGGESTION (N)
- S1: ...

## QUALITY_PASS / QUALITY_FAIL

## 最终判定
- SPEC_COMPLIANT + QUALITY_PASS → PASS，进入下一个 task
- 任一 Critical 偏差 或 BLOCKER → FAIL，派回 implementer 修复
- 仅有 Important/Suggestion/WARNING → 记录，PASS
```

**判定规则：**
- PASS → 进入下一个 task
- FAIL → 派回 Phase 1 修复，重新走 Phase 2

## 全部 task 完成后

### Phase 3：派发 test-reporter subagent（集成测试验证）

全部 task 通过审查后，派发一个 test-reporter subagent 生成集成测试报告。

**输入上下文：**
- `specs/<date+feature>/spec.md`（完整需求，含所有接口定义）
- `specs/<date+feature>/plan.md`（实现计划）
- 项目测试命令的完整输出
- 编译和静态分析的输出

**test-reporter 的指令模板：**

```
你是项目的测试报告生成者。

## 任务
基于 spec.md 中的接口定义和已实现的代码，生成集成测试报告。

## 执行步骤

### 1. 运行全量测试
执行项目测试命令并收集输出。

### 2. 对照 spec 验证
对 spec.md 中定义的每个接口，逐一检查：
- 正常流程：接口是否能正确响应
- 参数验证：缺少必填参数、类型错误、越界值是否正确返回错误
- 权限校验：无 Token / 过期 Token / 无权限是否正确拦截
- 业务逻辑：创建/更新/删除后数据状态是否正确

### 3. 输出测试报告
保存到 `specs/<date+feature>/test-report.md`。
```

### Phase 3 判定规则

- **全部 PASS** → 通过，触发 index-update skill
- **存在 FAIL** → 不通过，派回 implementer 修复后重新走 Phase 3
- **存在 WARN** → 警告，等用户选择跳过或修复

### 最终验证

在 test-reporter 之前，先执行全量编译和测试。全部通过后方可派发 test-reporter 生成报告。同时更新 `specs/<date+feature>/progress.md`。

## 关键规则

1. **subagent 互不继承上下文** — 每个 subagent 是全新会话，必须完整传入所需上下文
2. **绝不跳过审查** — implementer 完成后必须过 reviewer（spec + quality 合并）
3. **BLOCKER 阻断** — 任一审查有 BLOCKER 或 Critical 偏差则不进入下一个 task
4. **TDD 验证** — implementer 必须编写并运行单元测试，测试失败等同 BLOCKER
5. **测试报告必须生成** — 全部 task 完成后必须派发 test-reporter，报告有 FAIL 则禁止进入 index-update
6. **停止条件** — 遇到 plan 不清晰、重复修复无效、spec 有歧义时，立即停止并询问用户
