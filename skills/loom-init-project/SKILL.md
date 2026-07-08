---
name: loom-init-project
description: >
  Bootstrap .loom/ context files for a new repository: constitution, structured memory, workflow, and agent entry files.
  Use when: initializing loom context for a repository that lacks .loom/ files or standard agent entry docs.
when_to_use: Bootstrap .loom context, workflow, memory, and agent entry files for a repository.
argument-hint: <project root>
user-invocable: true
---

# 项目初始化 Skill

- `.loom/` 是唯一长期维护点，存放项目原则、结构化记忆和 workflow。
- `AGENTS.md` 是 Codex/OpenCode 等通用 agent 的标准入口。
- Claude、Cursor、Copilot 只接收薄 wrapper 或规则副本，避免多处规则漂移。
- 初始化尽量自动化；不确定的信息用 `[TODO]` 标记，交给用户确认。

## 触发条件

用户只需要说 `/loom-init-project`、`初始化项目` 或 `扫描项目生成配置`。

## 内部执行方式

触发本 skill 后，判断当前目录是不是项目根目录，如果不是根目录，询问用户是否在当前目录运行：

### 第一步：确认角色（多选）

如果用户没有明确指定角色，先询问这个项目给谁用（**可多选，取并集**）：

- `pm`：PM 视角，生成产品上下文 `.loom/rules/product.md`，走 `需求 → spec → 原型` 流水线
- `dev`：研发视角，生成工程上下文（宪章 / subagent-context），走完整工程流水线

角色决定生成哪些 `.loom/` 文件；`workflow.yaml` 始终是含全部 pipeline 的单文件，不裁剪。未指定时默认 `dev`（与历史行为一致）。把选择通过 `--roles` 传给脚本，例如 `--roles pm,dev`。

### 第二步：确认 agent 工具

如果用户没有明确指定 agent 工具，再询问要为哪些工具生成入口文件。可选项为：

- `claude-code`：生成 `AGENTS.md`+ `CLAUDE.md`
- `codex`：生成 `AGENTS.md`
- `opencode`：生成 `AGENTS.md` 并合并 `opencode.json` watcher ignore
- `cursor`：生成 `.cursor/rules/loom.mdc`
- `copilot`：生成 `.github/copilot-instructions.md`

拿到用户选择后，把角色和工具通过 `--roles` / `--tools` 显式传给脚本，例如：

```bash
node <skill-dir>/scripts/init-project.mjs --cwd <project-root> --roles pm,dev --tools claude-code,codex
```

### 第三步：填充产品上下文（仅当选了 `pm`）

脚本对 `pm` 角色只写出 `.loom/rules/product.md` 模板（保留 `{{...}}` 占位符）。脚本运行后，**问用户以下 5 题**，再用 Edit 把答案填进 `product.md`，替换对应占位符：

1. 产品名 + 一句话描述 → `{{PRODUCT_NAME}}` / `{{PRODUCT_ONELINE}}`
2. 目标用户是谁 → `{{TARGET_USERS}}`
3. 核心价值 → `{{CORE_VALUE}}`
4. 主要平台（移动端 / PC / 两者）→ `{{PLATFORM}}`
5. UI 风格（Material / Ant Design / 简洁 / 无要求）+ 原型受众（研发评审 / 用户测试 / 投资人 demo）→ `{{UI_STYLE}}` / `{{PROTOTYPE_AUDIENCE}}`

填完确认无残留 `{{...}}` 占位符。`## 设计原则` 下的 `[TODO]` 提示用户后续补充，不强制此刻填。

如果当前环境已安装 loom CLI，也可以等价运行：

```bash
loom init-project
```

可选参数：

- `--force`：覆盖已有 loom 生成文件。
- `--roles pm,dev`：显式指定角色，决定生成哪些 `.loom/` 文件；不传时默认 `dev`（与历史行为一致）。`pm` 多写 `product.md`，`dev` 写工程上下文，两者取并集。
- `--tools claude-code,codex,cursor,copilot,opencode`：显式指定要分发的工具；兼容历史别名 `claude`，不传时 CLI 在交互终端会询问用户，非交互环境会自动检测并默认生成 `AGENTS.md`。
- `--template-dir <path>`：使用指定模板目录，主要用于测试或本地调试；CLI 入口不暴露该参数。

执行后检查输出报告中的 `written` 和 `skipped`。被跳过的文件通常是用户已有的非 loom 管理文件，不要擅自覆盖，除非用户明确同意或使用 `--force`。

## 输出结构

```text
.loom/
  memory/store.json                       # 所有角色，结构化记忆源
  memory/MEMORY.md                        # 所有角色，只读导出视图
  workflow.yaml                           # 所有角色（单文件，含全部 pipeline）
  rules/product.md                        # 选择 pm 角色时
  rules/constitution.md                   # 选择 dev 角色时
  contexts/subagent-context.md            # 选择 dev 角色时
AGENTS.md                       # 选择 Codex/OpenCode/Claude Code 时
CLAUDE.md               # 选择 Claude Code 时
.cursor/rules/loom.mdc                  # 检测到 Cursor 时
.cursor/rules/loom-session-init.mdc     # Cursor 等价 session-start hook（新增）
.github/copilot-instructions.md         # 检测到 GitHub Copilot 时
.github/workflows/loom-verify.yml       # 可选：CI 规范门禁（询问用户是否生成）
```

## 人工检查清单

脚本完成后必须快速审阅（按所选角色）：

1. 【dev】`.loom/rules/constitution.md` 中技术栈、构建命令、测试命令、目录树和架构模式是否准确。
2. 【dev】codegraph：可用时 `loom init-project` 已自动 `codegraph init` 建图（`.codegraph/`）；codegraph 不可用时确认图查询能力已跳过。
4. 【pm】`.loom/rules/product.md` 中 5 项产品上下文已填，无残留 `{{...}}` 占位符。
5. `.loom/memory/MEMORY.md` 是否有需要保留的用户偏好、踩坑和长期决策。
6. 入口文件是否轻量：它们应该指向 `.loom/`，不要复制大段规则。

## 约束

- 不修改业务代码。
- 不覆盖用户已有的非 loom 管理文件，除非用户明确要求。
- 生成后不得留下未渲染的 `{{PLACEHOLDER}}`。
- Cursor `.mdc` 必须有合法 frontmatter。
- subagent/并行流程只作为可选执行策略，不作为所有任务的默认要求。

## 完成标准

- 初始化脚本运行成功。
- 输出报告无异常。
- 所有生成文件路径与 `.loom/` 目录结构一致。
- 如存在 `[TODO]`，已明确提示用户后续确认。
