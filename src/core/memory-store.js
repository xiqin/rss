/**
 * memory-store.js — 结构化记忆存储
 *
 * 使用 JSON 文件模拟结构化存储（避免 native 编译依赖）。
 * 每条记忆有 id / type / content / author / created_at。
 * MEMORY.md 变成只读导出视图。
 *
 * 文件布局：
 *   .loom/memory/store.json      — 结构化存储（单一真实来源）
 *   .loom/memory/MEMORY.md       — 只读导出（loom memory export 生成）
 *   .loom/memory/sessions/       — 会话归档目录
 */

import { NodeFileSystem } from './fs-interface.js';
import { escapeMarkdown } from './markdown.js';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

/** 原子写：temp + rename，避免半写损坏 store.json */
function writeFileAtomic(path, content, fs) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, path);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

function now() { return new Date().toISOString(); }
function today() { return now().slice(0, 10); }

function cleanArray(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map(item => String(item).trim()).filter(Boolean);
}

function cleanLinks(opts) {
  const links = { ...(opts.links || {}) };
  if (opts.specDir || opts.spec) links.spec = opts.specDir || opts.spec;
  if (opts.pr) links.pr = opts.pr;
  if (opts.commit) links.commit = opts.commit;
  if (opts.task) links.task = opts.task;
  if (opts.handoff) links.handoff = opts.handoff;
  return Object.fromEntries(Object.entries(links).filter(([, value]) => value != null && value !== ''));
}

function normalizeConfidence(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function isExpired(entry) {
  return Boolean(entry.expires_at && entry.expires_at <= now());
}

const SESSION_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

function assertValidSessionSlug(slug) {
  if (typeof slug !== 'string' || !SESSION_SLUG_RE.test(slug)) {
    throw new Error(`Invalid session slug: ${slug}`);
  }
}

export class MemoryStore {
  constructor(loomDir, { fs } = {}) {
    this.loomDir = loomDir;
    this.memDir = join(loomDir, 'memory');
    this.storePath = join(this.memDir, 'store.json');
    this.mdPath = join(this.memDir, 'MEMORY.md');
    this.sessionsDir = join(this.memDir, 'sessions');
    this.fs = fs || new NodeFileSystem();
  }

  // ── 读写底层 ──────────────────────────────────────────────────────────────

  _load() {
    if (!this.fs.existsSync(this.storePath)) return { entries: [], sessions: [] };
    try { return JSON.parse(this.fs.readFileSync(this.storePath, 'utf-8')); }
    catch (err) {
      throw new Error(`Corrupt memory store: ${this.storePath} (${err.message}). Fix or delete it manually.`);
    }
  }

  _save(data) {
    this.fs.mkdirSync(this.memDir, { recursive: true });
    writeFileAtomic(this.storePath, JSON.stringify(data, null, 2) + '\n', this.fs);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * 添加一条记忆
   * @param {string} type     '决策' | '踩坑' | '偏好' | '状态' | 'adr'
   * @param {string} content  一句话描述
   * @param {object} [opts]   { author, context, tags, source, confidence, scope, expiresAt, stage, files, links }
   * @returns {object}        新创建的 entry
   */
  add(type, content, opts = {}) {
    const data = this._load();
    const entry = {
      id: randomUUID().slice(0, 8),
      type,
      content,
      author: opts.author || this._detectAuthor(),
      tags: cleanArray(opts.tags),
      context: opts.context || null,
      source: opts.source || null,
      confidence: normalizeConfidence(opts.confidence),
      scope: opts.scope || 'project',
      expires_at: opts.expiresAt || opts.expires_at || null,
      stage: opts.stage || null,
      files: cleanArray(opts.files),
      links: cleanLinks(opts),
      created_at: now()
    };
    data.entries.unshift(entry); // 最新在前

    // 摘要最多保留 50 条
    if (data.entries.length > 50) {
      data.entries = data.entries.slice(0, 50);
    }

    this._save(data);
    return entry;
  }

  /**
   * 列出记忆（支持过滤）
   * @param {object} [filter] { type, author, limit, since, tag, scope, stage, file, specDir, task, includeExpired }
   */
  list(filter = {}) {
    const data = this._load();
    let entries = data.entries;

    if (filter.type) entries = entries.filter(e => e.type === filter.type);
    if (filter.author) entries = entries.filter(e => e.author === filter.author);
    if (filter.since) entries = entries.filter(e => e.created_at >= filter.since);
    if (!filter.includeExpired) entries = entries.filter(e => !isExpired(e));
    if (filter.tag) entries = entries.filter(e => (e.tags || []).includes(filter.tag));
    if (filter.scope) entries = entries.filter(e => e.scope === filter.scope);
    if (filter.stage) entries = entries.filter(e => e.stage === filter.stage);
    if (filter.file) entries = entries.filter(e => (e.files || []).includes(filter.file));

    const linkFilters = {
      spec: filter.specDir || filter.spec,
      pr: filter.pr,
      commit: filter.commit,
      task: filter.task,
      handoff: filter.handoff,
    };
    for (const [key, value] of Object.entries(linkFilters)) {
      if (value) entries = entries.filter(e => e.links?.[key] === value);
    }

    const limit = filter.limit || 20;
    return entries.slice(0, limit);
  }

  /**
   * 按 ID 删除
   */
  remove(id) {
    const data = this._load();
    const idx = data.entries.findIndex(e => e.id === id);
    if (idx < 0) return false;
    data.entries.splice(idx, 1);
    this._save(data);
    return true;
  }

  /**
   * 归档当前会话
   */
  archiveSession(featureSlug, content) {
    assertValidSessionSlug(featureSlug);
    const data = this._load();
    this.fs.mkdirSync(this.sessionsDir, { recursive: true });
    const filename = `${today()}-${featureSlug}.md`;
    const path = join(this.sessionsDir, filename);
    this.fs.writeFileSync(path, content, 'utf-8');

    data.sessions.unshift({
      file: `sessions/${filename}`,
      date: today(),
      slug: featureSlug,
      created_at: now()
    });
    this._save(data);
    return filename;
  }

  /**
   * 按 feature slug 归档条目：标记 archived + 写归档文件
   * @param {string} featureSlug
   * @param {string} [sessionContent] 附加到归档文件的会话内容
   * @returns {{ archivePath: string, entriesCount: number }}
   */
  archive(featureSlug, sessionContent = '') {
    assertValidSessionSlug(featureSlug);
    const data = this._load();
    const archiveVersion = today().replace(/-/g, '');

    const relevant = data.entries.filter(e => !e.archived);
    for (const entry of relevant) {
      entry.archived = true;
      entry.archive_version = archiveVersion;
    }
    this._save(data);

    this.fs.mkdirSync(this.sessionsDir, { recursive: true });
    const archiveFilename = `archive-${featureSlug}-${archiveVersion}.json`;
    const archivePath = join(this.sessionsDir, archiveFilename);
    this.fs.writeFileSync(archivePath, JSON.stringify({
      featureSlug,
      version: archiveVersion,
      archived_at: now(),
      sessionContent,
      entries: relevant
    }, null, 2), 'utf-8');

    return { archivePath, entriesCount: relevant.length };
  }

  // ── 导出 MEMORY.md ───────────────────────────────────────────────────────

  exportMarkdown() {
    const data = this._load();
    const lines = [];

    lines.push('# Project Memory');
    lines.push('');
    lines.push('> Auto-generated by `loom memory export`. Do not edit — use `loom memory add` instead.');
    lines.push(`> Last exported: ${now().slice(0, 16).replace('T', ' ')}`);
    lines.push('');

    // 📌 摘要
    lines.push('## 📌 摘要');
    lines.push('');
    const summaryTypes = ['决策', '踩坑', '偏好', '状态'];
    const summaryEntries = data.entries.filter(e => summaryTypes.includes(e.type)).slice(0, 10);
    if (summaryEntries.length === 0) {
      lines.push('_No entries yet._');
    } else {
      for (const e of summaryEntries) {
        lines.push(`${e.created_at.slice(0, 10)} | ${escapeMarkdown(e.type)} | ${escapeMarkdown(e.content)}`);
      }
    }
    lines.push('');

    // 🏗 架构决策
    lines.push('## 🏗 架构决策（ADR）');
    lines.push('');
    const adrs = data.entries.filter(e => e.type === 'adr');
    if (adrs.length === 0) {
      lines.push('_No ADRs yet._');
    } else {
      lines.push('| Date | Decision | Context |');
      lines.push('|------|----------|---------|');
      for (const e of adrs.slice(0, 20)) {
        lines.push(`| ${e.created_at.slice(0, 10)} | ${escapeMarkdown(e.content)} | ${escapeMarkdown(e.context)} |`);
      }
    }
    lines.push('');

    // ⚠️ 踩坑记录
    lines.push('## ⚠️ 踩坑记录');
    lines.push('');
    const gotchas = data.entries.filter(e => e.type === '踩坑');
    if (gotchas.length === 0) {
      lines.push('_No gotchas yet._');
    } else {
      for (const e of gotchas.slice(0, 15)) {
        lines.push(`- **${e.created_at.slice(0, 10)}**: ${escapeMarkdown(e.content)}`);
      }
    }
    lines.push('');

    // 👤 用户偏好
    lines.push('## 👤 用户偏好');
    lines.push('');
    const prefs = data.entries.filter(e => e.type === '偏好');
    if (prefs.length === 0) {
      lines.push('_No preferences recorded._');
    } else {
      for (const e of prefs) {
        lines.push(`- ${escapeMarkdown(e.content)}`);
      }
    }
    lines.push('');

    // 📦 会话归档
    if (data.sessions?.length > 0) {
      lines.push('## 📦 会话归档索引');
      lines.push('');
      lines.push('| File | Date | Slug |');
      lines.push('|------|------|------|');
      for (const s of data.sessions.slice(0, 30)) {
        lines.push(`| ${escapeMarkdown(s.file)} | ${escapeMarkdown(s.date)} | ${escapeMarkdown(s.slug)} |`);
      }
      lines.push('');
    }

    const md = lines.join('\n');
    this.fs.mkdirSync(this.memDir, { recursive: true });
    this.fs.writeFileSync(this.mdPath, md, 'utf-8');
    return md;
  }

  // ── 多人合并 ──────────────────────────────────────────────────────────────

  /**
   * 合并另一个 store.json 的内容（用于 PR 合并时去重）
   */
  merge(otherStorePath) {
    const myData = this._load();
    let other;
    try { other = JSON.parse(this.fs.readFileSync(otherStorePath, 'utf-8')); }
    catch { return { merged: 0, error: 'Cannot read other store' }; }

    const existingIds = new Set(myData.entries.map(e => e.id));
    let merged = 0;
    for (const entry of (other.entries || [])) {
      if (!existingIds.has(entry.id)) {
        myData.entries.push(entry);
        existingIds.add(entry.id);
        merged++;
      }
    }

    // 重新按时间排序
    myData.entries.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (myData.entries.length > 50) myData.entries = myData.entries.slice(0, 50);

    this._save(myData);
    return { merged };
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  _detectAuthor() {
    try {
      return execSync('git config user.name', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch { return 'unknown'; }
  }
}
