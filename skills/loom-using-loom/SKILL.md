---
name: loom-using-loom
description: >
  Overview of the loom engineering framework: pipeline stages, skills catalog, and review dimensions.
  Load when the user asks about loom capabilities or how to use it.
  Use when: the user asks how loom works, what skills exist, or how to run the engineering pipeline.
---

# Using loom — AI 工程化框架

loom 是一个 AI 工程化框架，把需求、规范、上下文、执行过程"织"成一套稳定工程流程。流水线由 `.loom/workflow.yaml` 集中定义。

<!-- loom:generate:rule:no-skip-step -->
**严令禁止跳步**

严令禁止跳过任何步骤。每个步骤完成后必须显式触发下一步，不可自行终止。
<!-- /loom:generate:rule:no-skip-step -->

## Skills 清单

<!-- loom:generate:skills-catalog -->
所有 skills 通过 `/` 命令或 Skill 工具调用。详见 `.loom/skills/` 目录（完整定义）

**核心流水线 Skills：**

| Skill                               | 输出                           | 说明                                               |
| ----------------------------------- | ------------------------------ | -------------------------------------------------- |
| loom-brainstorming | `specs/<date+feature>/spec.md` | 需求头脑风暴, +可视化伴侣、设计自检、用户审查 Gate |
| loom-writing-plans | `specs/<date+feature>/plan.md` | 分层拆解 task, +模型选择、类型一致性检查 |
| loom-using-git-worktrees | feature 分支 | 创建隔离分支, +测试基线验证 |
| loom-subagent-driven-development | 源码 + 测试报告 | Subagent 派发 + 双重审查,独立模板文件、4种状态处理 |
| loom-verification-before-completion | 验证报告 | 完成前验证, +Spec覆盖、类型一致性、编译测试 |
| loom-index-update | codegraph 同步 + 结构化记忆 | codegraph 同步 |

**辅助 Skills：**

| Skill             | 说明                               |
| ----------------- | ---------------------------------- |
| loom-init-project | 项目初始化（扫描 + 生成宪章/记忆/入口） |
| loom-router | 轻量入口路由（分流到 skill 或 pipeline selector，不写流水线状态） |
| loom-pipeline-selector | 开发流水线步骤选择（确认后写入 dynamic_steps） |
| loom-using-loom | loom 框架使用指南（本 skill） |

**通用 Skills：**

| Skill                               | 说明                                              |
| ----------------------------------- | ------------------------------------------------- |
| loom-test-driven-development | TDD 测试驱动开发，+流程图、好/坏示例、常见借口表 |
| loom-systematic-debugging | 系统化调试, +4阶段流程图、条件等待、纵深防御 |
| loom-requesting-code-review | 请求代码审查, +预审查清单、审查模板 |
| loom-receiving-code-review | 接受代码审查, +响应模板、流程图 |
| loom-dispatching-parallel-agents | 并行 agent 派发, +模型选择、并发工作流图 |
| loom-writing-skills | 编写自定义 skills, +方法论深度、流程图 |
| loom-finishing-a-development-branch | 分支完成流程 , +选项展示（Merge/PR/Keep/Discard） |

**测试 Skills：**

| Skill      | 输出                           | 说明                                                        |
| ---------- | ------------------------------ | ----------------------------------------------------------- |
| loom-qa | `qa/<date+target>/qa-report.md` | QA 验收流水线，测试人员使用：新功能验证 + 回归 + 集成测试 + 持久化用例库 |
<!-- /loom:generate:skills-catalog -->

<!-- loom:generate:review-summary -->
### 6 维审查

| 维度 | 关键检查项 |
|------|----------|
| 架构合规 | 是否遵循项目架构分层（从 constitution.md 读取）、是否存在跨层调用 |
| 代码质量 | 是否使用了项目禁止的调试函数、SQL 是否参数化（防注入） |
| 安全风险 | SQL 注入检查、认证/授权是否正确 |
| 性能隐患 | N+1 查询检查、分页查询是否使用框架分页组件 |
| 规范一致性 | 命名是否符合项目规范、响应格式是否统一 |
| 变更影响范围 | 本次变更的函数、接口、类型是否被其他模块引用（codegraph 可用时查 codegraph_impact/codegraph_callers，否则用源码搜索补充判断）、公开接口的参数签名是否变化（新增必填参数、删除字段、类型变更） |
<!-- /loom:generate:review-summary -->
