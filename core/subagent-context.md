# Subagent 上下文模板（core/subagent-context.md）

> ⚠️ 此文件为模板定义，不直接用于 subagent。实际使用时由 /rss-init-project 渲染后生成 `.claude/templates/subagent-context.md`

## 用途

Subagent 隔离派发时注入的项目上下文，提供最精简的约束信息，减少 token 消耗。

## 模板

```markdown
# 项目约束

## 架构
{{ARCH_PATTERN}}

## 编码红线
{{CODING_REDLINES}}

## 技术栈
{{TECH_STACK}}

## 错误处理
{{ERROR_PATTERN}}

## 响应格式
{{RESPONSE_PATTERN}}

## 日志格式
{{LOGGING_PATTERN}}

## DI 模式
{{DI_PATTERN}}

## 测试模式
{{TEST_PATTERN}}
```

## 占位符说明

| 占位符 | 来源 | 示例 |
|--------|------|------|
| `{{ARCH_PATTERN}}` | 目录结构推断 | Router → Controller → Service → Repository |
| `{{CODING_REDLINES}}` | 宪章 + 项目检测 | 禁止在 Controller 写业务逻辑等 |
| `{{TECH_STACK}}` | go.mod / package.json | Go 1.24 + Gin + GORM + MySQL |
| `{{ERROR_PATTERN}}` | 源码分析 | errs.New(code, msg) |
| `{{RESPONSE_PATTERN}}` | 源码分析 | response.Backend***Response |
| `{{LOGGING_PATTERN}}` | 源码分析 | logger.Info("描述", zap.String("key", value)) |
| `{{DI_PATTERN}}` | 源码分析 | Google Wire |
| `{{TEST_PATTERN}}` | 测试框架检测 | 如 Go: `go test ./... -v -count=1`，Python: `pytest -v`，Node.js: `npm test` |

## 使用方式

1. `/rss-init-project` 生成 `.claude/templates/subagent-context.md`
2. subagent-driven-development 派发时读取此文件注入 subagent prompt
3. 项目可手动编辑 `.claude/templates/subagent-context.md` 添加项目特有约束

## 生成逻辑

`/rss-init-project` 时：

1. 扫描项目获取技术栈信息
2. 源码分析提取错误处理/响应/日志模式
3. 读取宪章中的编码红线
4. 渲染模板 → `.claude/templates/subagent-context.md`
