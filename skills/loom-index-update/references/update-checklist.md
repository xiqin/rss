# 图后端与记忆同步检查清单

> **图后端抽象原则**：AI 只调用 loom 暴露的固定 MCP 工具（`loom_graph_status`、`loom_graph_query`、`loom_graph_sync`），由 loom 内部根据 `.loom/graph.config.json` 选择后端执行。配置不存在时默认 codegraph（向后兼容）。后端不可用时跳过图索引同步。

## 变更检测 → 更新映射

### 图后端可用

只需确认图后端已同步（`loom_graph_sync` 或 `loom index --check`）。无需手动更新任何 Markdown 文件。

| 查询需求 | 使用工具 |
|---------|---------|
| 查找符号定义/上下文 | `loom_graph_query(capability="definition")` |
| 调用链追踪 | `loom_graph_query(capability="callers")` / `"callees"` |
| 改动影响范围 | `loom_graph_query(capability="impact")` |
| 模块/文件结构 | `loom_graph_query(capability="explore")` |
| 按名称搜索符号 | `loom_graph_query(capability="symbolSearch")` |

> 后端能力不足时（例如 `impact` 返回 `false`/`partial`/`viaExplore`），用 `references` 或 `explore` 降级，并报告“影响范围可能不完整”。

### 图后端不可用

跳过图索引同步，不生成任何 Markdown 索引。需要影响范围分析时使用源码搜索并在报告中注明限制。

### 结构化 Memory

| 事件 | 写入方式 |
|------|----------|
| 发现新坑点 | `loom_add_memory(type="踩坑")` |
| 用户表达偏好 | `loom_add_memory(type="偏好")` |
| 项目重大变更 | `loom_add_memory(type="状态")` |

### {{ENTRY_FILE}}

| 事件 | 需更新的节 |
|------|-----------|
| 新增入口程序 | 入口表 |
| 新增快速命令 | 快速命令 |
| 开发流程变更 | 开发流程 |
| 新增约定 | 对应节 |

## 更新顺序

1. **先检测** — 确认变更范围 + 调 `loom_graph_status` 检测图后端可用性和能力
2. **选择路径**：
   - **图后端可用** → `loom_graph_sync` 确认同步，无需更新 Markdown 索引
   - **图后端不可用** → 跳过图索引同步，用源码搜索兜底
3. **更新 Memory/ENTRY** — 按需
