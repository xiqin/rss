# loom 卸载

## 卸载

```bash
# 脚本卸载
bash uninstall.sh --tool claude-code

# CLI 卸载
loom uninstall --tool claude-code
```

### 卸载内容

卸载会移除以下内容（取决于目标工具）：

| 位置                                 | 说明                               |
| ------------------------------------ | ---------------------------------- |
| `~/.config/opencode/commands/`       | OpenCode commands                  |
| `~/.config/opencode/opencode.json`   | OpenCode plugin 注册 + MCP 配置    |
| `~/.cursor/rules/`                   | Cursor `.mdc` 规则文件             |
| `~/.copilot/skills/`                 | Copilot skills                     |
| `~/.copilot/copilot-instructions.md` | Copilot 全局指令                   |
| `.github/copilot-instructions.md`    | Copilot 仓库级 custom instructions（仅当前工作目录） |
| `.github/workflows/copilot-setup-steps.yml` | Copilot cloud agent setup workflow（仅当前工作目录） |
| `.github/workflows/loom-verify.yml`  | Loom PR/Push 验证 workflow（仅当前工作目录） |
| `~/.codex/skills/`                   | Codex skills                       |
| `~/.codex/config.toml`               | Codex MCP 配置中的 loom section     |
| Plugin 注册                          | Claude Code / OpenCode plugin 注册 |

### 不涉及的范围

卸载**不会**触及：

- 任何非 loom 生成的项目目录文件
- 非 loom 生成的文件
- 用户主目录下非 loom 管理的文件

### Dry-run 预览

```bash
loom uninstall --tool claude-code --dry-run
```

预览模式显示将删除的文件和目录，不实际执行。
