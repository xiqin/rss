import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initProject } from '../../skills/loom-init-project/scripts/init-project.mjs';

const TEST_DIR = join(import.meta.dirname, '__test_init_project__');
const TEMPLATE_DIR = join(import.meta.dirname, '..', '..', 'templates');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('loom-init-project script', () => {
  it('generates .loom files and a canonical AGENTS.md entry', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
      name: 'demo-app',
      description: 'Demo app',
      scripts: { build: 'vite build', lint: 'eslint .', test: 'vitest run' },
      dependencies: { express: '^4.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }));

    const result = initProject({ cwd: TEST_DIR, templateDir: TEMPLATE_DIR, tools: ['codex'] });

    expect(result.projectName).toBe('demo-app');
    expect(existsSync(join(TEST_DIR, '.loom', 'rules', 'constitution.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.loom', 'rules', 'project-structure.md'))).toBe(false);
    expect(existsSync(join(TEST_DIR, '.loom', 'index', 'engineering-index.md'))).toBe(false);
    expect(existsSync(join(TEST_DIR, '.loom', 'memory', 'store.json'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.loom', 'contexts', 'subagent-context.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'AGENTS.md'))).toBe(true);

    const agents = readFileSync(join(TEST_DIR, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('.loom/rules/constitution.md');
    expect(agents).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);

    const constitution = readFileSync(join(TEST_DIR, '.loom', 'rules', 'constitution.md'), 'utf8');
    expect(constitution).toContain('npm run build');
    expect(constitution).toContain('## 架构模式');
    expect(constitution).toContain('## 目录结构');
    expect(constitution).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);

    const context = readFileSync(join(TEST_DIR, '.loom', 'contexts', 'subagent-context.md'), 'utf8');
    expect(context).toMatch(/constitution-sha256: [a-f0-9]{64}/);
    expect(context).toContain('Current source and command output');
    expect(context).toContain('Handoffs (navigation hints only');
  });

  it('distributes cursor and copilot files when tools are requested', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ name: 'demo-app' }));

    initProject({ cwd: TEST_DIR, templateDir: TEMPLATE_DIR, tools: ['cursor', 'copilot'] });

    const cursorRule = readFileSync(join(TEST_DIR, '.cursor', 'rules', 'loom.mdc'), 'utf8');
    expect(cursorRule).toMatch(/^---\ndescription: "loom project entry/);
    expect(cursorRule).toContain('alwaysApply: true');
    expect(existsSync(join(TEST_DIR, '.github', 'copilot-instructions.md'))).toBe(true);
  });

  it('distributes Claude Code files when the canonical tool id is requested', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ name: 'demo-app' }));

    const result = initProject({ cwd: TEST_DIR, templateDir: TEMPLATE_DIR, tools: ['claude-code'] });

    expect(result.detectedTools).toEqual(['claude-code']);
    expect(existsSync(join(TEST_DIR, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'CLAUDE.md'))).toBe(true);
    expect(readFileSync(join(TEST_DIR, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    expect(existsSync(join(TEST_DIR, '.claudeignore'))).toBe(true);
  });

  it('keeps backward compatibility with the old claude tool alias', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ name: 'demo-app' }));

    const result = initProject({ cwd: TEST_DIR, templateDir: TEMPLATE_DIR, tools: ['claude'] });

    expect(result.detectedTools).toEqual(['claude-code']);
    expect(existsSync(join(TEST_DIR, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'CLAUDE.md'))).toBe(true);
  });

  it('does not overwrite existing non-loom files unless forced', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ name: 'demo-app' }));
    writeFileSync(join(TEST_DIR, 'AGENTS.md'), '# Custom agent rules\n');

    const result = initProject({ cwd: TEST_DIR, templateDir: TEMPLATE_DIR, tools: ['codex'] });
    expect(result.skipped.some(item => item.path.endsWith('AGENTS.md'))).toBe(true);
    expect(readFileSync(join(TEST_DIR, 'AGENTS.md'), 'utf8')).toBe('# Custom agent rules\n');

    initProject({ cwd: TEST_DIR, templateDir: TEMPLATE_DIR, tools: ['codex'], force: true });
    expect(readFileSync(join(TEST_DIR, 'AGENTS.md'), 'utf8')).toContain('.loom/rules/constitution.md');
  });
});
