#!/usr/bin/env node
/**
 * sync-version.mjs — Sync package.json.version to all version-bearing files.
 *
 * Usage: node scripts/sync-version.mjs [--check]
 *
 *   Without --check: writes version to all target files.
 *   With --check:    exits non-zero if any file is out of sync (for CI).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CHECK = process.argv.includes('--check');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const V = pkg.version;

// ── Target definitions ─────────────────────────────────────────────────

const JSON_TARGETS = [
  {
    path: '.claude-plugin/plugin.json',
    update(json) { json.version = V; },
  },
];

const SHELL_TARGETS = [
  { path: 'scripts/common.sh',  pattern: /^VERSION="[^"]*"/m,            replacement: `VERSION="${V}"` },
  { path: 'scripts/common.ps1', pattern: /^\$DefaultVersion = "[^"]*"/m, replacement: `$DefaultVersion = "${V}"` },
];

const TEXT_TARGETS = [
  { path: 'docs/system-design.md', pattern: /\| v\d+\.\d+\.\d+ \|/m, replacement: `| v${V} |` },
];

// ── Run ────────────────────────────────────────────────────────────────

let outOfSync = 0;

// JSON targets
for (const target of JSON_TARGETS) {
  const fullPath = join(ROOT, target.path);
  const json = JSON.parse(readFileSync(fullPath, 'utf-8'));
  const before = JSON.stringify(json, null, 2) + '\n';
  target.update(json);
  const after = JSON.stringify(json, null, 2) + '\n';
  if (before !== after) {
    if (CHECK) {
      console.error(`  ✘ ${target.path} — version mismatch (expected ${V})`);
      outOfSync++;
    } else {
      writeFileSync(fullPath, after, 'utf-8');
      console.log(`  ✔ ${target.path} → ${V}`);
    }
  } else {
    console.log(`  · ${target.path} — already ${V}`);
  }
}

// Shell targets
for (const target of SHELL_TARGETS) {
  const fullPath = join(ROOT, target.path);
  const content = readFileSync(fullPath, 'utf-8');
  if (!target.pattern.test(content)) {
    console.error(`  ✘ ${target.path} — VERSION pattern not found`);
    outOfSync++;
    continue;
  }
  const updated = content.replace(target.pattern, target.replacement);
  if (content !== updated) {
    if (CHECK) {
      console.error(`  ✘ ${target.path} — version mismatch (expected ${V})`);
      outOfSync++;
    } else {
      writeFileSync(fullPath, updated, 'utf-8');
      console.log(`  ✔ ${target.path} → ${V}`);
    }
  } else {
    console.log(`  · ${target.path} — already ${V}`);
  }
}

// Text targets
for (const target of TEXT_TARGETS) {
  const fullPath = join(ROOT, target.path);
  const content = readFileSync(fullPath, 'utf-8');
  if (!target.pattern.test(content)) {
    console.error(`  ✘ ${target.path} — version pattern not found`);
    outOfSync++;
    continue;
  }
  const updated = content.replace(target.pattern, target.replacement);
  if (content !== updated) {
    if (CHECK) {
      console.error(`  ✘ ${target.path} — version mismatch (expected ${V})`);
      outOfSync++;
    } else {
      writeFileSync(fullPath, updated, 'utf-8');
      console.log(`  ✔ ${target.path} → ${V}`);
    }
  } else {
    console.log(`  · ${target.path} — already ${V}`);
  }
}

// ── Result ─────────────────────────────────────────────────────────────

if (outOfSync > 0) {
  console.error(`\n  ${outOfSync} file(s) out of sync. Run: node scripts/sync-version.mjs`);
  process.exit(1);
} else {
  console.log(`\n  All version references synced to ${V}.`);
}
