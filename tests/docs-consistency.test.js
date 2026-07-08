import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

function read(relPath) {
  return readFileSync(join(root, relPath), 'utf-8');
}

describe('documentation consistency', () => {
  it('documents the current Node.js engine requirement', () => {
    const expected = `Node.js >= ${pkg.engines.node.replace('>=', '')}`;
    expect(read('README.md')).toContain(expected);
    expect(read('docs/installation.md')).toContain(expected);
    expect(read('docs/system-design.md')).toContain(expected);
  });

  it('documents the current package version in system design', () => {
    expect(read('docs/system-design.md')).toContain(`v${pkg.version}`);
  });

  it('does not document obsolete runtime or protocol versions', () => {
    const docs = [
      read('README.md'),
      read('docs/installation.md'),
      read('docs/system-design.md'),
      read('docs/architecture.md'),
    ].join('\n');

    expect(docs).not.toContain('Node.js >= 18');
    expect(docs).not.toContain('2025-03-26');
  });
});
