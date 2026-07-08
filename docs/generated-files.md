# 用户级安装生成文件

用户级安装（`loom install`）主要在用户目录下生成以下文件；GitHub Copilot 还会在执行安装命令的当前仓库中生成仓库级 custom instructions、cloud agent setup workflow 和 loom 验证 workflow。

## 按工具划分

### Claude Code

| 路径                                       | 类型     | 说明                             |
| ------------------------------------------ | -------- | -------------------------------- |
| `~/.claude/plugins/installed_plugins.json` | 追加配置 | plugin 列表添加 loom-engineering |
| Plugin marketplace                         | 注册     | loom plugin marketplace          |

### OpenCode

| 路径                               | 类型      | 说明                             |
| ---------------------------------- | --------- | -------------------------------- |
| `~/.config/opencode/commands/`     | directory | command 定义文件                 |
| `~/.config/opencode/opencode.json` | 追加配置  | plugin 列表添加 loom-engineering |
| `~/.config/opencode/opencode.json` | 追加配置  | `mcp.loom` MCP server 注册       |

### Cursor

| 路径                       | 类型      | 说明                  |
| -------------------------- | --------- | --------------------- |
| `~/.cursor/rules/<name>.mdc` | file | 每个 skill 转为 .mdc 规则文件 |

### Copilot

| 路径                                 | 类型      | 说明                  |
| ------------------------------------ | --------- | --------------------- |
| `~/.copilot/skills/<name>/`          | directory | 每个 skill 一个子目录 |
| `~/.copilot/instructions/`           | directory | command 定义文件      |
| `~/.copilot/copilot-instructions.md` | file      | 全局指令文件（入口）  |
| `.github/copilot-instructions.md`    | file      | 当前仓库的 Copilot custom instructions；仅在不存在时生成 |
| `.github/workflows/copilot-setup-steps.yml` | file | 当前仓库的 Copilot cloud agent setup workflow；仅在不存在时生成 |
| `.github/workflows/loom-verify.yml` | file | 当前仓库的 PR/Push 验证 workflow；仅在不存在时生成 |

### Codex

| 路径                      | 类型      | 说明                  |
| ------------------------- | --------- | --------------------- |
| `~/.codex/skills/<name>/` | directory | 每个 skill 一个子目录 |
| `~/.codex/config.toml`    | 追加配置  | `mcp_servers.loom` MCP server 注册 |

## 文件生命周期

- **安装**：从 loom 仓库的 `skills/` 和 `commands/` 复制到用户目录
- **更新**：通过 `loom update --tool <target>` 重新安装，覆盖现有文件
- **卸载**：删除 loom 复制进去的每个文件和目录（用户级/仓库级 `copilot-instructions.md`、`copilot-setup-steps.yml` 和 `loom-verify.yml` 仅在含 loom 标记时删除）
