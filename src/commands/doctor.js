import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getUserAdapter, USER_TOOL_IDS } from '../core/installer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));

/**
 * subagent-context.md 是 init-project 时冻结渲染的，constitution 之后变更不会自动同步。
 * 比较两者 mtime：宪章更新 → 提示重新生成，防止 subagent 拿到过期红线/约束。
 */
export function checkSubagentContextStale(loomDir) {
  const ctxPath = join(loomDir, 'contexts', 'subagent-context.md');
  if (!existsSync(ctxPath)) return { exists: false };
  const constPath = join(loomDir, 'rules', 'constitution.md');
  if (!existsSync(constPath)) return { exists: true, stale: false };
  const context = readFileSync(ctxPath, 'utf-8');
  const recorded = context.match(/constitution-sha256:\s*([a-f0-9]{64})/i)?.[1]?.toLowerCase();
  if (recorded) {
    const actual = createHash('sha256').update(readFileSync(constPath, 'utf-8')).digest('hex');
    return { exists: true, stale: recorded !== actual };
  }
  const stale = statSync(constPath).mtimeMs > statSync(ctxPath).mtimeMs;
  return { exists: true, stale };
}

export default async function doctor(options) {
  const tools = options.tool ? [options.tool] : USER_TOOL_IDS;
  const cwd = process.cwd();

  console.log(`\n  loom doctor — Diagnosis Report\n`);

  // ── 工具安装状态 ──────────────────────────────────────────────────────────
  let foundAny = false;
  for (const tool of tools) {
    if (!USER_TOOL_IDS.includes(tool)) {
      console.log(`  Unknown tool: "${tool}". Supported: ${USER_TOOL_IDS.join(', ')}`);
      continue;
    }

    const adapter = await getUserAdapter(tool);
    const userDir = adapter.getUserDir();
    let hasSkills = false;
    let hasCommands = false;

    if (tool === 'cursor') {
      hasSkills = checkCursorMdc(adapter);
    } else {
      const skillsDir = adapter.getSkillsDir();
      const cmdDir = adapter.getCommandsDir();
      hasSkills = skillsDir && existsSync(skillsDir) &&
        readdirSync(skillsDir, { withFileTypes: true }).some(e => e.isDirectory());
      hasCommands = cmdDir && existsSync(cmdDir) &&
        readdirSync(cmdDir, { withFileTypes: true }).some(e => e.isFile() && e.name.endsWith('.md'));
    }

    if (!hasSkills && !hasCommands) continue;
    foundAny = true;

    console.log(`  [${tool}]`);
    console.log(`    user dir:  ${userDir}`);

    if (tool === 'cursor') {
      const rulesDir = adapter.getRulesDir();
      if (existsSync(rulesDir)) {
        const mdcFiles = readdirSync(rulesDir).filter(f => f.startsWith('loom-') && f.endsWith('.mdc'));
        const skillCount = mdcFiles.filter(f => !f.startsWith('loom-cmd-')).length;
        const cmdCount = mdcFiles.filter(f => f.startsWith('loom-cmd-')).length;
        const hasSessionInit = mdcFiles.includes('loom-session-init.mdc');
        console.log(`    rules:     ${rulesDir}`);
        console.log(`    skills:    ${skillCount} skill(s) as .mdc`);
        if (cmdCount > 0) console.log(`    commands:  ${cmdCount} command(s) as .mdc`);
        console.log(`    session-init: ${hasSessionInit ? '✓ installed' : '✗ missing (run loom update --tool cursor)'}`);
      }
    } else {
      const skillsDir = adapter.getSkillsDir();
      if (skillsDir && existsSync(skillsDir)) {
        const count = countSkillDirs(skillsDir);
        console.log(`    skills:    ${skillsDir} (${count} skill(s))`);
      }
      const cmdDir = adapter.getCommandsDir();
      if (cmdDir) {
        if (existsSync(cmdDir)) {
          const count = readdirSync(cmdDir).filter(f => f.endsWith('.md')).length;
          console.log(`    commands:  ${cmdDir} (${count} command(s))`);
        } else {
          console.log(`    commands:  (none)`);
        }
      }
    }

    if (adapter.supportsPlugin()) {
      console.log(`    plugin:    registered`);
    }
    const caps = adapter.capabilities;
    if (caps) {
      const capStr = Object.entries(caps)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      if (capStr) {
        console.log(`    capabilities: ${capStr}`);
      }
    }
    console.log('');
  }

  if (!foundAny) {
    console.log('  No loom installation detected. Run "loom install --tool <target>" to install.');
  }

  // ── 项目健康度检查（当前目录有 .loom/ 时执行）──────────────────────────
  const loomDir = join(cwd, '.loom');
  if (!existsSync(loomDir)) {
    console.log('  Project: .loom/ not found in current directory (not a loom project).\n');
    return;
  }

  console.log('  [project health]');
  console.log(`    root:  ${cwd}`);

  // constitution 占位符检查
  const constPath = join(loomDir, 'rules', 'constitution.md');
  if (existsSync(constPath)) {
    const content = readFileSync(constPath, 'utf-8');
    const placeholders = [...new Set(content.match(/\{\{[A-Z_]+\}\}/g) || [])];
    if (placeholders.length > 0) {
      console.log(`    constitution: ⚠  ${placeholders.length} unrendered placeholder(s): ${placeholders.join(', ')}`);
    } else {
      console.log(`    constitution: ✓`);
    }
  } else {
    console.log(`    constitution: ✗ missing`);
  }

  // workflow.yaml 检查
  const workflowPath = join(loomDir, 'workflow.yaml');
  console.log(`    workflow.yaml: ${existsSync(workflowPath) ? '✓' : '✗ missing'}`);

  // memory 检查
  const memoryPath = join(loomDir, 'memory', 'MEMORY.md');
  console.log(`    MEMORY.md:     ${existsSync(memoryPath) ? '✓' : '✗ missing'}`);

  // codegraph 检查：未启用时跳过图索引同步。
  if (existsSync(join(cwd, '.codegraph'))) {
    console.log(`    index:         ✓ codegraph backend (.codegraph/) — sync: loom index`);
  } else {
    console.log(`    index:         – codegraph not configured; index update skipped`);
  }

  // subagent-context 新鲜度：宪章变更后未重新生成会让 subagent 拿到过期约束
  const sub = checkSubagentContextStale(loomDir);
  if (!sub.exists) {
    console.log(`    subagent-context: – not generated`);
  } else if (sub.stale) {
    console.log(`    subagent-context: ⚠  stale (constitution.md newer) — regenerate via /loom-init-project`);
  } else {
    console.log(`    subagent-context: ✓`);
  }

  await doctorCompliance(cwd);

  console.log('');
}

function countSkillDirs(dir) {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md'))) count++;
    }
  } catch {}
  return count;
}

function checkCursorMdc(adapter) {
  try {
    const rulesDir = adapter.getRulesDir();
    if (!rulesDir || !existsSync(rulesDir)) return false;
    return readdirSync(rulesDir).some(f => f.startsWith('loom-') && f.endsWith('.mdc'));
  } catch { return false; }
}

// ── 方向5: Skill 遵守率报告 ────────────────────────────────────────────────
// 在 doctor 末尾追加 compliance 统计（如有数据）

import { ComplianceTracker } from '../core/compliance-tracker.js';

export async function doctorCompliance(cwd) {
  const tracker = new ComplianceTracker(cwd);
  const stats = tracker.aggregate();
  if (stats.length === 0) return;

  console.log('  [skill compliance]');
  console.log('');
  console.log('    Skill                                    Total  Pass  Rate');
  console.log('    ─────────────────────────────────────    ─────  ────  ────');

  for (const s of stats) {
    const name = s.skill.padEnd(40);
    const total = String(s.total).padStart(5);
    const passed = String(s.passed).padStart(4);
    const rate = s.rate.padStart(4);
    const warn = parseFloat(s.rate) < 80 ? '  ⚠ high-risk' : '';
    console.log(`    ${name}  ${total}  ${passed}  ${rate}${warn}`);
  }

  const highrisk = stats.filter(s => parseFloat(s.rate) < 80);
  if (highrisk.length > 0) {
    console.log('');
    console.log('    Top violations on high-risk skills:');
    for (const s of highrisk) {
      if (s.topViolations.length === 0) continue;
      console.log(`      ${s.skill}:`);
      for (const v of s.topViolations.slice(0, 3)) {
        console.log(`        · ${v}`);
      }
    }
  }
  console.log('');
}
