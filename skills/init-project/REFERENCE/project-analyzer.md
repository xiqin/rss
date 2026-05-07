# 项目分析模板

> 本文件是语言检测规则库，init-project 按项目语言选择对应规则进行分析。

## 扫描阶段

### 1.1 语言检测

| 文件 | 检测结果 |
|------|---------|
| go.mod | Go |
| package.json | Node.js / TypeScript |
| requirements.txt | Python |
| pom.xml | Java |
| Cargo.toml | Rust |
| build.gradle | Java/Kotlin |

### 1.2 框架检测

**Go:**
- `import "github.com/gin-gonic/gin"` → Gin
- `import "github.com/labstack/echo"` → Echo
- `import "github.com/gofiber/fiber"` → Fiber
- `import "net/http"` → 标准库

**Python:**
- `import fastapi` → FastAPI
- `import flask` → Flask
- `import django` → Django

**Node.js:**
- `import express` / `require('express')` → Express
- `import Koa` / `require('koa')` → Koa
- `import { NestFactory }` → NestJS

### 1.3 ORM 检测

**Go:**
- `import "gorm.io/gorm"` → GORM
- `import "github.com/jmoiron/sqlx"` → sqlx
- `import "database/sql"` → 标准库

**Python:**
- `import sqlalchemy` → SQLAlchemy
- `import peewee` → Peewee
- `import prisma` → Prisma

**Node.js:**
- `import { PrismaClient }` → Prisma
- `import { DataSource }` → TypeORM
- `import { Sequelize }` → Sequelize

### 1.4 数据库检测

- `mysql` / `mariadb` → MySQL
- `postgres` / `postgresql` → PostgreSQL
- `sqlite` → SQLite
- `mongodb` → MongoDB

### 1.5 缓存检测

- `redis` → Redis
- `memcached` → Memcached

### 1.6 日志检测

**Go:**
- `go.uber.org/zap` → Zap
- `github.com/sirupsen/logrus` → Logrus
- `log` → 标准库

**Python:**
- `logging` → 标准库
- `loguru` → Loguru

### 1.7 DI 检测

**Go:**
- `github.com/google/wire` → Wire
- `go.uber.org/dig` → Dig
- `github.com/facebookgo/inject` → inject

**Java/Spring:**
- `@Autowired` / `@Inject` → Spring DI

## 源码分析

### 2.1 错误处理模式

```bash
# Go
grep -rn "errs\.New\|errors\.New\|fmt\.Errorf\|panic\(" --include="*.go"

# Python
grep -rn "raise \|except \|try:" --include="*.py"

# JavaScript/TypeScript
grep -rn "throw \|catch \|Error(" --include="*.ts" --include="*.js"
```

### 2.2 响应格式模式

```bash
# 搜索响应结构体
grep -rn "type.*Response struct\|Response\s*{" --include="*.go"

# 搜索 JSON 响应
grep -rn "c\.JSON\|ctx\.JSON\|res\.json\|jsonify" --include="*.go" --include="*.py" --include="*.ts"
```

### 2.3 日志模式

```bash
# Go (Zap)
grep -rn "logger\.\(Info\|Error\|Warn\|Debug\)" --include="*.go"

# Python
grep -rn "logger\.\(info\|error\|warning\|debug\)\|logging\.\(info\|error\)" --include="*.py"
```

### 2.4 路由模式

```bash
# Go (Gin)
grep -rn "router\.\(GET\|POST\|PUT\|DELETE\)\|group\.\(GET\|POST\)" --include="*.go"

# Python (FastAPI)
grep -rn "@app\.\(get\|post\|put\|delete\)\|@router\.\(get\|post\)" --include="*.py"
```

### 2.5 测试模式

```bash
# Go
grep -rn "func Test" --include="*_test.go"

# Python
grep -rn "def test_\|class Test" --include="*.py"

# JavaScript/TypeScript
grep -rn "describe\|it\|test(" --include="*.test.ts" --include="*.spec.ts"
```

## 编码红线检测

自动检测项目中常见的编码红线：

### Go 项目

```bash
# 禁止 fmt.Println
grep -rn "fmt\.Println\|fmt\.Print\(" --include="*.go" | head -5

# 禁止硬编码密码
grep -rn "password.*=.*\"\|secret.*=.*\"\|api_key.*=.*\"" --include="*.go" | head -5

# 禁止 SQL 拼接
grep -rn "Where(.*+\|Exec(.*+" --include="*.go" | head -5
```

### Python 项目

```bash
# 禁止 print()
grep -rn "print(" --include="*.py" | head -5

# 禁止硬编码
grep -rn "PASSWORD.*=.*\"\|SECRET.*=.*\"" --include="*.py" | head -5
```

## 目录结构推断

根据目录名推断架构分层：

| 目录模式 | 推断分层 |
|---------|---------|
| controller/s, handler/s, view/s | 控制器层 |
| service/s, usecase/s, business | 业务逻辑层 |
| model/s, entity/s, domain | 数据模型层 |
| repository/s, dao/s, store | 数据访问层 |
| middleware/s, interceptor | 中间件 |
| router/s, route/s, api | 路由定义 |
| config/, conf/, settings | 配置管理 |
| util/s, helper/s, common | 工具函数 |
| pkg/, lib/, shared | 公共包 |
| cmd/, bin/, main. | 入口程序 |
