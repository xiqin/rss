import { mkdirSync, cpSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const MANAGED_SKILL_PREFIX = 'loom-';
const REMOVE_DIR_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };

/**
 * codegraph（https://github.com/colbymchenry/codegraph）的 MCP server 描述符，
 * 仅当 CLI 在 PATH 时返回，否则 null（避免注册一个起不来的 server）。
 * loom 索引以 codegraph 为首选后端；注册它让 AI 会话能调用 codegraph_* 实时查图。
 */
export function codegraphMcpDescriptor() {
  try {
    execSync('codegraph --version', { stdio: 'ignore', timeout: 10_000, windowsHide: true });
    return { command: 'codegraph', args: ['serve', '--mcp'] };
  } catch {
    return null;
  }
}

export class BaseAdapter {
  get toolName() { throw new Error('must implement toolName'); }

  getUserDir() { throw new Error('must implement getUserDir'); }

  getSkillsDir() { return join(this.getUserDir(), 'skills'); }

  getCommandsDir() { return null; }

  supportsPlugin() { return false; }

  get capabilities() {
    return {
      hooks: false,
      skills: Boolean(this.getSkillsDir()),
      commands: Boolean(this.getCommandsDir()),
      plugin: this.supportsPlugin(),
      mcpConfig: false,
    };
  }

  install(loomRoot, version) {
    const log = [];
    log.push(`Installing loom@${version} → ${this.toolName} (user-level)`);

    this._copySkills(loomRoot, log);
    this._copyCommands(loomRoot, log);
    this._postInstall(loomRoot, version, log);

    if (this.supportsPlugin()) {
      this._registerPlugin(loomRoot, version, log);
    }

    return log;
  }

  uninstall(loomRoot) {
    const log = [];
    this._removeSkills(log);
    this._removeCommands(log);
    return log;
  }

  _copySkills(loomRoot, log) {
    const src = join(loomRoot, 'skills');
    if (!existsSync(src)) return;
    const dest = this.getSkillsDir();
    mkdirSync(dest, { recursive: true });

    const srcNames = new Set();
    let count = 0;
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(src, entry.name);
      const skillMd = join(skillDir, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      srcNames.add(entry.name);
      this._copyDir(skillDir, join(dest, entry.name));
      count++;
    }

    // Remove stale loom-managed skills only; users may have other skills here.
    if (existsSync(dest)) {
      for (const entry of readdirSync(dest, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (srcNames.has(entry.name)) continue;
        if (!this._isManagedSkillName(entry.name)) continue;
        rmSync(join(dest, entry.name), REMOVE_DIR_OPTIONS);
        log.push(`  skills: removed stale ${entry.name}`);
      }
    }

    log.push(`  skills: ${count} copied → ${dest}`);
  }

  _removeSkills(log) {
    const dest = this.getSkillsDir();
    if (!existsSync(dest)) return;
    const entries = readdirSync(dest, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!this._isManagedSkillName(entry.name)) continue;
      const skillDir = join(dest, entry.name, 'SKILL.md');
      if (!existsSync(skillDir)) continue;
      rmSync(join(dest, entry.name), REMOVE_DIR_OPTIONS);
      count++;
    }
    log.push(`  skills: ${count} removed from ${dest}`);
  }

  _copyCommands(loomRoot, log) {
    const cmdDir = this.getCommandsDir();
    if (!cmdDir) return;
    const src = join(loomRoot, 'commands');
    if (!existsSync(src)) return;
    mkdirSync(cmdDir, { recursive: true });

    const srcNames = new Set();
    let count = 0;
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      srcNames.add(entry.name);
      cpSync(join(src, entry.name), join(cmdDir, entry.name), { force: true });
      count++;
    }

    // Remove stale loom-managed command files only; users may have other commands here.
    if (existsSync(cmdDir)) {
      for (const entry of readdirSync(cmdDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (srcNames.has(entry.name)) continue;
        if (!entry.name.startsWith('loom-')) continue;
        rmSync(join(cmdDir, entry.name), { force: true });
        log.push(`  commands: removed stale ${entry.name}`);
      }
    }

    log.push(`  commands: ${count} copied → ${cmdDir}`);
  }

  _removeCommands(log) {
    const cmdDir = this.getCommandsDir();
    if (!cmdDir || !existsSync(cmdDir)) return;
    const entries = readdirSync(cmdDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      if (!entry.name.startsWith('loom-')) continue;
      rmSync(join(cmdDir, entry.name), { force: true });
      count++;
    }
    log.push(`  commands: ${count} removed from ${cmdDir}`);
  }

  _postInstall(loomRoot, version, log) {}

  _registerPlugin(loomRoot, version, log) {}

  _isManagedSkillName(name) {
    return name.startsWith(MANAGED_SKILL_PREFIX);
  }

  _copyDir(src, dest) {
    mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const s = join(src, entry.name);
      const d = join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDir(s, d);
      } else {
        cpSync(s, d, { force: true });
      }
    }
  }
}
