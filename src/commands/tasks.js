/**
 * loom tasks — 任务冲突检测与批次调度器
 *
 * 读取 specs/<date+feature>/plan.md 中 YAML frontmatter 或标准化
 * task 声明，分析 owns/reads 字段，检测并行冲突，输出可安全并行的批次。
 *
 * 使用方式：
 *   loom tasks --spec-dir specs/2026-05-27+user-auth   # 分析指定 spec
 *   loom tasks --spec-dir <dir> --validate             # 只做冲突检测，有冲突则 exit 1
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { resolvePipelineDir } from '../core/spec-dir.js';

// ─── Task 声明解析 ──────────────────────────────────────────────────────────
// 从 tasks/TN.md 的 YAML frontmatter 读取 owns / reads / depends_on
// 格式示例（task 文件顶部）：
//
// ---
// owns: [src/auth/, src/middleware/auth.ts]
// reads: [src/types/user.ts]
// depends_on: []
// complexity: high
// ---

export function parseTaskFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result = {};

  // owns
  const ownsMatch = yaml.match(/^owns\s*:\s*\[([^\]]*)\]/m);
  if (ownsMatch) {
    result.owns = ownsMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  // reads
  const readsMatch = yaml.match(/^reads\s*:\s*\[([^\]]*)\]/m);
  if (readsMatch) {
    result.reads = readsMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  // depends_on
  const depsMatch = yaml.match(/^depends_on\s*:\s*\[([^\]]*)\]/m);
  if (depsMatch) {
    result.depends_on = depsMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  // complexity
  const complexityMatch = yaml.match(/^complexity\s*:\s*(\S+)/m);
  if (complexityMatch) result.complexity = complexityMatch[1];

  return result;
}

function loadTasks(tasksDir) {
  if (!existsSync(tasksDir)) return [];
  const tasks = [];
  const entries = readdirSync(tasksDir, { withFileTypes: true })
    .filter(e => e.isFile() && /^T\d+\.md$/i.test(e.name))
    .sort((a, b) => {
      const na = parseInt(a.name.match(/\d+/)[0]);
      const nb = parseInt(b.name.match(/\d+/)[0]);
      return na - nb;
    });

  for (const entry of entries) {
    const path = join(tasksDir, entry.name);
    const content = readFileSync(path, 'utf-8');
    const meta = parseTaskFrontmatter(content);
    // 从 task 文件中提取 description（第一个 # 标题后的第一行正文）
    const descMatch = content.match(/^#[^#][^\n]*\n+([^\n#]+)/m);
    const description = descMatch ? descMatch[1].trim() : entry.name;

    tasks.push({
      id: entry.name.replace('.md', ''),
      file: path,
      description,
      owns: meta.owns || [],
      reads: meta.reads || [],
      depends_on: meta.depends_on || [],
      complexity: meta.complexity || 'medium',
    });
  }
  return tasks;
}

// ─── 冲突检测 ───────────────────────────────────────────────────────────────

function pathOverlaps(a, b) {
  // a owns [src/auth/] and b owns [src/auth/middleware.ts] → conflict
  const normalize = p => p.replace(/\\/g, '/').replace(/\/$/, '');
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.startsWith(nb + '/') || nb.startsWith(na + '/');
}

export function detectConflicts(tasks) {
  const conflicts = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const ta = tasks[i];
      const tb = tasks[j];
      const overlaps = [];
      for (const oa of ta.owns) {
        for (const ob of tb.owns) {
          if (pathOverlaps(oa, ob)) overlaps.push(`"${oa}" ↔ "${ob}"`);
        }
        for (const rb of tb.reads) {
          if (pathOverlaps(oa, rb)) overlaps.push(`write "${oa}" ↔ read "${rb}"`);
        }
      }
      for (const ob of tb.owns) {
        for (const ra of ta.reads) {
          if (pathOverlaps(ob, ra)) overlaps.push(`write "${ob}" ↔ read "${ra}"`);
        }
      }
      if (overlaps.length > 0) {
        conflicts.push({ taskA: ta.id, taskB: tb.id, overlaps });
      }
    }
  }
  return conflicts;
}

// ─── 批次调度（拓扑排序）───────────────────────────────────────────────────

export function buildBatches(tasks) {
  // 先解析 depends_on（支持 T1 / T1.md 两种写法）
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));
  const normalize = id => id.replace('.md', '').toUpperCase();

  const remaining = new Set(tasks.map(t => t.id));
  const done = new Set();
  const batches = [];

  while (remaining.size > 0) {
    const batch = [];
    for (const id of remaining) {
      const task = taskById[id];
      const deps = (task.depends_on || []).map(d => normalize(d));
      const allDepsDone = deps.every(d => done.has(d));
      if (allDepsDone) batch.push(id);
    }

    if (batch.length === 0) {
      // 循环依赖
      return { batches, cycle: [...remaining] };
    }

    // 在同一批次内做冲突检测，有冲突的必须串行
    const batchTasks = batch.map(id => taskById[id]);
    const batchConflicts = detectConflicts(batchTasks);
    const conflictedIds = new Set(batchConflicts.flatMap(c => [c.taskA, c.taskB]));

    const parallel = batch.filter(id => !conflictedIds.has(id));
    const serial = batch.filter(id => conflictedIds.has(id));

    if (parallel.length > 0) batches.push({ type: 'parallel', tasks: parallel });
    if (serial.length > 0) batches.push({ type: 'serial', tasks: serial, reason: 'file conflict' });

    for (const id of batch) {
      remaining.delete(id);
      done.add(normalize(id));
    }
  }

  return { batches, cycle: null };
}

// ─── 主命令 ─────────────────────────────────────────────────────────────────

export default async function tasksCommand(options) {
  const cwd = options.cwd || process.cwd();
  let specDir = options.specDir;
  const validateOnly = options.validate || false;

  if (!specDir) {
    console.error('\n  loom tasks: --spec-dir is required\n');
    process.exitCode = 1;
    return;
  }

  try {
    specDir = resolvePipelineDir(cwd, specDir);
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(specDir)) {
    console.error(`\n  loom tasks: spec dir not found: ${specDir}\n`);
    process.exitCode = 1;
    return;
  }

  const tasksDir = join(specDir, 'tasks');
  const tasks = loadTasks(tasksDir);

  if (tasks.length === 0) {
    console.log(`\n  No task files found in ${tasksDir}\n`);
    return;
  }

  // 全量冲突检测
  const allConflicts = detectConflicts(tasks);

  if (validateOnly) {
    const noOwns = tasks.filter(t => t.owns.length === 0);
    if (allConflicts.length > 0 || noOwns.length > 0) {
      if (noOwns.length > 0) {
        console.error(`\n  ✗ ${noOwns.length} task(s) have no owns declaration: ${noOwns.map(t => t.id).join(', ')}`);
      }
      console.error(`\n  ✗ ${allConflicts.length} file ownership conflict(s) detected:\n`);
      for (const c of allConflicts) {
        console.error(`    ${c.taskA} ↔ ${c.taskB}: ${c.overlaps.join(', ')}`);
      }
      console.error('\n  Fix: split conflicting tasks or adjust owns/reads declarations.\n');
      process.exitCode = 1;
    } else {
      console.log(`\n  ✓ No file conflicts detected across ${tasks.length} tasks\n`);
    }
    return;
  }

  // 完整分析
  console.log(`\n  loom tasks — Task Schedule for ${basename(specDir)}\n`);
  console.log(`  Tasks found: ${tasks.length}`);

  if (allConflicts.length > 0) {
    console.log(`\n  ⚠  File ownership conflicts (cannot run these in parallel):`);
    for (const c of allConflicts) {
      console.log(`     ${c.taskA} ↔ ${c.taskB}`);
      for (const o of c.overlaps) console.log(`       overlap: ${o}`);
    }
  }

  const { batches, cycle } = buildBatches(tasks);

  if (cycle) {
    console.error(`\n  ✗ Circular dependency detected among: ${cycle.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  console.log('\n  Execution schedule:\n');
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const icon = b.type === 'parallel' ? '⟹ ' : '→ ';
    const label = b.type === 'parallel' ? 'Parallel' : `Serial (${b.reason})`;
    console.log(`  Batch ${i + 1} [${label}]`);
    for (const id of b.tasks) {
      const t = tasks.find(t => t.id === id);
      const ownsStr = t.owns.length > 0 ? `  owns: ${t.owns.join(', ')}` : '';
      console.log(`    ${icon}${id}: ${t.description}${ownsStr ? '\n       ' + ownsStr : ''}`);
    }
    if (i < batches.length - 1) {
      console.log(`    ↓ wait for all above to complete`);
    }
    console.log('');
  }

  // 打印 tasks 缺少 owns 声明的警告
  const noOwns = tasks.filter(t => t.owns.length === 0);
  if (noOwns.length > 0) {
    console.log(`  ℹ  ${noOwns.length} task(s) have no "owns" declaration (conflict detection skipped):`);
    console.log(`     ${noOwns.map(t => t.id).join(', ')}`);
    console.log(`     Add YAML frontmatter to task files to enable conflict detection.\n`);
  }
}
