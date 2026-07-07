---
name: loom-writing-skills
description: >
  Author or modify a loom skill file. Provides SKILL.md structure, frontmatter format, and quality checklist.
  Use when: creating or updating loom skills, their frontmatter, triggers, or quality checklist.
---

# 编写新 Skill

## Skill 文件结构

```text
skills/
  <skill-name>/
    SKILL.md          # 必需：skill 主文件
    references/       # 可选：参考文件
      *.md
    scripts/          # 可选：可执行检查、生成器、转换器
    assets/           # 可选：模板、prompt 片段、示例输入输出
    evals/            # 可选：触发边界样例
```

## SKILL.md 格式

````markdown
---
name: loom-<skill-name>
description: >
  简短描述。说明何时使用此 skill。
  Use when: <触发条件描述>.
  Trigger keywords: <关键词列表>.
---

# <Skill 标题>

## 触发条件

- 用户说 xxx 时触发
- 在 xxx 流程中自动触发

## 执行流程

### Step 1: ...
### Step 2: ...

## 约束

- 规则 1
- 规则 2

## 完成条件与下一步

完成后继续。
````

## Frontmatter 字段

| 字段 | 必需 | 说明 |
| ---- | ---- | ---- |
| name | 是 | skill 名称，必须与目录名一致 |
| description | 是 | 简短描述，用于 Skill 工具选择 |

## 编写原则

| 正确做法 | 反模式 |
| --- | --- |
| 单一职责 | 一个 skill 做多件事 |
| 清晰触发条件 | 触发太宽或太窄 |
| 完整执行流程 | 步骤描述模糊 |
| 可中断、可链式 | 缺少完成条件或不串联 |
| 有必要的自检清单 | 输出质量不可验证 |

## 职责分层

- **Router skill**：只做入口分流、解释推荐路径和上下文策略；不得写流水线状态。
- **Pipeline skill**：选择、推进或调整流水线；只有这类 skill 可以持久化 `dynamic_steps` 或推进 `pipeline.state.json`。
- **Execution skill**：执行已确认阶段；不得自行扩大流程范围或跳过 gate。
- **Review skill**：findings 优先，先列问题和证据，再给摘要。

## 触发与上下文负载

- `description` 必须说明 `Use when:`，并保持短而精确。
- 写清楚触发条件和非触发条件，避免 model 在相邻场景误触发。
- 主 `SKILL.md` 只放必须执行的步骤；长解释、示例、模板放 `references/` 或 `assets/`。
- 每个步骤必须有可检查的完成标准，避免 agent 提前宣布完成。

## 去沉积检查

修改 skill 时逐段做 no-op test：如果删除某句话不会改变 agent 行为，就删除或移入 reference。

常见沉积信号：

- 同一规则在多个文件重复但措辞不同。
- skill 同时承担 router、pipeline、execution、review 多层职责。
- 长篇背景说明没有对应检查动作。
- 没有说明失败时该停下、降级还是请求用户确认。

## 参考与测试

详细的 references 结构、scripts/evals 写法、测试方法和常见反模式见 `references/detailed-guide.md`。
