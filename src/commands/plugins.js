import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export default async function pluginsCommand(action, options = {}) {
  if (action === 'list') return listPlugins(options);
  if (action === 'marketplace-template') return writeMarketplaceTemplate(options);
  if (action === 'marketplace-sync') return writeMarketplaceSync(options);
  if (action === 'plan') return writePluginPlan(options);
  throw new Error(`Unknown plugins action: ${action}`);
}

function listPlugins(options) {
  const cwd = options.cwd || process.cwd();
  const pluginsDir = resolve(cwd, options.dir || '.loom/plugins');
  const { plugins, invalid } = loadPluginManifests(pluginsDir);
  const result = { count: plugins.length, plugins, invalid };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printText(result);
  }
  return result;
}

function loadPluginManifests(pluginsDir) {
  if (!existsSync(pluginsDir)) return { plugins: [], invalid: [] };
  const plugins = [];
  const invalid = [];

  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(pluginsDir, entry.name);
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf-8'));
      plugins.push(normalizeManifest(manifest, path));
    } catch (error) {
      invalid.push({ file: entry.name, path, error: error.message });
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));
  invalid.sort((a, b) => a.file.localeCompare(b.file));
  return { plugins, invalid };
}

function writeMarketplaceTemplate(options) {
  const cwd = options.cwd || process.cwd();
  const outPath = resolve(cwd, options.out || '.loom/marketplace/mcp-marketplace.json');
  if (existsSync(outPath) && !options.force) {
    const result = { path: outPath, skipped: true, reason: 'already exists' };
    printMarketplaceResult(result, options);
    return result;
  }

  const template = buildMarketplaceTemplate(options);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(template, null, 2)}\n`, 'utf-8');
  const result = { path: outPath, skipped: false, template };
  printMarketplaceResult(result, options);
  return result;
}

function writePluginPlan(options) {
  const cwd = options.cwd || process.cwd();
  const pluginsDir = resolve(cwd, options.dir || '.loom/plugins');
  const outPath = resolve(cwd, options.out || '.loom/plugins/plugin-plan.json');
  const { plugins, invalid } = loadPluginManifests(pluginsDir);
  const plan = buildPluginPlan(plugins, invalid);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  const result = { path: outPath, plan };

  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Wrote plugin execution plan to ${outPath}`);
  return result;
}

function writeMarketplaceSync(options) {
  const cwd = options.cwd || process.cwd();
  const sourcePath = resolve(cwd, options.source || '.loom/marketplace/mcp-marketplace.json');
  const outPath = resolve(cwd, options.out || '.loom/marketplace/mcp-marketplace.sync.json');
  const auditPath = resolve(cwd, options.auditOut || '.loom/compliance/marketplace-sync.jsonl');
  const template = JSON.parse(readFileSync(sourcePath, 'utf-8'));
  const plan = buildMarketplaceSyncPlan(template, sourcePath);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');

  const audit = {
    timestamp: plan.generatedAt,
    type: 'marketplace_sync',
    verdict: plan.verdict,
    risk: plan.verdict === 'PASS' ? 'low' : 'high',
    source: sourcePath,
    output: outPath,
    servers: plan.servers.map(server => server.id),
    clients: plan.clients.map(client => client.id),
    violations: plan.violations,
  };
  mkdirSync(dirname(auditPath), { recursive: true });
  writeFileSync(auditPath, `${JSON.stringify(audit)}\n`, { encoding: 'utf-8', flag: 'a' });

  const result = { path: outPath, auditPath, plan };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Wrote MCP marketplace sync plan to ${outPath}`);
  return result;
}

function buildPluginPlan(plugins, invalid) {
  return {
    schema: 'loom.plugin-plan.v1',
    generatedAt: new Date().toISOString(),
    safety: {
      dynamicLoading: false,
      execution: 'manual-review',
      note: 'This plan is declarative. Loom does not load or execute third-party plugin code from manifests.',
    },
    plugins: plugins.map(plugin => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      entry: plugin.entry,
      path: plugin.path,
    })),
    extensionPoints: {
      steps: flattenExtensions(plugins, 'steps'),
      adapters: flattenExtensions(plugins, 'adapters'),
      hooks: flattenExtensions(plugins, 'hooks'),
      reporters: flattenExtensions(plugins, 'reporters'),
    },
    invalid,
  };
}

function buildMarketplaceTemplate(options) {
  return {
    schema: 'loom.mcp-marketplace.v1',
    name: stringOr(options.name, 'Loom MCP Marketplace'),
    description: 'Remote MCP marketplace template for publishing loom-compatible servers.',
    servers: [
      {
        id: stringOr(options.id, 'loom'),
        name: stringOr(options.serverName, 'Loom Remote MCP'),
        type: 'remote',
        transport: stringOr(options.transport, 'streamable-http'),
        url: stringOr(options.url, 'https://example.com/mcp/loom'),
        scopes: ['context', 'memory', 'evidence', 'pipeline'],
        capabilities: [
          'loom_get_context',
          'loom_get_memory',
          'loom_add_memory',
          'loom_pipeline_status',
          'loom_evidence_query',
        ],
        auth: {
          type: 'bearer',
          env: 'LOOM_MCP_TOKEN',
        },
        trust: {
          install: 'manual-review',
          network: 'remote-server',
          codeExecution: false,
        },
      },
    ],
    clients: [
      { id: 'claude-code', configPath: 'settings.json', configKey: 'mcpServers.loom-remote' },
      { id: 'cursor', configPath: 'mcp/mcp.json', configKey: 'mcpServers.loom-remote' },
      { id: 'opencode', configPath: 'opencode.json', configKey: 'mcp.loom-remote' },
      { id: 'codex', configPath: 'config.toml', configKey: 'mcp_servers.loom-remote' },
    ],
  };
}

function buildMarketplaceSyncPlan(template, sourcePath) {
  const servers = Array.isArray(template.servers) ? template.servers : [];
  const clients = Array.isArray(template.clients) ? template.clients : [];
  const violations = servers.flatMap(validateMarketplaceServer);
  return {
    schema: 'loom.mcp-marketplace-sync.v1',
    generatedAt: new Date().toISOString(),
    marketplace: {
      name: stringOr(template.name, 'Loom MCP Marketplace'),
      source: sourcePath,
      schema: template.schema || null,
    },
    safety: {
      network: false,
      dynamicLoading: false,
      execution: 'manual-review',
      note: 'This sync plan is local-only. Loom does not publish, install client config, or contact remote MCP servers.',
    },
    verdict: violations.length ? 'FAIL' : 'PASS',
    servers: servers.map(server => ({
      id: stringOr(server.id, 'unknown'),
      name: stringOr(server.name, stringOr(server.id, 'unknown')),
      type: stringOr(server.type, 'remote'),
      transport: stringOr(server.transport, 'streamable-http'),
      url: stringOr(server.url, ''),
      capabilities: Array.isArray(server.capabilities) ? server.capabilities : [],
      auth: server.auth || null,
      trust: server.trust || null,
      status: 'ready-for-review',
    })),
    clients: clients.map(client => ({
      id: stringOr(client.id, 'unknown'),
      configPath: stringOr(client.configPath, ''),
      configKey: stringOr(client.configKey, ''),
    })),
    violations,
  };
}

function validateMarketplaceServer(server) {
  const id = stringOr(server?.id, 'unknown');
  const violations = [];
  const url = typeof server?.url === 'string' ? server.url.trim() : '';
  if (!url.startsWith('https://')) {
    violations.push({
      rule: 'remote-url-https',
      server: id,
      message: 'Remote MCP server URL must use https.',
    });
  }
  if (server?.trust?.codeExecution !== false) {
    violations.push({
      rule: 'remote-code-execution',
      server: id,
      message: 'Remote MCP marketplace entries must declare codeExecution:false.',
    });
  }
  return violations;
}

function printMarketplaceResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.skipped) {
    console.log(`Marketplace template already exists: ${result.path}`);
  } else {
    console.log(`Wrote MCP marketplace template to ${result.path}`);
  }
}

function normalizeManifest(manifest, path) {
  const id = requiredString(manifest.id, 'id', path);
  const capabilities = manifest.capabilities || {};
  return {
    id,
    name: stringOr(manifest.name, id),
    version: stringOr(manifest.version, '0.0.0'),
    entry: manifest.entry || null,
    path,
    extensionPoints: {
      steps: ids(capabilities.steps),
      adapters: ids(capabilities.adapters),
      hooks: hookIds(capabilities.hooks),
      reporters: ids(capabilities.reporters),
    },
    rawExtensionPoints: {
      steps: rawIds(capabilities.steps),
      adapters: rawIds(capabilities.adapters),
      hooks: rawHooks(capabilities.hooks),
      reporters: rawIds(capabilities.reporters),
    },
  };
}

function requiredString(value, field, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid plugin manifest ${path}: missing ${field}`);
  }
  return value.trim();
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function ids(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => item?.id).filter(id => typeof id === 'string' && id.trim()).map(id => id.trim());
}

function hookIds(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      const event = typeof item?.event === 'string' ? item.event.trim() : '';
      if (!id) return null;
      return event ? `${event}:${id}` : id;
    })
    .filter(Boolean);
}

function rawIds(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => ({ id: typeof item?.id === 'string' ? item.id.trim() : '' }))
    .filter(item => item.id);
}

function rawHooks(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => ({
      id: typeof item?.id === 'string' ? item.id.trim() : '',
      event: typeof item?.event === 'string' ? item.event.trim() : '',
    }))
    .filter(item => item.id);
}

function flattenExtensions(plugins, kind) {
  return plugins.flatMap(plugin => (plugin.rawExtensionPoints[kind] || []).map(item => {
    const extension = { plugin: plugin.id, id: item.id };
    if (item.event) extension.event = item.event;
    return extension;
  }));
}

function printText(result) {
  console.log(`\n  loom plugins — ${result.count} manifest(s)\n`);
  for (const plugin of result.plugins) {
    console.log(`  ${plugin.id} (${plugin.version}) — ${plugin.name}`);
    console.log(`      steps: ${dash(plugin.extensionPoints.steps)}`);
    console.log(`      adapters: ${dash(plugin.extensionPoints.adapters)}`);
    console.log(`      hooks: ${dash(plugin.extensionPoints.hooks)}`);
    console.log(`      reporters: ${dash(plugin.extensionPoints.reporters)}`);
  }
  if (result.invalid.length) {
    console.log('\n  Invalid manifests:');
    for (const item of result.invalid) console.log(`    ${item.file} — ${item.error}`);
  }
  console.log('');
}

function dash(items) {
  return items.length ? items.join(', ') : '-';
}
