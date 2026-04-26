---
name: writing-skills
description: >
  编写新 skill。创建自定义 skill 文件。
  Use when: creating a new skill or modifying existing skills.
  Trigger keywords: 写 skill, 创建技能, 新技能, 自定义 skill.
---

# 编写新 Skill

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
  简短描述。说明何时使用此 skill。
  Use when: <触发条件描述>.
  Trigger keywords: <关键词列表>.
---

# <Skill 标题>

## 触发条件

- 用户说 xxx 时触发
- 在 xxx 流程中自动触发

## 状态输出（如适用）

执行开始时：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [进度条] Step N/5 — 阶段名 (skill名)
 skill:   skill名
 status:  ▶ 开始执行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 执行流程

### Step 1: ...
### Step 2: ...

## 约束

- 规则 1
- 规则 2

## 完成条件与下一步

完成后触发下一个 skill。
```

## Frontmatter 字段

| 字段 | 必需 | 说明 |
|------|------|------|
| name | 是 | skill 名称，必须与目录名一致 |
| description | 是 | 简短描述，用于 Skill 工具选择 |
| trigger | 否 | 触发条件说明 |

## 编写原则

1. **单一职责**：一个 skill 做一件事
2. **清晰触发**：明确什么条件下触发
3. **完整流程**：包含执行所需的全部步骤
4. **可中断**：支持在任何步骤暂停等待用户输入
5. **可链式**：支持与其他 skill 串联

## 状态横幅规范

如果 skill 是流水线的一部分，需要输出状态横幅：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■■□□□□□] Step N/M — 阶段名 (skill名)
 skill:   <skill名>
 功能:    <功能名>
 status:  ▶ 开始执行 | ✅ 完成 | ❌ 失败
 下一步:  → Step N+1: <下一阶段>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Reference 文件

如果 skill 需要大量参考信息，放在 REFERENCE/ 目录：

- 保持 SKILL.md 精简
- REFERENCE/ 包含详细检查清单、模板、示例
- 在 SKILL.md 中引用 REFERENCE 文件

## 测试新 Skill

1. 创建 skill 目录和 SKILL.md
2. 使用 Skill 工具调用测试
3. 验证触发条件是否正确
4. 验证执行流程是否完整
