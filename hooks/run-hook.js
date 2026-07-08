import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

/**
 * Detect current platform.
 * @returns {'linux'|'macos'|'windows'|'unknown'}
 */
export function detectPlatform() {
  const map = { linux: 'linux', darwin: 'macos', win32: 'windows' };
  return map[process.platform] ?? 'unknown';
}

/**
 * Load hook definitions from hooks.json.
 * @param {string} [hooksDir] - Directory containing hooks.json (default: __dirname)
 * @returns {Array<object>}
 */
export function loadHooks(hooksDir = __dirname) {
  const raw = readFileSync(join(hooksDir, 'hooks.json'), 'utf-8');
  return JSON.parse(raw);
}

/**
 * Flatten either the legacy array format or the event-indexed hook registry.
 * @param {Array<object>|Record<string, Array<object>>} hooks
 * @returns {Array<object>}
 */
export function flattenHooks(hooks) {
  if (Array.isArray(hooks)) return hooks;
  if (!hooks || typeof hooks !== 'object') return [];

  const flattened = [];
  for (const [eventName, eventHooks] of Object.entries(hooks)) {
    if (!Array.isArray(eventHooks)) continue;
    for (const hook of eventHooks) {
      flattened.push({ ...hook, event: hook.event ?? eventName });
    }
  }
  return flattened;
}

/**
 * Return hooks registered for a lifecycle event.
 * @param {Array<object>|Record<string, Array<object>>} hooks
 * @param {string} eventName
 * @returns {Array<object>}
 */
export function listHooksForEvent(hooks, eventName) {
  if (Array.isArray(hooks)) {
    return hooks.filter(h => h.event === eventName || h.events?.includes?.(eventName));
  }
  if (!hooks || typeof hooks !== 'object') return [];
  const eventHooks = hooks[eventName];
  if (!Array.isArray(eventHooks)) return [];
  return eventHooks.map(hook => ({ ...hook, event: hook.event ?? eventName }));
}

/**
 * Find hook by id.
 * @param {Array<object>} hooks
 * @param {string} hookId
 * @returns {object|null}
 */
export function findHook(hooks, hookId) {
  return flattenHooks(hooks).find(h => h.id === hookId) ?? null;
}

/**
 * Check if hook supports current platform.
 * @param {object} hook
 * @param {string} platform
 * @returns {boolean}
 */
export function supportsPlatform(hook, platform) {
  if (!hook.platforms || hook.platforms.length === 0) return true;
  return hook.platforms.includes(platform);
}

/**
 * Execute function with timeout.
 * @param {Function} fn - Async function to execute
 * @param {number} timeoutMs - Timeout in ms (0 = no timeout)
 * @returns {Promise<{ok: boolean, timedOut: boolean, error?: Error}>}
 */
export async function withTimeout(fn, timeoutMs) {
  if (timeoutMs <= 0) {
    try {
      const value = await fn();
      return { ok: true, timedOut: false, value };
    } catch (error) {
      return { ok: false, timedOut: false, error };
    }
  }

  let timer;
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('HOOK_TIMEOUT')), timeoutMs);
      }),
    ]);
    return { ok: true, timedOut: false, value };
  } catch (error) {
    return {
      ok: false,
      timedOut: error.message === 'HOOK_TIMEOUT',
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve log function for fallback strategy.
 */
function logForStrategy(strategy, hookId) {
  const prefix = `[loom:hook:${hookId}]`;
  switch (strategy) {
    case 'skip':
      return (msg) => console.debug(`${prefix} ${msg}`);
    case 'warn':
      return (msg) => console.warn(`${prefix} WARNING: ${msg}`);
    case 'error':
    case 'retry':
      return (msg) => console.error(`${prefix} ERROR: ${msg}`);
    default:
      return (msg) => console.log(`${prefix} ${msg}`);
  }
}

function normalizeHandlerDecision(value) {
  if (!value || typeof value !== 'object') return { status: 'ok' };
  const status = value.status ?? value.verdict;
  if (!status) return { status: 'ok', data: value };
  return {
    status: String(status).toLowerCase(),
    message: value.message ?? value.reason,
    data: value,
  };
}

/**
 * Run a single hook by id.
 *
 * @param {string} hookId
 * @param {object} [options]
 * @param {string} [options.hooksDir] - Directory containing hooks.json and handlers/
 * @param {string} [options.platform] - Override platform detection
 * @returns {Promise<{hookId: string, status: string, message?: string}>}
 */
export async function runHook(hookId, options = {}) {
  const hooksDir = options.hooksDir ?? __dirname;
  const platform = options.platform ?? detectPlatform();
  const hooks = loadHooks(hooksDir);
  const hook = findHook(hooks, hookId);

  return executeHook(hook, hookId, { ...options, hooksDir, platform });
}

async function executeHook(hook, hookId, options) {
  const hooksDir = options.hooksDir ?? __dirname;
  const platform = options.platform ?? detectPlatform();

  if (!hook) {
    return { hookId, status: 'skipped', message: `Hook "${hookId}" not found in hooks.json` };
  }

  // Platform check
  if (!supportsPlatform(hook, platform)) {
    const log = logForStrategy('warn', hookId);
    log(`Platform "${platform}" not supported (requires: ${hook.platforms.join(', ')}). Skipping.`);
    return { hookId, status: 'skipped', message: `Platform "${platform}" not supported` };
  }

  const fallback = hook.fallback ?? 'warn';
  const retryCount = hook.retryCount ?? 2;
  const log = logForStrategy(fallback, hookId);

  // Load handler
  let handler;
  try {
    const handlerPath = join(hooksDir, hook.entry);
    const mod = _require(handlerPath);
    handler = mod.run ?? mod.default ?? mod;
  } catch (error) {
    log(`Failed to load handler "${hook.entry}": ${error.message}`);
    return { hookId, status: 'failed', message: `Handler load error: ${error.message}` };
  }

  if (typeof handler !== 'function') {
    log(`Handler "${hook.entry}" does not export a function`);
    return { hookId, status: 'failed', message: 'Handler is not a function' };
  }

  // Execute with retry logic
  const maxAttempts = fallback === 'retry' ? retryCount + 1 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      log(`Retry ${attempt}/${retryCount}...`);
      await new Promise(r => setTimeout(r, 500));
    }

    const result = await withTimeout(
      () => handler({ event: options.eventName ?? hook.event, payload: options.payload, hook }),
      hook.timeoutMs ?? 0,
    );

    if (result.ok) {
      const decision = normalizeHandlerDecision(result.value);
      if (decision.status === 'blocked' || decision.status === 'failed') {
        log(`Handler blocked execution: ${decision.message ?? 'policy decision'}`);
        return {
          hookId,
          status: 'failed',
          message: decision.message ?? 'Blocked by hook policy',
          decision: decision.data,
        };
      }
      if (decision.status === 'warned' || decision.status === 'warning') {
        logForStrategy('warn', hookId)(decision.message ?? 'Handler returned warning');
        return { hookId, status: 'warned', message: decision.message, decision: decision.data };
      }
      if (decision.status === 'skipped') {
        return { hookId, status: 'skipped', message: decision.message, decision: decision.data };
      }
      return { hookId, status: 'ok', decision: decision.data };
    }

    if (result.timedOut) {
      log(`Execution timed out after ${hook.timeoutMs}ms`);
    } else {
      log(`Execution failed: ${result.error?.message}`);
    }
  }

  // All attempts failed — apply fallback
  switch (fallback) {
    case 'skip':
      return { hookId, status: 'skipped', message: 'Failed, skipped per fallback policy' };
    case 'warn':
      return { hookId, status: 'warned', message: 'Failed, warned per fallback policy' };
    case 'error':
    case 'retry':
      return { hookId, status: 'failed', message: `Failed after ${maxAttempts} attempt(s)` };
    default:
      return { hookId, status: 'warned', message: 'Failed, unknown fallback' };
  }
}

function summarizeEventStatus(results) {
  if (results.some(r => r.status === 'failed')) return 'failed';
  if (results.some(r => r.status === 'warned')) return 'warned';
  if (results.every(r => r.status === 'skipped')) return 'skipped';
  return 'ok';
}

/**
 * Run all hooks registered for a lifecycle event.
 *
 * @param {string} eventName
 * @param {object} [options]
 * @param {string} [options.hooksDir] - Directory containing hooks.json and handlers/
 * @param {string} [options.platform] - Override platform detection
 * @param {unknown} [options.payload] - Event payload passed to handlers
 * @returns {Promise<{event: string, status: string, results: Array<object>, message?: string}>}
 */
export async function runHookEvent(eventName, options = {}) {
  const hooksDir = options.hooksDir ?? __dirname;
  const platform = options.platform ?? detectPlatform();
  const hooks = loadHooks(hooksDir);
  const eventHooks = listHooksForEvent(hooks, eventName);

  if (eventHooks.length === 0) {
    return {
      event: eventName,
      status: 'skipped',
      results: [],
      message: `No hooks registered for event "${eventName}"`,
    };
  }

  const results = [];
  for (const hook of eventHooks) {
    results.push(await executeHook(hook, hook.id, { ...options, hooksDir, platform, eventName }));
  }

  return { event: eventName, status: summarizeEventStatus(results), results };
}

/**
 * CLI entry point: node run-hook.js <hook-id>
 */
const isMain = process.argv[1] &&
  (process.argv[1].endsWith('run-hook.js') || process.argv[1].endsWith('run-hook'));

if (isMain) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node run-hook.js <hook-id> | --event <event-name>');
    process.exit(1);
  }

  const result = arg === '--event'
    ? await runHookEvent(process.argv[3])
    : await runHook(arg);

  if (result.status === 'failed') {
    console.error(`Hook "${arg}" failed: ${result.message ?? 'event hook failed'}`);
    process.exit(1);
  }

  if (result.status === 'skipped' && result.message?.includes('not found')) {
    console.warn(`Hook "${arg}" not found`);
    process.exit(1);
  }
}
