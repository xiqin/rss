# 结构化追踪账本（Traceability Ledger）

## 概述

Loom 用两个结构化 JSON 账本把需求、行为、任务、测试、证据、收据串成可机器校验的闭环：

- `requirements.json`：需求清单，每个 `REQ-xxx` 拆成可独立验证的 Behavior Obligation（`REQ-xxx-Bnn`），按 15 个固定维度分类。
- `traceability.json`：追踪账本，把每个 REQ 与 behavior 映射到 task、test、evidence，planning 写 task 映射，executing 补 tests/evidence，verification 校验闭环。

这两个文件是 Loom 防止"AI 漏掉细节"的核心机制：需求细节一旦写入账本，就不会从结构化校验中消失；没有对应代码、测试、证据时流水线不能完成。

## 文件布局

```
specs/<date+feature>/
├── spec.md                  # 自然语言需求
├── requirements.json        # 结构化需求清单（brainstorming 产出）
├── plan.md                  # 实现计划
├── tasks/
│   └── Tn.md                # 任务（frontmatter 含 requirements + behavior_ids）
├── traceability.json        # 追踪账本（planning 产出，executing 补齐）
├── test-report.md           # 测试报告
├── verify-report.md         # 验证报告
├── evidence/
│   └── *.log                # 测试证据日志
├── receipts/
│   ├── approvals/           # 审批收据
│   ├── implementations/     # 实现收据
│   ├── tests/               # 测试收据
│   ├── reviews/             # 审查收据
│   └── evaluations/         # 评估收据
├── findings/                # 遗漏/冲突发现
├── implementation-packets/  # 实现包（每 task 一个）
├── artifact-analysis.json   # 跨产物一致性分析
├── convergence-report.json  # 收敛报告
└── handoffs/                # 阶段交接
```

## requirements.json

每个 requirement 包含：

| 字段 | 说明 |
|------|------|
| `id` | `REQ-xxx` |
| `status` | `failing` / `in_progress` / `candidate_implemented` / `passing` / `blocked` / `superseded` |
| `types` | 需求类型：`functional` / `input` / `authorization` / `write` / `state` / `idempotent` / `concurrent` / `external` / `security` / `performance` / `observable` / `recovery` |
| `required_categories` | 必须覆盖的行为维度，从 15 个白名单选 |
| `acceptance` | 需求级验收标准 |
| `behaviors` | 可独立验证的行为义务数组 |

每个 behavior 包含：

| 字段 | 说明 |
|------|------|
| `id` | `REQ-xxx-Bnn` |
| `category` | `happy-path` / `boundary` / `invalid-input` / `authorization` / `state-transition` / `idempotency` / `concurrency` / `atomicity` / `external-failure` / `compatibility` / `security` / `performance` / `observability` / `recovery` / `forbidden-behavior` |
| `description` | 可被代码实现与测试验证的单一行为 |
| `status` | 同 requirement status |
| `acceptance` | 可测量验收项 |
| `test_plan` | 测试计划：`strategy` / `inputs` / `expected` / `coverage_target` |
| `evidence_receipt` | passing 时绑定的证据收据路径 |
| `verified_at` / `verified_by` | passing 时由外部验证器写入 |

### 行为维度白名单

`happy-path`、`boundary`、`invalid-input`、`authorization`、`state-transition`、`idempotency`、`concurrency`、`atomicity`、`external-failure`、`compatibility`、`security`、`performance`、`observability`、`recovery`、`forbidden-behavior`。

### 类型到必需维度的映射

| type | required category |
|------|-------------------|
| `functional` | `happy-path` |
| `input` | `invalid-input` |
| `authorization` / `auth` | `authorization` |
| `write` / `mutation` | `atomicity` |
| `state` | `state-transition` |
| `idempotent` | `idempotency` |
| `concurrent` | `concurrency` |
| `external` | `external-failure` |
| `security` | `security` |
| `performance` | `performance` |
| `observable` | `observability` |
| `recovery` | `recovery` |

## traceability.json

每个 REQ 条目：

| 字段 | 说明 |
|------|------|
| `tasks` | 负责该 REQ 的 task ID 列表（planning 写） |
| `tests` | 测试文件引用列表（executing 写） |
| `evidence` | 证据文件引用列表（executing 写） |
| `behaviors` | 每个 `REQ-xxx-Bnn` 的独立映射 |

每个 behavior 条目同样有 `tasks` / `tests` / `evidence`，实现 behavior 级闭环。

## 校验阶段

| 阶段 | validator | 说明 |
|------|----------|------|
| brainstorming | `validateRequirementsFile` | spec REQ 与 requirements.json 一一对应，behavior 字段齐全 |
| planning | `planning-artifacts` | 每个 REQ/behavior 至少映射到一个 task（tests/evidence 可空） |
| planning | `validate-plan.mjs` | task frontmatter `behavior_ids` 存在且引用合法 behavior，无依赖环，无 owns 冲突 |
| executing | `task-state-closure` | 每个 task 有 done 状态 |
| executing | `requirement-task-closure` | 每个 spec REQ 映射到至少一个 task |
| verification | `verification-artifacts` | test-report/verify-report 覆盖每个 REQ，traceability behavior 级 tests/evidence 闭环且引用真实文件 |

## CLI

```bash
npm run requirements:generate   # 从 spec.md 生成 requirements.json
npm run requirements:check       # 校验 requirements.json
npm run traceability:generate    # 从 requirements + tasks 生成 traceability.json
npm run traceability:check       # 校验 traceability.json
node scripts/implementation-packets.mjs generate --spec-dir <dir> --task T1
node scripts/implementation-packets.mjs check   --spec-dir <dir> --task T1
```

## 状态机强制

- `passing` 状态只能由外部验证器（非 implementer）通过 `updateBehaviorStatus` 写入，且必须绑定 `evidenceReceipt`。
- `passing` 不可回退；如需重做，必须新建 task 并显式 reviewer approval。
- 实现期修改 `traceability.json` 不会触发 stale approval（已从审批指纹中排除）。

## 相关 Schema

以下 schema 仅作为文档与测试 fixture 保留，skill 运行时不依赖；校验逻辑硬编码在 `src/core/*.js` 与各 skill 的 `scripts/*.mjs` 中：

- `config/requirements.schema.json`
- `config/traceability.schema.json`
- `config/receipt.schema.json`
- `config/finding.schema.json`
