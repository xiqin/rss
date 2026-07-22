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

  it('keeps the feature workflow stages represented in pipeline.schema.json', () => {
    const workflow = yaml.load(readFileSync(join(ROOT, 'templates', 'workflow.yaml'), 'utf8'));
    const schema = JSON.parse(readFileSync(join(ROOT, 'config', 'pipeline.schema.json'), 'utf8'));
    const featureSteps = workflow.pipelines.feature.steps;

    for (const step of featureSteps) {
      expect(schema.states[step.id], `missing schema state for ${step.id}`).toBeTruthy();

      if (step.next) {
        expect(
          schema.states[step.id].allowedTransitions,
          `missing schema transition ${step.id} -> ${step.next}`,
        ).toContain(step.next);
      }
    }
  });

  it('keeps structured ledger artifacts in the default feature workflow', () => {
    const workflow = yaml.load(readFileSync(join(ROOT, 'templates', 'workflow.yaml'), 'utf8'));
    const schema = JSON.parse(readFileSync(join(ROOT, 'config', 'pipeline.schema.json'), 'utf8'));
    const featureSteps = Object.fromEntries(workflow.pipelines.feature.steps.map(step => [step.id, step]));

    expect(featureSteps.brainstorming.outputs).toContain('requirements.json');
    expect(featureSteps.planning.requires).toContain('requirements.json');
    expect(featureSteps.planning.outputs).toContain('traceability.json');
    expect(featureSteps.executing.requires).toContain('traceability.json');
    expect(featureSteps.executing.outputs).toContain('traceability.json');
    expect(featureSteps.verification.requires).toEqual(expect.arrayContaining([
      'requirements.json',
      'traceability.json'
    ]));

    const schemaOutputs = Object.fromEntries(
      Object.entries(schema.states).map(([id, state]) => [
        id,
        (state.outputs || []).map(output => output.path)
      ])
    );
    expect(schemaOutputs.brainstorming).toContain('specs/<date+feature>/requirements.json');
    expect(schemaOutputs.planning).toContain('specs/<date+feature>/traceability.json');
    expect(schemaOutputs.executing).toContain('specs/<date+feature>/traceability.json');
  });

  it('keeps step_catalog validators aligned with pipeline validators', () => {
    const workflow = yaml.load(readFileSync(join(ROOT, 'templates', 'workflow.yaml'), 'utf8'));
    const catalog = workflow.step_catalog || {};
    const catalogByStage = Object.fromEntries(
      Object.entries(catalog).map(([id, step]) => [id, step.validators || []])
    );

    const collected = new Map();
    for (const [type, pipeline] of Object.entries(workflow.pipelines || {})) {
      for (const step of pipeline.steps || []) {
        const declared = step.validators || [];
        const catalogValidators = catalogByStage[step.id] || [];
        for (const validator of declared) {
          collected.set(`${step.id}:${validator}`, {
            stage: step.id,
            validator,
            type,
            catalog: catalogValidators.includes(validator)
          });
        }
      }
    }

    const missing = [...collected.values()].filter(entry => !entry.catalog);
    expect(missing).toEqual([]);
  });

  it('keeps detail skills declared in step_catalog with mandatory flag', () => {
    const workflow = yaml.load(readFileSync(join(ROOT, 'templates', 'workflow.yaml'), 'utf8'));
    const catalog = workflow.step_catalog || {};
    const detailSkills = ['detail-expansion', 'analyze-artifacts', 'converge'];
    for (const id of detailSkills) {
      expect(catalog[id], `step_catalog should declare ${id}`).toBeDefined();
      expect(catalog[id].mandatory, `step_catalog.${id} should be mandatory`).toBe(true);
      expect(catalog[id].skill, `step_catalog.${id} should have skill`).toBe(`loom-${id.replace('-', '-')}`);
      expect(catalog[id].validators, `step_catalog.${id} should declare validators`).toBeDefined();
    }
    const convergeDesc = String(catalog.converge?.description || '');
    expect(convergeDesc, 'converge description should reference omission-hunter').toContain('omission-hunter');
  });

  it('documents structured requirement dimensions in the brainstorming template', () => {
    const skill = readFileSync(join(ROOT, 'skills', 'loom-brainstorming', 'SKILL.md'), 'utf8');
    const template = readFileSync(join(ROOT, 'skills', 'loom-brainstorming', 'assets', 'spec-template.md'), 'utf8');

    for (const token of ['requirements.json', 'types', 'required_categories', 'behaviors']) {
      expect(skill, `loom-brainstorming SKILL.md should mention ${token}`).toContain(token);
      expect(template, `spec-template.md should mention ${token}`).toContain(token);
    }

    for (const category of ['happy-path', 'invalid-input', 'authorization', 'atomicity', 'observability']) {
      expect(template, `spec-template.md should mention ${category}`).toContain(category);
    }
  });

  it('documents traceability ledger output in the planning templates', () => {
    const skill = readFileSync(join(ROOT, 'skills', 'loom-writing-plans', 'SKILL.md'), 'utf8');
    const planTemplate = readFileSync(join(ROOT, 'skills', 'loom-writing-plans', 'assets', 'plan-template.md'), 'utf8');
    const taskTemplate = readFileSync(join(ROOT, 'skills', 'loom-writing-plans', 'assets', 'task-template.md'), 'utf8');

    for (const token of ['requirements.json', 'traceability.json', 'behaviors']) {
      expect(skill, `loom-writing-plans SKILL.md should mention ${token}`).toContain(token);
      expect(planTemplate, `plan-template.md should mention ${token}`).toContain(token);
    }

    for (const token of ['behavior_ids', 'REQ-001-B01']) {
      expect(taskTemplate, `task-template.md should mention ${token}`).toContain(token);
    }
  });

  it('documents behavior-level traceability updates in the execution prompts', () => {
    const skill = readFileSync(join(ROOT, 'skills', 'loom-subagent-driven-development', 'SKILL.md'), 'utf8');
    const implementer = readFileSync(join(ROOT, 'skills', 'loom-subagent-driven-development', 'implementer-prompt.md'), 'utf8');
    const reviewer = readFileSync(join(ROOT, 'skills', 'loom-subagent-driven-development', 'combined-reviewer-prompt.md'), 'utf8');
    const reporter = readFileSync(join(ROOT, 'skills', 'loom-subagent-driven-development', 'test-reporter-prompt.md'), 'utf8');

    for (const token of ['traceability.json', 'behavior_ids', 'tests', 'evidence']) {
      expect(skill, `loom-subagent-driven-development SKILL.md should mention ${token}`).toContain(token);
    }

    for (const prompt of [implementer, reviewer, reporter]) {
      expect(prompt).toContain('traceability.json');
      expect(prompt).toContain('behavior_ids');
    }
  });

  it('exposes structured ledger CLI scripts and documents them in README', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

    expect(pkg.scripts['requirements:generate']).toBe('node scripts/requirements-json.mjs generate');
    expect(pkg.scripts['requirements:check']).toBe('node scripts/requirements-json.mjs check');
    expect(pkg.scripts['traceability:generate']).toBe('node scripts/traceability-json.mjs generate');
    expect(pkg.scripts['traceability:check']).toBe('node scripts/traceability-json.mjs check');

    for (const token of ['requirements.json', 'traceability.json', 'requirements:generate', 'traceability:check']) {
      expect(readme, `README.md should mention ${token}`).toContain(token);
    }
  });

  it('ships JSON schemas for the structured ledger and receipts', () => {
    const schemaNames = [
      'requirements.schema.json',
      'traceability.schema.json',
      'receipt.schema.json',
      'finding.schema.json',
    ];
    for (const name of schemaNames) {
      const path = join(ROOT, 'config', name);
      const schema = JSON.parse(readFileSync(path, 'utf8'));
      expect(schema.$schema, `${name} should declare $schema`).toMatch(/^http:\/\/json-schema\.org\//);
      expect(schema.title, `${name} should declare title`).toBeTruthy();
      expect(schema.type, `${name} should declare type`).toBeTruthy();
    }

    const requirementsSchema = JSON.parse(readFileSync(join(ROOT, 'config', 'requirements.schema.json'), 'utf8'));
    expect(requirementsSchema.definitions.behavior.properties.category.enum).toContain('forbidden-behavior');
    expect(requirementsSchema.definitions.behavior.properties.id.pattern).toBe('^REQ-\\d{3,}-B\\d{2,}$');

    const traceabilitySchema = JSON.parse(readFileSync(join(ROOT, 'config', 'traceability.schema.json'), 'utf8'));
    expect(traceabilitySchema.definitions.traceabilityEntry.required).toEqual(['id', 'tasks', 'tests', 'evidence']);

    const receiptSchema = JSON.parse(readFileSync(join(ROOT, 'config', 'receipt.schema.json'), 'utf8'));
    expect(receiptSchema.properties.kind.enum).toContain('evaluation');
    expect(receiptSchema.properties.git_tree.pattern).toBe('^[a-f0-9]{40}$');

    const findingSchema = JSON.parse(readFileSync(join(ROOT, 'config', 'finding.schema.json'), 'utf8'));
    expect(findingSchema.definitions.finding.properties.kind.enum).toContain('missing');
    expect(findingSchema.definitions.finding.properties.severity.enum).toContain('blocker');
  });
});
