import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { initProject, normalizeToolIds } from '../../skills/loom-init-project/scripts/init-project.mjs';

const TOOL_CHOICES = [
  { id: 'claude-code', label: 'Claude Code', marker: root => existsSync(join(root, '.claude')) || existsSync(join(root, 'CLAUDE.md')) },
  { id: 'codex', label: 'Codex / AGENTS.md', marker: () => true },
  { id: 'opencode', label: 'OpenCode / AGENTS.md', marker: root => existsSync(join(root, '.opencode')) || existsSync(join(root, 'opencode.json')) },
  { id: 'cursor', label: 'Cursor', marker: root => existsSync(join(root, '.cursor')) },
  { id: 'copilot', label: 'GitHub Copilot', marker: root => existsSync(join(root, '.github')) },
];

export default async function initProjectCommand(options = {}) {
  const cwd = options.cwd || process.cwd();
  const tools = await resolveTools(cwd, options);
  const result = initProject({
    cwd,
    force: Boolean(options.force),
    tools,
  });

  console.log(`\n  loom init-project`);
  console.log(`  project: ${result.projectName}`);
  console.log(`  stack:   ${result.techStack}`);
  console.log(`  tools:   ${result.detectedTools.join(', ') || 'none'}`);
  console.log(`\n  written: ${result.written.length}`);
  for (const file of result.written) {
    console.log(`    + ${file}`);
  }

  if (result.skipped.length) {
    console.log(`\n  skipped: ${result.skipped.length}`);
    for (const item of result.skipped) {
      console.log(`    - ${item.path} (${item.reason})`);
    }
  }

  console.log('\n  Done. Review .loom/** [TODO] items before relying on generated context.\n');
}

async function resolveTools(cwd, options) {
  if (options.tools) return normalizeToolIds(options.tools);
  if (options.interactive === false || !input.isTTY || !output.isTTY) return undefined;
  return promptForTools(cwd);
}

async function promptForTools(cwd) {
  const suggested = suggestedTools(cwd);
  const defaultText = suggested.join(',');
  const lines = TOOL_CHOICES.map((tool, index) => {
    const checked = suggested.includes(tool.id) ? '*' : ' ';
    return `    ${index + 1}. [${checked}] ${tool.label} (${tool.id})`;
  }).join('\n');

  const rl = createInterface({ input, output });
  try {
    console.log('\n  Select agent tools to generate entry files for:');
    console.log(lines);
    const answer = await rl.question(`  Tools [${defaultText}]: `);
    return parseToolSelection(answer, suggested);
  } finally {
    rl.close();
  }
}

function suggestedTools(cwd) {
  return TOOL_CHOICES
    .filter(tool => tool.marker(cwd))
    .map(tool => tool.id);
}

function parseToolSelection(answer, fallback) {
  const raw = answer.trim();
  if (!raw) return fallback;

  const selected = [];
  for (const item of raw.split(',').map(part => part.trim()).filter(Boolean)) {
    if (/^\d+$/.test(item)) {
      const choice = TOOL_CHOICES[Number(item) - 1];
      if (!choice) throw new Error(`Unsupported tool number "${item}".`);
      selected.push(choice.id);
      continue;
    }
    selected.push(item);
  }

  return normalizeToolIds(selected);
}
