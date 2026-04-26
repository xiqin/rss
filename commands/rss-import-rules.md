# /rss-import-rules

导入项目自定义规则。

## 用法

```
/rss-import-rules
```

## 功能

导入项目已有的自定义规则到 rss 框架：

1. 扫描项目中可能的规则文件：
   - `.claude/memory/constitution.md`
   - `.claude/rules/*.md`
   - `.claude/skills/*/SKILL.md`
   - `CLAUDE.md`
   - `.cursorrules`
   - `.github/copilot-instructions.md`
   - `AGENTS.md` / `GEMINI.md`

2. 提取规则内容：
   - 架构规则
   - 编码红线
   - 技术栈信息
   - 自定义 skills

3. 合并到 rss 框架：
   - 更新 `constitution.md`
   - 更新 `project-structure.md`
   - 提示用户确认合并结果

## 适用场景

- 已有项目规则，需要导入 rss 框架
- 从其他 AI 工具迁移（Cursor、Copilot 等）
- 整合多个规则文件

## 注意事项

- 不覆盖已有的 rss 配置，而是合并
- 冲突时提示用户选择
- 保留原始规则文件
