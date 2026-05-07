# Gemini 配置

本项目使用 rss（Requirement-Driven Software Engineering）AI 工程化框架。

核心规则、流水线、Skills 清单详见 `CLAUDE.md`（Gemini 同样适用）。

## Gemini 特殊说明

- 使用 `activate_skill` 工具触发 skills
- 技能文件路径：`skills/<skill-name>/SKILL.md`
- 项目宪章：`.claude/memory/constitution.md`

## 快速开始

1. 首次使用运行 `activate_skill("init-project")` 扫描项目并生成配置
2. 使用 `activate_skill("brainstorming")` 开始需求分析
