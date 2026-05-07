#!/usr/bin/env node

/**
 * sync-assets.mjs
 * 从根目录同步 skills/commands/core/hooks/templates 到 rss-engineering/assets/
 * 根目录为 source of truth，assets/ 完全镜像。
 */

import { cpSync, mkdirSync, readdirSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const ASSETS = join(ROOT, 'rss-engineering', 'assets');

const SYNC_DIRS = ['skills', 'commands', 'core', 'hooks', 'templates'];

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath);
    }
  }
}

function getFiles(dir, base) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFiles(fullPath, base));
    } else {
      files.push(relative(base, fullPath));
    }
  }
  return files;
}

function removeEmptyDirs(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirs(join(dir, entry.name));
    }
  }
  try {
    if (readdirSync(dir).length === 0 && dir !== ASSETS) {
      rmSync(dir, { recursive: true });
    }
  } catch {}
}

let totalCopied = 0;
let totalRemoved = 0;

for (const dir of SYNC_DIRS) {
  const src = join(ROOT, dir);
  const dest = join(ASSETS, dir);

  if (!existsSync(src)) {
    // Root dir missing — delete entire assets subdir
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
      console.log(`del   assets/${dir}/ (source removed)`);
    }
    continue;
  }

  // Build src file set
  const srcSet = new Set(getFiles(src, src));

  // Copy root → assets (overwrites existing)
  copyDir(src, dest);
  const copied = srcSet.size;
  totalCopied += copied;
  console.log(`sync  ${dir}/ → assets/${dir}/ (${copied} files)`);

  // Remove stale files in dest that no longer exist in src
  const destFiles = getFiles(dest, dest);
  for (const relPath of destFiles) {
    if (!srcSet.has(relPath)) {
      unlinkSync(join(dest, relPath));
      console.log(`  del ${dir}/${relPath.replace(/\\/g, '/')}`);
      totalRemoved++;
    }
  }

  // Clean empty directories
  removeEmptyDirs(dest);
}

// Sync plugin-meta: .claude-plugin/plugin.json → assets/plugin-meta/claude-plugin.json
const pluginSrc = join(ROOT, '.claude-plugin', 'plugin.json');
if (existsSync(pluginSrc)) {
  const pluginMetaDir = join(ASSETS, 'plugin-meta');
  mkdirSync(pluginMetaDir, { recursive: true });
  cpSync(pluginSrc, join(pluginMetaDir, 'claude-plugin.json'));
  console.log('sync  .claude-plugin/plugin.json → assets/plugin-meta/claude-plugin.json');
}

console.log(`\ndone. ${totalCopied} files synced, ${totalRemoved} stale files removed.`);
