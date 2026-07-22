import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const VALID_KINDS = new Set(['approval', 'implementation', 'test', 'review', 'evaluation']);
const VALID_VERDICTS = new Set(['pass', 'fail', 'blocked', 'changes_requested', 'needs_context']);

function sha256File(path, fs = { existsSync, readFileSync }) {
  if (!fs.existsSync(path)) return null;
  return createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

function safeGit(command, cwd) {
  try {
    return execSync(command, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function buildReceipt({ kind, stage, taskId, verdict, actor, specDir, artifacts = [], behaviors = [], requirements = [], evidence = [], projectRoot, gitBinding = true }) {
  const errors = [];
  if (!VALID_KINDS.has(kind)) errors.push(`Invalid receipt kind: ${kind}`);
  if (!stage) errors.push('Receipt requires stage');
  if (verdict && !VALID_VERDICTS.has(verdict)) errors.push(`Invalid verdict: ${verdict}`);
  if (taskId && !/^T\d+$/.test(taskId)) errors.push(`Invalid task_id: ${taskId}`);

  const artifactFingerprints = {};
  for (const art of artifacts) {
    const abs = isAbsolute(art) ? art : join(specDir || process.cwd(), art);
    const sha = sha256File(abs);
    if (sha) artifactFingerprints[art] = sha;
    else errors.push(`Cannot fingerprint missing artifact: ${art}`);
  }

  let gitTree = null;
  let gitCommit = null;
  let diffSha256 = null;
  if (gitBinding && projectRoot) {
    gitTree = safeGit('git log -1 --format=%T', projectRoot);
    gitCommit = safeGit('git rev-parse HEAD', projectRoot);
    const diff = safeGit('git diff HEAD', projectRoot);
    if (diff !== null) diffSha256 = createHash('sha256').update(diff).digest('hex');
  }

  return {
    ok: errors.length === 0,
    errors,
    receipt: {
      kind,
      stage,
      task_id: taskId || undefined,
      created_at: new Date().toISOString(),
      actor: actor || undefined,
      verdict: verdict || undefined,
      artifact_fingerprints: artifactFingerprints,
      git_tree: gitTree,
      git_commit: gitCommit,
      diff_sha256: diffSha256,
      requirements,
      behaviors,
      evidence
    }
  };
}

export function writeReceipt({ specDir, subdir, receipt }) {
  const dir = join(specDir, 'receipts', subdir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = process.hrtime ? process.hrtime().join('-') : Math.random().toString(36).slice(2, 8);
  const name = `${receipt.kind}-${stamp}-${suffix}.json`;
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return { ok: true, path };
}

export function validateReceiptFile(path, errors = []) {
  if (!existsSync(path)) {
    errors.push(`Missing receipt: ${path}`);
    return { ok: false, errors };
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    errors.push(`Receipt ${path} is not valid JSON: ${err.message}`);
    return { ok: false, errors };
  }
  if (!VALID_KINDS.has(receipt.kind)) errors.push(`Receipt ${path} has invalid kind: ${receipt.kind}`);
  if (!receipt.stage) errors.push(`Receipt ${path} missing stage`);
  if (!receipt.created_at) errors.push(`Receipt ${path} missing created_at`);
  if (receipt.verdict && !VALID_VERDICTS.has(receipt.verdict)) errors.push(`Receipt ${path} invalid verdict: ${receipt.verdict}`);

  if (Array.isArray(receipt.evidence)) {
    for (const ev of receipt.evidence) {
      if (!ev.command) errors.push(`Receipt ${path} evidence missing command`);
      if (ev.exit_code !== 0) errors.push(`Receipt ${path} evidence exit_code must be 0, got ${ev.exit_code}`);
      if (!ev.log_file) errors.push(`Receipt ${path} evidence missing log_file`);
      if (!ev.log_sha256 || !/^[a-f0-9]{64}$/.test(ev.log_sha256)) errors.push(`Receipt ${path} evidence invalid log_sha256`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateReceiptsDir(specDir, subdir, errors = []) {
  const dir = join(specDir, 'receipts', subdir);
  if (!existsSync(dir)) {
    return { ok: true, errors, count: 0 };
  }
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  let allOk = true;
  for (const f of files) {
    const r = validateReceiptFile(join(dir, f), errors);
    if (!r.ok) allOk = false;
  }
  return { ok: allOk, errors, count: files.length };
}
