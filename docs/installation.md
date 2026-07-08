# loom 安装指南

## 前置条件

- Node.js >= 22
- Git（本地安装方式需要）

## 方式一：一键安装脚本

```bash
git clone https://github.com/xiqin/loom.git
cd loom
bash install.sh --tool claude-code
```

### 远程安装

```bash
# Unix
curl -fsSL https://raw.githubusercontent.com/xiqin/loom/main/install.sh | bash -s -- --tool claude-code

# Windows PowerShell
irm https://raw.githubusercontent.com/xiqin/loom/main/install.ps1 -OutFile install.ps1; .\install.ps1 -Tool claude-code
```

### 安装多个工具

```bash
bash install.sh --tool claude-code --tool cursor --tool opencode
```

## 方式二：npm 全局安装

```bash
npm i -g loom-engineering
loom install --tool claude-code
```

## 选项参考

| Flag              | 作用                                                            |
| ----------------- | --------------------------------------------------------------- |
| `--tool <targets>` | 目标工具（必填，逗号分隔或 "all"）：claude-code, opencode, cursor, copilot, codex |
| `--dry-run`       | 预览安装文件，不实际写入                                        |
| `--from-release`  | 从 GitHub release tag 下载（可重现安装）                        |
| `--version <ver>` | 指定下载版本（配合 `--from-release` 使用）                      |

## 安装后验证

```bash
loom doctor    # 诊断安装状态
loom doctor --json  # 输出机器可读诊断，供 CI / Web UI 使用
loom doctor --fix-plan --json  # 生成非破坏性修复计划
loom list      # 列出可用 skills 和 commands
```

`loom doctor --json` 会输出 `loom.doctor.v1` 报告，包含工具安装状态、skills/commands 数量、adapter contract 一致性、项目 health、codegraph 状态和 skill compliance 汇总。

`loom doctor --fix-plan` 会基于诊断结果写入 `.loom/doctor/fix-plan.json`，使用 `loom.doctor-fix-plan.v1` schema 列出建议动作。该计划明确 `autoApply:false`、`mutatesFiles:false` 和 `requiresReview:true`，只用于审计和人工确认，不会自动修改项目文件。

工具将在下次会话中自动发现 loom 的 skills 和 commands。对 GitHub Copilot，`loom install --tool copilot` 会写入用户级 `~/.copilot/copilot-instructions.md`，并在当前工作目录没有 `.github/copilot-instructions.md` 时生成仓库级 Copilot custom instructions；还会在缺少 `.github/workflows/copilot-setup-steps.yml` 时生成 cloud agent setup workflow，包含 Node.js 22、依赖安装、`generate:check` 和 `npm test`；在缺少 `.github/workflows/loom-verify.yml` 时生成 PR/Push 验证 workflow，运行 `generate:check`、`npm test`、`audit:high` 和文档一致性检查。已有仓库级说明或 workflow 不会被覆盖。

## 在项目中初始化

安装是用户级（全局）的。要在某个仓库中使用 loom 的流水线与上下文，需在该仓库根目录初始化：

```bash
cd your-project
loom init-project                       # 生成 .loom/ 上下文（宪章、结构化记忆、workflow 等）
loom init-project --tools claude-code   # 指定写入哪些工具的项目级配置
loom init-project --force               # 覆盖已存在的 loom 托管文件
```

## 从 GitHub Issue 创建 Spec

GitHub / Copilot cloud agent 工作流可以先把 issue 元数据落成本地 spec 初稿：

```bash
loom issue import \
  --number 42 \
  --title "Add login audit trail" \
  --body-file issue-body.md \
  --url https://github.com/acme/app/issues/42
```

该命令会生成 `specs/<date+slug>/spec.md`，默认不覆盖已有 spec；需要覆盖时显式传 `--force`。

## 生成 PR Evidence 摘要

在创建或更新 PR 前，可以把 `.loom/compliance/history.json` 中的验证、hook 和审计记录导出为 Markdown 摘要：

```bash
loom pr evidence --spec-dir specs/2026-07-07+add-login-audit-trail
```

默认输出到 `.loom/evidence/pr-evidence.md`，可直接粘贴到 PR 描述或作为 GitHub Actions artifact；可通过 `--out`、`--limit`、`--verdict`、`--risk` 和 `--type` 缩小范围。

## 生成团队 Dashboard

如需给团队查看当前仓库的 AI 工程状态，可生成一个无需启动服务的 HTML 看板：

```bash
loom dashboard
```

默认输出到 `.loom/reports/team-dashboard.html`，汇总 evidence 总量、失败率、近期 evidence、趋势指标和结构化 memory；可用 `--spec-dir` 只查看某个需求范围，或用 `--out` 指定输出路径。需要跨仓库汇总时传入逗号分隔的仓库根目录：

```bash
loom dashboard --repos ../service-a,../service-b --out team-dashboard.html
```

跨仓库看板会合并多个仓库的 evidence 与 memory，并额外展示每个仓库的 PASS/WARN/FAIL 与失败率。

如果需要静态 Web UI 数据面，可额外生成 JSON 数据文件和浏览器刷新元数据：

```bash
loom dashboard --web --refresh 30
```

`--web` 会在 HTML 同目录生成 `team-dashboard.json`（`loom.dashboard.v1`），并把数据文件和刷新间隔写入页面；它不启动常驻服务，适合放到 CI artifact、静态站点或任意本地静态服务器中预览。可用 `--data-out` 指定 JSON 输出位置。

## 发现插件 Manifest

第三方扩展可以先用 `.loom/plugins/*.json` 声明扩展点，再通过只读命令检查 manifest 是否可被 loom 发现：

```bash
loom plugins list --json
```

当前 manifest 支持声明 `steps`、`adapters`、`hooks` 和 `reporters` 扩展点。该命令只负责发现和校验 manifest，不会加载或执行第三方代码；无效 JSON 或缺少必填字段的 manifest 会出现在 `invalid` 列表中。

需要把 manifest 接入执行引擎前，先生成声明式插件计划：

```bash
loom plugins plan --json
```

默认写入 `.loom/plugins/plugin-plan.json`。计划使用 `loom.plugin-plan.v1` schema 汇总有效插件、step、adapter、hook 和 reporter 接入点，并把无效 manifest 放入 `invalid`；同时明确 `dynamicLoading:false` 和 `manual-review`，表示该文件只用于审计和人工接入，不会加载或执行第三方代码。

## 生成 Remote MCP Marketplace 模板

如需为远程 MCP 服务准备发布模板，可先生成本地 marketplace 配置草稿：

```bash
loom plugins marketplace-template --url https://mcp.example.com/loom
```

默认写入 `.loom/marketplace/mcp-marketplace.json`，声明 `loom.mcp-marketplace.v1` schema、remote MCP endpoint、能力范围、`LOOM_MCP_TOKEN` bearer token 环境变量、人工审核信任边界，以及 Claude Code、Cursor、OpenCode、Codex 的配置落点。命令不会联网，也不会加载远程代码；已有模板默认不覆盖，需要重写时显式传 `--force`。

发布或同步前，先生成本地审计计划：

```bash
loom plugins marketplace-sync --json
```

默认读取 `.loom/marketplace/mcp-marketplace.json`，写入 `.loom/marketplace/mcp-marketplace.sync.json`，并追加 `.loom/compliance/marketplace-sync.jsonl`。该命令不会联网、不会发布，也不会写入任何客户端配置；它只校验 remote MCP URL 必须使用 HTTPS，且 marketplace 条目必须声明 `trust.codeExecution:false`。校验失败时会写入 high risk 审计记录，并以失败退出码返回，适合放入 CI。

## 企业治理 Policy 检查

`npm run audit:high` 会先运行 `npm audit --audit-level=high`，再执行 `loom policy check`。如需扫描本次变更文件，可直接运行：

```bash
loom policy check --files .env,config/production.json
```

项目可在 `.loom/policy.json` 中配置 `sensitivePaths` 和 `secretPatterns`，检查结果会写入 `.loom/compliance/policy-audit.jsonl`，便于 CI 或审计系统收集。

## 卸载

```bash
bash uninstall.sh --tool claude-code
# 或
loom uninstall --tool claude-code
```

卸载默认清理用户目录下由 loom 生成的文件。对 GitHub Copilot，如果当前工作目录存在由 loom 生成的 `.github/copilot-instructions.md`、`.github/workflows/copilot-setup-steps.yml` 或 `.github/workflows/loom-verify.yml`，会一并删除；不含 `Generated by loom` 标记的用户自定义文件不会被删除。

## 支持的 tools

| Tool ID     | 工具名称       | skills | commands/rules | plugin | hooks | MCP 配置 |
| ----------- | -------------- | ------ | -------------- | ------ | ----- | -------- |
| claude-code | Claude Code    | ✓      | plugin 分发     | ✓      | ✓     | ✓        |
| opencode    | OpenCode       | ✓      | ✓              | ✓      | ✗     | ✓        |
| cursor      | Cursor         | ✓      | `.mdc` rules    | ✗      | ✗     | ✓        |
| copilot     | GitHub Copilot | ✓      | instructions    | ✗      | ✗     | ✗        |
| codex       | Codex CLI      | ✓      | `AGENTS.md`     | ✗      | ✗     | ✓        |
