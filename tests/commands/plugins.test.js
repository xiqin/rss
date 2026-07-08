import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_plugins__');

beforeEach(() => {
  mkdirSync(join(TEST_DIR, '.loom', 'plugins'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeManifest(name, manifest) {
  writeFileSync(join(TEST_DIR, '.loom', 'plugins', name), JSON.stringify(manifest, null, 2), 'utf-8');
}

describe('plugins command', () => {
  it('lists plugin manifests and their extension points as JSON', async () => {
    writeManifest('acme-reporter.json', {
      id: 'acme-reporter',
      name: 'Acme Reporter',
      version: '1.0.0',
      entry: './plugins/acme-reporter/index.js',
      capabilities: {
        steps: [{ id: 'security-review', title: 'Security Review' }],
        adapters: [{ id: 'acme-tool', toolName: 'Acme Tool' }],
        hooks: [{ id: 'post-tool-audit', event: 'PostToolUse' }],
        reporters: [{ id: 'team-html', format: 'html' }],
      },
    });

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: pluginsCommand } = await import('../../src/commands/plugins.js');
    const result = await pluginsCommand('list', { cwd: TEST_DIR, json: true });

    expect(result.count).toBe(1);
    expect(result.plugins[0]).toMatchObject({
      id: 'acme-reporter',
      name: 'Acme Reporter',
      version: '1.0.0',
      path: join(TEST_DIR, '.loom', 'plugins', 'acme-reporter.json'),
      extensionPoints: {
        steps: ['security-review'],
        adapters: ['acme-tool'],
        hooks: ['PostToolUse:post-tool-audit'],
        reporters: ['team-html'],
      },
    });
    const output = JSON.parse(sp.mock.calls[0][0]);
    expect(output.plugins[0].extensionPoints.reporters).toEqual(['team-html']);
  });

  it('reports invalid manifests without hiding valid plugins', async () => {
    writeManifest('valid.json', {
      id: 'valid-plugin',
      name: 'Valid Plugin',
      version: '1.0.0',
      capabilities: { reporters: [{ id: 'summary', format: 'markdown' }] },
    });
    writeFileSync(join(TEST_DIR, '.loom', 'plugins', 'broken.json'), '{ nope', 'utf-8');

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: pluginsCommand } = await import('../../src/commands/plugins.js');
    const result = await pluginsCommand('list', { cwd: TEST_DIR, json: true });

    expect(result.count).toBe(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]).toMatchObject({ file: 'broken.json' });
    expect(result.plugins[0].id).toBe('valid-plugin');
    expect(JSON.parse(sp.mock.calls[0][0]).invalid[0].error).toContain('JSON');
  });

  it('writes a remote MCP marketplace template', async () => {
    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: pluginsCommand } = await import('../../src/commands/plugins.js');
    const result = await pluginsCommand('marketplace-template', { cwd: TEST_DIR, json: true });

    expect(result.path).toBe(join(TEST_DIR, '.loom', 'marketplace', 'mcp-marketplace.json'));
    expect(result.skipped).toBe(false);
    const template = JSON.parse(readFileSync(result.path, 'utf-8'));
    expect(template).toMatchObject({
      schema: 'loom.mcp-marketplace.v1',
      name: 'Loom MCP Marketplace',
      servers: [
        {
          id: 'loom',
          type: 'remote',
          transport: 'streamable-http',
          url: 'https://example.com/mcp/loom',
        },
      ],
    });
    expect(template.servers[0].scopes).toEqual(['context', 'memory', 'evidence', 'pipeline']);
    expect(template.servers[0].capabilities).toContain('loom_get_memory');
    expect(template.clients).toContainEqual({
      id: 'claude-code',
      configPath: 'settings.json',
      configKey: 'mcpServers.loom-remote',
    });
    expect(JSON.parse(sp.mock.calls[0][0]).path).toBe(result.path);
  });

  it('does not overwrite marketplace templates unless forced', async () => {
    const out = join(TEST_DIR, '.loom', 'marketplace', 'mcp-marketplace.json');
    mkdirSync(join(TEST_DIR, '.loom', 'marketplace'), { recursive: true });
    writeFileSync(out, JSON.stringify({ custom: true }), 'utf-8');

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: pluginsCommand } = await import('../../src/commands/plugins.js');
    const skipped = await pluginsCommand('marketplace-template', { cwd: TEST_DIR, json: true });
    expect(skipped.skipped).toBe(true);
    expect(JSON.parse(readFileSync(out, 'utf-8'))).toEqual({ custom: true });

    const written = await pluginsCommand('marketplace-template', {
      cwd: TEST_DIR,
      force: true,
      name: 'Acme MCP Marketplace',
      url: 'https://mcp.example.com/loom',
      json: true,
    });
    expect(written.skipped).toBe(false);
    const template = JSON.parse(readFileSync(written.path, 'utf-8'));
    expect(template.name).toBe('Acme MCP Marketplace');
    expect(template.servers[0].url).toBe('https://mcp.example.com/loom');
  });

  it('writes a safe plugin execution plan from manifests', async () => {
    writeManifest('acme-reporter.json', {
      id: 'acme-reporter',
      name: 'Acme Reporter',
      version: '1.0.0',
      entry: './plugins/acme-reporter/index.js',
      capabilities: {
        steps: [{ id: 'security-review', title: 'Security Review' }],
        hooks: [{ id: 'post-tool-audit', event: 'PostToolUse' }],
        reporters: [{ id: 'team-html', format: 'html' }],
      },
    });

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: pluginsCommand } = await import('../../src/commands/plugins.js');
    const result = await pluginsCommand('plan', { cwd: TEST_DIR, json: true });

    expect(result.path).toBe(join(TEST_DIR, '.loom', 'plugins', 'plugin-plan.json'));
    expect(result.plan).toMatchObject({
      schema: 'loom.plugin-plan.v1',
      safety: { dynamicLoading: false, execution: 'manual-review' },
      plugins: [{ id: 'acme-reporter', version: '1.0.0', entry: './plugins/acme-reporter/index.js' }],
    });
    expect(result.plan.extensionPoints.steps).toContainEqual({
      plugin: 'acme-reporter',
      id: 'security-review',
    });
    expect(result.plan.extensionPoints.hooks).toContainEqual({
      plugin: 'acme-reporter',
      id: 'post-tool-audit',
      event: 'PostToolUse',
    });
    expect(result.plan.extensionPoints.reporters).toContainEqual({
      plugin: 'acme-reporter',
      id: 'team-html',
    });
    const plan = JSON.parse(readFileSync(result.path, 'utf-8'));
    expect(plan.safety.dynamicLoading).toBe(false);
    expect(JSON.parse(sp.mock.calls[0][0]).path).toBe(result.path);
  });

  it('includes invalid manifests in plugin execution plans', async () => {
    writeManifest('valid.json', { id: 'valid-plugin', capabilities: { reporters: [{ id: 'summary' }] } });
    writeFileSync(join(TEST_DIR, '.loom', 'plugins', 'broken.json'), '{ nope', 'utf-8');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: pluginsCommand } = await import('../../src/commands/plugins.js');
    const result = await pluginsCommand('plan', { cwd: TEST_DIR, json: true });

    expect(result.plan.plugins.map(plugin => plugin.id)).toEqual(['valid-plugin']);
    expect(result.plan.invalid).toHaveLength(1);
    expect(result.plan.invalid[0]).toMatchObject({ file: 'broken.json' });
  });

  it('writes an auditable remote MCP marketplace sync plan', async () => {
    const templatePath = join(TEST_DIR, '.loom', 'marketplace', 'mcp-marketplace.json');
    mkdirSync(join(TEST_DIR, '.loom', 'marketplace'), { recursive: true });
    writeFileSync(templatePath, JSON.stringify({
      schema: 'loom.mcp-marketplace.v1',
      name: 'Acme Marketplace',
      servers: [{
        id: 'loom',
        type: 'remote',
        transport: 'streamable-http',
        url: 'https://mcp.example.com/loom',
        capabilities: ['loom_get_memory'],
        auth: { type: 'bearer', env: 'LOOM_MCP_TOKEN' },
        trust: { install: 'manual-review', codeExecution: false },
      }],
      clients: [{ id: 'claude-code', configPath: 'settings.json', configKey: 'mcpServers.loom-remote' }],
    }, null, 2), 'utf-8');

    const sp = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: pluginsCommand } = await import('../../src/commands/plugins.js');
    const result = await pluginsCommand('marketplace-sync', { cwd: TEST_DIR, json: true });

    expect(result.path).toBe(join(TEST_DIR, '.loom', 'marketplace', 'mcp-marketplace.sync.json'));
    expect(result.auditPath).toBe(join(TEST_DIR, '.loom', 'compliance', 'marketplace-sync.jsonl'));
    expect(result.plan).toMatchObject({
      schema: 'loom.mcp-marketplace-sync.v1',
      marketplace: { name: 'Acme Marketplace', source: templatePath },
      safety: { network: false, dynamicLoading: false, execution: 'manual-review' },
      servers: [{ id: 'loom', url: 'https://mcp.example.com/loom', status: 'ready-for-review' }],
      clients: [{ id: 'claude-code', configPath: 'settings.json', configKey: 'mcpServers.loom-remote' }],
    });
    const plan = JSON.parse(readFileSync(result.path, 'utf-8'));
    expect(plan.servers[0].capabilities).toEqual(['loom_get_memory']);
    const audit = JSON.parse(readFileSync(result.auditPath, 'utf-8').trim());
    expect(audit).toMatchObject({
      type: 'marketplace_sync',
      verdict: 'PASS',
      risk: 'low',
      servers: ['loom'],
      clients: ['claude-code'],
    });
    expect(JSON.parse(sp.mock.calls[0][0]).path).toBe(result.path);
  });

  it('fails marketplace sync for unsafe remote MCP templates', async () => {
    const templatePath = join(TEST_DIR, '.loom', 'marketplace', 'mcp-marketplace.json');
    mkdirSync(join(TEST_DIR, '.loom', 'marketplace'), { recursive: true });
    writeFileSync(templatePath, JSON.stringify({
      schema: 'loom.mcp-marketplace.v1',
      name: 'Unsafe Marketplace',
      servers: [{ id: 'unsafe', type: 'remote', url: 'http://example.com/mcp', trust: { codeExecution: true } }],
      clients: [],
    }, null, 2), 'utf-8');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { default: pluginsCommand } = await import('../../src/commands/plugins.js');
    const result = await pluginsCommand('marketplace-sync', { cwd: TEST_DIR, json: true });

    expect(result.plan.verdict).toBe('FAIL');
    expect(result.plan.violations).toContainEqual({
      rule: 'remote-url-https',
      server: 'unsafe',
      message: 'Remote MCP server URL must use https.',
    });
    expect(result.plan.violations).toContainEqual({
      rule: 'remote-code-execution',
      server: 'unsafe',
      message: 'Remote MCP marketplace entries must declare codeExecution:false.',
    });
    const audit = JSON.parse(readFileSync(result.auditPath, 'utf-8').trim());
    expect(audit).toMatchObject({ type: 'marketplace_sync', verdict: 'FAIL', risk: 'high' });
  });
});
