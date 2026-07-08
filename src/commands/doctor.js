import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getUserAdapter, USER_TOOL_IDS } from '../core/installer.js';
import { getAdapterContract } from '../generated/tooling.js';

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

export default async function doctor(options = {}) {
  const report = await buildDoctorReport(options);
  if (options.fixPlan) {
    report.fixPlan = writeDoctorFixPlan(report, options);
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  printDoctorReport(report);
  return report;
}

function writeDoctorFixPlan(report, options = {}) {
  const outPath = resolveOutputPath(report.project.root, options.fixPlanOut || '.loom/doctor/fix-plan.json');
  const plan = buildDoctorFixPlan(report);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`);
  return { path: outPath, ...plan };
}

function buildDoctorFixPlan(report) {
  const actions = [];

  for (const tool of report.tools) {
    if (!tool.supported) continue;
    if (!tool.installed) {
      actions.push({
        id: `install-${tool.id}`,
        title: `Install loom integration for ${tool.id}`,
        category: 'tool-installation',
        status: 'suggested',
        risk: 'medium',
        command: `loom install --tool ${tool.id}`,
        reason: 'No loom-managed skills or commands were detected for this tool.',
      });
    }
    if (tool.contract && !tool.contract.capabilitiesMatch) {
      actions.push({
        id: `review-${tool.id}-contract`,
        title: `Review adapter contract drift for ${tool.id}`,
        category: 'adapter-contract',
        status: 'manual-review',
        risk: 'medium',
        command: `loom doctor --tool ${tool.id} --json`,
        reason: tool.contract.mismatches.join('; '),
      });
    }
  }

  const project = report.project;
  if (project.exists) {
    const health = project.health || {};
    if (health.constitution?.status === 'missing') {
      actions.push({
        id: 'create-constitution',
        title: 'Create project constitution',
        category: 'project-health',
        status: 'suggested',
        risk: 'medium',
        command: 'loom init-project',
        target: health.constitution.path,
        reason: 'Project constitution is missing.',
      });
    } else if (health.constitution?.status === 'warning') {
      actions.push({
        id: 'render-constitution',
        title: 'Resolve unrendered constitution placeholders',
        category: 'project-health',
        status: 'manual-review',
        risk: 'low',
        target: health.constitution.path,
        reason: `Unrendered placeholders: ${health.constitution.placeholders.join(', ')}`,
      });
    }
    if (health.workflow?.status === 'missing') {
      actions.push({
        id: 'create-workflow',
        title: 'Create loom workflow file',
        category: 'project-health',
        status: 'suggested',
        risk: 'medium',
        command: 'loom init-project',
        target: health.workflow.path,
        reason: 'Project workflow.yaml is missing.',
      });
    }
    if (health.memory?.status === 'missing') {
      actions.push({
        id: 'create-memory',
        title: 'Create loom memory file',
        category: 'project-health',
        status: 'suggested',
        risk: 'medium',
        command: 'loom init-project',
        target: health.memory.path,
        reason: 'Project MEMORY.md is missing.',
      });
    }
    if (health.subagentContext?.status === 'warning') {
      actions.push({
        id: 'refresh-subagent-context',
        title: 'Refresh stale subagent context',
        category: 'project-health',
        status: 'suggested',
        risk: 'low',
        command: 'loom init-project --force',
        reason: 'subagent-context.md is stale relative to constitution.md.',
      });
    }
    if (health.index?.status === 'skipped') {
      actions.push({
        id: 'configure-codegraph',
        title: 'Configure codegraph index when needed',
        category: 'index',
        status: 'optional',
        risk: 'low',
        command: 'codegraph init',
        reason: 'No .codegraph/ directory was found; indexing is optional and user-controlled.',
      });
    }
  }

  return {
    schema: 'loom.doctor-fix-plan.v1',
    generatedAt: report.generatedAt,
    source: {
      schema: report.schema,
      generatedAt: report.generatedAt,
    },
    project: {
      root: report.project.root,
      exists: report.project.exists,
    },
    safety: {
      autoApply: false,
      mutatesFiles: false,
      requiresReview: true,
      note: 'This plan is advisory only. Loom does not apply fixes from doctor automatically.',
    },
    summary: {
      total: actions.length,
      byRisk: countBy(actions, 'risk'),
      byStatus: countBy(actions, 'status'),
      byCategory: countBy(actions, 'category'),
    },
    actions,
  };
}

function resolveOutputPath(cwd, path) {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

async function buildDoctorReport(options) {
  const tools = options.tool ? [options.tool] : USER_TOOL_IDS;
  const cwd = process.cwd();
  const diagnosedTools = [];

  for (const tool of tools) {
    if (!USER_TOOL_IDS.includes(tool)) {
      diagnosedTools.push({
        id: tool,
        supported: false,
        installed: false,
        message: `Unknown tool: "${tool}". Supported: ${USER_TOOL_IDS.join(', ')}`,
      });
      continue;
    }

    const adapter = await getUserAdapter(tool);
    diagnosedTools.push(diagnoseToolInstallation(tool, adapter));
  }

  return {
    schema: 'loom.doctor.v1',
    generatedAt: new Date().toISOString(),
    version: pkg.version,
    tools: diagnosedTools,
    project: diagnoseProject(cwd),
  };
}

function printDoctorReport(report) {
  console.log(`\n  loom doctor — Diagnosis Report\n`);

  // ── 工具安装状态 ──────────────────────────────────────────────────────────
  let foundAny = false;
  for (const tool of report.tools) {
    if (!tool.supported) {
      console.log(`  ${tool.message}`);
      continue;
    }

    if (!tool.installed) continue;
    foundAny = true;

    console.log(`  [${tool.id}]`);
    console.log(`    user dir:  ${tool.userDir}`);

    if (tool.id === 'cursor') {
      if (tool.rules?.exists) {
        console.log(`    rules:     ${tool.rules.path}`);
        console.log(`    skills:    ${tool.skills.count} skill(s) as .mdc`);
        if (tool.commands.count > 0) console.log(`    commands:  ${tool.commands.count} command(s) as .mdc`);
        console.log(`    session-init: ${tool.rules.hasSessionInit ? '✓ installed' : '✗ missing (run loom update --tool cursor)'}`);
      }
    } else {
      if (tool.skills.path && tool.skills.exists) {
        console.log(`    skills:    ${tool.skills.path} (${tool.skills.count} skill(s))`);
      }
      if (tool.commands.path) {
        if (tool.commands.exists) {
          console.log(`    commands:  ${tool.commands.path} (${tool.commands.count} command(s))`);
        } else {
          console.log(`    commands:  (none)`);
        }
      }
    }

    if (tool.plugin.registered) {
      console.log(`    plugin:    registered`);
    }
    const caps = tool.capabilities;
    if (caps) {
      const capStr = Object.entries(caps)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      if (capStr) {
        console.log(`    capabilities: ${capStr}`);
      }
    }
    printContractDiagnostics(tool.contract);
    console.log('');
  }

  if (!foundAny) {
    console.log('  No loom installation detected. Run "loom install --tool <target>" to install.');
  }

  // ── 项目健康度检查（当前目录有 .loom/ 时执行）──────────────────────────
  const project = report.project;
  if (!project.exists) {
    console.log('  Project: .loom/ not found in current directory (not a loom project).\n');
    printFixPlanSummary(report.fixPlan);
    return;
  }

  console.log('  [project health]');
  console.log(`    root:  ${project.root}`);

  const constitution = project.health.constitution;
  if (constitution.status === 'warning') {
    console.log(`    constitution: ⚠  ${constitution.placeholders.length} unrendered placeholder(s): ${constitution.placeholders.join(', ')}`);
  } else if (constitution.status === 'ok') {
    console.log(`    constitution: ✓`);
  } else {
    console.log(`    constitution: ✗ missing`);
  }

  console.log(`    workflow.yaml: ${project.health.workflow.status === 'ok' ? '✓' : '✗ missing'}`);

  console.log(`    MEMORY.md:     ${project.health.memory.status === 'ok' ? '✓' : '✗ missing'}`);

  if (project.health.index.status === 'ok') {
    console.log(`    index:         ✓ codegraph backend (.codegraph/) — sync: loom index`);
  } else {
    console.log(`    index:         – codegraph not configured; index update skipped`);
  }

  const sub = project.health.subagentContext;
  if (!sub.exists) {
    console.log(`    subagent-context: – not generated`);
  } else if (sub.stale) {
    console.log(`    subagent-context: ⚠  stale (constitution.md newer) — regenerate via /loom-init-project`);
  } else {
    console.log(`    subagent-context: ✓`);
  }

  printCompliance(project.compliance);

  printFixPlanSummary(report.fixPlan);
  console.log('');
}

function printFixPlanSummary(fixPlan) {
  if (!fixPlan) return;
  console.log(`  fix plan: ${fixPlan.path} (${fixPlan.summary.total} action(s), not applied)`);
}

function diagnoseToolInstallation(tool, adapter) {
  const userDir = adapter.getUserDir();
  const result = {
    id: tool,
    supported: true,
    userDir,
    installed: false,
    skills: { path: null, exists: false, count: 0 },
    commands: { path: null, exists: false, count: 0 },
    rules: null,
    plugin: { registered: adapter.supportsPlugin?.() || false },
    capabilities: adapter.capabilities || {},
    contract: getAdapterContractDiagnostics(tool, adapter),
  };

  if (tool === 'cursor') {
    const rulesDir = adapter.getRulesDir();
    const mdcFiles = rulesDir && existsSync(rulesDir)
      ? readdirSync(rulesDir).filter(f => f.startsWith('loom-') && f.endsWith('.mdc'))
      : [];
    result.rules = {
      path: rulesDir,
      exists: Boolean(rulesDir && existsSync(rulesDir)),
      hasSessionInit: mdcFiles.includes('loom-session-init.mdc'),
    };
    result.skills = { path: rulesDir, exists: result.rules.exists, count: mdcFiles.filter(f => !f.startsWith('loom-cmd-')).length };
    result.commands = { path: rulesDir, exists: result.rules.exists, count: mdcFiles.filter(f => f.startsWith('loom-cmd-')).length };
    result.installed = result.skills.count > 0 || result.commands.count > 0;
    return result;
  }

  const skillsDir = adapter.getSkillsDir();
  const cmdDir = adapter.getCommandsDir();
  result.skills = {
    path: skillsDir,
    exists: Boolean(skillsDir && existsSync(skillsDir)),
    count: skillsDir && existsSync(skillsDir) ? countSkillDirs(skillsDir) : 0,
  };
  result.commands = {
    path: cmdDir,
    exists: Boolean(cmdDir && existsSync(cmdDir)),
    count: cmdDir && existsSync(cmdDir) ? readdirSync(cmdDir).filter(f => f.endsWith('.md')).length : 0,
  };
  result.installed = result.skills.count > 0 || result.commands.count > 0;
  return result;
}

function diagnoseProject(cwd) {
  const loomDir = join(cwd, '.loom');
  if (!existsSync(loomDir)) {
    return { root: cwd, loomDir, exists: false, health: {}, compliance: [] };
  }

  return {
    root: cwd,
    loomDir,
    exists: true,
    health: {
      constitution: diagnoseConstitution(loomDir),
      workflow: diagnoseFile(join(loomDir, 'workflow.yaml')),
      memory: diagnoseFile(join(loomDir, 'memory', 'MEMORY.md')),
      index: existsSync(join(cwd, '.codegraph'))
        ? { status: 'ok', backend: 'codegraph' }
        : { status: 'skipped', backend: null },
      subagentContext: diagnoseSubagentContext(loomDir),
    },
    compliance: new ComplianceTracker(cwd).aggregate(),
  };
}

function diagnoseConstitution(loomDir) {
  const path = join(loomDir, 'rules', 'constitution.md');
  if (!existsSync(path)) return { status: 'missing', path, exists: false, placeholders: [] };
  const content = readFileSync(path, 'utf-8');
  const placeholders = [...new Set(content.match(/\{\{[A-Z_]+\}\}/g) || [])];
  return {
    status: placeholders.length > 0 ? 'warning' : 'ok',
    path,
    exists: true,
    placeholders,
  };
}

function diagnoseFile(path) {
  return { status: existsSync(path) ? 'ok' : 'missing', path, exists: existsSync(path) };
}

function diagnoseSubagentContext(loomDir) {
  const state = checkSubagentContextStale(loomDir);
  return {
    ...state,
    status: !state.exists ? 'missing' : state.stale ? 'warning' : 'ok',
  };
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

export function getAdapterContractDiagnostics(tool, adapter, options = {}) {
  const contract = getAdapterContract(tool);
  if (!contract) return null;

  const runtime = adapter.capabilities || {};
  const mismatches = [];
  for (const [capability, expected] of Object.entries(contract.capabilities || {})) {
    if (runtime[capability] !== expected) {
      mismatches.push(`${capability}: expected ${expected}, got ${runtime[capability]}`);
    }
  }

  return {
    contract,
    capabilitiesMatch: mismatches.length === 0,
    mismatches,
    version: diagnoseVersionProbe(contract.versionProbe, options.runVersionProbe),
  };
}

export function diagnoseVersionProbe(probe, runVersionProbe = executeVersionProbe) {
  if (!probe?.command) return null;

  try {
    const output = runVersionProbe(probe);
    const version = extractVersion(output, probe.versionPattern);
    const minimum = probe.minimumVersion || probe.minVersion;
    const meetsMinimum = minimum && version ? compareVersions(version, minimum) >= 0 : null;
    return {
      command: probe.command,
      args: probe.args || [],
      available: true,
      status: meetsMinimum === false ? 'outdated' : 'ok',
      version,
      minimumVersion: minimum || null,
      message: meetsMinimum === false
        ? `version ${version} is below recommended ${minimum}`
        : `version ${version || 'detected'}`,
    };
  } catch (err) {
    return {
      command: probe.command,
      args: probe.args || [],
      available: false,
      status: 'unavailable',
      version: null,
      minimumVersion: probe.minimumVersion || probe.minVersion || null,
      message: probe.installHint || err.message,
    };
  }
}

function executeVersionProbe(probe) {
  const result = spawnSync(probe.command, probe.args || [], {
    encoding: 'utf-8',
    timeout: probe.timeoutMs || 3000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${probe.command} exited with ${result.status}`).trim());
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

function extractVersion(output, pattern) {
  const text = String(output || '').trim();
  if (!text) return null;
  if (pattern) {
    const match = text.match(new RegExp(pattern));
    if (match) return match[1] || match[0];
  }
  const fallback = text.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return fallback ? fallback[0] : text.split(/\r?\n/)[0];
}

function compareVersions(a, b) {
  const left = String(a || '').match(/\d+/g)?.slice(0, 3).map(Number) || [];
  const right = String(b || '').match(/\d+/g)?.slice(0, 3).map(Number) || [];
  for (let i = 0; i < 3; i++) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function printContractDiagnostics(diagnostics) {
  if (!diagnostics) return;

  const { contract, capabilitiesMatch, mismatches } = diagnostics;
  console.log(`    contract: ${capabilitiesMatch ? '✓ capabilities match' : `⚠ ${mismatches.length} capability mismatch(es)`}`);
  if (mismatches.length > 0) {
    for (const mismatch of mismatches.slice(0, 3)) {
      console.log(`      · ${mismatch}`);
    }
  }

  if (contract.configSurfaces?.length > 0) {
    console.log(`    config surfaces: ${contract.configSurfaces.join(', ')}`);
  }
  if (contract.managedArtifacts?.length > 0) {
    console.log(`    managed artifacts: ${contract.managedArtifacts.join(', ')}`);
  }
  if (contract.mcpServers?.length > 0) {
    console.log(`    mcp servers: ${contract.mcpServers.map(formatMcpServer).join('; ')}`);
  }
  if (contract.directoryLayout?.length > 0) {
    console.log(`    directory layout: ${contract.directoryLayout.map(formatDirectoryLayout).join('; ')}`);
  }
  if (contract.hookHandlers?.length > 0) {
    console.log(`    hook handlers: ${contract.hookHandlers.map(formatHookHandler).join('; ')}`);
  }
  const permissions = formatPermissions(contract.permissions);
  if (permissions) {
    console.log(`    permissions: ${permissions}`);
  }
  if (contract.sideEffects?.install?.length > 0) {
    console.log(`    install side effects: ${contract.sideEffects.install.join('; ')}`);
  }
  if (contract.sideEffects?.uninstall?.length > 0) {
    console.log(`    uninstall side effects: ${contract.sideEffects.uninstall.join('; ')}`);
  }
  if (diagnostics.version) {
    const { version } = diagnostics;
    const command = [version.command, ...(version.args || [])].join(' ');
    if (version.status === 'ok') {
      console.log(`    version probe: ✓ ${command} → ${version.version || 'detected'}`);
    } else if (version.status === 'outdated') {
      console.log(`    version probe: ⚠ ${command} → ${version.message}`);
    } else {
      console.log(`    version probe: ⚠ ${command} unavailable — ${version.message}`);
    }
  }
}

function formatMcpServer(server) {
  const requirement = server.required ? 'required' : 'optional';
  return `${server.id} ${server.type} ${requirement} @ ${server.configPath}#${server.configKey}`;
}

function formatDirectoryLayout(entry) {
  return `${entry.kind} ${entry.scope} ${entry.path}/${entry.pattern} ${entry.lifecycle}`;
}

function formatHookHandler(handler) {
  const blocking = handler.blocking ? 'blocking' : 'optional';
  return `${handler.event}:${handler.id} ${handler.handlerType} ${blocking} ${handler.fallback}`;
}

function formatPermissions(permissions) {
  if (!permissions) return '';

  const fileSystem = (permissions.fileSystem || [])
    .map(entry => `fs ${entry.access} ${entry.scope} ${entry.path}`);
  const commands = (permissions.commands || [])
    .map(entry => `cmd ${entry.access} ${entry.phase} ${entry.command}`);
  return [...fileSystem, ...commands].join('; ');
}

// ── 方向5: Skill 遵守率报告 ────────────────────────────────────────────────
// 在 doctor 末尾追加 compliance 统计（如有数据）

import { ComplianceTracker } from '../core/compliance-tracker.js';

export async function doctorCompliance(cwd) {
  const tracker = new ComplianceTracker(cwd);
  const stats = tracker.aggregate();
  printCompliance(stats);
}

function printCompliance(stats) {
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
