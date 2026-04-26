# /rss-init-project

项目初始化。扫描项目源码，自动生成宪章、工程结构、子 agent 上下文等配置文件。

## 用法

```
/rss-init-project
```

## 功能

加载 `skills/init-project/SKILL.md`，执行项目初始化：

1. 扫描项目根目录（语言、框架、目录结构）
2. 深度分析源码（错误处理、响应格式、日志、DI 模式）
3. 生成项目文件：
   - `.claude/memory/constitution.md`（宪章）
   - `.claude/rules/project-structure.md`（工程结构）
   - `.claude/memory/MEMORY.md`（记忆文件）
   - `.claude/templates/subagent-context.md`（子 agent 上下文）
4. 输出报告（已生成 + 需人工完善的 [TODO]）

## 适用场景

- 首次使用 rss 框架
- 项目结构发生重大变更
- 需要重新生成配置文件

## 注意事项

- 已有配置文件时必须提示是否覆盖并等用户确认
- 检测到不明确的信息时使用 `[TODO]` 标记
- 禁止修改任何业务代码
