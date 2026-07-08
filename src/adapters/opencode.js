import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { BaseAdapter, codegraphMcpDescriptor } from './base.js';
import { readJsonConfig } from './config-utils.js';

export class OpenCodeAdapter extends BaseAdapter {
  get toolName() { return 'opencode'; }

  getUserDir() { return join(homedir(), '.config', 'opencode'); }

  getCommandsDir() { return join(this.getUserDir(), 'commands'); }

  supportsPlugin() { return true; }

  get capabilities() {
    return { hooks: false, skills: true, commands: true, plugin: true, mcpConfig: true, templates: true };
  }

  install(loomRoot, version) {
    const log = [];
    log.push(`Installing loom@${version} → ${this.toolName} (user-level)`);
    this._copySkills(loomRoot, log);
    this._copyCommands(loomRoot, log);
    this._copyTemplates(loomRoot, log);
    this._addNpmPlugin(loomRoot, log);
    this._ensureMcpConfig(log);
    return log;
  }

  uninstall(loomRoot) {
    const log = [];
    log.push(`Uninstalling loom → ${this.toolName} (user-level)`);
    this._removeNpmPlugin(log);
    this._removeMcpConfig(log);
    this._removeSkills(log);
    this._removeTemplates(log);
    this._removeCommands(log);
    return log;
  }

  _addNpmPlugin(loomRoot, log) {
    const configPath = join(this.getUserDir(), 'opencode.json');
    let config = readJsonConfig(configPath, { log, label: 'plugin', name: 'opencode.json' });

    let changed = false;

    if (!config.plugin) config.plugin = [];
    if (!config.plugin.includes('loom-engineering')) {
      config.plugin.push('loom-engineering');
      changed = true;
      log.push('  plugin: loom-engineering added to opencode.json');
    } else {
      log.push('  plugin: loom-engineering already in opencode.json');
    }

    const ignorePatterns = [
      'node_modules', 'vendor', 'dist', 'build', '.cache', '.git',
      '*.lock', '*.log', '__pycache__', '.venv', 'venv',
      '.coverage', '*.pyc', '*.pyo', '*.egg-info', '.tox',
    ];
    if (!config.watcher) config.watcher = {};
    if (!config.watcher.ignore) config.watcher.ignore = [];
    for (const pattern of ignorePatterns) {
      if (!config.watcher.ignore.includes(pattern)) {
        config.watcher.ignore.push(pattern);
        changed = true;
      }
    }
    if (changed) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      log.push('  watcher.ignore: merged ignore patterns');
    }
  }

  _removeNpmPlugin(log) {
    const configPath = join(this.getUserDir(), 'opencode.json');
    if (!existsSync(configPath)) return;
    let config;
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (e) {
      log.push(`  plugin: opencode.json 解析失败 (${e.message})，跳过移除`);
      return;
    }
    if (!config.plugin) return;
    const idx = config.plugin.indexOf('loom-engineering');
    if (idx !== -1) {
      config.plugin.splice(idx, 1);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      log.push('  plugin: loom-engineering removed from opencode.json');
    }
  }

  _copyTemplates(loomRoot, log) {
    const src = join(loomRoot, 'templates');
    if (!existsSync(src)) return;

    const initProjectDir = join(this.getSkillsDir(), 'loom-init-project');
    if (!existsSync(initProjectDir)) {
      log.push('  templates: loom-init-project skill not found, skipped');
      return;
    }

    const dest = join(initProjectDir, 'templates');
    cpSync(src, dest, { recursive: true, force: true });
    log.push('  templates: copied to loom-init-project skill dir');
  }

  _removeTemplates(log) {
    const skillsDir = this.getSkillsDir();
    if (!existsSync(skillsDir)) return;

    const initProjectDir = join(skillsDir, 'loom-init-project', 'templates');
    if (existsSync(initProjectDir)) {
      rmSync(initProjectDir, { recursive: true, force: true });
      log.push('  templates: removed from loom-init-project skill dir');
    }
  }

  _ensureMcpConfig(log) {
    const configPath = join(this.getUserDir(), 'opencode.json');
    let config = readJsonConfig(configPath, { log, label: 'mcp', name: 'opencode.json' });

    if (!config.mcp) config.mcp = {};
    let changed = false;

    if (config.mcp.loom) {
      if (config.mcp.loom.env) {
        config.mcp.loom.environment = {
          ...config.mcp.loom.env,
          ...(config.mcp.loom.environment || {}),
        };
        delete config.mcp.loom.env;
        changed = true;
        log.push('  mcp: migrated loom env to environment in opencode.json');
      }
      log.push('  mcp: loom server already configured');
    } else {
      config.mcp.loom = {
        type: 'local',
        command: ['loom', 'mcp-serve'],
        enabled: true,
        environment: { LOOM_LAZY_TOOLS: '1' },
      };
      changed = true;
      log.push('  mcp: loom server added to opencode.json');
    }

    if (config.mcp.codegraph) {
      log.push('  mcp: codegraph server already configured');
    } else {
      const codegraph = codegraphMcpDescriptor();
      if (codegraph) {
        config.mcp.codegraph = {
          type: 'local',
          command: [codegraph.command, ...codegraph.args],
          enabled: true,
        };
        changed = true;
        log.push('  mcp: codegraph server added to opencode.json');
      } else {
        log.push('  mcp: codegraph CLI not found, codegraph indexing disabled');
      }
    }

    if (changed) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    }
  }

  _removeMcpConfig(log) {
    const configPath = join(this.getUserDir(), 'opencode.json');
    if (!existsSync(configPath)) return;
    let config;
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (e) {
      log.push(`  mcp: opencode.json 解析失败 (${e.message})，跳过移除`);
      return;
    }
    if (!config.mcp) return;

    let changed = false;
    if (config.mcp.loom) {
      delete config.mcp.loom;
      changed = true;
      log.push('  mcp: loom server removed from opencode.json');
    }
    if (config.mcp.codegraph) {
      delete config.mcp.codegraph;
      changed = true;
      log.push('  mcp: codegraph server removed from opencode.json');
    }

    if (changed) {
      if (Object.keys(config.mcp).length === 0) delete config.mcp;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    }
  }
}
