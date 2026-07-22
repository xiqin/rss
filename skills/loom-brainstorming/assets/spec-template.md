# <功能名> — 需求规格

## 1. 概述

**需求来源**：用户描述 / PRD 链接
**需求类型**：新增 / 修改
**选定方案**：方案 X — <简述>

## 2. 功能清单

| Requirement ID | 功能点 | 优先级 | 可验证验收标准 |
| -------------- | ------ | ------ | -------------- |
| REQ-001 | xxx | P0 | 给定…当…则… |
| REQ-002 | xxx | P1 | 给定…当…则… |

## 2.1 结构化需求清单 requirements.json

同目录必须生成 `requirements.json`。每个 `REQ-xxx` 必须声明 `types`、`required_categories` 和可独立验证的 `behaviors`，用于后续 `traceability.json` 逐行为闭环。

`types` 用于推导必须覆盖的行为维度；可用值包括：`functional`、`input`、`authorization`、`write`、`mutation`、`state`、`idempotent`、`concurrent`、`external`、`security`、`performance`、`observable`、`recovery`。

`required_categories` 必须从以下白名单选择：`happy-path`、`boundary`、`invalid-input`、`authorization`、`state-transition`、`idempotency`、`concurrency`、`atomicity`、`external-failure`、`compatibility`、`security`、`performance`、`observability`、`recovery`、`forbidden-behavior`。

示例：

```json
{
  "requirements": [
    {
      "id": "REQ-001",
      "status": "failing",
      "types": ["functional", "input", "authorization"],
      "required_categories": ["happy-path", "invalid-input", "authorization"],
      "acceptance": ["给定有效用户和输入，当提交请求，则返回成功结果"],
      "behaviors": [
        {
          "id": "REQ-001-B01",
          "category": "happy-path",
          "description": "有效输入时完成主流程",
          "status": "failing",
          "acceptance": ["测试证明主流程成功"]
        },
        {
          "id": "REQ-001-B02",
          "category": "invalid-input",
          "description": "无效输入时返回明确错误且不产生副作用",
          "status": "failing",
          "acceptance": ["测试证明无效输入被拒绝"]
        },
        {
          "id": "REQ-001-B03",
          "category": "authorization",
          "description": "无权限用户不能执行该操作",
          "status": "failing",
          "acceptance": ["测试证明未授权请求被拒绝"]
        }
      ]
    }
  ]
}
```

## 3. 接口/API 设计（如有）

### 3.1 <接口名>

- **调用方式**：POST /api/xxx/edit
- **描述**：...
- **输入**：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| name | string | 是 | 名称 |

- **输出**：遵循项目统一格式

## 4. 数据设计（如有）

根据项目类型填写数据库表、数据结构、状态管理或文件格式。

## 5. 业务规则

- 规则 1：...
- 规则 2：...

## 6. 异常/边界场景

| 场景 | 预期行为 |
| ---- | -------- |
| 输入缺失 | 返回明确错误 |
| 权限不足 | 拒绝操作 |

## 7. 非目标

- 本次明确不实现：...
