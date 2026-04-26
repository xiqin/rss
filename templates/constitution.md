# 项目宪章

> 本文件由 `/rss-init-project` 自动生成，请根据项目实际情况完善。

## 编码行为准则

> 源自 Andrej Karpathy 的 LLM 编码原则，是所有 AI 产出代码的底层纪律。

### 1. 先思考，再编码

- 显式声明你的假设，不确定时主动提问
- 当存在多种合理解读时，列举所有可能性，不要默默选择一种
- 如果有更简单的方案，必须提出

### 2. 极简优先

- 只写解决问题的最小代码，不做推测性实现
- 不添加用户未要求的功能、配置项或抽象层
- 判断标准：一个高级工程师看了会不会觉得过度设计？

### 3. 精准手术

- 只改动必须改动的部分，不"顺便优化"相邻代码
- 保持现有代码风格，除非用户明确要求改变
- 清理范围仅限于自己改动产生的孤代码

### 4. 目标驱动

- 将模糊任务转化为可验证的成功标准
- 制定多步验证计划，循环执行直到达标
- 不声称"完成"，除非验证通过

## 核心原则

1. **{{ARCH_PRINCIPLE}}**：{{ARCH_DESC}}
2. **{{DI_PRINCIPLE}}**：{{DI_DESC}}
3. **{{CONFIG_PRINCIPLE}}**：{{CONFIG_DESC}}
4. **{{ERROR_PRINCIPLE}}**：{{ERROR_DESC}}
5. **{{CODEGEN_PRINCIPLE}}**：{{CODEGEN_DESC}}

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| {{LANGUAGE}} | {{LANGUAGE_VERSION}} | 编程语言 |
| {{WEB_FRAMEWORK}} | {{FRAMEWORK_VERSION}} | Web 框架 |
| {{ORM}} | {{ORM_VERSION}} | ORM |
| {{DATABASE}} | {{DATABASE_VERSION}} | 数据库 |
| {{CACHE}} | {{CACHE_VERSION}} | 缓存 |
| {{LOGGING}} | {{LOGGING_VERSION}} | 日志 |
| {{DI}} | {{DI_VERSION}} | 依赖注入 |

## 编码红线

> 以下红线为自动生成，请确认并补充。

{{CODING_REDLINES}}

## 项目约束

- 语言版本：{{LANGUAGE_VERSION}}
- 必须通过：{{BUILD_CMD}}
- 必须通过：{{VET_CMD}}
- 测试命令：{{TEST_CMD}}

## 开发流程

```
brainstorming → writing-plans → git-worktree → subagent-dev → index-update
```

详见 CLAUDE.md。
