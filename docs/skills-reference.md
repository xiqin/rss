---
title: Skills 参考
description: loom 全部技能快速参考
---

# Skills 参考

> **本文件由各 SKILL.md 自动汇总，内容可能滞后于实际 skills。最新定义请直接参考 `skills/` 目录中各 SKILL.md。**

## 核心流水线 Skills

### brainstorming

- **用途**：需求头脑风暴
- **触发**：用户提出需求、功能描述、PRD
- **输出**：`specs/<date+feature>/spec.md`
- **下一步**：等待用户确认 → writing-plans

### writing-plans

- **用途**：拆解实现计划
- **触发**：spec.md 已存在，用户确认方案
- **输出**：`specs/<date+feature>/plan.md`
- **下一步**：等待用户确认 → git-worktree

### subagent-driven-development

- **用途**：Subagent 隔离派发
- **触发**：plan.md 已存在，git worktree 已创建
- **输出**：源码 + 测试报告
- **下一步**：index-update

### index-update

- **用途**：codegraph 同步
- **触发**：代码变更完成后
- **输出**：codegraph 同步（可用时）、结构化 memory 更新、MEMORY.md 导出视图（按需）
- **下一步**：工作完成，可以提交

## 辅助 Skills

### init-project

- **用途**：项目初始化
- **触发**：`/loom-init-project` 命令
- **输出**：宪章、结构化记忆、子 agent 上下文、agent 入口文件

### router

- **用途**：轻量入口路由
- **触发**：用户请求需要先判断应进入哪个 loom 能力
- **边界**：不写 `pipeline.state.json`，不生成 `dynamic_steps`，开发型任务交给 `pipeline-selector`
- **输出**：推荐 skill / pipeline selector、理由、下一步和上下文策略

### pipeline-selector

- **用途**：AI 自主流程选择
- **触发**：用户未指定 `--type`，或调用 `loom run --auto` / MCP `loom_select_pipeline`
- **输出**：选择结果；初始化后持久化到 `pipeline.state.json` 的 `dynamic_steps`，并反映在 `progress.md`
- **决策**：规则短路 → AI fallback → 规则兜底
- **护栏**：must_include、dependency_closure、never_skip_gates、max_steps
- **下一步**：向用户说明选择结果并等待明确确认后执行；如需人工审查，可先用 `loom select` 生成 `pipeline-plan.md` 再 `loom run --approve-pipeline`

## 通用 Skills（继承 superpowers 框架）

### test-driven-development

- **用途**：测试驱动开发
- **触发**：需要 TDD 方式开发
- **循环**：确认 seam → 红 → 绿 → 重构

### systematic-debugging

- **用途**：系统化调试
- **触发**：遇到 bug、测试失败、运行异常
- **方法**：建立 red-capable feedback loop → 复现/最小化 → 收集信息 → 形成假设 → 验证 → 修复

### verification-before-completion

- **用途**：完成前验证
- **触发**：宣布任务完成前
- **检查**：编译、测试、代码质量、功能完整性、文档同步

### using-git-worktrees

- **用途**：Git 工作树隔离
- **触发**：开始新功能开发
- **输出**：feature 分支

### finishing-a-development-branch

- **用途**：开发分支收尾
- **触发**：开发完成
- **流程**：验证 → 提交 → 推送 → 创建 PR

### requesting-code-review

- **用途**：请求代码审查
- **触发**：准备审查
- **输出**：Standards + Spec 双轴预审查结果和审查请求材料

### receiving-code-review

- **用途**：接受代码审查
- **触发**：收到审查反馈
- **流程**：理解反馈 → 分类处理 → 修复 → 回复

### dispatching-parallel-agents

- **用途**：并行派发
- **触发**：多个独立任务可并行
- **流程**：分析依赖 → 创建并行组 → 并行派发

### writing-skills

- **用途**：编写新 skill
- **触发**：创建自定义 skill
- **格式**：frontmatter + 触发条件 + 执行流程

## Skill 文件结构

```
skills/
  <skill-name>/
    SKILL.md          # 必需：skill 主文件
    REFERENCE/        # 可选：参考文件
      *.md
```

## SKILL.md 格式

```markdown
---
name: <skill-name>
description: >
  简短描述。Use when: <触发条件>.
---

# <Skill 标题>

## 触发条件

...

## 执行流程

...
```
