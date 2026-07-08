/**
 * loom memory — 结构化记忆 CLI
 *
 * 用法：
 *   loom memory add --type 决策 --content "选择 PostgreSQL 而非 MySQL"
 *   loom memory add --type adr --content "用 Event Sourcing" --context "因为需要审计追踪"
 *   loom memory list                              最近 20 条
 *   loom memory list --type 踩坑 --limit 5        过滤
 *   loom memory export                            生成 MEMORY.md
 *   loom memory merge --from /other/.loom/memory/store.json
 *   loom memory remove --id abc12345
 *   loom memory archive --slug user-auth --file session.md
 */

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MemoryStore } from '../core/memory-store.js';

export default async function memory(subcommand, options) {
  const cwd = options.cwd || process.cwd();
  const loomDir = join(cwd, '.loom');
  const store = new MemoryStore(loomDir);

  switch (subcommand) {

    case 'add': {
      if (!options.type || !options.content) {
        console.error('\n  Usage: loom memory add --type <type> --content "<text>"\n');
        console.error('  Types: 决策, 踩坑, 偏好, 状态, adr\n');
        process.exitCode = 1;
        return;
      }
      const entry = store.add(options.type, options.content, {
        author: options.author,
        context: options.context,
        tags: csv(options.tags),
        source: options.source,
        confidence: options.confidence,
        scope: options.scope,
        expiresAt: options.expiresAt,
        stage: options.stage,
        files: csv(options.files),
        specDir: options.specDir,
        pr: options.pr,
        commit: options.commit,
        task: options.task,
        handoff: options.handoff,
      });
      console.log(`\n  ✓ Memory added [${entry.id}]: ${entry.type} — ${entry.content}\n`);
      break;
    }

    case 'list': {
      const entries = store.list({
        type: options.type,
        author: options.author,
        limit: parseInt(options.limit) || 20,
        tag: options.tag,
        scope: options.scope,
        stage: options.stage,
        file: options.file,
        specDir: options.specDir,
        pr: options.pr,
        commit: options.commit,
        task: options.task,
        handoff: options.handoff,
        includeExpired: options.includeExpired,
      });

      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      console.log(`\n  loom memory — ${entries.length} entries\n`);
      if (entries.length === 0) {
        console.log('  (empty)\n');
        return;
      }

      for (const e of entries) {
        const date = e.created_at?.slice(0, 10) || '?';
        const author = e.author !== 'unknown' ? ` [${e.author}]` : '';
        const metadata = formatMetadata(e);
        console.log(`  ${e.id}  ${date}  ${e.type.padEnd(4)}  ${e.content}${author}${metadata}`);
      }
      console.log('');
      break;
    }

    case 'export': {
      store.exportMarkdown();
      console.log(`\n  ✓ MEMORY.md exported to ${join(loomDir, 'memory', 'MEMORY.md')}\n`);
      break;
    }

    case 'merge': {
      if (!options.from) {
        console.error('\n  Usage: loom memory merge --from <path-to-store.json>\n');
        process.exitCode = 1;
        return;
      }
      const result = store.merge(resolve(cwd, options.from));
      if (result.error) {
        console.error(`\n  ✗ ${result.error}\n`);
        process.exitCode = 1;
      } else {
        console.log(`\n  ✓ Merged ${result.merged} entries\n`);
      }
      break;
    }

    case 'remove': {
      if (!options.id) {
        console.error('\n  Usage: loom memory remove --id <entry-id>\n');
        process.exitCode = 1;
        return;
      }
      const removed = store.remove(options.id);
      console.log(removed
        ? `\n  ✓ Removed ${options.id}\n`
        : `\n  ✗ Entry ${options.id} not found\n`
      );
      break;
    }

    case 'archive': {
      if (!options.slug) {
        console.error('\n  Usage: loom memory archive --slug <feature-slug> --file <session.md>\n');
        process.exitCode = 1;
        return;
      }
      const content = options.file
        ? readFileSync(resolve(cwd, options.file), 'utf-8')
        : `# Session: ${options.slug}\n\n(archived at ${new Date().toISOString()})\n`;
      const filename = store.archiveSession(options.slug, content);
      console.log(`\n  ✓ Session archived: ${filename}\n`);
      break;
    }

    default: {
      console.log(`
  loom memory <command>

  Commands:
    add      Add a memory entry
    list     List entries (with filters)
    export   Generate MEMORY.md from store
    merge    Merge another store.json
    remove   Delete by ID
    archive  Archive a session
`);
    }
  }
}

function csv(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function formatMetadata(entry) {
  const parts = [];
  if (entry.scope) parts.push(`scope:${entry.scope}`);
  if (entry.stage) parts.push(`stage:${entry.stage}`);
  if (entry.links?.spec) parts.push(`spec:${entry.links.spec}`);
  if (entry.links?.task) parts.push(`task:${entry.links.task}`);
  if (entry.files?.length) parts.push(`files:${entry.files.join(',')}`);
  if (entry.expires_at) parts.push(`expires:${entry.expires_at.slice(0, 10)}`);
  return parts.length ? ` (${parts.join(' ')})` : '';
}
