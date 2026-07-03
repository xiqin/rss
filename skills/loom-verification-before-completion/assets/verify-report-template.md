## 完成前验证报告

**功能：** xxx
**验证时间：** YYYY-MM-DD HH:mm

### 检查结果

| 检查项 | 状态 | 说明 |
| ------ | ---- | ---- |
| 前置产出核验 | ✅ | test-report + reviewer 通过 |
| BUILD_CMD | ✅ | 编译通过 |
| VET_CMD | ✅ | 无警告 |
| 占位符扫描 | ✅ | 无占位符 |
| 类型一致性 | ✅ | 类型匹配 |
| 最终一致性核验 | ✅ | spec 功能全覆盖 |

### Requirement Coverage

| Requirement ID | 代码位置 | 测试证据 | 状态 |
| -------------- | -------- | -------- | ---- |
| REQ-001 | `path:symbol` | `test name` | PASS |

### Evidence Receipt

- evidence-command: `<实际执行的构建/检查命令>`
- evidence-exit-code: `0`
- evidence-file: `evidence/verification.log`
- evidence-sha256: `<64位 SHA-256>`

verdict: PASS
