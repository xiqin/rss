import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectPlatform,
  loadHooks,
  findHook,
  supportsPlatform,
  withTimeout,
  runHook,
  flattenHooks,
  listHooksForEvent,
  runHookEvent,
} from '../../hooks/run-hook.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'loom-hook-test-'));
}

function writeHandler(dir, code) {
  writeFileSync(join(dir, 'handlers', 'test.cjs'), code);
}

describe('detectPlatform', () => {
  it('returns a known platform string', () => {
    const p = detectPlatform();
    expect(['linux', 'macos', 'windows']).toContain(p);
  });
});

describe('loadHooks', () => {
  it('loads hooks.json from directory', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs' },
    ]));
    const hooks = loadHooks(dir);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].id).toBe('test');
  });

  it('throws on missing hooks.json', () => {
    expect(() => loadHooks('/nonexistent')).toThrow();
  });
});

describe('findHook', () => {
  const hooks = [
    { id: 'session-start', entry: 'handlers/session-start.cjs' },
    { id: 'pre-commit', entry: 'handlers/pre-commit.cjs' },
  ];

  it('finds hook by id', () => {
    expect(findHook(hooks, 'session-start')).toEqual(hooks[0]);
  });

  it('returns null for missing id', () => {
    expect(findHook(hooks, 'nonexistent')).toBeNull();
  });
});

describe('event hook registry', () => {
  const registry = {
    SessionStart: [
      { id: 'session-start', entry: 'handlers/session-start.cjs' },
      { id: 'audit-session', entry: 'handlers/audit.cjs', event: 'CustomSessionStart' },
    ],
    PreToolUse: [
      { id: 'pre-tool-use', entry: 'handlers/pre-tool-use.cjs' },
    ],
  };

  it('flattens event-indexed hooks and preserves event names', () => {
    const hooks = flattenHooks(registry);
    expect(hooks.map(h => h.id)).toEqual(['session-start', 'audit-session', 'pre-tool-use']);
    expect(hooks[0].event).toBe('SessionStart');
    expect(hooks[1].event).toBe('CustomSessionStart');
  });

  it('lists hooks for a lifecycle event', () => {
    const hooks = listHooksForEvent(registry, 'SessionStart');
    expect(hooks.map(h => h.id)).toEqual(['session-start', 'audit-session']);
    expect(listHooksForEvent(registry, 'PostToolUse')).toEqual([]);
  });

  it('finds hooks in event-indexed registries', () => {
    expect(findHook(registry, 'pre-tool-use')?.entry).toBe('handlers/pre-tool-use.cjs');
  });
});

describe('supportsPlatform', () => {
  it('returns true when platforms is empty', () => {
    expect(supportsPlatform({ platforms: [] }, 'linux')).toBe(true);
  });

  it('returns true when platforms is missing', () => {
    expect(supportsPlatform({}, 'linux')).toBe(true);
  });

  it('returns true for supported platform', () => {
    expect(supportsPlatform({ platforms: ['linux', 'macos'] }, 'linux')).toBe(true);
  });

  it('returns false for unsupported platform', () => {
    expect(supportsPlatform({ platforms: ['linux'] }, 'windows')).toBe(false);
  });
});

describe('withTimeout', () => {
  it('returns ok for fast function', async () => {
    const result = await withTimeout(async () => {}, 1000);
    expect(result.ok).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it('returns error for throwing function', async () => {
    const result = await withTimeout(async () => {
      throw new Error('boom');
    }, 1000);
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error.message).toBe('boom');
  });

  it('returns timedOut for slow function', async () => {
    const result = await withTimeout(async () => {
      await new Promise(r => setTimeout(r, 500));
    }, 50);
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('no timeout when timeoutMs is 0', async () => {
    const result = await withTimeout(async () => {}, 0);
    expect(result.ok).toBe(true);
  });
});

describe('runHook', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips unknown hook', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([]));
    const result = await runHook('nonexistent', { hooksDir: dir });
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('not found');
  });

  it('skips hook on unsupported platform', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', platforms: ['linux'], fallback: 'warn' },
    ]));
    writeHandler(dir, 'module.exports = function() {};');
    const result = await runHook('test', { hooksDir: dir, platform: 'windows' });
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('not supported');
  });

  it('runs handler successfully', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'warn' },
    ]));
    writeHandler(dir, `
      function handler() { console.log('handler ran'); }
      module.exports = handler;
      module.exports.run = handler;
    `);
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('ok');
  });

  it('treats blocked handler decisions as failures', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'error' },
    ]));
    writeHandler(dir, `module.exports = function() { return { status: 'blocked', message: 'policy blocked' }; };`);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('failed');
    expect(result.message).toBe('policy blocked');
    expect(result.decision.status).toBe('blocked');
  });

  it('preserves warning decisions from handlers', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'warn' },
    ]));
    writeHandler(dir, `module.exports = function() { return { status: 'warned', message: 'approved risk' }; };`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('warned');
    expect(result.message).toBe('approved risk');
  });

  it('handles handler failure with warn fallback', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'warn' },
    ]));
    writeHandler(dir, `module.exports = function() { throw new Error('handler failed'); };`);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('warned');
    expect(spy).toHaveBeenCalled();
  });

  it('handles handler failure with skip fallback', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'skip' },
    ]));
    writeHandler(dir, `module.exports = function() { throw new Error('handler failed'); };`);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('skipped');
  });

  it('handles handler failure with error fallback', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'error' },
    ]));
    writeHandler(dir, `module.exports = function() { throw new Error('handler failed'); };`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('failed');
  });

  it('retries on retry fallback', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'retry', retryCount: 2 },
    ]));
    writeHandler(dir, `module.exports = function() { throw new Error('always fails'); };`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('3 attempt(s)');
  });

  it('handles timeout', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 50, fallback: 'warn' },
    ]));
    writeHandler(dir, `module.exports = async function() { await new Promise(r => setTimeout(r, 500)); };`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('warned');
  });

  it('handles missing handler file', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/missing.cjs', timeoutMs: 5000, fallback: 'warn' },
    ]));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Handler load error');
  });

  it('handles handler that exports named run function', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify([
      { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'warn' },
    ]));
    writeHandler(dir, `
      function run() { console.log('named export ran'); }
      module.exports = { run };
    `);
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('ok');
  });

  it('runs hooks from an event-indexed registry by id', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      SessionStart: [
        { id: 'test', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
    writeHandler(dir, `module.exports = function({ event }) { if (event !== 'SessionStart') throw new Error(event); };`);
    const result = await runHook('test', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('ok');
  });
});

describe('runHookEvent', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs all hooks registered for an event', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      SessionStart: [
        { id: 'first', entry: 'handlers/test.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
    writeFileSync(join(dir, 'handlers', 'test.cjs'), `
      module.exports = function({ event, payload }) {
        if (event !== 'SessionStart') throw new Error(event);
        if (payload.sessionId !== 's1') throw new Error('bad payload');
      };
    `);

    const result = await runHookEvent('SessionStart', {
      hooksDir: dir,
      platform: 'linux',
      payload: { sessionId: 's1' },
    });

    expect(result.status).toBe('ok');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].hookId).toBe('first');
  });

  it('summarizes event hook failures', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      PreToolUse: [
        { id: 'ok', entry: 'handlers/ok.cjs', timeoutMs: 5000, fallback: 'warn' },
        { id: 'fail', entry: 'handlers/fail.cjs', timeoutMs: 5000, fallback: 'error' },
      ],
    }));
    writeFileSync(join(dir, 'handlers', 'ok.cjs'), `module.exports = function() {};`);
    writeFileSync(join(dir, 'handlers', 'fail.cjs'), `module.exports = function() { throw new Error('boom'); };`);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runHookEvent('PreToolUse', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('failed');
    expect(result.results.map(r => r.status)).toEqual(['ok', 'failed']);
  });

  it('skips events without registered hooks', async () => {
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ SessionStart: [] }));
    const result = await runHookEvent('PostToolUse', { hooksDir: dir, platform: 'linux' });
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('No hooks registered');
  });
});

describe('pre-tool-use-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'pre-tool-use-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'pre-tool-use-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      PreToolUse: [
        { id: 'pre-tool-use-audit', entry: 'handlers/pre-tool-use-audit.cjs', timeoutMs: 5000, fallback: 'error' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows low-risk shell commands', async () => {
    const result = await runHookEvent('PreToolUse', {
      hooksDir: dir,
      platform: 'linux',
      payload: { toolName: 'bash', command: 'npm test' },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].status).toBe('ok');
  });

  it('blocks high-risk shell commands without explicit approval', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runHookEvent('PreToolUse', {
      hooksDir: dir,
      platform: 'linux',
      payload: { toolName: 'bash', command: 'git reset --hard HEAD' },
    });

    expect(result.status).toBe('failed');
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].decision.rule).toBe('git-reset-hard');
  });

  it('warns for approved high-risk shell commands', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('PreToolUse', {
      hooksDir: dir,
      platform: 'linux',
      payload: { toolName: 'bash', command: 'Remove-Item -Recurse -Force build', approved: true },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');
    expect(result.results[0].decision.rule).toBe('powershell-remove-force-recurse');
  });
});

describe('permission-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'permission-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'permission-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      PermissionRequest: [
        { id: 'permission-request-audit', entry: 'handlers/permission-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
      PermissionDenied: [
        { id: 'permission-denied-audit', entry: 'handlers/permission-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records permission requests in compliance history', async () => {
    const result = await runHookEvent('PermissionRequest', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        toolName: 'bash',
        action: 'execute',
        resource: 'npm test',
        reason: 'Run verification command',
        risk: 'low',
      },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].decision.record.event).toBe('PermissionRequest');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:PermissionRequest',
      skill: 'permission-request-audit',
      passed: true,
      decision: 'requested',
      risk: 'low',
    });
    expect(history[0].permission.tool).toBe('bash');
  });

  it('records denied permissions as compliance violations', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('PermissionDenied', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        specDir: 'specs/demo',
        permission: {
          tool: 'bash',
          action: 'execute',
          resource: 'git reset --hard HEAD',
          reason: 'Destructive command was not approved',
          requester: 'agent-1',
        },
      },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:PermissionDenied',
      skill: 'permission-denied-audit',
      passed: false,
      decision: 'denied',
      risk: 'medium',
    });
    expect(history[0].violations).toEqual(['Destructive command was not approved']);
    expect(history[0].permission.requester).toBe('agent-1');
  });
});

describe('subagent-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'subagent-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'subagent-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      SubagentStart: [
        { id: 'subagent-start-audit', entry: 'handlers/subagent-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
      SubagentStop: [
        { id: 'subagent-stop-audit', entry: 'handlers/subagent-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records subagent starts with task and handoff links', async () => {
    const result = await runHookEvent('SubagentStart', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        subagentId: 'agent-1',
        sessionId: 'session-1',
        parentSessionId: 'parent-1',
        taskId: 'T1',
        role: 'implementer',
        model: 'test-model',
      },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].decision.record.event).toBe('SubagentStart');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:SubagentStart',
      skill: 'subagent-start-audit',
      passed: true,
      decision: 'started',
      risk: 'low',
    });
    expect(history[0].subagent).toMatchObject({
      id: 'agent-1',
      session_id: 'session-1',
      parent_session_id: 'parent-1',
      task_id: 'T1',
      role: 'implementer',
      model: 'test-model',
      task_state_path: 'task-states/T1.state.json',
      handoff_path: 'handoffs/T1.json',
    });
  });

  it('records failed subagent stops as compliance warnings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('SubagentStop', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        specDir: 'specs/demo',
        subagent: {
          id: 'agent-1',
          session_id: 'session-1',
          task_id: 'T1',
          status: 'failed',
          summary: 'Implementation task failed verification',
          durationMs: 1200,
        },
      },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:SubagentStop',
      skill: 'subagent-stop-audit',
      passed: false,
      decision: 'failed',
      risk: 'medium',
      violations: ['Implementation task failed verification'],
    });
    expect(history[0].subagent).toMatchObject({
      id: 'agent-1',
      session_id: 'session-1',
      task_id: 'T1',
      task_state_path: 'task-states/T1.state.json',
      handoff_path: 'handoffs/T1.json',
      duration_ms: 1200,
    });
  });
});

describe('compaction-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'compaction-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'compaction-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      PreCompact: [
        { id: 'pre-compact-audit', entry: 'handlers/compaction-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
      PostCompact: [
        { id: 'post-compact-audit', entry: 'handlers/compaction-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records pre-compact events and writes a handoff when spec_dir is present', async () => {
    const result = await runHookEvent('PreCompact', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        sessionId: 'session-1',
        reason: 'Context window is near limit',
        summary: 'Need to preserve current implementation state before compacting.',
        beforeTokens: 120000,
      },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].decision.record.event).toBe('PreCompact');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:PreCompact',
      skill: 'pre-compact-audit',
      passed: true,
      decision: 'preparing',
      risk: 'low',
    });
    expect(history[0].compaction).toMatchObject({
      session_id: 'session-1',
      reason: 'Context window is near limit',
      before_tokens: 120000,
      handoff_path: 'handoffs/compact-pre.json',
    });

    const handoff = JSON.parse(readFileSync(join(dir, 'specs', 'demo', 'handoffs', 'compact-pre.json'), 'utf-8'));
    expect(handoff).toMatchObject({
      status: 'pending',
      event: 'PreCompact',
      decision: 'preparing',
      compliance_stage: 'hook:PreCompact',
    });
  });

  it('records failed post-compact events as compliance warnings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('PostCompact', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        specDir: 'specs/demo',
        compaction: {
          status: 'failed',
          summary: 'Compaction failed before handoff was restored',
          afterTokens: 90000,
        },
      },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:PostCompact',
      skill: 'post-compact-audit',
      passed: false,
      decision: 'failed',
      risk: 'medium',
      violations: ['Compaction failed before handoff was restored'],
    });
    expect(history[0].compaction).toMatchObject({
      after_tokens: 90000,
      handoff_path: 'handoffs/compact-post.json',
    });
  });

  it('records a warning when compaction handoff escapes the spec directory', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('PreCompact', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        handoffPath: '../outside.json',
      },
    });

    expect(result.status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stage: 'hook:PreCompact',
      passed: false,
      risk: 'medium',
    });
    expect(history[0].violations[0]).toContain('Handoff path escapes spec directory');
  });
});

describe('task-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'task-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'task-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      TaskCreated: [
        { id: 'task-created-audit', entry: 'handlers/task-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
      TaskCompleted: [
        { id: 'task-completed-audit', entry: 'handlers/task-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records task creation with task state and handoff links', async () => {
    const result = await runHookEvent('TaskCreated', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        task: {
          id: 'T1',
          title: 'Implement parser',
          owner: 'agent-1',
          complexity: 'medium',
          owns: ['src/parser.js'],
          reads: ['src/tokenizer.js'],
          depends_on: ['T0'],
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].decision.record.event).toBe('TaskCreated');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:TaskCreated',
      skill: 'task-created-audit',
      passed: true,
      decision: 'created',
      risk: 'low',
    });
    expect(history[0].task).toMatchObject({
      id: 'T1',
      title: 'Implement parser',
      owner: 'agent-1',
      complexity: 'medium',
      task_path: 'tasks/T1.md',
      task_state_path: 'task-states/T1.state.json',
      handoff_path: 'handoffs/T1.json',
      depends_on: ['T0'],
      owns: ['src/parser.js'],
      reads: ['src/tokenizer.js'],
    });
  });

  it('records successful task completion with artifacts', async () => {
    const result = await runHookEvent('TaskCompleted', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        specDir: 'specs/demo',
        taskId: 'T1',
        status: 'done',
        artifacts: ['src/parser.js', 'tests/parser.test.js'],
        durationMs: 1500,
      },
    });

    expect(result.status).toBe('ok');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:TaskCompleted',
      skill: 'task-completed-audit',
      passed: true,
      decision: 'done',
      risk: 'low',
    });
    expect(history[0].task).toMatchObject({
      id: 'T1',
      artifacts: ['src/parser.js', 'tests/parser.test.js'],
      duration_ms: 1500,
      task_state_path: 'task-states/T1.state.json',
      handoff_path: 'handoffs/T1.json',
    });
  });

  it('records failed task completion as compliance warnings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('TaskCompleted', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        specDir: 'specs/demo',
        task: {
          id: 'T2',
          status: 'failed',
          summary: 'Verification failed for parser edge cases',
        },
      },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:TaskCompleted',
      skill: 'task-completed-audit',
      passed: false,
      decision: 'failed',
      risk: 'medium',
      violations: ['Verification failed for parser edge cases'],
    });
    expect(history[0].task).toMatchObject({
      id: 'T2',
      summary: 'Verification failed for parser edge cases',
      task_path: 'tasks/T2.md',
      task_state_path: 'task-states/T2.state.json',
      handoff_path: 'handoffs/T2.json',
    });
  });
});

describe('file-changed-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'file-changed-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'file-changed-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      FileChanged: [
        { id: 'file-changed-audit', entry: 'handlers/file-changed-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records low-risk source changes with codegraph sync suggestions', async () => {
    const result = await runHookEvent('FileChanged', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        files: [{ path: 'src/core/pipeline-engine.js', changeType: 'modified' }],
      },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].decision.record.event).toBe('FileChanged');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:FileChanged',
      skill: 'file-changed-audit',
      passed: true,
      decision: 'changed',
      risk: 'low',
    });
    expect(history[0].file_change).toMatchObject({
      changed_count: 1,
      sync_suggestions: ['review-changed-files', 'consider-codegraph-sync'],
    });
    expect(history[0].file_change.files[0]).toMatchObject({
      path: 'src/core/pipeline-engine.js',
      change_type: 'modified',
      risk: 'low',
      reason: 'source-change',
      in_project: true,
    });
  });

  it('warns for context and generated file changes with targeted sync suggestions', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('FileChanged', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        files: ['.loom/rules/constitution.md', 'src/generated/tooling.js'],
      },
    });

    expect(result.status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stage: 'hook:FileChanged',
      passed: true,
      risk: 'medium',
    });
    expect(history[0].file_change.files.map(file => file.reason)).toEqual(['context-path', 'generated-artifact']);
    expect(history[0].file_change.sync_suggestions).toEqual([
      'review-changed-files',
      'refresh-loom-context',
      'run-generate-check',
    ]);
  });

  it('records sensitive file changes as high risk without blocking', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('FileChanged', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        path: '.env.production',
      },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stage: 'hook:FileChanged',
      passed: true,
      risk: 'high',
    });
    expect(history[0].file_change.sensitive_files).toEqual(['.env.production']);
    expect(history[0].file_change.sync_suggestions).toContain('run-secret-scan');
  });
});

describe('worktree-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'worktree-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'worktree-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      WorktreeCreate: [
        { id: 'worktree-create-audit', entry: 'handlers/worktree-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
      WorktreeRemove: [
        { id: 'worktree-remove-audit', entry: 'handlers/worktree-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records worktree creation with branch and base branch links', async () => {
    const result = await runHookEvent('WorktreeCreate', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        worktreePath: '.worktree/20260707-demo',
        branch: 'feature/20260707-demo',
        baseBranch: 'main',
        commit: 'abc1234',
        createdBy: 'loom-using-git-worktrees',
      },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].decision.record.event).toBe('WorktreeCreate');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:WorktreeCreate',
      skill: 'worktree-create-audit',
      passed: true,
      decision: 'created',
      risk: 'low',
    });
    expect(history[0].worktree).toMatchObject({
      path: '.worktree/20260707-demo',
      branch: 'feature/20260707-demo',
      base_branch: 'main',
      commit: 'abc1234',
      created_by: 'loom-using-git-worktrees',
    });
  });

  it('records successful worktree removal cleanup', async () => {
    const result = await runHookEvent('WorktreeRemove', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        specDir: 'specs/demo',
        worktree: {
          path: '.worktree/20260707-demo',
          branch: 'feature/20260707-demo',
          cleanup_status: 'removed',
          removed: true,
        },
      },
    });

    expect(result.status).toBe('ok');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:WorktreeRemove',
      skill: 'worktree-remove-audit',
      passed: true,
      decision: 'removed',
      risk: 'low',
    });
    expect(history[0].worktree).toMatchObject({
      path: '.worktree/20260707-demo',
      branch: 'feature/20260707-demo',
      cleanup_status: 'removed',
      removed: true,
    });
  });

  it('records failed or dirty worktree removals as compliance warnings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('WorktreeRemove', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        specDir: 'specs/demo',
        worktreePath: '.worktree/20260707-demo',
        branch: 'feature/20260707-demo',
        cleanupStatus: 'dirty',
        removed: false,
        residualRisks: ['uncommitted changes remain in worktree'],
      },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:WorktreeRemove',
      skill: 'worktree-remove-audit',
      passed: false,
      decision: 'dirty',
      risk: 'medium',
      violations: ['uncommitted changes remain in worktree'],
    });
    expect(history[0].worktree).toMatchObject({
      path: '.worktree/20260707-demo',
      branch: 'feature/20260707-demo',
      cleanup_status: 'dirty',
      removed: false,
      residual_risks: ['uncommitted changes remain in worktree'],
    });
  });
});

describe('user-prompt-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'user-prompt-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'user-prompt-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      UserPromptSubmit: [
        { id: 'user-prompt-audit', entry: 'handlers/user-prompt-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records low-risk user prompts with workflow suggestions', async () => {
    const result = await runHookEvent('UserPromptSubmit', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        prompt: 'Add a small status command and run tests',
        sessionId: 'session-1',
        requester: 'developer',
      },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].decision.record.event).toBe('UserPromptSubmit');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:UserPromptSubmit',
      skill: 'user-prompt-audit',
      passed: true,
      decision: 'submitted',
      risk: 'low',
    });
    expect(history[0].prompt).toMatchObject({
      text: 'Add a small status command and run tests',
      reasons: ['general-request'],
      session_id: 'session-1',
      requester: 'developer',
    });
    expect(history[0].prompt.suggestions).toEqual([
      'record-user-intent',
      'consider-pipeline-selector',
      'consider-qa-or-verification',
    ]);
  });

  it('warns for destructive or secret-related prompts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('UserPromptSubmit', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        prompt: 'Run git reset --hard and inspect the .env.production secret token',
      },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stage: 'hook:UserPromptSubmit',
      passed: true,
      risk: 'high',
    });
    expect(history[0].prompt.reasons).toEqual([
      'destructive-request',
      'credential-or-secret-request',
      'production-or-release-risk',
    ]);
    expect(history[0].prompt.suggestions).toContain('require-explicit-confirmation');
    expect(history[0].prompt.suggestions).toContain('avoid-secret-exposure');
  });

  it('classifies production refactor prompts as requiring planning and approval', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('UserPromptSubmit', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        userPrompt: 'Refactor the production auth migration flow',
      },
    });

    expect(result.status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stage: 'hook:UserPromptSubmit',
      risk: 'medium',
    });
    expect(history[0].prompt.reasons).toEqual([
      'production-or-release-risk',
      'large-scope-change',
      'security-sensitive-request',
    ]);
    expect(history[0].prompt.suggestions).toContain('require-plan-and-approval');
    expect(history[0].prompt.suggestions).toContain('review-permission-policy');
  });
});

describe('post-tool-use-audit handler', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, 'handlers'));
    writeFileSync(join(dir, 'handlers', 'post-tool-use-audit.cjs'), `
      module.exports = require(${JSON.stringify(join(process.cwd(), 'hooks', 'handlers', 'post-tool-use-audit.cjs'))});
    `);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({
      PostToolUse: [
        { id: 'post-tool-use-audit', entry: 'handlers/post-tool-use-audit.cjs', timeoutMs: 5000, fallback: 'warn' },
      ],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records successful tool results with artifacts', async () => {
    const result = await runHookEvent('PostToolUse', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        spec_dir: 'specs/demo',
        toolName: 'bash',
        command: 'npm test',
        exitCode: 0,
        durationMs: 1234,
        artifacts: ['test-report.md'],
      },
    });

    expect(result.status).toBe('ok');
    expect(result.results[0].decision.record.event).toBe('PostToolUse');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      spec_dir: 'specs/demo',
      stage: 'hook:PostToolUse',
      skill: 'post-tool-use-audit',
      passed: true,
      decision: 'succeeded',
      risk: 'low',
    });
    expect(history[0].tool_use).toMatchObject({
      tool: 'bash',
      input_summary: { kind: 'command', text: 'npm test' },
      exit_code: 0,
      success: true,
      duration_ms: 1234,
      artifacts: ['test-report.md'],
      error_summary: null,
      risk_reasons: [],
    });
  });

  it('records failed tool results as compliance warnings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('PostToolUse', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        toolName: 'bash',
        command: 'npm run build',
        result: {
          exitCode: 1,
          stderr: 'Build failed because TypeScript reported errors',
        },
      },
    });

    expect(result.status).toBe('warned');
    expect(result.results[0].status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stage: 'hook:PostToolUse',
      passed: false,
      decision: 'failed',
      risk: 'medium',
      violations: ['Build failed because TypeScript reported errors'],
    });
    expect(history[0].tool_use).toMatchObject({
      tool: 'bash',
      exit_code: 1,
      success: false,
      error_summary: 'Build failed because TypeScript reported errors',
      risk_reasons: ['tool-failed'],
    });
  });

  it('warns for high-risk commands and sensitive artifacts after execution', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runHookEvent('PostToolUse', {
      hooksDir: dir,
      platform: 'linux',
      payload: {
        projectRoot: dir,
        toolName: 'bash',
        command: 'git reset --hard HEAD',
        exitCode: 0,
        artifacts: ['.env.production'],
      },
    });

    expect(result.status).toBe('warned');

    const history = JSON.parse(readFileSync(join(dir, '.loom', 'compliance', 'history.json'), 'utf-8'));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stage: 'hook:PostToolUse',
      passed: true,
      decision: 'succeeded',
      risk: 'high',
    });
    expect(history[0].tool_use.risk_reasons).toEqual(['git-reset-hard', 'sensitive-artifact']);
    expect(history[0].tool_use.artifacts).toEqual(['.env.production']);
  });
});
