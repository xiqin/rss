import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isInside(base, candidate) {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Hash a file or directory deterministically without loading it into model context. */
export function fingerprintPath(path, fs) {
  if (!fs.existsSync(path)) return null;
  const stats = fs.statSync(path);
  if (stats.isFile()) return sha256(fs.readFileSync(path));

  const rows = [];
  const walk = (dir, prefix = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = resolve(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child, rel);
      else rows.push(`${rel}\0${sha256(fs.readFileSync(child))}`);
    }
  };
  walk(path);
  return sha256(rows.join('\n'));
}

/** Resolve a declared artifact while preventing paths outside project/spec roots. */
export function resolveTrackedPath(specDir, projectRoot, declaredPath) {
  if (typeof declaredPath !== 'string' || declaredPath.trim() === '') return null;
  const value = declaredPath.replace(/\\/g, '/').replace(/\/$/, '');
  if (!value || isAbsolute(value)) return null;

  const specLocal = /^(?:spec\.md|plan\.md|requirements\.json|traceability\.json|artifact-analysis\.json|convergence-report\.json|review-request\.md|review-response\.md|progress\.md|pipeline\.state\.json|test-report\.md|verify-report\.md|qa-[^/]+\.md|manual-checklist\.md|tasks|task-states|handoffs|evidence|receipts|findings|implementation-packets)(?:\/|$)/;
  const base = specLocal.test(value) ? specDir : projectRoot;
  const candidate = resolve(base, value);
  return isInside(base, candidate) ? candidate : null;
}

export function fingerprintDeclaredPaths(paths, { specDir, projectRoot, fs }) {
  const result = {};
  for (const declared of [...new Set(paths || [])].sort()) {
    const path = resolveTrackedPath(specDir, projectRoot, declared);
    if (!path) continue;
    const digest = fingerprintPath(path, fs);
    if (digest) result[declared] = digest;
  }
  return result;
}

export function compareFingerprints(expected, options) {
  const stale = [];
  for (const [declared, digest] of Object.entries(expected || {})) {
    const path = resolveTrackedPath(options.specDir, options.projectRoot, declared);
    const actual = path ? fingerprintPath(path, options.fs) : null;
    if (!actual) stale.push({ path: declared, reason: 'missing' });
    else if (actual !== digest) stale.push({ path: declared, reason: 'changed' });
  }
  return stale;
}

export function sha256File(path, fs) {
  if (!fs.existsSync(path) || !fs.statSync(path).isFile()) return null;
  return sha256(fs.readFileSync(path));
}
