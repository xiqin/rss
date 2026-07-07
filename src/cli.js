import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('loom')
  .description('loom — AI 工程化框架 CLI')
  .version(pkg.version)
  .enablePositionalOptions();

// ── 项目初始化 ──────────────────────────────────────────────────────────────

program
  .command('init-project')
  .description('Initialize loom project context in the current repository')
  .option('--cwd <path>', 'Project root (default: current working directory)')
  .option('--tools <list>', 'Comma-separated tools: claude-code,codex,cursor,copilot,opencode')
  .option('--force', 'Overwrite existing loom-managed files')
  .option('--no-codegraph', 'Skip codegraph init even if CLI is available')
  .action(async (options) => {
    const { default: initProjectCommand } = await import('./commands/init-project.js');
    await initProjectCommand(options);
  });

// ── 安装 / 卸载 / 更新 ──────────────────────────────────────────────────────

program
  .command('install')
  .description('Install loom at user-level (global) for CLI tool(s)')
  .requiredOption('--tool <targets...>', 'Target tool(s): space/comma-separated, e.g. --tool claude-code cursor or --tool all')
  .option('--version <ver>', 'Version to install (default: package.json version)')
  .option('--dry-run', 'Show what would be installed without writing')
  .action(async (options) => {
    const { default: installCommand } = await import('./commands/install.js');
    await installCommand(options);
  });

program
  .command('update')
  .description('Reinstall loom at user-level for CLI tool(s) (update)')
  .option('--tool <targets...>', 'Target tool(s): space/comma-separated or "all" (default: all)')
  .option('--version <ver>', 'Version to install (default: package.json version)')
  .option('--dry-run', 'Show diff without applying')
  .action(async (options) => {
    const { default: updateCommand } = await import('./commands/update.js');
    await updateCommand(options);
  });

program
  .command('uninstall')
  .description('Remove user-level installation for CLI tool(s)')
  .requiredOption('--tool <targets...>', 'Target tool(s): space/comma-separated or --tool all')
  .option('--dry-run', 'Show what would be removed without deleting')
  .action(async (options) => {
    const { default: uninstallCommand } = await import('./commands/uninstall.js');
    await uninstallCommand(options);
  });

// ── 诊断 ────────────────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Diagnose loom installation and project health')
  .option('--tool <target>', 'Target tool (auto-detect if omitted)')
  .action(async (options) => {
    const { default: doctor } = await import('./commands/doctor.js');
    await doctor(options);
  });

program
  .command('list')
  .description('List available skills and commands')
  .option('--type <kind>', 'Filter: skills | commands | all', 'all')
  .action(async (options) => {
    const { default: list } = await import('./commands/list.js');
    await list(options);
  });

// ── 方向1: 执行引擎 ─────────────────────────────────────────────────────────

program
  .command('run')
  .description('Pipeline execution engine: init, advance, approve, recover')
  .requiredOption('--spec-dir <path>', 'Path to spec directory')
  .option('--cwd <path>', 'Project root')
  .option('--advance', 'Advance to next stage')
  .option('--compression-confirmed', 'Confirm closed-stage raw context was compressed before advancing')
  .option('--approve', 'Approve human-approval gate')
  .option('--approve-pipeline', '读取 pipeline-plan.md 并初始化为 dynamic_steps')
  .option('--fail <reason>', 'Mark current stage as failed')
  .option('--recover <stage>', 'Recover from failed to target stage')
  .option('--task <id>', 'Task ID (for task-state updates)')
  .option('--task-status <status>', 'Task status: pending|executing|reviewing|done|failed|blocked')
  .option('--blocker <reason>', 'Blocker reason (with --task-status blocked)')
  .option('--context', 'Output stage context as JSON (for MCP / AI)')
  .option('--verdict', 'Read qa-report.md verdict: exit 0=PASS, 1=FAIL, 2=PARTIAL')
  .option('--verdict-file <file>', 'Report filename to read verdict from (default: qa-report.md)')
  .option('--type <pipeline>', 'Pipeline type for init: feature|bugfix|hotfix|refactor|quickfix|chore|qa')
  .option('--auto', 'AI 自主选择模式：分析需求后选择 steps，覆盖 --type')
  .option('--request <text>', '需求描述（配合 --auto 使用）')
  .option('--force', 'Override spec lock')
  .action(async (options) => {
    const { default: runCommand } = await import('./commands/run.js');
    await runCommand(options);
  });

program
  .command('select')
  .description('AI 自主选择 pipeline 步骤，生成 pipeline-plan.md（不初始化状态）')
  .requiredOption('--spec-dir <path>', 'Path to spec directory')
  .requiredOption('--request <text>', '需求描述')
  .option('--cwd <path>', 'Project root')
  .option('--json', 'JSON 输出（不写 pipeline-plan.md）')
  .action(async (options) => {
    const { default: selectCommand } = await import('./commands/select.js');
    await selectCommand(options);
  });

program
  .command('status')
  .description('Show pipeline status for all specs or a single spec')
  .option('--spec-dir <path>', 'Single spec detail view')
  .option('--cwd <path>', 'Project root')
  .option('--all', 'Show all specs (default behavior)')
  .option('--json', 'JSON output')
  .action(async (options) => {
    const { default: statusCommand } = await import('./commands/status.js');
    await statusCommand(options);
  });

const handoffCmd = program
  .command('handoff')
  .description('Write stage/task handoff files and refresh progress.md');

handoffCmd
  .command('write')
  .description('Write a stage or task handoff JSON file')
  .requiredOption('--spec-dir <path>', 'Path to spec directory')
  .option('--cwd <path>', 'Project root')
  .option('--stage <stage>', 'Stage id, e.g. planning')
  .option('--task <id>', 'Task id, e.g. T1')
  .option('--status <status>', 'Handoff status (default: done)', 'done')
  .option('--summary <text>', 'Short handoff summary')
  .option('--artifacts <csv>', 'Comma-separated artifact paths')
  .option('--data <json>', 'Additional JSON object fields')
  .option('--force', 'Override spec lock')
  .action(async (options) => {
    const { default: handoffCommand } = await import('./commands/handoff.js');
    await handoffCommand('write', options);
  });

// ── 方向1 continued: tasks / index / start ──────────────────────────────────

program
  .command('tasks')
  .description('Analyse task file ownership and output safe parallel execution batches')
  .requiredOption('--spec-dir <path>', 'Path to spec directory')
  .option('--validate', 'Conflict-check only; exit 1 if conflicts found')
  .action(async (options) => {
    const { default: tasksCommand } = await import('./commands/tasks.js');
    await tasksCommand(options);
  });

program
  .command('index')
  .description('Sync codegraph index when available')
  .option('--cwd <path>', 'Project root')
  .option('--check', 'Check codegraph status when available')
  .option('--no-codegraph', 'Skip codegraph delegation')
  .action(async (options) => {
    const { default: indexCommand } = await import('./commands/index.js');
    await indexCommand(options);
  });

program
  .command('start')
  .description('Print project loom status for pasting into any AI session')
  .option('--cwd <path>', 'Project root')
  .option('--format <mode>', 'Output: paste (default) | full', 'paste')
  .action(async (options) => {
    const { default: startCommand } = await import('./commands/start.js');
    await startCommand(options);
  });

// ── 方向2: 结构化记忆 ───────────────────────────────────────────────────────

const memoryCmd = program
  .command('memory')
  .description('Structured project memory: add, list, export, merge');

memoryCmd
  .command('add')
  .description('Add a memory entry')
  .requiredOption('--type <type>', 'Type: 决策 | 踩坑 | 偏好 | 状态 | adr')
  .requiredOption('--content <text>', 'One-line description')
  .option('--context <text>', 'Background reason (for ADRs)')
  .option('--author <name>', 'Author name')
  .option('--tags <csv>', 'Comma-separated tags')
  .option('--cwd <path>', 'Project root')
  .action(async (options) => {
    const { default: memoryCommand } = await import('./commands/memory.js');
    await memoryCommand('add', options);
  });

memoryCmd
  .command('list')
  .description('List memory entries')
  .option('--type <type>', 'Filter by type')
  .option('--author <name>', 'Filter by author')
  .option('--limit <n>', 'Max entries', '20')
  .option('--json', 'JSON output')
  .option('--cwd <path>', 'Project root')
  .action(async (options) => {
    const { default: memoryCommand } = await import('./commands/memory.js');
    await memoryCommand('list', options);
  });

memoryCmd
  .command('export')
  .description('Generate MEMORY.md from structured store')
  .option('--cwd <path>', 'Project root')
  .action(async (options) => {
    const { default: memoryCommand } = await import('./commands/memory.js');
    await memoryCommand('export', options);
  });

memoryCmd
  .command('merge')
  .description('Merge another store.json (for team collaboration)')
  .requiredOption('--from <path>', 'Path to other store.json')
  .option('--cwd <path>', 'Project root')
  .action(async (options) => {
    const { default: memoryCommand } = await import('./commands/memory.js');
    await memoryCommand('merge', options);
  });

memoryCmd
  .command('remove')
  .description('Remove entry by ID')
  .requiredOption('--id <id>', 'Entry ID')
  .option('--cwd <path>', 'Project root')
  .action(async (options) => {
    const { default: memoryCommand } = await import('./commands/memory.js');
    await memoryCommand('remove', options);
  });

memoryCmd
  .command('archive')
  .description('Archive a session')
  .requiredOption('--slug <name>', 'Feature slug')
  .option('--file <path>', 'Session content file')
  .option('--cwd <path>', 'Project root')
  .action(async (options) => {
    const { default: memoryCommand } = await import('./commands/memory.js');
    await memoryCommand('archive', options);
  });

// ── 方向3: MCP Server ───────────────────────────────────────────────────────

program
  .command('mcp-serve')
  .description('Start loom MCP server over stdio')
  .option('--help', 'Show MCP configuration examples')
  .action(async (options) => {
    const { default: mcpServe } = await import('./commands/mcp-serve.js');
    await mcpServe(options);
  });

// ── 解析 ────────────────────────────────────────────────────────────────────

program.parse();
