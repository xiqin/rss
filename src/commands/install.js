import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

function parseTools(raw, USER_TOOL_IDS) {
  const input = Array.isArray(raw) ? raw.join(',') : String(raw || '');
  if (input.trim() === 'all') return [...USER_TOOL_IDS];
  return input.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
}

export default async function install(options) {
  const { tool: rawTool, version: ver, dryRun = false, force = false } = options;
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
  const version = ver || pkg.version;

  const { getUserAdapter, USER_TOOL_IDS } = await import('../core/installer.js');

  const tools = parseTools(rawTool, USER_TOOL_IDS);

  console.log(`\n  loom install --tool ${tools.join(',')} --version ${version} (user-level)\n`);

  for (const tool of tools) {
    if (!USER_TOOL_IDS.includes(tool)) {
      console.log(`  ✗ ${tool}: unknown. Supported: ${USER_TOOL_IDS.join(', ')}`);
      continue;
    }

    const adapter = await getUserAdapter(tool);
    console.log(`→ ${tool}`);

    if (dryRun) {
      console.log(`    [dry-run] Would install loom@${version} for ${tool}`);
      console.log(`    user dir:  ${adapter.getUserDir()}`);
      if (tool === 'cursor') {
        console.log(`    rules:     ${adapter.getRulesDir()} (loom-*.mdc)`);
      } else {
        if (adapter.supportsPlugin()) {
          console.log('    plugin:    will register via tool plugin system');
        } else {
          console.log(`    skills:    ${adapter.getSkillsDir()}`);
        }
        const cmdDir = adapter.getCommandsDir();
        if (cmdDir) console.log(`    commands:  ${cmdDir}`);
      }
      console.log('');
      continue;
    }

    const log = adapter.install(PROJECT_ROOT, version, process.cwd());
    console.log(log.join('\n'));
    console.log('');
  }

  console.log('  Done.\n');
}
