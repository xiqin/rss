# rss — Requirement-Driven Software Engineering

AI 工程化框架，基于 superpowers 增强。

## 核心特性

- **5 步流水线**：brainstorming → writing-plans → git-worktree → subagent-dev → index-update
- **项目宪章自动生成**：`/rss-init-project` 扫描项目，自动生成宪章 + 工程结构
- **5 维代码审查**：架构合规 / 代码质量 / 安全风险 / 性能隐患 / 规范一致性
- **Subagent 隔离派发**：每任务独立派发 implementer + spec-reviewer + quality-reviewer
- **进度追踪**：progress.md 可视化流水线状态
- **多工具兼容**：Claude Code / OpenCode / Cursor / GitHub Copilot

## 安装

### Claude Code

```bash
# 在项目根目录
cp -r /path/to/rss/.claude-plugin ./
# 或在 CLAUDE.md 中引用 rss/skills/ 路径
```

### OpenCode / Cursor / GitHub Copilot

参见 `docs/installation.md`。

## 快速开始

1. 安装 rss 框架
2. 运行 `/rss-init-project` 扫描项目并生成配置
3. 使用 `/rss-brainstorm` 开始需求分析
4. 按流水线逐步执行

## 与 superpowers 的关系

rss 继承 superpowers 的插件基础设施，替换/增强核心 skills 为 rss 版本（增加流水线、宪章、审查维度等），并新增项目规则自动生成、进度追踪、索引同步等能力。

## License

MIT
