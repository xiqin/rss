import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintSkills } from '../../skills/loom-writing-skills/scripts/lint-skills.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const TMP_ROOT = join(import.meta.dirname, '__test_lint_skills__');

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const data = {};
  let key = null;
  let value = '';
  let multiline = false;

  for (const line of match[1].split('\n')) {
    if (multiline) {
      if (/^\s+/.test(line)) {
        value = `${value} ${line.trim()}`.trim();
        continue;
      }
      data[key] = value.trim();
      key = null;
      value = '';
      multiline = false;
    }

    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;

    if (key) data[key] = value.trim();
    key = kv[1];
    value = kv[2].trim();
    multiline = value === '>' || value === '|';
    if (multiline) value = '';
  }

  if (key) data[key] = value.trim();
  return data;
}

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('lint-skills script', () => {
  it('passes the repository skills', () => {
    const result = lintSkills({ root: ROOT });
    expect(result.errors).toEqual([]);
    expect(result.skills).toContain('loom-writing-skills');
  });

  it('requires Agent Skills standard frontmatter fields', () => {
    const skillsDir = join(ROOT, 'skills');
    const skillNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    expect(skillNames.length).toBe(18);

    for (const skillName of skillNames) {
      const skillFile = join(skillsDir, skillName, 'SKILL.md');
      const frontmatter = parseFrontmatter(readFileSync(skillFile, 'utf-8'));

      expect(frontmatter.name, skillName).toBe(skillName);
      expect(frontmatter.description, skillName).toBeTruthy();
      expect(frontmatter.when_to_use, skillName).toBeTruthy();
      expect(frontmatter.when_to_use, skillName).not.toBe(frontmatter.description);
      expect(frontmatter['argument-hint'], skillName).toMatch(/^<[^>]+>$/);
      expect(frontmatter['user-invocable'], skillName).toBe('true');
    }
  });

  it('detects missing referenced files and malformed evals', () => {
    const skillDir = join(TMP_ROOT, 'skills', 'loom-bad-skill');
    mkdirSync(join(skillDir, 'evals'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: loom-bad-skill
description: >
  Broken skill.
---

# Bad Skill

Read \`references/missing.md\`.
`);
    writeFileSync(join(skillDir, 'evals', 'triggers.json'), JSON.stringify({
      version: 1,
      skill: 'loom-other',
      positive: [],
      negative: []
    }));

    const result = lintSkills({ root: TMP_ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes('missing referenced file'))).toBe(true);
    expect(result.errors.some(error => error.includes('evals skill must match'))).toBe(true);
    expect(existsSync(skillDir)).toBe(true);
  });

  it('rejects legacy REFERENCE casing', () => {
    const skillDir = join(TMP_ROOT, 'skills', 'loom-legacy-skill');
    mkdirSync(join(skillDir, 'REFERENCE'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: loom-legacy-skill
description: >
  Legacy skill.
  Use when: testing reference casing.
---

# Legacy Skill

Read \`REFERENCE/details.md\`.
`);

    const result = lintSkills({ root: TMP_ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes('reference directory must be named references'))).toBe(true);
    expect(result.errors.some(error => error.includes('use references/ path casing'))).toBe(true);
  });
});
