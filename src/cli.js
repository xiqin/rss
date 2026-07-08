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
  .option('--json', 'Output machine-readable JSON diagnostics')
  .option('--fix-plan', 'Write a non-mutating doctor fix plan')
  .option('--fix-plan-out <path>', 'Doctor fix plan output path', '.loom/doctor/fix-plan.json')
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
  .option('--no-reports', 'Skip automatic completion reports when terminal stage completes')
  .option('--pr-evidence', 'Generate PR evidence when terminal stage completes')
  .option('--dashboard', 'Generate dashboard when terminal stage completes')
  .option('--hash-artifacts', 'Hash existing evidence artifacts in completion reports')
  .option('--force', 'Override spec lock')
  .action(async (options) => {
    const { default: runCommand } = await import('./commands/run.js');
    await runCommand(options);
  });

program
  .command('finalize')
  .description('Generate completion reports for a finished loom spec')
  .requiredOption('--spec-dir <path>', 'Path to spec directory')
  .option('--cwd <path>', 'Project root')
  .option('--no-reports', 'Skip report generation')
  .option('--pr-evidence', 'Generate PR evidence summary')
  .option('--dashboard', 'Generate dashboard HTML and JSON')
  .option('--hash-artifacts', 'Hash existing evidence artifacts')
  .action(async (options) => {
    const { default: finalizeCommand } = await import('./commands/finalize.js');
    await finalizeCommand(options);
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

program
  .command('evidence')
  .description('Show normalized evidence records from compliance history')
  .option('--cwd <path>', 'Project root')
  .option('--limit <n>', 'Max evidence records', '50')
  .option('--type <type>', 'Filter by evidence type')
  .option('--risk <risk>', 'Filter by risk: low | medium | high')
  .option('--verdict <verdict>', 'Filter by verdict: PASS | WARN | FAIL')
  .option('--spec-dir <path>', 'Filter by spec directory')
  .option('--json', 'JSON output')
  .option('--jsonl', 'JSON Lines output')
  .option('--raw', 'Include raw compliance records in JSON output')
  .option('--hash-artifacts', 'Add sha256 hashes for existing artifact files')
  .option('--trends', 'Output trend metrics instead of evidence records')
  .option('--top <n>', 'Top N failure reasons for --trends', '5')
  .option('--format <format>', 'Export format with --out: json | jsonl | markdown | html')
  .option('--out <path>', 'Write evidence export to a file instead of stdout')
  .action(async (options) => {
    const { default: evidenceCommand } = await import('./commands/evidence.js');
    await evidenceCommand(options);
  });

program
  .command('dashboard')
  .description('Generate a local HTML team dashboard from evidence and memory')
  .option('--cwd <path>', 'Project root')
  .option('--out <path>', 'Output HTML path', '.loom/reports/team-dashboard.html')
  .option('--spec-dir <path>', 'Filter dashboard by spec directory')
  .option('--limit <n>', 'Max recent evidence and memory items', '10')
  .option('--repos <paths>', 'Comma-separated repository roots to aggregate')
  .option('--web', 'Also write static JSON data and add browser refresh metadata')
  .option('--data-out <path>', 'Dashboard JSON data path')
  .option('--refresh <seconds>', 'Static web dashboard refresh interval', '15')
  .action(async (options) => {
    const { default: dashboardCommand } = await import('./commands/dashboard.js');
    await dashboardCommand(options);
  });

const pluginsCmd = program
  .command('plugins')
  .description('Discover loom plugin manifests and extension points');

pluginsCmd
  .command('list')
  .description('List .loom/plugins/*.json manifests')
  .option('--cwd <path>', 'Project root')
  .option('--dir <path>', 'Plugin manifest directory', '.loom/plugins')
  .option('--json', 'JSON output')
  .action(async (options) => {
    const { default: pluginsCommand } = await import('./commands/plugins.js');
    await pluginsCommand('list', options);
  });

pluginsCmd
  .command('marketplace-template')
  .description('Write a remote MCP marketplace template')
  .option('--cwd <path>', 'Project root')
  .option('--out <path>', 'Marketplace template path', '.loom/marketplace/mcp-marketplace.json')
  .option('--name <name>', 'Marketplace display name')
  .option('--id <id>', 'Remote MCP server id')
  .option('--server-name <name>', 'Remote MCP server display name')
  .option('--url <url>', 'Remote MCP endpoint URL')
  .option('--transport <type>', 'Remote MCP transport', 'streamable-http')
  .option('--force', 'Overwrite an existing template')
  .option('--json', 'JSON output')
  .action(async (options) => {
    const { default: pluginsCommand } = await import('./commands/plugins.js');
    await pluginsCommand('marketplace-template', options);
  });

pluginsCmd
  .command('marketplace-sync')
  .description('Write a local audit plan for a remote MCP marketplace template')
  .option('--cwd <path>', 'Project root')
  .option('--source <path>', 'Marketplace template input path', '.loom/marketplace/mcp-marketplace.json')
  .option('--out <path>', 'Marketplace sync plan output path', '.loom/marketplace/mcp-marketplace.sync.json')
  .option('--audit-out <path>', 'Marketplace sync audit JSONL output path', '.loom/compliance/marketplace-sync.jsonl')
  .option('--json', 'JSON output')
  .action(async (options) => {
    const { default: pluginsCommand } = await import('./commands/plugins.js');
    const result = await pluginsCommand('marketplace-sync', options);
    if (result.plan?.verdict === 'FAIL') process.exitCode = 1;
  });

pluginsCmd
  .command('plan')
  .description('Write a declarative plugin execution plan without loading plugin code')
  .option('--cwd <path>', 'Workspace root', process.cwd())
  .option('--dir <path>', 'Plugin manifest directory', '.loom/plugins')
  .option('--out <path>', 'Output plan path', '.loom/plugins/plugin-plan.json')
  .option('--json', 'JSON output')
  .action(async (options) => {
    const { default: pluginsCommand } = await import('./commands/plugins.js');
    await pluginsCommand('plan', options);
  });

const prCmd = program
  .command('pr')
  .description('Create pull request artifacts from loom state and evidence');

prCmd
  .command('evidence')
  .description('Write a Markdown evidence summary for pull requests')
  .option('--cwd <path>', 'Project root')
  .option('--out <path>', 'Output Markdown path', '.loom/evidence/pr-evidence.md')
  .option('--limit <n>', 'Max evidence records', '50')
  .option('--type <type>', 'Filter by evidence type')
  .option('--risk <risk>', 'Filter by risk: low | medium | high')
  .option('--verdict <verdict>', 'Filter by verdict: PASS | WARN | FAIL')
  .option('--spec-dir <path>', 'Filter by spec directory')
  .option('--raw', 'Include raw compliance records in generated Markdown')
  .option('--hash-artifacts', 'Add sha256 hashes for existing artifact files')
  .action(async (options) => {
    const { default: prCommand } = await import('./commands/pr.js');
    await prCommand('evidence', options);
  });

const policyCmd = program
  .command('policy')
  .description('Enterprise policy checks for sensitive paths, secrets and audit records');

policyCmd
  .command('check')
  .description('Scan files against .loom/policy.json and write a JSONL audit record')
  .option('--cwd <path>', 'Project root')
  .option('--policy <path>', 'Policy file path', '.loom/policy.json')
  .option('--files <csv>', 'Comma-separated files to scan')
  .option('--file <path>', 'Single file to scan')
  .option('--out <path>', 'Audit JSONL output path', '.loom/compliance/policy-audit.jsonl')
  .action(async (options) => {
    const { default: policyCommand } = await import('./commands/policy.js');
    const result = await policyCommand('check', options);
    if (result.verdict === 'FAIL') process.exitCode = 1;
  });

const issueCmd = program
  .command('issue')
  .description('Import GitHub issue metadata into loom specs');

issueCmd
  .command('import')
  .description('Create specs/<date+slug>/spec.md from a GitHub issue title/body')
  .requiredOption('--title <text>', 'GitHub issue title')
  .option('--body <text>', 'GitHub issue body')
  .option('--body-file <path>', 'Read GitHub issue body from a file')
  .option('--number <n>', 'GitHub issue number')
  .option('--url <url>', 'GitHub issue URL')
  .option('--slug <name>', 'Feature slug (default: derived from title)')
  .option('--date <yyyy-mm-dd>', 'Spec date prefix (default: today)')
  .option('--cwd <path>', 'Project root')
  .option('--force', 'Overwrite existing spec.md')
  .action(async (options) => {
    const { default: issueCommand } = await import('./commands/issue.js');
    await issueCommand('import', options);
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
  .option('--source <text>', 'Source of this memory, e.g. issue, PR, review, session')
  .option('--confidence <number>', 'Confidence from 0 to 1')
  .option('--scope <scope>', 'Applicability scope, e.g. project | spec | file | team')
  .option('--expires-at <iso>', 'Expiration timestamp for temporary memory')
  .option('--spec-dir <path>', 'Related spec directory')
  .option('--pr <id>', 'Related pull request id or URL')
  .option('--commit <sha>', 'Related commit SHA')
  .option('--task <id>', 'Related task id')
  .option('--handoff <path>', 'Related handoff artifact')
  .option('--stage <stage>', 'Related pipeline stage')
  .option('--files <csv>', 'Related file paths')
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
  .option('--tag <tag>', 'Filter by tag')
  .option('--scope <scope>', 'Filter by applicability scope')
  .option('--stage <stage>', 'Filter by pipeline stage')
  .option('--file <path>', 'Filter by related file path')
  .option('--spec-dir <path>', 'Filter by related spec directory')
  .option('--pr <id>', 'Filter by related pull request')
  .option('--commit <sha>', 'Filter by related commit')
  .option('--task <id>', 'Filter by related task id')
  .option('--handoff <path>', 'Filter by related handoff artifact')
  .option('--include-expired', 'Include expired memory entries')
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
