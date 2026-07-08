import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../../src/core/memory-store.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-mem-')); }

describe('MemoryStore', () => {
  let store;
  beforeEach(() => { store = new MemoryStore(tmp()); });

  it('add + list', () => {
    store.add('决策', '用 JSON 文件存状态', { author: 'tester' });
    const list = store.list({ type: '决策' });
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('用 JSON 文件存状态');
    expect(list[0].id).toHaveLength(8);
  });

  it('stores source, confidence, scope, expiration and links metadata', () => {
    const entry = store.add('决策', '复用 evidence store 做 PR 摘要', {
      author: 'tester',
      source: 'pr-review',
      confidence: 0.8,
      scope: 'spec',
      expiresAt: '2026-12-31T00:00:00.000Z',
      stage: 'verification',
      files: ['src/core/evidence-store.js'],
      links: {
        spec: 'specs/2026-07-07+pr-evidence',
        pr: '123',
        commit: 'abc1234',
        task: 'T1',
        handoff: 'handoffs/T1.json',
      },
    });

    expect(entry).toMatchObject({
      source: 'pr-review',
      confidence: 0.8,
      scope: 'spec',
      expires_at: '2026-12-31T00:00:00.000Z',
      stage: 'verification',
      files: ['src/core/evidence-store.js'],
      links: {
        spec: 'specs/2026-07-07+pr-evidence',
        pr: '123',
        commit: 'abc1234',
        task: 'T1',
        handoff: 'handoffs/T1.json',
      },
    });
  });

  it('filters memory by tags, scope, stage, files and linked work items', () => {
    store.add('决策', 'use evidence store', {
      author: 'tester',
      tags: ['evidence', 'github'],
      scope: 'spec',
      stage: 'verification',
      files: ['src/core/evidence-store.js'],
      links: { spec: 'specs/a', task: 'T1' },
    });
    store.add('踩坑', 'avoid overwriting workflows', {
      author: 'tester',
      tags: ['copilot'],
      scope: 'project',
      stage: 'install',
      files: ['src/adapters/copilot.js'],
      links: { spec: 'specs/b', task: 'T2' },
    });

    expect(store.list({ tag: 'evidence' }).map(e => e.content)).toEqual(['use evidence store']);
    expect(store.list({ scope: 'project' }).map(e => e.content)).toEqual(['avoid overwriting workflows']);
    expect(store.list({ stage: 'verification' }).map(e => e.content)).toEqual(['use evidence store']);
    expect(store.list({ file: 'src/core/evidence-store.js' }).map(e => e.content)).toEqual(['use evidence store']);
    expect(store.list({ specDir: 'specs/a' }).map(e => e.content)).toEqual(['use evidence store']);
    expect(store.list({ task: 'T2' }).map(e => e.content)).toEqual(['avoid overwriting workflows']);
  });

  it('hides expired memory unless includeExpired is requested', () => {
    store.add('状态', 'expired context', {
      author: 'tester',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    store.add('状态', 'active context', { author: 'tester' });

    expect(store.list({ type: '状态' }).map(e => e.content)).toEqual(['active context']);
    expect(store.list({ type: '状态', includeExpired: true }).map(e => e.content)).toEqual(['active context', 'expired context']);
  });

  it('save is atomic — store.json stays valid JSON', () => {
    store.add('踩坑', 'a'); store.add('偏好', 'b');
    expect(() => JSON.parse(readFileSync(store.storePath, 'utf-8'))).not.toThrow();
  });

  it('remove by id', () => {
    const e = store.add('状态', 'tmp');
    expect(store.remove(e.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it('exportMarkdown writes MEMORY.md', () => {
    store.add('决策', 'x');
    store.exportMarkdown();
    expect(existsSync(store.mdPath)).toBe(true);
    expect(readFileSync(store.mdPath, 'utf-8')).toMatch(/Project Memory/);
  });

  it('escapes markdown table and list-breaking content', () => {
    store.add('adr', 'a | b', { author: 'tester', context: 'ctx | break' });
    store.add('踩坑', 'line1\n- injected', { author: 'tester' });

    const md = store.exportMarkdown();

    expect(md).toContain('a \\| b');
    expect(md).toContain('ctx \\| break');
    expect(md).toContain('line1<br>- injected');
    expect(md).not.toContain('\n- injected\n');
  });

  it('throws on corrupt store.json instead of silently dropping entries', () => {
    store.add('决策', 'x', { author: 'tester' });
    writeFileSync(store.storePath, '{ bad json', 'utf-8');

    expect(() => store.list()).toThrow(/Corrupt memory store/);
  });

  it('rejects unsafe archive slugs before writing session files', () => {
    expect(() => store.archiveSession('../escape', 'content')).toThrow(/Invalid session slug/);
    expect(() => store.archiveSession('feature/name', 'content')).toThrow(/Invalid session slug/);
  });
});
