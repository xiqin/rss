# Upstream 同步指南

## 概述

rss 基于 superpowers 增强，需要定期同步上游更新。

## 方案 1：Git Subtree（推荐）

将 superpowers 作为 git subtree 引入，定期同步：

```bash
# 首次添加 superpowers 仓库
git subtree add --prefix=upstream/superpowers https://github.com/superpowers/superpowers.git main --squash

# 定期同步更新
git subtree pull --prefix=upstream/superpowers https://github.com/superpowers/superpowers.git main --squash

# 同步后，对比差异
diff -rq upstream/superpowers/skills/ skills/
```

### 目录结构

```
rss/
├── upstream/
│   └── superpowers/          # 上游 superpowers 原始文件
│       ├── skills/
│       └── ...
├── skills/                   # rss 增强版 skills
│   ├── brainstorming/
│   └── ...
├── SYNC-LOG.md               # 同步日志
└── ...
```

### 同步流程

1. **拉取上游更新**
   ```bash
   git subtree pull --prefix=upstream/superpowers https://github.com/superpowers/superpowers.git main --squash
   ```

2. **对比差异**
   ```bash
   # 对比每个 skill
   diff upstream/superpowers/skills/brainstorming/SKILL.md skills/brainstorming/SKILL.md
   ```

3. **评估变更**
   - 新增功能 → 是否需要集成到 rss
   - 修复 bug → 是否影响 rss 的定制版本
   - 接口变更 → 是否需要适配

4. **合并更新**
   - 手动合并有价值的变更到 rss skills
   - 记录到 SYNC-LOG.md

## 方案 2：手动追踪

定期检查 superpowers 仓库更新：

```bash
# 添加 superpowers 为 remote
git remote add superpowers https://github.com/superpowers/superpowers.git

# 获取最新变更
git fetch superpowers

# 对比差异
git diff HEAD superpowers/main -- skills/
```

## 方案 3：GitHub Watch + Release Notes

1. 在 GitHub 上 Watch superpowers 仓库
2. 订阅 Release 通知
3. 定期查看 CHANGELOG

## 同步日志格式

```markdown
# SYNC-LOG.md

## YYYY-MM-DD 同步

**来源**: superpowers v1.x.x
**同步内容**:
- [x] skill: brainstorming — 新增 xxx 功能
- [ ] skill: writing-plans — 无变化

**变更摘要**:
- brainstorming SKILL.md: 新增了 xxx 段落
- systematic-debugging: 修复了 xxx 问题

**处理方式**:
- brainstorming: 已合并到 rss 版本
- systematic-debugging: 已同步

**待处理**:
- [ ] 评估 xxx 变更是否需要集成
```

## 版本对照表

| superpowers 版本 | rss 版本 | 同步日期 | 变更摘要 |
|-----------------|---------|---------|---------|
| v1.0.0 | rss 1.0.0 | 2026-04-26 | 初始版本 |

## 建议

1. **使用方案 1（Git Subtree）**：自动追踪上游，便于 diff
2. **建立定期同步习惯**：每月或每个 superpowers release 后同步
3. **记录同步日志**：便于追溯变更历史
4. **保持 rss 定制清晰**：明确哪些是 rss 增强，哪些是 superpowers 原始
