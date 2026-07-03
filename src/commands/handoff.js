import { PipelineStateStore } from '../core/state-store.js';
import { SpecLock } from '../core/lock.js';
import { resolvePipelineDir } from '../core/spec-dir.js';

function parseCsv(value) {
  if (!value) return [];
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function parseData(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid --data JSON: ${err.message}`);
  }
}

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

export default async function handoff(action, options) {
  if (action !== 'write') {
    console.error('\n  loom handoff: unknown action. Use: loom handoff write --spec-dir <dir> --stage <stage> --summary <text>\n');
    process.exitCode = 1;
    return;
  }

  const cwd = options.cwd || process.cwd();
  if (!options.specDir) {
    console.error('\n  loom handoff write: --spec-dir is required\n');
    process.exitCode = 1;
    return;
  }

  if (!options.stage && !options.task) {
    console.error('\n  loom handoff write: either --stage or --task is required\n');
    process.exitCode = 1;
    return;
  }

  if (options.stage && options.task) {
    console.error('\n  loom handoff write: use only one of --stage or --task\n');
    process.exitCode = 1;
    return;
  }

  let absSpecDir;
  try {
    absSpecDir = resolvePipelineDir(cwd, options.specDir);
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  const store = new PipelineStateStore(absSpecDir, { projectRoot: cwd });
  const lock = new SpecLock(absSpecDir);

  await withWriteLock(lock, options, () => {
    const data = parseData(options.data);
    const artifacts = parseCsv(options.artifacts);
    const payload = {
      ...data,
      status: options.status || data.status || 'done',
      ...(options.summary ? { summary: options.summary } : {}),
      ...(artifacts.length > 0 ? { artifacts } : {})
    };

    if (options.stage) {
      store.writeStageHandoff(options.stage, payload);
      console.log(`\n  ✓ handoff written: handoffs/${options.stage}.json\n`);
      return;
    }

    store.writeHandoff(options.task, payload);
    console.log(`\n  ✓ handoff written: handoffs/${options.task}.json\n`);
  });
}
