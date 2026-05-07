---
name: index-update
description: >
  完成工作后更新索引文件。测试通过后触发，确保工程索引、记忆文件、入口文档与代码保持同步。
  Use when: code changes are complete and indexes need to be synchronized.
---

# 索引更新 Skill

## 触发条件

- 功能测试通过后自动触发
- 用户手动触发："更新索引""同步索引""更新文档"

## 前置条件

1. 代码变更已完成（coding + review + test 全部通过）
2. 或用户明确要求更新索引

## 状态输出

执行开始时：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■■■■] Step 5/5 — 索引更新 (index-update)
 skill:   index-update
 status:  ▶ 开始执行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

执行结束时：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 pipeline [■■■■■] Step 5/5 — 索引更新 (index-update)
 status:  ✅ 完成
 下一步:  → 工作完成，可以提交
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

同时更新 `specs/<date+feature>/progress.md`。

## 执行流程

### Step 1: 检测变更范围

1. 运行 `git diff --name-only HEAD` 确认本次变更涉及的文件
2. 分析变更类型，按 `REFERENCE/update-checklist.md` 确定需要更新的文件

### Step 2: 更新 ENGINEERING-INDEX.md

对照 `REFERENCE/update-checklist.md` 中的检查清单，逐一检查并更新。

**更新顺序：**
1. 先更新数据库表 — 其他层依赖表名
2. 再更新 Model — Model 依赖表
3. 再更新 Service — Service 调用 Model
4. 再更新 Controller — Controller 调用 Service
5. 最后更新路由 — 路由注册 Controller
6. 更新调用链 — 基于以上更新串联
7. 更新中间件、定时任务、队列、公共包等

**签名格式标准**（参考 `REFERENCE/update-checklist.md`）：
- 控制器签名：struct + NewXxx + 所有方法
- 服务层签名：struct + NewXxx + 所有方法（标注调用链）
- 模型层签名：struct + NewXxx + 查询方法
- 数据库表：表名 | 用途 | 关键字段

### Step 3: 更新 MEMORY.md

**3.1 踩坑记录**
- 开发过程中发现了新的踩坑点 → 添加到"踩坑记录"节
- 格式：`- 问题描述；解决方案`

**3.2 用户偏好**
- 用户表达了新的偏好 → 添加到"用户偏好"节

**3.3 项目状态**
- 项目有重大变更（新增技术栈、架构调整等） → 更新"项目状态"节

### Step 4: 更新 CLAUDE.md（仅在必要时）

以下情况才更新 CLAUDE.md：
- 引入了新的约定或命令
- 入口程序有变化
- 开发流程有调整

一般性代码变更**不更新** CLAUDE.md。

### Step 5: 输出更新报告

```markdown
## 索引更新报告

**时间：** YYYY-MM-DD HH:mm
**触发原因：** <feature_name> 功能开发完成

### ENGINEERING-INDEX.md 更新

| 节 | 变更类型 | 内容 |
|----|---------|------|
| 路由表 | 新增 | POST /xxx/edit → XxxController.Edit |
| 控制器签名 | 新增 | XxxController 完整签名 |
| 服务层签名 | 新增 | XxxService 完整签名 |

### MEMORY.md 更新

- [ ] 踩坑记录：无新增
- [x] 用户偏好：新增偏好 XXX

### CLAUDE.md 更新

- 无需更新
```

## 约束

- 只更新索引文件，不可修改业务代码
- 索引内容必须与实际代码一致（可对照源码验证）
- 如果不确定是否需要更新，宁可多检查不要漏
- 新增的表名、路由路径必须与代码中实际使用的完全一致

## 完成条件与下一步

**索引更新完成后：**

1. 输出更新报告，确认所有索引文件已同步
2. 声明**工作完成，可以提交**

**索引未更新则禁止提交。**
