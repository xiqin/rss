# 索引更新检查清单

## 变更检测 → 更新映射

检测到以下代码变更时，需更新对应的索引文件节：

### ENGINEERING-INDEX.md

| 代码变更 | 需更新的节 | 更新方式 |
|---------|-----------|---------|
| `routers/` 新增/修改文件 | 完整路由表 | 添加/修改对应路由组的行 |
| `controllers/` 新增 struct | 控制器签名 | 添加完整 struct + 方法签名块 |
| `controllers/` 新增方法 | 控制器签名 | 在已有 struct 块中追加方法 |
| `service/` 新增 struct | 服务层签名 | 添加完整 struct + 方法签名块 |
| `service/` 新增方法 | 服务层签名 | 在已有 struct 块中追加 + 标注调用链 |
| `models/` 新增文件 | 数据模型层 + 表名↔Model映射 | 添加签名块 + 映射行 |
| `models/` 新增方法 | 数据模型层 | 在已有 Model 块中追加 |
| 自动生成的 Model 重新生成 | 数据库表索引 | 检查是否有新表/删表 |
| 新建 DDL | 数据库表索引 | 在对应前缀分组添加行 |
| `middleware/` 新增/修改 | 中间件链 | 添加/修改表行 |
| 任务调度新增 | 定时任务 | 添加表行 |
| 队列消费者新增 | 队列消费者 | 添加表行 |
| 公共包新增 | 公共包速查 | 添加表行 |
| 依赖注入结构变更 | 依赖注入结构 | 更新 DI 树 |
| 新增调用链 | 调用链速查 | 添加典型链路示例 |

### MEMORY.md

| 事件 | 需更新的节 |
|------|-----------|
| 发现新坑点 | 踩坑记录 |
| 用户表达偏好 | 用户偏好 |
| 项目重大变更 | 项目状态 |

### CLAUDE.md

| 事件 | 需更新的节 |
|------|-----------|
| 新增入口程序 | 入口表 |
| 新增快速命令 | 快速命令 |
| 开发流程变更 | 开发流程 |
| 新增约定 | 对应节 |

## 签名格式标准

### 控制器签名格式

```go
// <文件名>.go
type XxxController struct { *repository.Repository }
func NewXxxController(deps *repository.Repository) *XxxController
func (c *XxxController) MethodName(ctx *gin.Context)
```

### 服务层签名格式

```go
// <文件名>.go
type XxxService struct { *repository.CommonRepository }
func NewXxxService(repo *repository.CommonRepository) *XxxService
func (s *XxxService) MethodName(params...) (returns...)
```

### 模型层签名格式

```go
// <文件名>.go — 表：<table_name>
type Xxx struct { raws.Xxx }
func NewXxx(db *gorm.DB) *Xxx
func (m *Xxx) GetByXxx(...) *raws.Xxx
```

### 数据库表格式

```markdown
| 表名 | 用途 | 关键字段 |
|------|------|----------|
| xxx_yyy | 简短说明 | field1, field2, field3 |
```

## 更新顺序

1. **先检测** — 确认变更范围
2. **先更新数据库表** — 其他层依赖表名
3. **再更新 Model** — Model 依赖表
4. **再更新 Service** — Service 调用 Model
5. **再更新 Controller** — Controller 调用 Service
6. **最后更新路由** — 路由注册 Controller
7. **更新调用链** — 基于以上更新串联
8. **更新 MEMORY/CLAUDE** — 按需
