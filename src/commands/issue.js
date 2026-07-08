import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export default async function issueCommand(action, options = {}) {
  if (action !== 'import') throw new Error(`Unknown issue action: ${action}`);
  return importIssue(options);
}

function importIssue(options) {
  const cwd = resolve(options.cwd || process.cwd());
  const title = String(options.title || '').trim();
  if (!title) throw new Error('Missing required option: --title');

  const body = readBody(options, cwd);
  const date = normalizeDate(options.date || new Date().toISOString().slice(0, 10));
  const slug = options.slug ? normalizeSlug(options.slug) : slugify(title);
  const specDir = resolveInside(cwd, 'specs', `${date}+${slug}`);
  const specPath = join(specDir, 'spec.md');

  if (existsSync(specPath) && !options.force) {
    throw new Error(`spec.md already exists: ${specPath}`);
  }

  mkdirSync(specDir, { recursive: true });
  writeFileSync(specPath, renderSpec({ title, body, number: options.number, url: options.url }), 'utf-8');

  console.log('\n  loom issue import');
  console.log(`  spec: ${specPath}`);
  console.log('  next: review spec.md, then run loom select/run for planning.\n');

  return { specDir, specPath };
}

function readBody(options, cwd) {
  if (options.bodyFile) {
    const path = isAbsolute(options.bodyFile) ? options.bodyFile : resolve(cwd, options.bodyFile);
    return readFileSync(path, 'utf-8').trim();
  }
  return String(options.body || '').trim();
}

function normalizeDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid issue date: ${value}. Expected YYYY-MM-DD.`);
  }
  return date;
}

function normalizeSlug(value) {
  const slug = slugify(value);
  if (!slug) throw new Error(`Invalid issue slug: ${value}`);
  return slug;
}

function resolveInside(root, ...parts) {
  const abs = resolve(root, ...parts);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`issue spec path escapes project root: ${parts.join('/')}`);
  }
  return abs;
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'github-issue';
}

function renderSpec({ title, body, number, url }) {
  const source = number ? `GitHub Issue #${number}` : 'GitHub Issue';
  const sourceUrl = url ? `\n- URL: ${url}` : '';
  const issueBody = body || '(No issue body provided.)';

  return `# ${title}

## Source

- ${source}${sourceUrl}

## Problem

${issueBody}

## Requirements

- Preserve the intent of the original GitHub issue.
- Clarify open questions before implementation when requirements are ambiguous.

## Acceptance Criteria

- [ ] The requested behavior is implemented and verified.
- [ ] Relevant tests or validation evidence are recorded.
- [ ] User-facing documentation is updated when behavior changes.
`;
}
