/**
 * skill-loader.js — SKILL.md 渐进式披露（L0/L1）
 *
 * 16 个 SKILL.md 合计 ~53KB（~26K token），全量注入挤爆上下文。
 * 分层加载策略：
 *   L0（摘要层）：name + description + section 标题 + 触发条件
 *                 ~100-200 token/skill，用于"有什么 skill 可用"
 *   L1（完整层）：SKILL.md 全文，仅当 AI 需要执行该 skill 时加载
 *
 * 复用 context-index.js 的 section 解析模式（按 ## 切节，fence-aware）。
 */

import { NodeFileSystem } from './fs-interface.js';
import { join } from 'node:path';
import { estimateTokens } from './context-index.js';

/** L0 摘要的触发条件 section 最大行数（防止意外全量输出） */
const TRIGGER_MAX_LINES = 10;

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 * 提取简单 key/value 字段，不引入 yaml 库。
 */
function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fm = {};
  const body = match[1];
  let key = null;
  let value = '';
  let inMultiline = false;

  for (const line of body.split('\n')) {
    if (inMultiline) {
      if (line.match(/^\s*\S/)) {
        fm[key] = value.trim();
        inMultiline = false;
        // fall through to parse this line as new key
      } else {
        value += '\n' + line;
        continue;
      }
    }
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) {
      if (key) fm[key] = value.trim();
      key = kv[1];
      value = kv[2];
      if (value === '>' || value === '|') {
        inMultiline = true;
        value = '';
      }
    } else if (key && line.match(/^\s+/)) {
      value += '\n' + line.trim();
    }
  }
  if (key) fm[key] = value.trim();

  return fm;
}

/**
 * 从 SKILL.md 正文提取 section 标题（## 级别），fence-aware。
 */
function extractSectionTitles(text) {
  const lines = text.split('\n');
  const titles = [];
  let inFence = false;
  let fenceChar = '';

  for (const line of lines) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const ch = fence[1][0];
      if (!inFence) { inFence = true; fenceChar = ch; }
      else if (ch === fenceChar) { inFence = false; fenceChar = ''; }
      continue;
    }
    if (!inFence) {
      const h2 = line.match(/^##\s+(.+?)\s*$/);
      if (h2) titles.push(h2[1].trim());
    }
  }
  return titles;
}

/**
 * 从 SKILL.md 正文提取触发条件 section 的内容。
 * 找到 "触发条件" 或 "Trigger" 开头的 ## 节，取其内容（到下一个 ## 之前）。
 */
function extractTriggers(text) {
  const lines = text.split('\n');
  const result = [];
  let inTrigger = false;
  let inFence = false;
  let fenceChar = '';
  let lineCount = 0;

  for (const line of lines) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const ch = fence[1][0];
      if (!inFence) { inFence = true; fenceChar = ch; }
      else if (ch === fenceChar) { inFence = false; fenceChar = ''; }
      continue;
    }
    if (inFence) continue;

    const h2 = line.match(/^##\s+/);
    if (h2) {
      if (inTrigger) break; // 下一个 section 开始，停止
      const title = line.replace(/^##\s+/, '').trim().toLowerCase();
      if (title.includes('触发') || title.includes('trigger')) {
        inTrigger = true;
      }
      continue;
    }
    if (inTrigger && line.trim()) {
      result.push(line.trim());
      lineCount++;
      if (lineCount >= TRIGGER_MAX_LINES) break;
    }
  }
  return result;
}

export class SkillLoader {
  /**
   * @param {string} skillsDir  skills/ 目录的绝对路径
   * @param {object} options
   * @param {object} [options.fs]  文件系统抽象
   */
  constructor(skillsDir, { fs } = {}) {
    this.skillsDir = skillsDir;
    this.fs = fs || new NodeFileSystem();
  }

  /**
   * 列出所有可用 skill 的 L0 摘要。
   * @returns {Array<{name, description, sections, triggers, tokens}>}
   */
  listSummaries() {
    const results = [];
    if (!this.fs.existsSync(this.skillsDir)) return results;

    const entries = this.fs.readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(this.skillsDir, entry.name, 'SKILL.md');
      if (!this.fs.existsSync(skillPath)) continue;

      const content = this.fs.readFileSync(skillPath, 'utf-8');
      const fm = parseFrontmatter(content);
      const sections = extractSectionTitles(content);
      const triggers = extractTriggers(content);

      results.push({
        name: fm.name || entry.name,
        description: fm.description || '',
        sections,
        triggers,
        tokens: estimateTokens(content),
      });
    }
    return results;
  }

  /**
   * 获取单个 skill 的 L0 摘要。
   * @param {string} skillName  skill 名称（目录名或 frontmatter name）
   * @returns {object|null}
   */
  getSummary(skillName) {
    const all = this.listSummaries();
    return all.find(s => s.name === skillName) ||
           all.find(s => s.name === `loom-${skillName}`) ||
           null;
  }

  /**
   * 获取单个 skill 的执行摘要，不返回完整正文。
   * 用于 MCP 默认路径，避免一次取 skill 就把整篇 SKILL.md 注入上下文。
   * @param {string} skillName
   * @returns {{name, description, sections, triggers, tokens, full_tokens, read_hints}|null}
   */
  getSkillEssentials(skillName) {
    const summary = this.getSummary(skillName);
    if (!summary) return null;

    const payload = {
      name: summary.name,
      description: summary.description,
      sections: summary.sections,
      triggers: summary.triggers,
      full_tokens: summary.tokens,
      read_hints: {
        preferred: 'Call with section to read only the needed section.',
        full: 'Pass full: true only when the whole skill is required.'
      }
    };

    return {
      ...payload,
      tokens: estimateTokens(JSON.stringify(payload))
    };
  }

  /**
   * 获取单个 skill 的 L1 完整内容。
   * @param {string} skillName  skill 名称
   * @returns {{name, description, content, tokens}|null}
   */
  getFullSkill(skillName) {
    const skillDir = this._resolveSkillDir(skillName);
    if (!skillDir) return null;

    const skillPath = join(skillDir, 'SKILL.md');
    if (!this.fs.existsSync(skillPath)) return null;

    const content = this.fs.readFileSync(skillPath, 'utf-8');
    const fm = parseFrontmatter(content);

    return {
      name: fm.name || skillName,
      description: fm.description || '',
      content,
      tokens: estimateTokens(content),
    };
  }

  /**
   * 获取 skill 的某个 section 的内容（L1 细粒度）。
   * @param {string} skillName
   * @param {string} sectionTitle  ## 标题
   * @returns {{name, section, content, tokens}|null}
   */
  getSkillSection(skillName, sectionTitle) {
    const skillDir = this._resolveSkillDir(skillName);
    if (!skillDir) return null;

    const skillPath = join(skillDir, 'SKILL.md');
    if (!this.fs.existsSync(skillPath)) return null;

    const content = this.fs.readFileSync(skillPath, 'utf-8');
    const section = this._extractSection(content, sectionTitle);
    if (!section) return null;

    return {
      name: skillName,
      section: sectionTitle,
      content: section,
      tokens: estimateTokens(section),
    };
  }

  /**
   * 格式化 L0 摘要为 AI 友好的文本。
   * @returns {string}
   */
  formatL0() {
    const summaries = this.listSummaries();
    const lines = [];
    for (const s of summaries) {
      lines.push(`## ${s.name}`);
      if (s.description) lines.push(`Description: ${s.description}`);
      if (s.triggers.length > 0) {
        lines.push(`Triggers: ${s.triggers.join('; ')}`);
      }
      lines.push(`Sections: ${s.sections.join(', ')}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────────────

  _resolveSkillDir(skillName) {
    // 直接匹配目录名
    const direct = join(this.skillsDir, skillName);
    if (this.fs.existsSync(direct)) return direct;
    // 尝试加 loom- 前缀
    const prefixed = join(this.skillsDir, `loom-${skillName}`);
    if (this.fs.existsSync(prefixed)) return prefixed;
    // 遍历所有 skill 目录，匹配 frontmatter name
    if (!this.fs.existsSync(this.skillsDir)) return null;
    const entries = this.fs.readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(this.skillsDir, entry.name, 'SKILL.md');
      if (!this.fs.existsSync(skillPath)) continue;
      const content = this.fs.readFileSync(skillPath, 'utf-8');
      const fm = parseFrontmatter(content);
      if (fm.name === skillName || fm.name === `loom-${skillName}`) {
        return join(this.skillsDir, entry.name);
      }
    }
    return null;
  }

  _extractSection(text, title) {
    const lines = text.split('\n');
    const result = [];
    let inSection = false;
    let inFence = false;
    let fenceChar = '';

    const normalizedQuery = title.toLowerCase().replace(/\s+/g, ' ').trim();

    for (const line of lines) {
      const fence = line.match(/^\s*(```+|~~~+)/);
      if (fence) {
        const ch = fence[1][0];
        if (!inFence) { inFence = true; fenceChar = ch; }
        else if (ch === fenceChar) { inFence = false; fenceChar = ''; }
        if (inSection) result.push(line);
        continue;
      }

      const h2 = !inFence && line.match(/^##\s+(.+?)\s*$/);
      if (h2) {
        if (inSection) break; // 下一个 ## section，结束
        const normalized = h2[1].trim().toLowerCase().replace(/\s+/g, ' ');
        if (normalized === normalizedQuery ||
            normalized.includes(normalizedQuery) ||
            normalizedQuery.includes(normalized)) {
          inSection = true;
        }
        continue;
      }
      if (inSection) result.push(line);
    }
    return result.join('\n').trim() || null;
  }
}
