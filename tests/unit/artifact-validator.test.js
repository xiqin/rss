import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateSkillOutput, validatePipelineConsistency, hasPlaceholder } from '../../src/core/artifact-checker.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-artval-')); }

describe('validateSkillOutput', () => {
  let dir;
  beforeEach(() => { dir = tmp(); });

  it('detects missing spec.md for brainstorming', () => {
    const result = validateSkillOutput(dir, 'loom-brainstorming');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('spec.md'))).toBe(true);
  });

  it('detects placeholders in spec.md', () => {
    writeFileSync(join(dir, 'spec.md'), '# Spec\n\nTBD: implementation details');
    const result = validateSkillOutput(dir, 'loom-brainstorming');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('占位符'))).toBe(true);
  });

  it('passes valid brainstorming output', () => {
    writeFileSync(join(dir, 'spec.md'), '# Spec\n\n' + 'Complete requirements spec '.repeat(20));
    const result = validateSkillOutput(dir, 'loom-brainstorming');
    expect(result.valid).toBe(true);
  });

  it('returns valid for unknown skill', () => {
    const result = validateSkillOutput(dir, 'unknown-skill');
    expect(result.valid).toBe(true);
  });

  it('warns about short spec.md', () => {
    writeFileSync(join(dir, 'spec.md'), 'Short');
    const result = validateSkillOutput(dir, 'loom-brainstorming');
    expect(result.warnings.some(w => w.includes('过短'))).toBe(true);
  });

  it('warns about missing test report for subagent-dev', () => {
    const result = validateSkillOutput(dir, 'loom-subagent-driven-development');
    expect(result.warnings.some(w => w.includes('测试报告'))).toBe(true);
  });
});

describe('validatePipelineConsistency', () => {
  let dir;
  beforeEach(() => { dir = tmp(); });

  it('detects missing products for completed stages', () => {
    const result = validatePipelineConsistency(dir, ['brainstorming', 'planning']);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('passes when all stage outputs exist', () => {
    writeFileSync(join(dir, 'spec.md'), '# Spec');
    writeFileSync(join(dir, 'requirements.json'), '{ "requirements": [] }');
    const result = validatePipelineConsistency(dir, ['brainstorming']);
    expect(result.valid).toBe(true);
  });

  it('expects verify-report.md (not verification-report.md) for verification stage', () => {
    writeFileSync(join(dir, 'spec.md'), '# Spec');
    writeFileSync(join(dir, 'requirements.json'), '{ "requirements": [] }');
    writeFileSync(join(dir, 'plan.md'), '# Plan');
    writeFileSync(join(dir, 'traceability.json'), '{ "requirements": {} }');
    writeFileSync(join(dir, 'test-report.md'), 'verdict: PASS');
    writeFileSync(join(dir, 'verify-report.md'), 'verdict: PASS');
    const result = validatePipelineConsistency(dir, ['brainstorming', 'planning', 'executing', 'verification']);
    expect(result.valid).toBe(true);
    expect(result.errors.some(e => e.includes('verification-report.md'))).toBe(false);
  });

  it('detects missing structured ledger artifacts for completed stages', () => {
    const result = validatePipelineConsistency(dir, ['brainstorming']);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('requirements.json'))).toBe(true);
  });
});

describe('hasPlaceholder (exported)', () => {
  it('detects TBD', () => {
    expect(hasPlaceholder('some TBD text')).toBe(true);
  });

  it('detects TODO', () => {
    expect(hasPlaceholder('need to TODO this')).toBe(true);
  });

  it('detects template variables', () => {
    expect(hasPlaceholder('hello {{NAME}}')).toBe(true);
  });

  it('returns false for clean content', () => {
    expect(hasPlaceholder('clean content without placeholders')).toBe(false);
  });
});
