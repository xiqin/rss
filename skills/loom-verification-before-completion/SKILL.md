---
name: loom-verification-before-completion
description: >
  Final integrity check before declaring work complete: compile, test, placeholder scan, spec coverage.
  Use when: code changes appear complete and need final compile, test, and integrity verification.
---

# 完成前验证

## 铁律

1. 没有证据就不能声称通过。
2. 当前消息没有新鲜验证证据，就不许声称完成。
3. 已有 `specs/<date+feature>/test-report.md`、reviewer 判定等前置报告也算证据，但必须读取并引用。

## 产物根目录

本阶段的 `specDir` 是 `specs/<date+feature>/`。所有验证产物都必须写入该目录内；禁止在项目根目录写 `verify-report.md`、`progress.md` 或 `handoffs/`。

## 门禁函数

做状态声明前：识别证据 → 运行命令或读取报告 → 验证输出确实支持断言 → 再声明。

## 自动校验

进入人工判断前运行：

```bash
node <skill-dir>/scripts/verify-artifacts.mjs --spec-dir specs/<date+feature>
```

脚本通过只代表产物齐全且没有明显机械性缺陷；脚本失败时，先修复或补齐证据。

## 执行流程

1. 前置产出核验：读取 `specs/<date+feature>/test-report.md` 和 combined-reviewer 报告，确认最终通过。
2. 编译验证：读取 `.loom/rules/constitution.md` 中的 BUILD_CMD、VET_CMD 并执行；TEST_CMD 已由 test-reporter 执行时不重复。
3. 占位符扫描：搜索 `TBD`、`TODO`、`implement later`、`fill in details`。
4. 类型一致性检查：后续 task 使用的类型、方法签名和属性名与前序定义一致。
5. 最终一致性核验：spec 功能清单在 test-report 中有对应验证。
6. Drift Check：确认实现仍匹配 spec 中的用户目标、没有遗漏验收标准、没有引入 spec 外范围、没有违反 constitution、没有留下未验证路径。
7. 输出 `specs/<date+feature>/verify-report.md`。
8. 写入 `specs/<date+feature>/handoffs/verification.json`，摘要说明验证结论、证据命令、关键产物和剩余风险。

构建/检查的长输出保存到 `specs/<date+feature>/evidence/verification.log`；报告只保留 command、exit code、相对路径和 SHA-256。这样可验证且不占用后续上下文 token。

报告模板见：

- `assets/verify-report-template.md`
- `assets/fix-instructions-template.md`

## Red Flag

以下措辞意味着未验证就声称：`应该通过了`、`probably passes`、`似乎没问题`、`seems fine`、`我觉得可以`。发现后立即停止，补证据再声明。

## 约束

- 所有检查通过才能提交。
- 已有证据不须重做，但必须读取确认。
- 缺失证据的项必须执行或补做。
- 验证失败时输出结构化修复指令，回到 executing 阶段，只派发 implementer 修复模式。
- 不把完整测试日志塞进 handoff；handoff 只保存结论、证据命令、关键路径和 artifacts。
<!-- loom:generate:rule:build-vet-test-cmd -->
**构建/检查/测试命令**

读取 `.loom/rules/constitution.md` 中的 BUILD_CMD/VET_CMD/TEST_CMD 并执行验证。
<!-- /loom:generate:rule:build-vet-test-cmd -->

## 完成条件

验证通过时完成 `specs/<date+feature>/verify-report.md` 和 `specs/<date+feature>/handoffs/verification.json`；验证失败时标记失败，输出修复指令，禁止全量重跑 Step 4。阶段结束后压缩验证过程中的长日志和中间排查，只保留报告、progress 和 handoff。
