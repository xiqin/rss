# Loom 流水线可靠性最终改进方案

> 文档状态：设计方案，尚未实施
> 适用范围：Loom 流水线、核心状态机、Skills、验证脚本、测试与质量评估体系
> 编制日期：2026-07-20

---

## 1. 执行摘要

Loom 当前已经具备规格、计划、任务、执行、验证、审查和索引同步等完整阶段，但其可靠性约束主要存在于 Skill 提示词和 Markdown 报告中。状态机能够证明产物存在、命令退出码为 0、报告包含 `PASS`，却不能确定性证明以下事实：

- 用户需求中的每个细节都已被识别。
- 每个需求细节都进入了计划和任务。
- 每个任务都真实完成并经过独立审查。
- 每个需求细节都有代码、测试和当前版本证据。
- 实现没有遗漏边界、失败、权限、并发、回滚等非主路径。
- 审批、测试和审查证据对应的是当前版本产物。
- 实现没有引入规格之外的行为。

其中最关键的问题是：**AI 在实现需求时天然可能遗漏细节**。该问题无法通过扩写提示词或增加一次最终审查彻底解决，因为模型仍可能在长上下文、复杂代码和多目标任务中优先完成主路径，并错误地认为工作已经结束。

本方案不以“让 AI 第一次就绝不遗漏”为目标，而是建立以下系统性保证：

> 即使 AI 在某次实现中漏掉细节，该细节也不会从结构化账本中消失；没有对应代码、测试和证据时，流水线不能完成；遗漏被发现后会自动形成新任务并重新进入实现循环。

核心改造包括：

1. 将 Requirement 展开为可独立验证的 Behavior Obligation。
2. 建立 `需求 -> 行为义务 -> 任务 -> 代码 -> 测试 -> 证据 -> 裁决` 的端到端追踪账本。
3. 新增实现前的细节展开和产物一致性分析阶段。
4. 将执行阶段改为每次只实现 1 至 3 个行为义务的细粒度循环。
5. 为每次实现生成冻结、有哈希、范围受控的 Implementation Packet。
6. 每个行为义务执行独立的 Red-Green-Verify 循环。
7. 增加专门从需求反查代码的 `omission-hunter`，发现“应该存在但不存在”的实现。
8. 新增实现后的 convergence 阶段，发现遗漏后追加任务并回流执行。
9. 将任务状态、需求闭环、审批哈希和结构化收据变成状态机硬门禁。
10. 建立以错误放行为核心指标的持续 Eval 和故障样本库。

---

## 2. 当前问题与审计结论

### 2.1 根本问题

当前 Loom 的主要缺陷不是流程阶段数量不足，而是“文档式约束”没有转化为“可执行契约”。

现有机制大体采用以下判断方式：

```text
产物文件存在
  + 没有明显占位符
  + 报告包含 PASS
  + 命令退出码为 0
  + 日志哈希匹配
  = 允许推进
```

该方式只能证明某条命令执行成功以及日志未被篡改，不能证明命令覆盖了正确需求，更不能证明所有需求细节均已实现。

目标判断方式应调整为：

```text
所有需求已结构化
  + 所有细节已展开为行为义务
  + 所有行为义务已进入任务
  + 所有任务状态真实完成
  + 所有行为义务有代码引用
  + 所有行为义务有测试引用
  + 所有行为义务有当前代码版本证据
  + 独立遗漏审查无阻断项
  + 实现与规格完成收敛
  = 允许推进
```

### 2.2 主要证据

| 严重性 | 位置 | 问题 | 后果 |
|---|---|---|---|
| 严重 | `src/core/pipeline-engine.js` | `advance()` 不读取任务状态作为 executing 离开门禁 | 无 task state 或存在 pending/blocked task 时仍可能推进 |
| 严重 | `src/core/artifact-checker.js` | 主要校验文件存在、占位符、PASS 文本和命令证据 | 形式正确但语义不完整的报告可以通过 |
| 严重 | `tests/e2e/pipeline-flow.test.js` | 极简 spec、空洞任务和伪 PASS 证据可以走完整流程 | 测试固化了错误放行行为 |
| 高 | `src/core/pipeline-engine.js` | `approve()` 未绑定被批准产物的哈希 | 审批后产物改变，原审批语义仍可能被沿用 |
| 高 | `src/core/pipeline-selector.js` | `_isInWorktree()` 使用 `--is-inside-work-tree` | 普通 Git 仓库会被误判为额外 worktree |
| 高 | `src/core/pipeline-selector.js` | short circuit 跳过依赖闭包和 Gate 修正 | quickfix、hotfix 等流程可绕过统一护栏 |
| 高 | 核心 Skills | 完整性要求主要依赖提示词自述 | implementer 或 reviewer 声称完成，但引擎无法验证 |
| 中 | `templates/workflow.yaml`、`config/pipeline.schema.json` | 存在流程定义漂移 | 文档、工具和实际执行行为不一致 |
| 中 | Skill evals | 主要是触发测试，缺少产物质量和错误放行测试 | 无法量化遗漏率和 Skill 可靠性 |

### 2.3 AI 实现细节遗漏的直接原因

AI 在编码中遗漏细节通常不是单一提示词问题，而是工作单元、上下文和反馈机制共同造成：

1. 一个任务同时包含正常路径、权限、并发、回滚、兼容和可观测性等多种目标。
2. 需求细节只存在于自然语言段落中，没有成为不可丢失的执行对象。
3. 阅读源码、日志和历史信息后，初始需求在上下文中的权重下降。
4. 主路径测试通过后，AI 容易产生“任务已完成”的错误判断。
5. 实现者同时负责声明自己完成，缺少外部状态约束。
6. 普通代码审查更擅长发现已有代码中的错误，不擅长发现本应存在却不存在的代码。
7. 修复遗漏时常以“顺便补一下”的方式继续原任务，隐藏不变量可能再次被漏掉。

---

## 3. 改进目标与非目标

### 3.1 改进目标

本次改造需要实现以下结果：

- 每个需求细节都成为具有稳定 ID 的结构化对象。
- 任何细节在未验证前保持 `failing` 或 `unverified`，不能被实现 Agent 自行删除或标记完成。
- 每次实现只处理少量行为义务，避免任务过大和上下文稀释。
- 状态机基于结构化事实推进，而不是基于自然语言 PASS 推进。
- 每项需求均可追踪到任务、代码、测试、证据和裁决。
- 代码事实与需求意图可以双向核对。
- 发现遗漏后自动生成新行为义务和新任务，形成可审计的回流闭环。
- 错误放行率可以通过固定故障样本持续测量。

### 3.2 非目标

- 不承诺 AI 第一次实现就绝不遗漏。
- 不以增加更多提示词作为主要解决方案。
- 不要求所有验证都必须是传统单元测试；静态分析、契约测试、性能基准和人工审批可以作为特定类型证据。
- 不让大模型直接决定最终 PASS；模型可以发现问题和生成候选映射，最终状态由确定性验证器写入。
- 不在没有明确需求时引入隐藏的兼容层或自动降级逻辑。

---

## 4. 设计原则

### 4.1 细节不可丢失

需求一旦进入已审批账本，就不能被执行 Agent 删除。新增、修改或关闭需求必须留下来源、理由和审批记录。

### 4.2 小步执行

一次实现只处理 1 至 3 个行为义务，预计修改文件不超过 5 个，并且只包含一种主要关注点。

### 4.3 外部验证

implementer 只能提交候选实现和候选证据，只有独立验证器可以将行为状态改为 `passing`。

### 4.4 双向追踪

既要从需求追踪到代码，也要从代码 diff 反查对应需求，避免遗漏和未请求实现。

### 4.5 证据绑定版本

审批、测试和审查收据必须绑定 artifact hash、Git tree 或 diff hash。代码变化后旧证据自动失效。

### 4.6 确定性 Gate 优先

可以通过程序验证的规则必须由程序执行。模型裁决只能作为 finding 输入，不能替代状态机门禁。

### 4.7 追加式回流

发现遗漏后追加新的行为义务和任务，不静默改写旧的完成记录，确保问题来源、修复过程和重复模式可审计。

### 4.8 单一事实源

`templates/workflow.yaml` 作为流水线定义唯一来源，其他 schema、目录和文档由其生成并通过 drift test 校验。

---

## 5. 目标流水线

### 5.1 主流程

```text
brainstorming
  -> detail-expansion
  -> planning
  -> artifact-analysis
  -> approval
  -> git-worktree
  -> executing-loop
  -> convergence
       -> 有遗漏或冲突：追加任务并返回 executing-loop
       -> 无阻断项：继续
  -> verification
  -> parallel-evaluation
  -> review-gate
  -> review-response
  -> index-sync
```

### 5.2 执行阶段内部循环

```text
选择 1 至 3 个 Behavior Obligations
  -> 生成冻结的 Implementation Packet
  -> 建立或确认失败测试
  -> 运行测试并确认预期失败
  -> 编写最小实现
  -> 运行目标测试
  -> 运行影响测试
  -> 主动回忆检查
  -> 提交候选实现收据
  -> 独立任务审查
  -> omission-hunter 反向审查
  -> 外部验证器更新行为状态
  -> 处理下一批行为义务
```

### 5.3 流水线回流条件

以下任一条件成立时必须回到 executing，不得带警告继续：

- 存在 `missing` 行为。
- 存在 `partial` 行为。
- 存在 `contradicts` 行为。
- 存在未批准的 `unrequested` 行为。
- 存在 `unverifiable` 行为。
- 存在无测试证据的行为义务。
- 存在对应旧 Git tree 的证据。
- omission-hunter 或任一 evaluator 报告 BLOCKER。

---

## 6. 结构化数据契约

### 6.1 文件布局

建议将规格目录扩展为：

```text
specs/<date+feature>/
├── spec.md
├── requirements.json
├── traceability.json
├── plan.md
├── artifact-analysis.json
├── tasks/
├── task-states/
├── implementation-packets/
├── receipts/
│   ├── approvals/
│   ├── implementations/
│   ├── tests/
│   ├── reviews/
│   └── evaluations/
├── findings/
├── handoffs/
├── convergence-report.json
├── test-report.md
├── verify-report.md
└── pipeline.state.json
```

`spec.md` 继续保存背景、目标、方案和业务语义；`requirements.json` 是执行阶段的机器可验证需求账本。二者必须共同审批，出现不一致时由 artifact-analysis 阻断。

### 6.2 Requirement 与 Behavior Obligation

Requirement 不应直接作为最小完成单位。每项 Requirement 必须展开为多个 Behavior Obligation：

```json
{
  "schema_version": 1,
  "spec_sha256": "sha256:...",
  "requirements": [
    {
      "id": "REQ-001",
      "title": "用户可以取消订阅",
      "type": "functional",
      "priority": "must",
      "status": "failing",
      "obligations": [
        {
          "id": "REQ-001-B01",
          "category": "happy-path",
          "description": "有效订阅可以被所有者取消",
          "status": "failing",
          "task_ids": [],
          "code_refs": [],
          "test_refs": [],
          "evidence_receipts": []
        },
        {
          "id": "REQ-001-B02",
          "category": "authorization",
          "description": "非订阅所有者不能取消订阅",
          "status": "failing",
          "task_ids": [],
          "code_refs": [],
          "test_refs": [],
          "evidence_receipts": []
        },
        {
          "id": "REQ-001-B03",
          "category": "idempotency",
          "description": "重复取消不能重复退款或重复发布事件",
          "status": "failing",
          "task_ids": [],
          "code_refs": [],
          "test_refs": [],
          "evidence_receipts": []
        }
      ]
    }
  ]
}
```

允许的行为状态建议为：

```text
failing
in_progress
candidate_implemented
passing
blocked
superseded
```

状态约束：

- implementer 可以申请 `candidate_implemented`。
- 确定性验证器可以写入 `passing`。
- `superseded` 必须引用替代项、变更理由和新审批收据。
- 已审批行为不得被执行 Agent 删除。

### 6.3 强制细节分类

每项 Requirement 至少需要对以下维度给出结论：

| 分类 | 必须回答的问题 |
|---|---|
| `happy-path` | 正常输入和正常状态产生什么结果 |
| `boundary` | 空值、零值、最大值和临界状态如何处理 |
| `invalid-input` | 缺失、非法格式和非法组合如何处理 |
| `authorization` | 谁允许操作，谁必须被拒绝 |
| `state-transition` | 哪些前置状态允许或禁止转换 |
| `idempotency` | 重复请求是否产生重复副作用 |
| `concurrency` | 并发操作下如何保证一致性 |
| `atomicity` | 中途失败是否留下部分状态 |
| `external-failure` | 超时、重试和重复回调如何处理 |
| `compatibility` | 旧调用方、旧数据和旧配置是否保持有效 |
| `security` | 是否存在越权、注入、泄露和滥用风险 |
| `performance` | 数据规模扩大后有什么上限和退化风险 |
| `observability` | 日志、指标、追踪和审计要求是什么 |
| `recovery` | 失败后如何重试、补偿或回滚 |
| `forbidden-behavior` | 哪些副作用明确不能发生 |

每个分类必须是以下三种结果之一：

```text
applicable，并生成一个或多个行为义务
not_applicable，并给出理由
requires_clarification，并阻断后续阶段
```

### 6.4 测试计划

每个 Behavior Obligation 在进入执行阶段前必须具有测试计划：

```json
{
  "obligation_id": "REQ-001-B03",
  "test_plan": {
    "type": "integration",
    "setup": "创建有效订阅",
    "action": "使用相同幂等键连续发送两次取消请求",
    "expected": [
      "订阅状态为 cancelled",
      "仅产生一个退款记录",
      "仅发布一个 SubscriptionCancelled 事件"
    ],
    "forbidden": [
      "第二次请求不得重复退款",
      "第二次请求不得重复发布事件"
    ]
  }
}
```

验证方式可以是：

- 单元测试。
- 集成测试。
- API 或事件契约测试。
- 数据迁移验证。
- 静态分析。
- 安全扫描。
- 性能基准。
- Property-based testing。
- 状态机测试。
- 人工 Gate，适用于无法自动判断的视觉或业务决策。

### 6.5 Traceability Ledger

`traceability.json` 维护端到端映射：

```text
Requirement
  -> Behavior Obligation
  -> Acceptance Scenario
  -> Task
  -> Implementation Packet
  -> Code Reference
  -> Test Reference
  -> Evidence Receipt
  -> Review Receipt
  -> Final Verdict
```

该文件由 Loom 验证器维护，AI 不直接写入最终裁决字段。

---

## 7. 实现期防遗漏机制

### 7.1 Detail Expansion

新增 `loom-detail-expansion` Skill，放在 brainstorming 后、planning 前。

职责：

- 从 `spec.md` 提取 Requirement。
- 为 Requirement 分配稳定 ID。
- 按强制分类展开 Behavior Obligation。
- 生成正常、异常、边界和禁止行为。
- 标记待澄清问题。
- 为每个行为义务生成测试策略草案。
- 输出 `requirements.json`。

完成条件：

- Requirement ID 唯一。
- Behavior Obligation ID 唯一。
- 所有强制分类均有结论。
- `requires_clarification` 数量为 0。
- 每个行为义务均有可判断的预期结果。
- 每个行为义务均有验证方式。

### 7.2 小批量执行

implementer 每次最多接收 3 个 Behavior Obligations，并满足：

```text
预计修改文件 <= 5
预计上下文源码 <= 可用上下文的 30%
只包含一种主要关注点
不存在未解决的需求澄清项
```

超过阈值时必须拆分任务。例如：

```text
T1A 正常路径和基本状态转换
T1B 权限与拒绝路径
T1C 幂等和并发
T1D 失败回滚和补偿
T1E 审计、通知和可观测性
```

### 7.3 Implementation Packet

每次实现前由 orchestrator 生成冻结、有哈希的实现包：

```json
{
  "schema_version": 1,
  "task_id": "T1B",
  "obligation_ids": ["REQ-001-B02"],
  "acceptance_scenarios": ["REQ-001-AC-03"],
  "must_preserve": [
    "管理员代取消行为",
    "旧客户端错误码",
    "SubscriptionCancelled 事件结构"
  ],
  "code_context": [
    "SubscriptionService.cancel",
    "SubscriptionController.cancel",
    "AuthorizationPolicy.canCancel"
  ],
  "callers": [
    "SubscriptionApi",
    "AdminSubscriptionApi"
  ],
  "existing_tests": [
    "tests/subscription/subscription-cancel.integration.test.ts"
  ],
  "allowed_files": [
    "src/subscription/subscription-service.ts",
    "tests/subscription/subscription-cancel.integration.test.ts"
  ],
  "required_commands": [
    "npm test -- subscription-cancel.integration.test.ts"
  ],
  "packet_sha256": "sha256:..."
}
```

Implementation Packet 必须包含：

- 当前批次行为义务。
- 验收场景。
- 必须保持的不变量。
- 相关代码符号和调用方。
- 已有测试。
- 允许修改范围。
- 要求执行的命令。
- 上一轮失败原因。
- 包内容哈希。

该文件由规划器和仓库侦察器生成，implementer 不得自行扩大允许修改范围。确需扩大时必须提交 scope-change finding，由 orchestrator 更新计划和 Packet。

### 7.4 行为级 Red-Green-Verify

每个行为义务执行独立循环：

```text
读取 Behavior Obligation
  -> 写入或确认对应失败测试
  -> 执行测试并确认失败原因符合预期
  -> 编写最小生产代码
  -> 执行目标测试
  -> 执行影响测试
  -> 记录代码和测试引用
  -> 提交候选证据
  -> 外部验证器裁决
```

禁止以下做法：

- 在整个任务完成后统一声称全部行为通过。
- 没有观察到预期失败就直接编写生产代码。
- 使用一个宽泛的测试命令证明所有行为。
- implementer 自行将行为标记为 `passing`。

### 7.5 主动回忆检查点

每个实现批次至少设置三个检查点：

1. 编码前：当前必须实现哪些行为，必须保持哪些不变量？
2. 首次目标测试通过后：还有哪些行为、拒绝路径和禁止副作用未处理？
3. 任务结束前：当前 diff 中每一处修改对应哪个行为义务？

实现 Agent 必须提交结构化候选映射：

```json
{
  "obligations": [
    {
      "id": "REQ-001-B02",
      "implementation_refs": [
        "src/subscription/subscription-service.ts:85-101"
      ],
      "test_refs": [
        "tests/subscription/subscription-cancel.integration.test.ts:120-151"
      ],
      "preserved_invariants": [
        "管理员代取消行为未改变"
      ],
      "candidate_status": "candidate_implemented"
    }
  ]
}
```

### 7.6 Omission Hunter

新增独立只读 `omission-hunter`，其职责不是审查已有代码写得是否漂亮，而是发现缺失实现。

它必须从需求向代码反查：

```text
Behavior Obligation -> Code
Behavior Obligation -> Test
Expected Side Effect -> Positive Assertion
Forbidden Side Effect -> Negative Assertion
Failure Scenario -> Rollback Assertion
Public Change -> Compatibility Assertion
```

重点检查：

- 是否只实现正常路径。
- 是否只断言成功结果，没有断言禁止副作用。
- 是否遗漏权限拒绝。
- 是否遗漏重复请求和并发组合。
- 是否遗漏外部依赖失败和部分提交。
- 是否遗漏旧调用方、旧数据和公开接口兼容性。
- 是否遗漏日志、审计、指标和追踪。
- 是否存在代码修改无法映射到任何已审批行为。

finding 至少包含：

```json
{
  "id": "FINDING-017",
  "severity": "BLOCKER",
  "type": "missing-behavior",
  "requirement_id": "REQ-001",
  "obligation_id": "REQ-001-B04",
  "evidence": "退款失败场景没有代码分支和测试断言",
  "suggested_action": "创建新的修复任务"
}
```

### 7.7 生成式测试与不变量

对于状态组合多、输入空间大或失败路径复杂的模块，应定义不变量并使用生成式测试：

- Property-based testing。
- Fuzz testing。
- 状态机测试。
- Metamorphic testing。
- 契约测试。
- 差分测试。
- 故障注入。

示例不变量：

```text
无论相同请求重复多少次，成功退款记录最多一个
无论在哪一步失败，订阅与退款状态必须保持一致
非所有者在任何订阅状态下都不能取消
取消完成后重复请求不得再次发布事件
```

### 7.8 上下文控制

implementer 的上下文只应包含：

- 当前 Behavior Obligations。
- 相关验收场景。
- 必须保持的不变量。
- 相关代码符号及调用链。
- 相关测试。
- 允许修改范围。
- 上一轮失败摘要。

不应默认加载：

- 所有 task 文件。
- 所有历史 handoff。
- 完整长日志。
- 无关源码。
- 多轮审查讨论全文。

提示末尾应始终保留一个不可省略的短清单：

```text
未完成行为：REQ-001-B03、REQ-001-B04
禁止回归：管理员代取消、旧错误码、事件格式
完成条件：每项行为均有代码引用、测试引用和当前 Git tree 证据
```

### 7.9 遗漏回流

发现遗漏后不得用一句“顺便修复”继续原任务，而应形成完整回流：

```text
finding
  -> 新 Behavior Obligation
  -> 新 Task
  -> 新 Implementation Packet
  -> 新失败测试
  -> 新实现
  -> 新证据
  -> 重新 convergence
```

新增行为义务必须记录来源：

```json
{
  "id": "REQ-001-B06",
  "source": "convergence-finding",
  "introduced_by": "FINDING-017",
  "description": "退款超时后不能把订阅标记为 cancelled",
  "status": "failing"
}
```

---

## 8. Artifact Analysis 与 Convergence

### 8.1 Artifact Analysis

新增 `loom-analyze-artifacts` Skill，放在 planning 后、approval 前，以只读方式分析：

- `.loom/memory/constitution.md`
- `spec.md`
- `requirements.json`
- `plan.md`
- `tasks/*.md`

检查内容：

- 重复、歧义和不可测试需求。
- spec 与 requirements 不一致。
- spec、plan 与 tasks 冲突。
- 未映射到任务的 Requirement 或 Behavior Obligation。
- 未覆盖的边界和非功能要求。
- 无效依赖和依赖环。
- `owns` 范围交集。
- 架构约束冲突。
- 测试策略缺失。
- 未解决的澄清项。

强制门禁：

```text
Requirement -> Task 覆盖率 = 100%
Behavior Obligation -> Task 覆盖率 = 100%
Behavior Obligation -> Test Plan 覆盖率 = 100%
CRITICAL findings = 0
HIGH findings = 0
依赖环 = 0
未知 ID = 0
requires_clarification = 0
```

### 8.2 Convergence

新增 `loom-converge` Skill，放在 executing 后、verification 前，以当前代码和测试为事实来源，分类每个行为义务：

```text
implemented
partial
missing
contradicts
unrequested
unverifiable
```

Convergence 必须同时执行：

- 从需求到账本、任务、代码和测试的正向检查。
- 从 Git diff 到 Requirement/Obligation 的反向检查。
- 对禁止行为和不变量的负向检查。
- 对公开 API、数据结构和调用方的影响检查。
- 对当前证据 Git tree 的一致性检查。

只有以下条件全部成立才视为收敛：

```text
missing = 0
partial = 0
contradicts = 0
unapproved_unrequested = 0
unverifiable = 0
blocking_findings = 0
```

---

## 9. 状态机与声明式验证器

### 9.1 验证器声明

在 `templates/workflow.yaml` 中允许每个 step 声明 validators：

```yaml
- id: executing
  outputs:
    - test-report.json
  validators:
    - task-set-complete
    - all-task-states-done
    - task-handoffs-pass
    - requirement-task-closure
    - obligation-task-closure
    - review-receipts-pass
    - diff-within-ownership

- id: verification
  validators:
    - requirement-code-closure
    - obligation-test-closure
    - obligation-evidence-closure
    - evidence-bound-to-current-tree
    - convergence-pass
    - no-blocking-findings
```

### 9.2 必需验证器

| 验证器 | 强制规则 |
|---|---|
| `task-set-complete` | `tasks/*.md` 集合与 `task-states/*.state.json` 集合完全一致 |
| `all-task-states-done` | 不允许 pending、executing、reviewing、blocked 或 failed |
| `task-handoffs-pass` | 每个任务都有结构化实现与审查收据 |
| `requirement-task-closure` | 每个 Requirement 至少映射一个任务 |
| `obligation-task-closure` | 每个 Behavior Obligation 至少映射一个任务 |
| `requirement-code-closure` | 每个 Requirement 有有效代码落点 |
| `obligation-test-closure` | 每个 Behavior Obligation 有有效测试或验证引用 |
| `obligation-evidence-closure` | 每个 Behavior Obligation 有独立、当前版本的 PASS 证据 |
| `review-receipts-pass` | 所有必需 reviewer 均有结构化 PASS 收据 |
| `diff-within-ownership` | 变更在任务 owns 范围内，越界有批准记录 |
| `evidence-bound-to-current-tree` | 测试和审查证据绑定当前 Git tree 或 diff hash |
| `approval-current` | 当前 artifact hash 与审批收据一致 |
| `convergence-pass` | convergence 无阻断分类和 finding |
| `no-blocking-findings` | 所有 BLOCKER/HIGH 均已关闭并有验证证据 |

### 9.3 引擎推进规则

`PipelineEngine.advance()` 应按以下顺序执行：

1. 检查当前阶段 handoff 是否存在且未过期。
2. 检查当前阶段输出文件。
3. 加载并执行阶段声明的所有 validators。
4. 检查下一阶段 requires。
5. 检查上下文压缩要求。
6. 所有检查通过后原子更新状态。

任一 validator 失败时，返回结构化错误：

```json
{
  "validator": "obligation-evidence-closure",
  "status": "failed",
  "missing": ["REQ-001-B04"],
  "action": "返回 executing 并创建修复任务"
}
```

禁止仅通过报告中的 `PASS` 文本覆盖 validator 失败。

---

## 10. 结构化收据与审批

### 10.1 测试证据收据

Markdown 继续作为人类可读视图，状态机只消费 JSON 收据：

```json
{
  "schema_version": 1,
  "git_tree": "abc123...",
  "diff_sha256": "sha256:...",
  "command": "npm test -- --runInBand",
  "exit_code": 0,
  "log_file": "evidence/test.log",
  "log_sha256": "sha256:...",
  "obligations": [
    {
      "id": "REQ-001-B03",
      "test_ids": ["subscription.cancel.idempotency"],
      "result": "pass"
    }
  ]
}
```

要求：

- 测试命令来自项目允许列表或 constitution。
- 每个行为义务有独立证据映射。
- 收据记录 Git tree、diff hash、日志路径和日志哈希。
- 代码变化后旧收据自动过期。
- JSON 必须通过 schema 校验。
- Markdown 中的 PASS 不参与机器裁决。

### 10.2 审批收据

`approve()` 必须写入：

```json
{
  "schema_version": 1,
  "stage": "spec-approval",
  "artifacts": {
    "spec.md": "sha256:...",
    "requirements.json": "sha256:...",
    "plan.md": "sha256:...",
    "artifact-analysis.json": "sha256:..."
  },
  "approved_at": "2026-07-20T00:00:00.000Z",
  "approved_by": "human"
}
```

任一被批准产物变化时：

- 原审批自动失效。
- 流水线回到相应审批 Gate。
- 禁止复用旧 approval。

review-gate 进入前必须存在外部 review feedback，退出时必须绑定反馈版本和代码版本，不允许空审批。

---

## 11. 多视角独立评估

在最终 verification 前并行执行三个只读 evaluator：

| Evaluator | 关注点 |
|---|---|
| Requirements Evaluator | Requirement、Behavior Obligation、验收场景、代码和测试覆盖 |
| Architecture Evaluator | 架构约束、影响范围、API 兼容性、跨层调用、owns 越界 |
| Security/Test Evaluator | 权限、安全、失败路径、回归范围、测试真实性和负向断言 |

Evaluator 输出统一 finding schema：

```json
{
  "severity": "BLOCKER",
  "requirement_id": "REQ-004",
  "obligation_id": "REQ-004-B02",
  "file": "src/...",
  "evidence": "验收场景没有测试引用",
  "reason": "无法证明权限拒绝行为"
}
```

聚合规则：

```text
任一 evaluator 存在 BLOCKER -> FAIL
任一行为为 missing/partial/unverifiable -> FAIL
所有 evaluator PASS 且行为闭环率为 100% -> PASS
```

同一个 Agent 不应同时承担实现、测试、审查和最终证明职责。

---

## 12. Pipeline Selector 改进

### 12.1 使用真实仓库信号

Selector 应先执行 reconnaissance，再选择流程。信号至少包括：

- Git status 和 diff。
- 实际变更文件数。
- 实际模块或 package 数。
- CodeGraph 调用链和影响范围。
- 是否修改公共 API。
- 是否修改数据库 schema 或迁移。
- 是否涉及认证、授权、安全、支付或隐私数据。
- 是否影响已有测试。
- 是否跨服务、跨模块或跨仓库。
- 是否触及部署、配置或生成文件。

### 12.2 修复 worktree 判断

不能使用：

```bash
git rev-parse --is-inside-work-tree
```

应比较 `git rev-parse --git-dir` 与 `git rev-parse --git-common-dir`，或者解析：

```bash
git worktree list --porcelain
```

### 12.3 统一护栏

- 所有 short circuit 必须经过依赖闭包。
- 所有路径必须经过 Gate 修正。
- quickfix 和 hotfix 不得绕过任务完成、证据闭环等基础门禁。
- 执行中发现范围扩大时调用 `loom_adjust_pipeline`。
- 范围扩大后按风险自动追加 detail-analysis、convergence、review 或 worktree。

---

## 13. 单一事实源与生成体系

以 `templates/workflow.yaml` 为流水线定义唯一事实源，自动生成：

- `config/pipeline.schema.json`
- step catalog
- 流水线文档
- Skill 目录摘要
- 测试 fixture 标准阶段列表

CI 增加 drift test：

```text
执行生成命令后 git diff 必须为空
```

同时统一 `verification-report.md` 与 `verify-report.md` 等历史命名差异。

---

## 14. Skills 改造清单

### 14.1 新增 Skills

| Skill | 输入 | 输出 | 核心职责 |
|---|---|---|---|
| `loom-detail-expansion` | `spec.md` | `requirements.json` | 将需求展开为不可丢失的行为义务 |
| `loom-analyze-artifacts` | spec、requirements、plan、tasks、constitution | `artifact-analysis.json` | 实现前跨产物一致性和覆盖分析 |
| `loom-converge` | 需求账本、当前代码、测试、diff | `convergence-report.json` | 实现后识别 missing/partial/contradicts/unrequested |
| `loom-omission-hunter` | 行为义务、Packet、diff、测试 | review receipt/findings | 专门发现应有而缺失的代码和测试 |

### 14.2 修改现有 Skills

| Skill | 主要修改 |
|---|---|
| `loom-brainstorming` | 强制 Requirement ID、成功指标、非目标、风险、迁移和可观测性输入 |
| `loom-writing-plans` | 按 Behavior Obligation 拆任务；检查 depends_on、环、owns 和测试映射 |
| `loom-subagent-driven-development` | 按 Implementation Packet 执行；一次最多 3 个行为义务；输出结构化候选收据 |
| `loom-test-driven-development` | 将 Red-Green 周期绑定到 obligation ID，并保存失败与成功证据 |
| `loom-verification-before-completion` | 消费 traceability 和 receipts；不再信任 PASS 文本 |
| `loom-requesting-code-review` | 生成结构化 review request 和 spec/behavior 覆盖摘要 |
| `loom-receiving-code-review` | finding 必须转化为新 obligation/task 或有理由关闭 |
| `loom-pipeline-selector` | 基于真实仓库信号选流，并统一执行护栏 |

---

## 15. 分阶段实施计划

### 15.1 P0：立即堵住错误放行

目标：不引入完整新模型前，先阻止当前最危险的绕过。

实施内容：

1. 为 `PipelineEngine` 增加 validator registry。
2. executing 离开前强制任务定义集合等于任务状态集合。
3. 强制所有任务状态为 done。
4. 强制每个 Requirement 至少映射一个任务。
5. 审批收据绑定 artifact sha256。
6. 修复 `_isInWorktree()`。
7. 删除 short circuit 的 `skipClosure` 和 `skipGate` 绕过。
8. 修复 verify report 命名漂移。
9. 将 `templates/workflow.yaml` 确立为唯一来源并增加 drift test。
10. 先补充错误放行 E2E 负例，再修改实现。

重点文件：

```text
src/core/pipeline-engine.js
src/core/pipeline-selector.js
src/core/state-store.js
src/core/artifact-checker.js
templates/workflow.yaml
config/pipeline.schema.json
tests/e2e/pipeline-flow.test.js
tests/unit/
```

P0 验收：

- pending、blocked、failed 或缺失 task state 时无法推进。
- spec/plan 变化后旧审批失效。
- 普通仓库不再被误判为额外 worktree。
- short circuit 不能绕过统一门禁。
- 伪造 PASS 文本不能覆盖 validator 失败。

### 15.2 P1：建立细节账本与实现闭环

目标：从 Requirement 粒度升级为 Behavior Obligation 粒度。

实施内容：

1. 定义 requirements、traceability、receipt、finding JSON Schema。
2. 新增 `loom-detail-expansion`。
3. 新增 `loom-analyze-artifacts`。
4. 规划器按 Behavior Obligation 拆分任务。
5. 新增 Implementation Packet 生成器。
6. implementer 按 1 至 3 个行为义务执行。
7. 引入行为级 Red-Green-Verify 收据。
8. 新增 `loom-omission-hunter`。
9. 新增 `loom-converge` 和回流机制。
10. verification 强制 obligation 级代码、测试和证据闭环。

P1 验收：

- 所有 Requirement 均完成细节分类。
- 所有 Behavior Obligation 均有任务和测试计划。
- implementer 无权将行为直接标记为 passing。
- 任何缺少代码、测试或当前版本证据的行为都会阻断流水线。
- convergence 发现遗漏时能追加任务并回到 executing。

### 15.3 P2：独立评估与质量基准

目标：降低单一 Agent 自证导致的系统性漏检。

实施内容：

1. 引入三个并行只读 evaluator。
2. 统一 reviewer/evaluator finding schema。
3. review-gate 强制消费外部反馈收据。
4. 建立 20 至 50 个历史故障 fixture。
5. 为关键 Skills 增加 artifact/output eval，而不仅是 trigger eval。
6. 在 CI 中设置 false PASS 硬门槛。

P2 验收：

- 任一 BLOCKER 能稳定阻断。
- 已知遗漏 fixture 检出率达到 100%。
- false PASS rate 为 0。
- evaluator 的结论可以追踪到具体 requirement、obligation、文件和证据。

### 15.4 P3：数据驱动优化

目标：基于实际失败模式优化路由、模型和成本。

实施内容：

1. 建立遗漏类型和阶段分布仪表盘。
2. 跟踪 convergence 轮次、成本和延迟。
3. 根据任务复杂度路由不同模型。
4. 根据历史数据调整 Packet 大小和拆分阈值。
5. 对高遗漏类别增加专用分类器、测试生成器或 evaluator。

P3 验收：

- 可识别最常遗漏的需求类别和 Skill。
- 可量化每轮收敛带来的召回率提升。
- 在 false PASS 不增加的前提下降低平均成本和延迟。

---

## 16. 测试与 Eval 方案

### 16.1 必须新增的错误放行负例

| Fixture | 预期结果 |
|---|---|
| 缺少一个 Requirement 的任务映射 | planning/analyze 阶段阻断 |
| 缺少一个 Behavior Obligation | detail-expansion/analyze 阶段阻断 |
| Behavior 有任务但无测试计划 | approval 前阻断 |
| task 仍为 pending，报告写 PASS | executing 无法推进 |
| task-state 集合缺少一个任务 | executing 无法推进 |
| 测试引用指向不存在文件 | verification 阻断 |
| 日志哈希有效但未覆盖某项行为 | verification 阻断 |
| 测试证据对应旧 Git tree | verification 阻断 |
| spec 修改后复用旧审批 | approval 失效 |
| review feedback 不存在但用户 approve | review-gate 阻断 |
| diff 修改 owns 之外文件 | executing 阻断或要求批准 |
| 代码实现未请求公开 API | convergence 标记 unrequested |
| 正常路径完成但失败回滚缺失 | omission-hunter/convergence 阻断 |
| 重复请求产生重复事件 | 行为级测试失败 |
| 普通 Git 仓库被识别为 worktree | selector 测试失败 |
| workflow 与生成 schema 漂移 | CI drift test 失败 |

### 16.2 Eval 指标

| 指标 | 定义 | 目标 |
|---|---|---|
| False PASS Rate | 存在已知遗漏但流水线通过的比例 | 0 |
| Requirement Recall | 被系统识别并追踪的需求比例 | 100% |
| Obligation Recall | 被展开和追踪的行为细节比例 | 基准集 100% |
| Scenario Coverage | 有验证方式的验收场景比例 | 100% |
| Evidence Freshness | 绑定当前 Git tree 的有效证据比例 | 100% |
| Selector Precision | 流程选择与真实风险匹配比例 | 持续提升 |
| Convergence Rounds | 从首次实现到完全收敛的轮数 | 监控并降低 |
| Reviewer Disagreement | 多 evaluator 裁决分歧率 | 监控高风险类别 |
| Average Cost | 每个完成行为的 token/时间成本 | 在可靠性不下降时优化 |

### 16.3 CI 硬门槛

```text
false PASS rate = 0
已知遗漏 fixture 检出率 = 100%
Requirement -> Task 覆盖率 = 100%
Behavior Obligation -> Test Plan 覆盖率 = 100%
当前版本 Evidence 覆盖率 = 100%
workflow drift = 0
```

---

## 17. 迁移策略

仓库中可能存在已经运行的 `pipeline.state.json`，因此不能静默改变其语义。

建议采用显式版本策略：

- 新建流水线默认使用 `pipeline_schema_version: 2` 和严格门禁。
- 已存在的 v1 流水线保持原状态，不自动伪造 requirements 或 receipts。
- 提供显式迁移命令，扫描 spec、plan、tasks 和现有 handoff，生成迁移草稿。
- 迁移草稿中的所有 Behavior Obligation 初始为 `unverified`，不能根据旧 PASS 报告自动标记为 passing。
- 用户确认迁移产物后写入新的审批收据。
- 不提供“缺少证据时默认通过”的兼容逻辑。

---

## 18. 风险与控制措施

| 风险 | 影响 | 控制措施 |
|---|---|---|
| 行为义务数量膨胀 | 计划和执行成本上升 | 使用适用性分类、优先级和批次限制；不降低 must 行为门禁 |
| AI 生成无意义细节 | 噪声和错误任务增加 | artifact-analysis 检查重复、不可测试和与业务无关的义务 |
| 模型伪造代码/测试引用 | 错误闭环 | 验证器检查文件、符号、测试 ID 和 Git tree，不信任文本声明 |
| 证据频繁过期 | 验证成本上升 | 按影响范围选择重跑测试，但所有引用必须对应当前 tree |
| 多 evaluator 成本过高 | 延迟和 token 增加 | 仅中高风险流程启用完整并行评估，基础门禁对所有流程强制 |
| Convergence 无限循环 | 流水线无法终止 | 设置最大轮次，超限进入人工 Gate，不允许自动 PASS |
| 新旧流水线不兼容 | 活跃需求中断 | 使用 schema version 和显式迁移，不静默升级 |
| 结构化文件与 Markdown 漂移 | 人机看到不同事实 | JSON 为机器事实源，Markdown 由 JSON 生成或在分析阶段强制一致 |

---

## 19. 最终完成定义

流水线只有在以下问题全部回答“是”时才能完成：

1. 每个 Requirement ID 是否唯一、已审批且可测试？
2. 每个 Requirement 是否完成所有强制细节分类？
3. 每个适用细节是否成为稳定的 Behavior Obligation？
4. 每个 Behavior Obligation 是否具有任务和测试计划？
5. 任务定义集合与任务状态集合是否完全一致？
6. 所有任务是否完成并通过独立任务审查？
7. 每个 Behavior Obligation 是否有实际代码或其他有效实现落点？
8. 每个 Behavior Obligation 是否有具体测试或验证引用？
9. 每个 Behavior Obligation 是否有绑定当前 Git tree 的 PASS 证据？
10. 所有禁止行为和不变量是否有负向断言或其他验证？
11. 是否不存在 missing、partial、contradicts、unverifiable？
12. 是否不存在未经批准的 unrequested 实现？
13. omission-hunter 是否无 BLOCKER？
14. 所有 evaluator 是否无 BLOCKER/HIGH 未解决项？
15. 审批是否绑定当前版本的 spec、requirements、plan 和 analysis？
16. review feedback 是否存在并绑定当前代码版本？
17. workflow、schema、目录和文档是否无漂移？

---

## 20. 推荐实施顺序

最优先实施以下四项，它们直接针对 AI 实现细节遗漏：

1. 将每个 Requirement 展开为结构化 Behavior Obligations，禁止只按 Requirement 粒度声明完成。
2. 每次只允许 AI 实现 1 至 3 个行为义务，并生成冻结的 Implementation Packet。
3. 每个行为义务先建立失败测试，只有外部验证器可以将其标记为 passing。
4. 增加独立 omission-hunter，从需求向代码反查缺失行为。

随后立即补齐：

5. task state 和需求闭环的状态机硬门禁。
6. artifact-analysis 与 convergence 两个强制阶段。
7. 审批、测试和审查证据的版本哈希绑定。
8. 多 evaluator 与持续 Eval 基准集。

核心转变如下：

```text
原模式：
AI 读取需求 -> 编写大量代码 -> AI 声称完成 -> 最后检查

目标模式：
细节原子化 -> 冻结小批次上下文 -> 每项先失败再实现
-> 每项即时验证 -> 独立反查遗漏 -> 发现遗漏生成新任务
-> 代码与意图反复收敛 -> 全部行为有当前版本证据后完成
```

---

## 21. 外部参考

- Anthropic, [Building effective agents](https://www.anthropic.com/research/building-effective-agents)，2024-12-19。相关原则包括可组合 workflow、程序化中间 Gate、并行评估、orchestrator-workers、evaluator-optimizer 和环境事实反馈。
- Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)，2025-11-26。相关实践包括结构化 feature list、初始全部未通过、一次只完成一个小目标、端到端验证后才更新状态，以及跨会话避免过早宣告完成。
- GitHub, [Spec Kit](https://github.com/github/spec-kit)。其中 artifact analysis 和 implementation convergence 的设计思路可用于 Loom 的 `artifact-analysis` 与 `convergence` 阶段。

---

## 22. 结论

AI 实现细节遗漏不能通过“要求模型更认真”解决，也不能仅靠最后增加一次代码审查解决。可靠的工程系统必须假设模型会遗漏，并通过细节原子化、不可删除账本、小批量实现、失败测试、外部验证、遗漏反查和收敛回流，使遗漏无法被错误地当作完成。

Loom 的最终可靠性目标不是让 AI 永不犯错，而是：

> 任何未实现细节都保持可见、可追踪、可验证；任何缺少代码、测试或当前版本证据的行为都无法通过状态机；任何新发现的遗漏都能自动回流为明确任务，直到需求意图与实际代码完全收敛。
