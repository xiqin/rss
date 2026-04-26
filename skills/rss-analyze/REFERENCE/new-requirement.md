# 新增类需求分析规范

## 输出格式

需求分析必须输出以下完整结构，保存到 `specs/<date+feature>/spec.md`：

```markdown
# <功能名> 需求分析

## 概述
一句话描述功能目标和业务价值。

## 功能清单
- [ ] 功能点1：一句话描述
- [ ] 功能点2：一句话描述

## 模块详细分析

### 功能点1：XXX
- **前置条件**：用户需要满足什么条件
- **触发条件**：什么操作触发该功能
- **业务流程**：
  1. 步骤一
  2. 步骤二
- **业务规则**：
  - 规则1：具体约束
- **异常场景**：
  - 异常1：描述 → 处理方式

## 接口设计

### 接口1：XXX
- **请求方法**：GET / POST / PUT / DELETE
- **请求路径**：/xxx/yyy
- **认证方式**：JWT / API签名 / 无
- **请求参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| param1 | string | 是 | 说明 |
| param2 | int | 否 | 说明，默认值 |

- **响应结构**：
```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

- **错误码**：

| 错误码 | 说明 |
|--------|------|
| 41001 | 参数错误 |

## 数据模型

### 新增表：table_name
```sql
CREATE TABLE `table_name` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `field1` varchar(255) NOT NULL DEFAULT '' COMMENT '说明',
  `create_at` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表说明';
```

### 修改表：existing_table
- 新增字段：`field_name` type DEFAULT comment '说明'

## 涉及的现有代码
- `path/to/file.go`：需要修改的方法

## 待决议列表
- [ ] 问题1：需要用户确认的内容
```

## 约束

- 禁止模糊描述："大概""可能""差不多"
- 数值必须有单位："2秒内""100条/页"
- 接口路径必须遵循项目路由分组规范
- 数据库字段命名必须使用 snake_case
