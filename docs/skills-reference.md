# Skills 参考

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

- **用途**：工程索引同步
- **触发**：代码变更完成后
- **输出**：ENGINEERING-INDEX.md、MEMORY.md 更新
- **下一步**：工作完成，可以提交

## 辅助 Skills

### init-project

- **用途**：项目初始化
- **触发**：`/rss-init-project` 命令
- **输出**：宪章、工程结构、记忆文件、子 agent 上下文

## 通用 Skills（继承 superpowers）

### test-driven-development

- **用途**：测试驱动开发
- **触发**：需要 TDD 方式开发
- **循环**：红 → 绿 → 重构

### systematic-debugging

- **用途**：系统化调试
- **触发**：遇到 bug、测试失败、运行异常
- **方法**：复现 → 收集信息 → 缩小范围 → 形成假设 → 验证

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
- **输出**：审查请求材料

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

## 完成条件与下一步
...
```
