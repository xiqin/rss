#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// 内置图后端 marker 映射；未来扩展后端时在此补充
const GRAPH_BACKEND_MARKERS = {
  codegraph: '.codegraph',
  scip: '.lsif',
  sourcegraph: '.sourcegraph',
};

export function validateIndex(options = {}) {
  const root = options.root || process.cwd();
  const errors = [];
  const warnings = [];

  const storePath = join(root, '.loom', 'memory', 'store.json');
  const memoryPath = join(root, '.loom', 'memory', 'MEMORY.md');

  // 读取图后端配置；不存在时默认 codegraph（向后兼容）
  const graphConfig = readGraphConfig(root);
  const backend = graphConfig.backend || 'codegraph';
  const enabled = graphConfig.enabled !== false;

  if (enabled && backend !== 'none') {
    const marker = GRAPH_BACKEND_MARKERS[backend];
    if (marker) {
      const markerPath = join(root, marker);
      if (!existsSync(markerPath)) {
        warnings.push(`graph backend "${backend}" is enabled but marker "${marker}" not found; graph sync will be skipped`);
      }
    } else {
      warnings.push(`graph backend "${backend}" has no known marker; graph sync availability cannot be verified`);
    }
  } else if (backend === 'none') {
    warnings.push('graph backend is "none"; graph sync is skipped');
  }

  if (!existsSync(storePath)) {
    errors.push('Missing required file: .loom/memory/store.json');
  } else {
    try {
      JSON.parse(readFileSync(storePath, 'utf8'));
    } catch (error) {
      errors.push(`Invalid .loom/memory/store.json: ${error.message}`);
    }
  }

  if (!existsSync(memoryPath)) {
    warnings.push('MEMORY.md export view missing; run: loom memory export when needed');
  }

  return { ok: errors.length === 0, errors, warnings, root, graphBackend: backend };
}

function readGraphConfig(root) {
  const configPath = join(root, '.loom', 'graph.config.json');
  if (!existsSync(configPath)) {
    // 默认行为：若存在 .codegraph/ 则视为 codegraph 后端，否则仍报 codegraph（向后兼容）
    return { backend: 'codegraph', enabled: true };
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return { backend: 'codegraph', enabled: true };
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') options.root = argv[++i];
  }
  return options;
}

function printReport(result) {
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  for (const error of result.errors) console.error(`ERROR ${error}`);
  console.log(`Checked index in ${relative(process.cwd(), result.root) || '.'} (graph backend: ${result.graphBackend})`);
}

if (process.argv[1] === __filename) {
  const result = validateIndex(parseArgs(process.argv.slice(2)));
  printReport(result);
  if (!result.ok) process.exitCode = 1;
}
