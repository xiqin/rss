import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeToolCall, readMcpResource, TOOL_DEFINITIONS } from '../../src/mcp/tools.js';
import { SessionStore } from '../../src/mcp/session-store.js';
import { listVisibleTools } from '../../src/mcp/server.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'loom-mcp-')); }

describe('MCP tool definitions', () => {
  it('exposes the documented tools incl. context + capabilities', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(21);
    const names = TOOL_DEFINITIONS.map(t => t.name);
    expect(names).toContain('loom_attach_spec');
    expect(names).toContain('loom_get_context');
    expect(names).toContain('loom_list_capabilities');
    expect(names).toContain('loom_load_tool_group');
    expect(names).toContain('loom_get_skill_context');
    expect(names).toContain('loom_select_pipeline');
    expect(names).toContain('loom_adjust_pipeline');
    expect(names).toContain('loom_write_handoff');
    expect(names).toContain('loom_stage_checkpoint');
    expect(names).toContain('loom_detail_expansion_check');
    expect(names).toContain('loom_analyze_artifacts');
    expect(names).toContain('loom_converge');
    expect(names).toContain('loom_omission_hunt');
  });

  it('every tool carries a group tag for capability grouping', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(typeof t.group).toBe('string');
      expect(t.group.length).toBeGreaterThan(0);
    }
  });

  it('every tool carries security annotations and loom risk metadata', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.annotations).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
      expect(['low', 'medium', 'high']).toContain(t.loom.risk);
      expect(Array.isArray(t.loom.effects)).toBe(true);
      expect(Array.isArray(t.loom.writes)).toBe(true);
    }
  });

  it('marks read-only tools and approval-sensitive tools explicitly', () => {
    const getContext = TOOL_DEFINITIONS.find(t => t.name === 'loom_get_context');
    const approveGate = TOOL_DEFINITIONS.find(t => t.name === 'loom_approve_gate');
    const adjustPipeline = TOOL_DEFINITIONS.find(t => t.name === 'loom_adjust_pipeline');

    expect(getContext.annotations.readOnlyHint).toBe(true);
    expect(getContext.loom.writes).toEqual([]);
    expect(approveGate.loom.requiresUserConfirmation).toBe(true);
    expect(adjustPipeline.loom.risk).toBe('high');
  });

  it('memory tools expose project_root in their schemas', () => {
    const getMemory = TOOL_DEFINITIONS.find(t => t.name === 'loom_get_memory');
    const addMemory = TOOL_DEFINITIONS.find(t => t.name === 'loom_add_memory');

    expect(getMemory.inputSchema.properties.project_root).toBeDefined();
    expect(addMemory.inputSchema.properties.project_root).toBeDefined();
  });

  it('memory tools expose structured knowledge metadata fields', () => {
    const getMemory = TOOL_DEFINITIONS.find(t => t.name === 'loom_get_memory');
    const addMemory = TOOL_DEFINITIONS.find(t => t.name === 'loom_add_memory');

    for (const field of ['tag', 'scope', 'stage', 'file', 'spec_dir', 'task', 'include_expired']) {
      expect(getMemory.inputSchema.properties[field]).toBeDefined();
    }
    for (const field of ['source', 'confidence', 'scope', 'expires_at', 'spec_dir', 'pr', 'commit', 'task', 'handoff', 'stage', 'files']) {
      expect(addMemory.inputSchema.properties[field]).toBeDefined();
    }
  });

  it('write_handoff schema restricts status values', () => {
    const tool = TOOL_DEFINITIONS.find(t => t.name === 'loom_write_handoff');
    expect(tool.inputSchema.properties.status.enum).toEqual(['done', 'partial', 'blocked', 'failed']);
  });
});

describe('lazy MCP tool listing', () => {
  it('loads tool groups before attach and preserves them after attach', async () => {
    const root = tmp();
    const store = new SessionStore();
    const sessionId = 's-lazy';

    const initial = listVisibleTools(store, sessionId, { lazyEnabled: true }).map(t => t.name);
    expect(initial).toEqual(['loom_list_capabilities', 'loom_load_tool_group', 'loom_telemetry']);

    const loaded = await executeToolCall('loom_load_tool_group', { group: 'pipeline' }, store, sessionId);
    expect(loaded.ok).toBe(true);

    const afterLoad = listVisibleTools(store, sessionId, { lazyEnabled: true }).map(t => t.name);
    expect(afterLoad).toContain('loom_get_project_status');
    expect(afterLoad).not.toContain('loom_get_context');

    await executeToolCall('loom_attach_spec', { spec_dir: join(root, 'specs', 'x'), project_root: root }, store, sessionId);
    const afterAttach = listVisibleTools(store, sessionId, { lazyEnabled: true }).map(t => t.name);
    expect(afterAttach).toContain('loom_get_project_status');
  });

  it('exposes every tool when lazy loading is disabled', () => {
    const store = new SessionStore();
    const tools = listVisibleTools(store, 's-full', { lazyEnabled: false });
    const names = tools.map(t => t.name);
    expect(names).toEqual(TOOL_DEFINITIONS.map(t => t.name));
    expect(tools.find(t => t.name === 'loom_get_context').annotations.readOnlyHint).toBe(true);
    expect(tools.find(t => t.name === 'loom_adjust_pipeline').loom.risk).toBe('high');
  });
});

describe('loom_list_capabilities (② virtual-skill grouping)', () => {
  it('returns grouped catalog and hides retrieval group without codegraph', async () => {
    const root = tmp();
    const store = new SessionStore();
    const r = await executeToolCall('loom_list_capabilities', { project_root: root }, store, 's1');
    expect(r.codegraph_available).toBe(false);
    const groups = r.groups.map(g => g.group);
    expect(groups).toContain('context');
    expect(groups).toContain('pipeline');
    expect(groups).not.toContain('retrieval');
  });

  it('exposes retrieval group when .codegraph/ exists', async () => {
    const root = tmp();
    mkdirSync(join(root, '.codegraph'), { recursive: true });
    const store = new SessionStore();
    const r = await executeToolCall('loom_list_capabilities', { project_root: root }, store, 's1');
    expect(r.codegraph_available).toBe(true);
    expect(r.groups.map(g => g.group)).toContain('retrieval');
  });
});

describe('loom_get_context (① progressive disclosure)', () => {
  function seedConstitution(root) {
    const rulesDir = join(root, '.loom', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'constitution.md'),
      '# 项目宪章\n\n## 核心原则\n分层架构。\n\n## 编码红线\n禁止硬编码。\n');
  }

  it('returns outline (L0) when no section given', async () => {
    const root = tmp();
    seedConstitution(root);
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_context', { doc: 'constitution', project_root: root }, store, 's1');
    expect(r.title).toBe('项目宪章');
    expect(r.sections.map(s => s.title)).toEqual(['核心原则', '编码红线']);
    expect(r.sections.every(s => typeof s.tokens === 'number')).toBe(true);
    expect(r.content).toBeUndefined();
  });

  it('returns a single section full text (L1) when section given', async () => {
    const root = tmp();
    seedConstitution(root);
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_context', { doc: 'constitution', section: '编码红线', project_root: root }, store, 's1');
    expect(r.title).toBe('编码红线');
    expect(r.content).toContain('禁止硬编码');
  });

  it('errors with available_sections on unknown section', async () => {
    const root = tmp();
    seedConstitution(root);
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_context', { doc: 'constitution', section: '不存在', project_root: root }, store, 's1');
    expect(r.error).toMatch(/not found/);
    expect(r.available_sections).toContain('核心原则');
  });

  it('errors when doc file missing', async () => {
    const root = tmp();
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_context', { doc: 'constitution', project_root: root }, store, 's1');
    expect(r.error).toMatch(/not found/);
  });

  it('auto-falls back to full when doc has no ## sections (L0)', async () => {
    const root = tmp();
    const rulesDir = join(root, '.loom', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'constitution.md'), '# 宪章\n\n全部正文都在这里，没有二级标题。\n');
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_context', { doc: 'constitution', project_root: root }, store, 's1');
    expect(r.fallback).toBe('no-sections');
    expect(r.content).toContain('全部正文都在这里');
    expect(r.sections).toBeUndefined();
  });

  it('auto-falls back to full when requesting a section in an unstructured doc', async () => {
    const root = tmp();
    const rulesDir = join(root, '.loom', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'constitution.md'), '# 宪章\n\n没有分节。\n');
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_context', { doc: 'constitution', section: '任意', project_root: root }, store, 's1');
    expect(r.fallback).toBe('no-sections');
    expect(r.content).toContain('没有分节');
  });

  it('full:true returns whole raw file (fallback)', async () => {
    const root = tmp();
    seedConstitution(root);
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_context', { doc: 'constitution', full: true, project_root: root }, store, 's1');
    expect(r.content).toContain('# 项目宪章');
    expect(r.content).toContain('核心原则');
    expect(r.content).toContain('编码红线');
  });

  it('LOOM_CONTEXT_FULL env forces whole file over outline', async () => {
    const root = tmp();
    seedConstitution(root);
    const store = new SessionStore();
    process.env.LOOM_CONTEXT_FULL = '1';
    try {
      const r = await executeToolCall('loom_get_context', { doc: 'constitution', project_root: root }, store, 's1');
      expect(r.content).toContain('# 项目宪章');
      expect(r.sections).toBeUndefined();
    } finally {
      delete process.env.LOOM_CONTEXT_FULL;
    }
  });
});

describe('MCP resources/read', () => {
  it('reads context and memory resources as MCP contents', () => {
    const root = tmp();
    const rulesDir = join(root, '.loom', 'rules');
    const memoryDir = join(root, '.loom', 'memory');
    mkdirSync(rulesDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(rulesDir, 'constitution.md'), '# 宪章\n\n## 原则\n保持简单。\n');
    writeFileSync(join(memoryDir, 'MEMORY.md'), '# 记忆\n\n## 决策\n使用 JSON 文件持久化。\n');

    const store = new SessionStore();
    const constitution = readMcpResource('loom://context/constitution', store, 's1', { projectRoot: root });
    const memory = readMcpResource('loom://memory', store, 's1', { projectRoot: root });

    expect(constitution.contents).toHaveLength(1);
    expect(constitution.contents[0]).toMatchObject({
      uri: 'loom://context/constitution',
      mimeType: 'text/markdown',
    });
    expect(constitution.contents[0].text).toContain('保持简单');
    expect(memory.contents[0].text).toContain('使用 JSON 文件持久化');
  });

  it('reads the skill catalog as JSON', () => {
    const store = new SessionStore();
    const result = readMcpResource('loom://skills/catalog', store, 's1');
    const parsed = JSON.parse(result.contents[0].text);

    expect(result.contents[0]).toMatchObject({
      uri: 'loom://skills/catalog',
      mimeType: 'application/json',
    });
    expect(parsed.skills.map(s => s.name)).toContain('loom-using-loom');
  });

  it('rejects missing or unknown resource uri', () => {
    const store = new SessionStore();
    expect(() => readMcpResource('', store, 's1')).toThrow(/Missing resource uri/);
    expect(() => readMcpResource('loom://unknown', store, 's1')).toThrow(/Unknown resource uri/);
  });

  it('reads encoded spec state, progress, and handoff resources', () => {
    const root = tmp();
    const specDir = join(root, 'specs', '2026-07-07+demo');
    const handoffsDir = join(specDir, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(join(specDir, 'pipeline.state.json'), '{"current_stage":"planning"}\n');
    writeFileSync(join(specDir, 'progress.md'), '# Progress\n\n- planning\n');
    writeFileSync(join(handoffsDir, 'planning.json'), '{"status":"done"}\n');

    const store = new SessionStore();
    const encodedSpec = encodeURIComponent('specs/2026-07-07+demo');
    const state = readMcpResource(`loom://spec/${encodedSpec}/state`, store, 's1', { projectRoot: root });
    const progress = readMcpResource(`loom://spec/${encodedSpec}/progress`, store, 's1', { projectRoot: root });
    const handoff = readMcpResource(`loom://spec/${encodedSpec}/handoffs/planning`, store, 's1', { projectRoot: root });

    expect(state.contents[0]).toMatchObject({ mimeType: 'application/json' });
    expect(state.contents[0].text).toContain('planning');
    expect(progress.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    expect(progress.contents[0].text).toContain('# Progress');
    expect(handoff.contents[0].text).toContain('done');
  });

  it('rejects unsafe spec and handoff resource paths', () => {
    const root = tmp();
    const store = new SessionStore();
    const escapedSpec = encodeURIComponent('../outside');
    const validSpec = encodeURIComponent('specs/demo');

    expect(() => readMcpResource(`loom://spec/${escapedSpec}/state`, store, 's1', { projectRoot: root }))
      .toThrow(/escapes project root/);
    expect(() => readMcpResource(`loom://spec/${validSpec}/handoffs/..%2Fevil`, store, 's1', { projectRoot: root }))
      .toThrow(/Invalid resource id/);
  });
});

describe('path sandboxing', () => {
  it('rejects spec_dir escaping project root', async () => {
    const root = tmp();
    const store = new SessionStore();
    await expect(
      executeToolCall('loom_get_pipeline_context', { spec_dir: '../../etc', project_root: root }, store, 's1')
    ).rejects.toThrow(/escapes project root/);
  });

  it('rejects project root as spec_dir', async () => {
    const root = tmp();
    const store = new SessionStore();
    await expect(
      executeToolCall('loom_get_pipeline_context', { spec_dir: '.', project_root: root }, store, 's1')
    ).rejects.toThrow(/points at project root/);
  });

  it('rejects escape via update_task_state too', async () => {
    const root = tmp();
    const store = new SessionStore();
    await expect(
      executeToolCall('loom_update_task_state',
        { spec_dir: '../../../tmp/evil', task_id: 'T1', status: 'done', project_root: root },
        store, 's1')
    ).rejects.toThrow(/escapes project root/);
  });

  it('rejects unsafe task ids and invalid statuses', async () => {
    const root = tmp();
    const specDir = join(root, 'specs', 'x');
    mkdirSync(specDir, { recursive: true });
    const store = new SessionStore();

    await expect(
      executeToolCall('loom_update_task_state',
        { spec_dir: 'specs/x', task_id: '../evil', status: 'done', project_root: root },
        store, 's1')
    ).rejects.toThrow(/Invalid task id/);

    await expect(
      executeToolCall('loom_update_task_state',
        { spec_dir: 'specs/x', task_id: 'T1', status: 'almost-done', project_root: root },
        store, 's1')
    ).rejects.toThrow(/Invalid task status/);
  });

  it('rejects escape via write_handoff too', async () => {
    const root = tmp();
    const store = new SessionStore();
    await expect(
      executeToolCall('loom_write_handoff',
        { spec_dir: '../../../tmp/evil', stage: 'planning', summary: 'x', project_root: root },
        store, 's1')
    ).rejects.toThrow(/escapes project root/);
  });

  it('rejects invalid handoff statuses', async () => {
    const root = tmp();
    const specDir = join(root, 'specs', 'x');
    mkdirSync(specDir, { recursive: true });
    const store = new SessionStore();

    await expect(
      executeToolCall('loom_write_handoff',
        { spec_dir: 'specs/x', stage: 'planning', status: 'almost-done', project_root: root },
        store, 's1')
    ).rejects.toThrow(/Invalid handoff status/);
  });
});

describe('happy path', () => {
  it('attach + project status', async () => {
    const root = tmp();
    mkdirSync(join(root, 'specs'), { recursive: true });
    const store = new SessionStore();
    const att = await executeToolCall('loom_attach_spec',
      { spec_dir: join(root, 'specs', 'x'), project_root: root }, store, 's1');
    expect(att.ok).toBe(true);
    const status = await executeToolCall('loom_get_project_status', {}, store, 's1');
    expect(status.project_root).toBe(root);
    expect(Array.isArray(status.pipelines)).toBe(true);
  });

  it('project status limits summary output by default', async () => {
    const root = tmp();
    mkdirSync(join(root, 'specs'), { recursive: true });
    const store = new SessionStore();

    for (const name of ['a', 'b', 'c']) {
      const specDir = join(root, 'specs', name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, 'pipeline.state.json'), JSON.stringify({
        spec_dir: specDir,
        pipeline_type: 'feature',
        current_stage: 'executing',
        started_at: `2026-01-0${name.charCodeAt(0) - 96}T00:00:00.000Z`,
        updated_at: `2026-01-0${name.charCodeAt(0) - 96}T00:00:00.000Z`,
        stage_history: [],
        metadata: {}
      }), 'utf-8');
    }

    const status = await executeToolCall('loom_get_project_status', { project_root: root, limit: 2 }, store, 's1');
    expect(status.detail).toBe('summary');
    expect(status.total_pipelines).toBe(3);
    expect(status.returned_pipelines).toBe(2);
    expect(status.truncated).toBe(true);
    expect(status.omitted_pipelines).toBe(1);
    expect(status.pipelines[0].tasks).toBeUndefined();
  });

  it('project status respects limit in full detail mode', async () => {
    const root = tmp();
    mkdirSync(join(root, 'specs'), { recursive: true });
    const store = new SessionStore();

    for (const name of ['a', 'b', 'c']) {
      const specDir = join(root, 'specs', name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, 'pipeline.state.json'), JSON.stringify({
        spec_dir: specDir,
        pipeline_type: 'feature',
        current_stage: 'executing',
        started_at: `2026-01-0${name.charCodeAt(0) - 96}T00:00:00.000Z`,
        updated_at: `2026-01-0${name.charCodeAt(0) - 96}T00:00:00.000Z`,
        stage_history: [],
        metadata: {}
      }), 'utf-8');
    }

    const status = await executeToolCall('loom_get_project_status', { project_root: root, detail: 'full', limit: 2 }, store, 's1');
    expect(status.detail).toBe('full');
    expect(status.total_pipelines).toBe(3);
    expect(status.returned_pipelines).toBe(2);
    expect(status.truncated).toBe(true);
    expect(status.omitted_pipelines).toBe(1);
    expect(status.pipelines[0].pipeline).toBeDefined();
  });

  it('update_task_state writes within sandbox', async () => {
    const root = tmp();
    const specDir = join(root, 'specs', 'x');
    mkdirSync(specDir, { recursive: true });
    const store = new SessionStore();
    const r = await executeToolCall('loom_update_task_state',
      { spec_dir: 'specs/x', task_id: 'T1', status: 'executing', project_root: root },
      store, 's1');
    expect(r.ok).toBe(true);
    expect(r.task.status).toBe('executing');
  });

  it('write_handoff writes a stage handoff and refreshes progress', async () => {
    const root = tmp();
    const specDir = join(root, 'specs', 'x');
    mkdirSync(specDir, { recursive: true });
    const store = new SessionStore();
    await executeToolCall('loom_attach_spec', { spec_dir: 'specs/x', project_root: root }, store, 's1');

    const r = await executeToolCall('loom_write_handoff', {
      stage: 'planning',
      status: 'done',
      summary: '计划完成',
      artifacts: ['plan.md', 'tasks/']
    }, store, 's1');

    expect(r.ok).toBe(true);
    expect(r.path).toBe('handoffs/planning.json');
    expect(r.next_required_action).toMatch(/compress closed-stage raw context/);
    expect(r.handoff).toMatchObject({ stage: 'planning', task_id: 'planning', summary: '计划完成' });
    const progress = readFileSync(join(specDir, 'progress.md'), 'utf-8');
    expect(progress).toContain('## Handoffs');
    expect(progress).toContain('计划完成');
  });

  it('stage_checkpoint writes handoff and returns compact context', async () => {
    const root = tmp();
    mkdirSync(join(root, '.loom'), { recursive: true });
    writeFileSync(join(root, '.loom', 'workflow.yaml'), `
defaults:
  pipeline_type: feature
pipelines:
  feature:
    steps:
      - id: planning
        skill: loom-writing-plans
        next: executing
        outputs: [plan.md, handoffs/planning.json]
      - id: executing
        skill: loom-subagent-driven-development
        requires: [plan.md]
        outputs: []
`, 'utf-8');
    const specDir = join(root, 'specs', 'checkpoint');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'pipeline.state.json'), JSON.stringify({
      spec_dir: specDir,
      pipeline_type: 'feature',
      current_stage: 'planning',
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      stage_history: [],
      metadata: {}
    }), 'utf-8');
    writeFileSync(join(specDir, 'spec.md'), '# spec', 'utf-8');
    writeFileSync(join(specDir, 'plan.md'), '# plan', 'utf-8');

    const store = new SessionStore();
    const r = await executeToolCall('loom_stage_checkpoint', {
      spec_dir: 'specs/checkpoint',
      project_root: root,
      stage: 'planning',
      summary: '计划完成',
      artifacts: ['plan.md'],
      advance: true
    }, store, 's1');

    expect(r.ok).toBe(true);
    expect(r.path).toBe('handoffs/planning.json');
    expect(r.handoff_summary).toMatchObject({ stage: 'planning', summary: '计划完成' });
    expect(r.advance).toMatchObject({
      ok: false,
      skipped: true,
      compression_required: true,
      required_action: 'compress_closed_stage_context'
    });
    expect(r.context.detail).toBe('summary');
    expect(r.context.handoffs_summary.length).toBeLessThanOrEqual(5);
    expect(r.context.current_stage).toBe('planning');
    expect(r.next_required_action).toMatch(/compression_confirmed=true/);
  });

  it('advance requires compression confirmation after a stage handoff', async () => {
    const root = tmp();
    mkdirSync(join(root, '.loom'), { recursive: true });
    writeFileSync(join(root, '.loom', 'workflow.yaml'), `
defaults:
  pipeline_type: feature
pipelines:
  feature:
    steps:
      - id: planning
        skill: loom-writing-plans
        next: executing
        outputs: [plan.md, handoffs/planning.json]
      - id: executing
        skill: loom-subagent-driven-development
        requires: [plan.md]
        outputs: []
`, 'utf-8');
    const specDir = join(root, 'specs', 'advance-compress');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'pipeline.state.json'), JSON.stringify({
      spec_dir: specDir,
      pipeline_type: 'feature',
      current_stage: 'planning',
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      stage_history: [],
      metadata: {}
    }), 'utf-8');
    writeFileSync(join(specDir, 'plan.md'), '# plan', 'utf-8');

    const store = new SessionStore();
    await executeToolCall('loom_write_handoff', {
      spec_dir: 'specs/advance-compress',
      project_root: root,
      stage: 'planning',
      summary: '计划完成',
      artifacts: ['plan.md']
    }, store, 's1');

    const blocked = await executeToolCall('loom_advance_pipeline', {
      spec_dir: 'specs/advance-compress',
      project_root: root
    }, store, 's1');
    expect(blocked).toMatchObject({
      ok: false,
      compression_required: true,
      required_action: 'compress_closed_stage_context'
    });

    const advanced = await executeToolCall('loom_advance_pipeline', {
      spec_dir: 'specs/advance-compress',
      project_root: root,
      compression_confirmed: true
    }, store, 's1');
    expect(advanced).toMatchObject({ ok: true, from: 'planning', to: 'executing' });
  });

  it('stage_checkpoint rejects checkpoints for non-current stage', async () => {
    const root = tmp();
    mkdirSync(join(root, '.loom'), { recursive: true });
    writeFileSync(join(root, '.loom', 'workflow.yaml'), `
defaults:
  pipeline_type: feature
pipelines:
  feature:
    steps:
      - id: planning
        skill: loom-writing-plans
        next: executing
        outputs: []
      - id: executing
        skill: loom-subagent-driven-development
        outputs: []
`, 'utf-8');
    const specDir = join(root, 'specs', 'checkpoint-mismatch');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'pipeline.state.json'), JSON.stringify({
      spec_dir: specDir,
      pipeline_type: 'feature',
      current_stage: 'planning',
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      stage_history: [],
      metadata: {}
    }), 'utf-8');

    const store = new SessionStore();
    const r = await executeToolCall('loom_stage_checkpoint', {
      spec_dir: 'specs/checkpoint-mismatch',
      project_root: root,
      stage: 'executing',
      summary: '错误阶段',
      advance: true
    }, store, 's1');

    expect(r.error).toMatch(/does not match current stage/);
    expect(existsSync(join(specDir, 'handoffs', 'executing.json'))).toBe(false);
  });
});

describe('loom_get_skill_context', () => {
  it('returns essentials by default for a single skill', async () => {
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_skill_context', { skill: 'brainstorming' }, store, 's1');

    expect(r.level).toBe('L0.5');
    expect(r.name).toBe('loom-brainstorming');
    expect(r.sections.length).toBeGreaterThan(0);
    expect(r.content).toBeUndefined();
    expect(r.read_hints.full).toContain('full: true');
  });

  it('returns full skill only when full:true is passed', async () => {
    const store = new SessionStore();
    const r = await executeToolCall('loom_get_skill_context', { skill: 'brainstorming', full: true }, store, 's1');

    expect(r.level).toBe('L1');
    expect(r.content).toContain('#');
    expect(r.tokens).toBeGreaterThan(0);
  });
});

describe('loom_select_pipeline tool', () => {
  function setupProjectRoot() {
    const root = tmp();
    mkdirSync(join(root, '.loom'), { recursive: true });
    copyFileSync(
      join(process.cwd(), 'templates', 'workflow.yaml'),
      join(root, '.loom', 'workflow.yaml')
    );
    return root;
  }

  it('short-circuits for typo request without initializing', async () => {
    const root = setupProjectRoot();
    const store = new SessionStore();
    const r = await executeToolCall('loom_select_pipeline',
      { request: '修复 README 的 typo', project_root: root },
      store, 's1');
    expect(r.source).toBe('short-circuit:quickfix');
    const ids = r.steps.map(s => s.id);
    expect(ids).toEqual(['executing', 'verification']);
    const statePath = join(root, 'specs', 'x', 'pipeline.state.json');
    expect(existsSync(statePath)).toBe(false);
  });

  it('initializes with dynamic_steps when initialize=true', async () => {
    const root = setupProjectRoot();
    const specDir = join(root, 'specs', 'feat');
    mkdirSync(specDir, { recursive: true });
    const store = new SessionStore();
    const r = await executeToolCall('loom_select_pipeline',
      { request: '重构状态管理，跨模块改动', spec_dir: 'specs/feat', project_root: root, initialize: true },
      store, 's1');
    expect(r.initialized).toBe(true);
    expect(r.state.dynamic_steps).toBeDefined();
    expect(r.state.dynamic_steps.length).toBeGreaterThan(0);
  });

  it('errors on missing request', async () => {
    const root = setupProjectRoot();
    const store = new SessionStore();
    const r = await executeToolCall('loom_select_pipeline',
      { project_root: root },
      store, 's1');
    expect(r.error).toMatch(/request is required/);
  });
});

describe('loom_detail_expansion_check / loom_analyze_artifacts / loom_converge / loom_omission_hunt tools', () => {
  function setupSpecDir() {
    const root = tmp();
    const specDir = join(root, 'specs', 'feat');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'spec.md'), '# Spec\n## REQ-001 Login\n');
    writeFileSync(join(specDir, 'requirements.json'), JSON.stringify({
      requirements: [{
        id: 'REQ-001',
        status: 'failing',
        types: ['functional', 'input'],
        required_categories: ['happy-path', 'invalid-input'],
        acceptance: ['User can log in'],
        behaviors: [
          { id: 'REQ-001-B01', category: 'happy-path', description: 'valid login returns a token for accepted credentials', status: 'failing', acceptance: ['returns token'], test_plan: { strategy: 'unit', inputs: ['valid creds'], expected: ['token'], coverage_target: '100%' } },
          { id: 'REQ-001-B02', category: 'invalid-input', description: 'invalid password is rejected with an authorization error', status: 'failing', acceptance: ['rejects'], test_plan: { strategy: 'unit', inputs: ['bad pw'], expected: ['401'], coverage_target: '100%' } },
        ],
      }],
    }, null, 2));
    mkdirSync(join(specDir, 'tasks'));
    writeFileSync(join(specDir, 'tasks', 'T1.md'), '---\nowns: [src/auth.js]\nreads: []\ndepends_on: []\nrequirements: [REQ-001]\nbehavior_ids: [REQ-001-B01, REQ-001-B02]\ncomplexity: medium\n---\n# T1 Login\n');
    writeFileSync(join(specDir, 'plan.md'), '# Plan\n- T1 Login: tasks/T1.md\n');
    return { root, specDir };
  }

  it('detail_expansion_check passes when required categories + test_plan present', async () => {
    const { root, specDir } = setupSpecDir();
    const store = new SessionStore();
    await executeToolCall('loom_attach_spec', { spec_dir: specDir, project_root: root }, store, 's1');
    const r = await executeToolCall('loom_detail_expansion_check', {}, store, 's1');
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('analyze_artifacts passes when spec/requirements/plan/tasks/traceability are consistent', async () => {
    const { root, specDir } = setupSpecDir();
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T1'],
          tests: [],
          evidence: [],
          behaviors: {
            'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] },
            'REQ-001-B02': { tasks: ['T1'], tests: [], evidence: [] },
          },
        },
      },
    }, null, 2));
    const store = new SessionStore();
    await executeToolCall('loom_attach_spec', { spec_dir: specDir, project_root: root }, store, 's1');
    const r = await executeToolCall('loom_analyze_artifacts', {}, store, 's1');
    expect(r.ok).toBe(true);
    expect(r.report.status).toBe('pass');
    expect(existsSync(join(specDir, 'artifact-analysis.json'))).toBe(true);
  });

  it('converge reports needs_another_round when behavior tests/evidence missing', async () => {
    const { root, specDir } = setupSpecDir();
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T1'],
          tests: [],
          evidence: [],
          behaviors: {
            'REQ-001-B01': { tasks: ['T1'], tests: [], evidence: [] },
            'REQ-001-B02': { tasks: ['T1'], tests: [], evidence: [] },
          },
        },
      },
    }, null, 2));
    const store = new SessionStore();
    await executeToolCall('loom_attach_spec', { spec_dir: specDir, project_root: root }, store, 's1');
    const r = await executeToolCall('loom_converge', { round: 1 }, store, 's1');
    expect(r.ok).toBe(false);
    expect(r.report.status).toBe('needs_another_round');
    expect(existsSync(join(specDir, 'convergence-report.json'))).toBe(true);
  });

  it('omission_hunt blocks when behavior test references missing files', async () => {
    const { root, specDir } = setupSpecDir();
    writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
      requirements: {
        'REQ-001': {
          tasks: ['T1'],
          tests: [],
          evidence: [],
          behaviors: {
            'REQ-001-B01': { tasks: ['T1'], tests: ['tests/missing.test.js'], evidence: [] },
            'REQ-001-B02': { tasks: ['T1'], tests: [], evidence: [] },
          },
        },
      },
    }, null, 2));
    const store = new SessionStore();
    await executeToolCall('loom_attach_spec', { spec_dir: specDir, project_root: root }, store, 's1');
    const r = await executeToolCall('loom_omission_hunt', {}, store, 's1');
    expect(r.ok).toBe(false);
    expect(r.report.status).toBe('blocked');
    expect(existsSync(join(specDir, 'findings', 'omission-hunter.json'))).toBe(true);
  });
});
