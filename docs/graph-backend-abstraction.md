# loom 图后端抽象与可插拔知识库方案

## 背景

loom 当前推荐使用 codegraph 作为代码知识图谱，用于符号定位、上下文读取、调用链分析、影响范围评估和索引同步。这个默认选择适合大多数本地源码项目，但不同团队可能已经有其它图谱或代码知识库，例如 Sourcegraph、SCIP/LSIF、语言服务器、Neo4j 代码图谱、企业内部 RAG 或文档知识库。

目标不是移除 codegraph，而是把 codegraph 从“唯一图索引后端”调整为“默认内置后端”，并通过稳定抽象让其它后端以相同语义接入 loom。

## 目标

- 保留 codegraph 作为默认最佳路径。
- 支持项目或用户选择其它代码图谱/知识库后端。
- 让 skill 文本和 reviewer prompt 不再硬编码 `codegraph_*` 工具名。
- 所有 AI 侧调用只依赖 loom 提供的固定 MCP 工具。
- 后端能力、结果可信度、新鲜度和限制必须显式返回。
- 后端不可用或能力不足时，可以稳定降级到源码搜索、git diff 和当前源码校验。

## 非目标

- 不要求所有后端提供与 codegraph 完全相同的能力。
- 不允许默认执行仓库内任意 adapter 代码。
- 不把语义知识库的 RAG 结果当作精确调用链或影响范围依据。
- 不要求旧项目立即迁移；未配置时保持现有 codegraph 默认行为。

## 总体架构

```text
AI / Skill 文本
  ↓ 只调用固定 loom MCP 工具
loom_graph_status
loom_graph_query
loom_graph_sync
  ↓
loom Graph Backend Registry
  ↓
内置后端：codegraph / sourcegraph / scip / none
  ↓
可选外部后端：用户显式授权的 MCP server 或 CLI adapter
```

核心原则：AI 不直接动态调用项目配置里的工具名。AI 只调用 loom 暴露的固定工具，由 loom MCP server 内部读取配置、检查能力、执行后端查询并返回统一结构。

## 后端类型

需要区分两类不同能力，避免把低精度知识库误用为代码图谱：

| 类型 | 示例 | 适合回答 | 不适合回答 |
|------|------|----------|------------|
| `code-graph` | codegraph、SCIP、LSIF、AST 图、语言服务器 | 定义、引用、调用链、影响范围、文件结构 | 业务背景、历史决策 |
| `knowledge-base` | 向量库、RAG、ADR 库、企业文档库 | 架构背景、业务规则、历史决策、团队约定 | 精确调用链、breaking change 影响范围 |
| `hybrid` | 同时具备结构化代码图谱和语义检索的系统 | 依能力矩阵决定 | 不能声明不支持的精确能力 |

短期先实现 `loom_graph_*` 系列工具，服务 `code-graph` 能力。若后续要接入纯文档知识库，应新增 `loom_knowledge_query` 或在返回结构中明确 `backendType="knowledge-base"`，并禁止其承担精确影响分析。

## 配置文件

新增项目级配置：

```jsonc
// .loom/graph.config.json
{
  "version": 1,
  "backend": "codegraph",
  "enabled": true,
  "requiredCapabilities": ["explore", "definition", "references", "impact"],
  "fallback": {
    "useSourceSearch": true,
    "reportLimitations": true
  },
  "trust": {
    "allowRepositoryAdapter": false,
    "allowNetwork": false
  }
}
```

配置文件只表达项目意图，不建议把具体 MCP 工具名、CLI 命令、marker 路径全部写入项目配置。具体实现细节由 loom 的后端 registry 管理，避免每个项目维护容易漂移的工具名和命令。

### 默认行为

当 `.loom/graph.config.json` 不存在时，loom 使用兼容默认值：

```jsonc
{
  "version": 1,
  "backend": "codegraph",
  "enabled": true,
  "requiredCapabilities": ["explore", "definition", "references", "impact"],
  "fallback": {
    "useSourceSearch": true,
    "reportLimitations": true
  },
  "trust": {
    "allowRepositoryAdapter": false,
    "allowNetwork": false
  }
}
```

这样旧项目在存在 `.codegraph/` 时行为等同现在；不存在 `.codegraph/` 时继续走“图查询跳过 + 源码搜索兜底”。

### 配置优先级

后端选择按以下优先级解析：

```text
CLI 参数 > 环境变量 > 用户级配置 > 项目级配置 > 默认 codegraph
```

建议支持：

```text
LOOM_GRAPH_BACKEND=none
LOOM_GRAPH_BACKEND=sourcegraph
loom graph status --backend codegraph
loom graph query --backend sourcegraph --capability references --query "FooService"
```

CI 或高安全环境可以通过 `LOOM_GRAPH_BACKEND=none` 明确禁用所有图后端。

## 后端 Registry

loom 内置一个后端 registry，提供具体实现细节：

```js
const GRAPH_BACKENDS = {
  codegraph: {
    type: 'code-graph',
    marker: '.codegraph',
    mode: 'mcp',
    capabilities: {
      explore: true,
      definition: 'viaExplore',
      references: 'viaExplore',
      callers: 'viaExplore',
      callees: 'viaExplore',
      impact: 'viaExplore',
      pathTrace: 'viaExplore',
      sourceSnippets: true,
      semanticSearch: false
    },
    tools: {
      explore: 'codegraph_explore'
    },
    status() {},
    sync() {},
    query() {}
  },

  none: {
    type: 'disabled',
    capabilities: {},
    status() {},
    sync() {},
    query() {}
  }
};
```

注意：当前 codegraph 实际推荐以 `codegraph_explore` 作为主要查询入口。默认 codegraph adapter 应以 `explore` 为核心能力，不应继续依赖旧的 `codegraph_search`、`codegraph_context`、`codegraph_impact` 等工具名。

## 能力矩阵

后端不能只用“工具名映射”描述，必须声明能力和质量。能力值允许：

- `true`：原生支持。
- `false`：不支持。
- `partial`：部分支持，结果可能不完整。
- `derived`：通过其它能力推导，例如用 references 近似 impact。
- `viaExplore`：通过通用 explore 能力完成。

推荐能力集合：

| 能力 | 含义 |
|------|------|
| `explore` | 一次查询返回相关源代码、符号和关系摘要 |
| `symbolSearch` | 按名称搜索符号 |
| `definition` | 查定义和声明 |
| `references` | 查引用 |
| `callers` | 查上游调用方 |
| `callees` | 查下游调用方 |
| `impact` | 评估改动影响半径 |
| `pathTrace` | 追踪两个符号或模块之间的路径 |
| `files` | 查询文件/模块结构 |
| `sourceSnippets` | 返回源码片段 |
| `semanticSearch` | 语义检索，通常只作辅助 |

skill 文本应使用能力判断，而不是假设所有后端都有 `impact`：

```text
1. 调用 loom_graph_status 确认后端、能力和新鲜度。
2. 若支持 impact 且 freshness=fresh，调用 loom_graph_query(capability="impact")。
3. 若 impact 不支持，但 references 或 explore 可用，则降级为 references/explore。
4. 若图后端不可用、能力不足或 stale，以 git diff、当前源码和源码搜索为准，并在报告中注明限制。
```

## MCP 工具接口

### `loom_graph_status`

返回当前图后端状态、能力和新鲜度。

输入：

```jsonc
{
  "projectRoot": "optional path",
  "backend": "optional override"
}
```

输出：

```jsonc
{
  "backend": "codegraph",
  "backendType": "code-graph",
  "enabled": true,
  "available": true,
  "capabilities": {
    "explore": true,
    "definition": "viaExplore",
    "references": "viaExplore",
    "impact": "viaExplore"
  },
  "freshness": {
    "status": "fresh",
    "checkedAt": "2026-07-08T10:00:00.000Z",
    "indexedCommit": "abc123",
    "workingTreeAware": true
  },
  "warnings": []
}
```

`freshness.status` 允许值：

- `fresh`：索引覆盖当前工作区或已确认同步。
- `stale`：索引落后于当前源码或工作区。
- `unknown`：后端无法判断新鲜度。
- `commit-bound`：索引绑定到某个 commit，不覆盖未提交改动。
- `unavailable`：后端不可用。

### `loom_graph_query`

统一图查询入口。

输入：

```jsonc
{
  "projectRoot": "optional path",
  "capability": "impact",
  "query": "FooService updateUser",
  "scope": {
    "files": ["src/foo.ts"],
    "symbols": ["FooService.updateUser"]
  },
  "maxResults": 20
}
```

输出必须统一：

```jsonc
{
  "backend": "codegraph",
  "backendType": "code-graph",
  "capability": "impact",
  "ok": true,
  "confidence": "high",
  "freshness": {
    "status": "fresh",
    "checkedAt": "2026-07-08T10:00:00.000Z",
    "workingTreeAware": true
  },
  "results": [
    {
      "type": "symbol",
      "name": "FooService.updateUser",
      "file": "src/foo.ts",
      "startLine": 12,
      "endLine": 30,
      "summary": "更新用户信息的方法，被 UserController 调用。",
      "source": "optional source text",
      "relations": [
        {
          "kind": "called-by",
          "target": "UserController.update"
        }
      ]
    }
  ],
  "limitations": []
}
```

`confidence` 允许值：

- `high`：结构化代码图谱或精确索引结果。
- `medium`：由多种信号推导，可能不完整。
- `low`：语义检索或文本搜索近似结果。
- `unknown`：后端无法提供置信度。

### `loom_graph_sync`

同步或检查后端索引。

输入：

```jsonc
{
  "projectRoot": "optional path",
  "checkOnly": false,
  "backend": "optional override"
}
```

输出：

```jsonc
{
  "backend": "codegraph",
  "ok": true,
  "skipped": false,
  "freshness": {
    "status": "fresh",
    "checkedAt": "2026-07-08T10:00:00.000Z"
  },
  "warnings": []
}
```

## 降级语义

所有使用图后端的 skill 必须遵守：

1. 当前源码、git diff、命令输出和测试结果优先级高于图后端。
2. 图后端 `freshness` 不是 `fresh` 时，不得直接把其结论作为阻断判断依据。
3. 后端不支持 `impact` 时，可以用 `references`、`explore` 或源码搜索降级，但必须报告“影响范围可能不完整”。
4. 后端类型是 `knowledge-base` 时，不得用于精确调用链、breaking change 影响范围或引用覆盖率判断。
5. 后端不可用时，继续使用源码搜索和人工报告，不应中断整个开发流水线。

## 安全边界

默认禁止执行仓库内 adapter 代码。推荐优先级：

1. 内置后端：由 loom 代码内置实现，例如 `codegraph`、`sourcegraph`、`scip`、`none`。
2. 外部 MCP 后端：用户在本机或组织环境中显式安装并授权。
3. CLI 后端：只允许执行白名单命令。
4. 仓库内 adapter：默认禁用，必须用户显式开启。

仓库内 adapter 若未来支持，必须满足：

```jsonc
{
  "trust": {
    "allowRepositoryAdapter": true,
    "allowedCommands": ["rg", "src", "scip"],
    "allowNetwork": false
  }
}
```

adapter 不应绕过 loom 的统一返回 schema、安全白名单、超时限制和输出大小限制。

## 需要改造的 loom 文件

### P0：核心抽象与初始化入口

- 新增 `loom_graph_status`、`loom_graph_query`、`loom_graph_sync` MCP 工具。
- 新增 `.loom/graph.config.json` 读取逻辑和默认 codegraph 配置。
- 新增 Graph Backend Registry。
- 改造 `skills/loom-index-update/scripts/validate-index.mjs`，从硬编码 `.codegraph` 改为调用图后端状态判断。
- **改造 `skills/loom-init-project/SKILL.md`**：交互流程新增"确认图后端"步骤；输出结构新增 `graph.config.json`；人工检查清单第 2 项泛化为图后端。
- **改造 `skills/loom-init-project/scripts/init-project.mjs`**：
  - `parseArgs` 新增 `--graph-backend` 参数。
  - `initProject` 接收 `graphBackend` 选项。
  - 新增 `writeGraphConfig(root, backend)` 写入 `.loom/graph.config.json`。
  - `buildRequiredContext(roles, graphBackend)` 按后端渲染对应说明，不再硬编码 codegraph。
  - codegraph 后端保留自动 `codegraph init` 建图逻辑；其它后端不自动建图。
  - `printReport` 输出图后端选择结果。

### P1：skill 文本

- `skills/loom-index-update/SKILL.md`
- `skills/loom-index-update/references/update-checklist.md`
- `skills/loom-subagent-driven-development/combined-reviewer-prompt.md`
- `skills/loom-requesting-code-review/SKILL.md`
- `skills/loom-finishing-a-development-branch/SKILL.md`
- `skills/loom-using-loom/SKILL.md`
- `skills/loom-router/SKILL.md`

这些文件中的"codegraph 可用时使用 `codegraph_*`"应替换为"图后端可用且支持相关能力时使用 `loom_graph_*`"。

### P2：模板和生成逻辑

- `templates/agents.md`：第 14 行和第 159 行的 codegraph 硬编码改为 `{{GRAPH_BACKEND_DESC}}` 变量，由 `init-project.mjs` 按 `graphBackend` 渲染。
- `templates/workflow.yaml`
- `templates/github/workflows/loom-verify.yml`
- `skills/loom-pipeline-selector/references/step-catalog.md`

新项目生成时应写入泛化后的图后端描述，而不是硬编码 codegraph 工具名。`templates/constitution.md` 不涉及 codegraph，无需改动。

### P3：报告模板

- 将 `skills/loom-index-update/assets/report-codegraph-template.md` 泛化为 `report-graph-template.md`。
- 保留 `report-manual-template.md` 或改名为 `report-no-graph-template.md`。

报告字段应包含：

- 后端名称。
- 后端类型。
- 支持能力。
- 同步状态。
- 新鲜度。
- 使用过的查询能力。
- 降级路径。
- 未覆盖风险。

## 新项目初始化

### 背景

用户通常通过调用 `loom-init-project` skill 来初始化项目。该 skill 是交互式的：第一步确认角色（pm/dev），第二步确认 agent 工具（claude-code/codex/cursor/copilot/opencode），然后调用 `init-project.mjs` 生成所有 `.loom/` 文件和入口文件。当前 SKILL.md 第 101 行明确写了"codegraph：可用时 `loom init-project` 已自动 `codegraph init` 建图"，这是 init-project 的核心 codegraph 耦合点。

因此图后端选择不能只加一个 CLI 参数，必须在 skill 的交互问答流程中以独立步骤呈现，让用户在初始化时就选择图后端。

### 交互流程调整

在 `loom-init-project` 的 SKILL.md 交互流程中，**在"第二步：确认 agent 工具"之后、PM 角色填充产品上下文之前**，新增一步：

#### 第三步：确认图后端

如果用户没有明确指定图后端，询问这个项目使用哪个代码图谱/知识库后端。可选项为：

- `codegraph`（默认推荐）：基于 tree-sitter AST 的本地代码图谱，通过 MCP 实时查询。需要 `.codegraph/` 目录。
- `sourcegraph`：基于 Sourcegraph 的代码搜索和引用查询。需要 Sourcegraph 实例或 MCP server。
- `scip`：基于 SCIP/LSIF 精确索引。需要已生成的 `.lsif` 或 `.scip` 文件。
- `none`：不启用任何图后端，所有代码查询走源码搜索和 git diff。

未指定时默认 `codegraph`（与历史行为一致）。把选择通过 `--graph-backend` 传给脚本：

```bash
node <skill-dir>/scripts/init-project.mjs --cwd <project-root> --roles dev --tools codex --graph-backend codegraph
```

如果用户在调用 skill 时已经明确指定了图后端（例如"用 sourcegraph 初始化项目"），则跳过此询问。

### 脚本改造

`init-project.mjs` 需要以下改动：

1. **`parseArgs`** 新增 `--graph-backend` 参数解析。

2. **`initProject`** 接收 `graphBackend` 选项，默认 `codegraph`。

3. **新增 `writeGraphConfig(root, backend)` 函数**：根据 backend 写入 `.loom/graph.config.json`。codegraph 写默认配置；none 写 `backend=none`；其它后端写对应 backend 名称并标注 `enabled` 为该后端是否本地可用。

4. **`buildRequiredContext(roles, graphBackend)`**：当前硬编码的 codegraph 那一条，改为根据 `graphBackend` 渲染对应后端说明。例如：
   - `codegraph`：`codegraph：仅使用 MCP 工具查询（codegraph_explore）；未启用时跳过图索引同步。`
   - `sourcegraph`：`图后端 sourcegraph：通过 loom_graph_query 查询；未启用时跳过图索引同步。`
   - `none`：`图后端未启用：所有代码查询走源码搜索和 git diff。`

5. **`agents.md` 模板变量**：新增 `{{GRAPH_BACKEND_DESC}}` 占位符，在"上下文读取策略"和"完成前检查"中替换硬编码的 codegraph 文案。

6. **codegraph 后端的特殊处理**：当 `graphBackend=codegraph` 且本地检测到 codegraph CLI 可用时，继续执行现有的 `codegraph init` 建图逻辑（保持向后兼容）。当 `graphBackend=codegraph` 但 codegraph 不可用时，不失败，只在报告中注明"codegraph 未安装，图后端标记为不可用"。

7. **其它后端不做自动建图**：`sourcegraph`、`scip` 等后端的索引创建由用户自行完成，`init-project` 只写入配置和生成对应描述，不尝试自动初始化索引。

### SKILL.md 人工检查清单调整

SKILL.md 第 101 行当前内容：

```text
2. 【dev】codegraph：可用时 `loom init-project` 已自动 `codegraph init` 建图（`.codegraph/`）；codegraph 不可用时确认图查询能力已跳过。
```

改为：

```text
2. 【dev】图后端：确认 `.loom/graph.config.json` 中 backend 与用户选择一致；codegraph 后端可用时已自动建图，其它后端需用户自行初始化索引；后端不可用时确认图查询能力已跳过。
```

### 输出结构调整

SKILL.md 的"输出结构"新增一项：

```text
.loom/
  graph.config.json                        # dev 角色，图后端配置
  memory/store.json                        # 所有角色，结构化记忆源
  memory/MEMORY.md                         # 所有角色，只读导出视图
  workflow.yaml                            # 所有角色（单文件，含全部 pipeline）
  rules/product.md                         # 选择 pm 角色时
  rules/constitution.md                    # 选择 dev 角色时
  contexts/subagent-context.md             # 选择 dev 角色时
```

`graph.config.json` 只在 dev 角色时生成（pm 角色不需要图后端）。

### CLI 参数

除了通过 skill 交互选择，也支持 CLI 直接指定：

```text
loom init-project --graph-backend codegraph
loom init-project --graph-backend none
loom init-project --graph-backend sourcegraph
```

非交互环境（CI、脚本调用）未指定时默认 `codegraph`，不阻塞流程。

## 旧项目迁移

建议新增迁移命令：

```text
loom graph migrate
```

迁移行为：

- 如果存在 `.codegraph/` 且没有 `.loom/graph.config.json`，生成 backend=`codegraph` 的配置。
- 如果不存在 `.codegraph/`，生成 backend=`none` 或提示用户选择。
- 替换可自动生成的模板文案。
- 不强行覆盖用户手改过的 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/loom.mdc` 等入口文件。
- 输出人工审查清单，列出仍包含 `codegraph` 字样的位置。

## 测试矩阵

至少覆盖以下场景：

| 场景 | 预期 |
|------|------|
| 无 `.loom/graph.config.json`，有 `.codegraph/` | 行为等同旧版 codegraph |
| 无 `.loom/graph.config.json`，无 `.codegraph/` | 图同步跳过，源码搜索兜底 |
| `backend=none` | 永不尝试图查询 |
| `backend=codegraph` 但 `.codegraph/` 不存在 | 报告 unavailable，不中断流水线 |
| `backend=custom` 但 adapter 未授权 | 阻止执行并提示授权 |
| 后端不支持 `impact` | 降级到 `references`、`explore` 或源码搜索 |
| 后端 `freshness=stale` | 报告 stale，并用当前源码/diff 校验关键结论 |
| 后端类型为 `knowledge-base` | 不允许承担精确影响范围判断 |
| `loom-init-project` 未指定 `--graph-backend` | 默认 codegraph，行为等同旧版 |
| `loom-init-project --graph-backend none` | 生成 `.loom/graph.config.json`，AGENTS.md 不含 codegraph 工具名 |
| `loom-init-project --graph-backend sourcegraph` | 生成配置，AGENTS.md 含 sourcegraph 后端描述 |
| `loom-init-project` 交互流程中用户选择 `none` | 同 `--graph-backend none` |
| `loom-init-project` 指定 codegraph 但本地无 codegraph CLI | 生成配置，报告 codegraph 不可用，不失败 |

## 推荐实施顺序

1. 实现 `loom_graph_status`、`loom_graph_query`、`loom_graph_sync` 三个固定 MCP 工具。
2. 实现 Graph Backend Registry，先支持 `codegraph` 和 `none`。
3. 默认 codegraph adapter 只依赖当前推荐的 `codegraph_explore` 能力。
4. 改造 `loom-init-project`：SKILL.md 交互流程新增图后端选择步骤，`init-project.mjs` 新增 `--graph-backend` 参数、`writeGraphConfig` 和 `buildRequiredContext` 泛化。
5. 改造 `templates/agents.md`，用 `{{GRAPH_BACKEND_DESC}}` 替换硬编码 codegraph。
6. 改造 `validate-index.mjs` 和报告模板。
7. 改造 `loom-index-update` 与 reviewer prompt。
8. 改造 `workflow.yaml`、`step-catalog.md` 等剩余模板。
9. 增加 `loom graph migrate`，处理旧项目。
10. 再扩展 `sourcegraph`、`scip` 或其它组织内后端。

## 最终结论

loom 应采用“固定 MCP 工具 + 后端 registry + 能力矩阵 + 统一返回 schema”的方式接入其它图谱或知识库。codegraph 保持默认后端，但 skill 和模板不再直接引用 `codegraph_*` 工具；所有查询通过 `loom_graph_*` 代理完成。后端必须明确能力、置信度、新鲜度和限制，能力不足时稳定降级到源码搜索和当前源码校验。

由于用户通过 `loom-init-project` 初始化项目，图后端选择必须作为该 skill 交互流程的一个标准步骤（第三步：确认图后端），并在 `init-project.mjs` 中通过 `--graph-backend` 参数和 `writeGraphConfig` 函数落地。这样既保留 codegraph 的高质量体验，也允许团队在安全可控的边界内接入 Sourcegraph、SCIP/LSIF、语言服务器、自定义图谱或企业知识库。
