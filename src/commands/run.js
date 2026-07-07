import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PipelineEngine } from '../core/pipeline-engine.js';
import { PipelineSelector } from '../core/pipeline-selector.js';
import { SpecLock } from '../core/lock.js';
import { parseVerdict } from '../core/artifact-checker.js';
import { resolvePipelineDir } from '../core/spec-dir.js';

async function withWriteLock(lock, options, action) {
  if (options.force) lock.release();

  const content = lock.acquire();
  if (!content.acquired) {
    console.error(`\n  ✗ spec is locked by PID ${content.pid} (started: ${content.startedAt || 'unknown'})`);
    console.error('  Use --force to override\n');
    process.exitCode = 1;
    return;
  }

  try {
    return await action();
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    lock.release();
  }
}

function printResult(result, success, failure) {
  if (result.ok) {
    console.log(success(result));
  } else {
    console.error(failure(result));
    process.exitCode = 1;
  }
}

export default async function run(options) {
  const cwd = options.cwd || process.cwd();
  const specDir = options.specDir;

  if (!specDir) {
    console.error('\n  loom run: --spec-dir is required\n');
    process.exitCode = 1;
    return;
  }

  const requiresTypePipelines = !options.auto && !options.approvePipeline;
  let absSpecDir;
  try {
    absSpecDir = options.verdict ? resolve(cwd, specDir) : resolvePipelineDir(cwd, specDir);
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  const engine = new PipelineEngine(cwd, absSpecDir, { requirePipelines: requiresTypePipelines });
  const lock = new SpecLock(absSpecDir);

  if (options.verdict) {
    const reportFile = options.verdictFile || 'qa-report.md';
    const reportPath = join(absSpecDir, reportFile);
    if (!existsSync(reportPath)) {
      console.error(`\n  ✗ ${reportFile} not found in ${absSpecDir}\n`);
      process.exitCode = 1;
      return;
    }
    const content = readFileSync(reportPath, 'utf-8');
    const verdict = parseVerdict(content) || 'FAIL';
    console.log(verdict);
    if (verdict === 'PASS') process.exitCode = 0;
    else if (verdict === 'PARTIAL') process.exitCode = 2;
    else process.exitCode = 1;
    return;
  }

  if (options.context) {
    const ctx = engine.getStageContext();
    if (!ctx) {
      console.log('\n  Pipeline not initialized. Run: loom run --spec-dir <dir>\n');
      return;
    }
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }

  if (options.task && options.taskStatus) {
    await withWriteLock(lock, options, () => {
      const patch = { status: options.taskStatus };
      if (options.blocker) patch.blocker = options.blocker;
      if (options.taskStatus === 'reviewing' || options.taskStatus === 'failed') {
        const current = engine.store.readTask(options.task);
        if (current && options.taskStatus === 'failed') {
          patch.retry_count = (current.retry_count || 0) + 1;
        }
      }
      const state = engine.store.updateTask(options.task, patch);
      console.log(`  ✓ ${options.task} → ${state.status}`);
    });
    return;
  }

  if (options.approvePipeline) {
    await withWriteLock(lock, options, () => {
      const selector = new PipelineSelector(cwd, absSpecDir);
      const steps = selector.readPipelinePlan();
      if (!steps || steps.length === 0) {
        console.error('\n  ✗ pipeline-plan.md 不存在或未找到步骤段。先运行: loom select --spec-dir <dir> --request <text>\n');
        process.exitCode = 1;
        return;
      }
      const result = engine.initialize(null, { dynamicSteps: steps });
      const ids = steps.map(s => s.id);
      console.log(`\n  ✓ Pipeline 初始化（dynamic_steps）`);
      console.log(`  Steps: ${ids.join(' → ')}`);
      console.log(`  Stage: ${result.state.current_stage}`);
      console.log(`  State: ${absSpecDir}/pipeline.state.json\n`);
    });
    return;
  }

  if (options.advance) {
    await withWriteLock(lock, options, () => {
      const result = engine.advance({ compressionConfirmed: options.compressionConfirmed === true });
      printResult(
        result,
        r => `\n  ✓ Pipeline advanced: ${r.from} → ${r.to}\n`,
        r => `\n  ✗ Cannot advance: ${r.error}\n${r.hint ? `  Hint: ${r.hint}\n` : ''}`
      );
    });
    return;
  }

  if (options.approve) {
    await withWriteLock(lock, options, () => {
      const result = engine.approve();
      printResult(
        result,
        r => `\n  ✓ Gate approved: ${r.from} → ${r.to}\n`,
        r => `\n  ✗ Cannot approve: ${r.error}\n`
      );
    });
    return;
  }

  if (options.fail) {
    await withWriteLock(lock, options, () => {
      const result = engine.markFailed(options.fail);
      printResult(
        result,
        r => `\n  ✓ Marked failed at stage "${r.stage}": ${r.reason}\n`,
        r => `\n  ✗ ${r.error}\n`
      );
    });
    return;
  }

  if (options.recover) {
    await withWriteLock(lock, options, () => {
      const result = engine.recover(options.recover);
      printResult(
        result,
        r => `\n  ✓ Recovered: ${r.from} → ${r.to}\n`,
        r => `\n  ✗ ${r.error}\n`
      );
    });
    return;
  }

  const existing = engine.store.read();
  if (existing) {
    const ctx = engine.getStageContext();
    console.log(`\n  loom run — spec: ${specDir}\n`);
    console.log(`  Stage:    ${ctx.current_stage}${ctx.is_gate ? ' (gate — needs --approve)' : ''}`);
    console.log(`  Type:     ${ctx.pipeline_type}`);
    console.log(`  Skill:    ${ctx.current_skill || '(none)'}`);
    console.log(`  Next:     ${ctx.next_stage || '(end)'}`);
    if (ctx.tasks_summary.total > 0) {
      const s = ctx.tasks_summary;
      console.log(`  Tasks:    ${s.total} total (${s.done} done, ${s.executing} running, ${s.failed} failed, ${s.blocked} blocked)`);
    }
    console.log(`  Started:  ${ctx.started_at?.slice(0, 16).replace('T', ' ')}`);
    console.log('');
    return;
  }

  await withWriteLock(lock, options, async () => {
    if (options.auto) {
      const request = options.request || '';
      if (!request) {
        console.error('\n  ✗ --auto requires --request <text>\n');
        process.exitCode = 1;
        return;
      }
      const selector = new PipelineSelector(cwd, absSpecDir);
      const selection = await selector.select(request);
      const ids = selection.steps.map(s => s.id);
      console.log(`\n  ✓ Selected via ${selection.source} (risk: ${selection.risk})`);
      console.log(`  Steps: ${ids.join(' → ')}`);
      console.log(`  Reason: ${selection.reasoning}`);
      const initResult = engine.initialize(null, { dynamicSteps: selection.steps });
      console.log(`  Stage: ${initResult.state.current_stage}`);
      console.log(`  State: ${absSpecDir}/pipeline.state.json\n`);
      return;
    }

    const type = options.type || null;
    const result = engine.initialize(type);
    console.log(`\n  ✓ Pipeline initialized: ${result.state.pipeline_type}`);
    console.log(`  Stage: ${result.state.current_stage}`);
    console.log(`  State: ${absSpecDir}/pipeline.state.json\n`);
  });
}
