import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const ROOT = join(import.meta.dirname, '..');

describe('template schema', () => {
  it('declares exactly the placeholders used by each template', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'config', 'templates.schema.json'), 'utf8'));

    for (const template of schema.templates) {
      const content = readFileSync(join(ROOT, template.sourceFile), 'utf8');
      const used = [...new Set([...content.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(match => match[1]))].sort();
      const declared = [...new Set([
        ...(template.requiredVariables || []),
        ...(template.optionalVariables || []),
      ])].sort();

      expect(declared, template.sourceFile).toEqual(used);
    }
  });

  it('keeps agent entry templates lightweight and fully rendered', () => {
    for (const templateName of ['agents.md']) {
      const content = readFileSync(join(ROOT, 'templates', templateName), 'utf8');
      expect(content).toContain('.loom/rules/constitution.md');
      expect(content).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    }
  });

  it('requires handoff and verification artifacts for low-risk pipelines', () => {
    const workflow = yaml.load(readFileSync(join(ROOT, 'templates', 'workflow.yaml'), 'utf8'));

    for (const pipelineName of ['hotfix', 'chore', 'quickfix']) {
      const executing = workflow.pipelines[pipelineName].steps.find(step => step.id === 'executing');
      const verification = workflow.pipelines[pipelineName].steps.find(step => step.id === 'verification');

      expect(executing?.outputs, pipelineName).toContain('handoffs/executing.json');
      expect(verification?.outputs, pipelineName).toContain('verify-report.md');
      expect(verification?.outputs, pipelineName).toContain('handoffs/verification.json');
    }
  });

  it('requires handoffs for PM prototype and QA non-gate stages', () => {
    const workflow = yaml.load(readFileSync(join(ROOT, 'templates', 'workflow.yaml'), 'utf8'));
    const expected = {
      'pm-prototype': {
        brainstorming: 'handoffs/brainstorming.json',
        prototype: 'handoffs/prototype.json'
      },
      qa: {
        'qa-analysis': 'handoffs/qa-analysis.json',
        'qa-design': 'handoffs/qa-design.json',
        'qa-execution': 'handoffs/qa-execution.json',
        'qa-report': 'handoffs/qa-report.json'
      }
    };

    for (const [pipelineName, stageOutputs] of Object.entries(expected)) {
      for (const [stageId, output] of Object.entries(stageOutputs)) {
        const step = workflow.pipelines[pipelineName].steps.find(s => s.id === stageId);
        expect(step?.outputs, `${pipelineName}.${stageId}`).toContain(output);
      }
    }
  });
});
