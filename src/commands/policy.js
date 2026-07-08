import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, relative, sep } from 'node:path';

const DEFAULT_POLICY = {
  sensitivePaths: ['.env', '.env.*', 'config/production.json'],
  secretPatterns: [
    { id: 'generic-secret', pattern: '(SECRET|TOKEN|API_KEY|PASSWORD)\\s*=' },
  ],
};

export default async function policyCommand(action, options = {}) {
  if (action !== 'check') throw new Error(`Unknown policy action: ${action}`);
  return checkPolicy(options);
}

function checkPolicy(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const policyPath = resolveOptionPath(cwd, options.policy || '.loom/policy.json');
  const policy = loadPolicy(policyPath);
  const files = parseFiles(options.files || options.file).map(file => normalizePath(file));
  const violations = [];

  for (const file of files) {
    if (matchesSensitivePath(file, policy.sensitivePaths || [])) {
      violations.push({ rule: 'sensitive-path', path: file, severity: 'high' });
    }

    const abs = resolveInside(cwd, file);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, 'utf-8');
    for (const item of policy.secretPatterns || []) {
      const pattern = typeof item === 'string' ? item : item.pattern;
      if (!pattern) continue;
      let re;
      try {
        re = new RegExp(pattern, 'm');
      } catch (err) {
        throw new Error(`Invalid secret pattern (${typeof item === 'string' ? 'secret-pattern' : item.id || 'secret-pattern'}): ${err.message}`);
      }
      if (re.test(content)) {
        violations.push({
          rule: 'secret-pattern',
          id: typeof item === 'string' ? 'secret-pattern' : item.id || 'secret-pattern',
          path: file,
          severity: 'high',
        });
      }
    }
  }

  const verdict = violations.length > 0 ? 'FAIL' : 'PASS';
  const record = {
    timestamp: new Date().toISOString(),
    type: 'policy_check',
    verdict,
    risk: verdict === 'FAIL' ? 'high' : 'low',
    policy_path: relative(cwd, policyPath) || policyPath,
    files,
    violations,
  };

  const outPath = resolveOptionPath(cwd, options.out || '.loom/compliance/policy-audit.jsonl');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(record) + '\n', { encoding: 'utf-8', flag: 'a' });

  console.log(`\n  policy check: ${verdict} (${violations.length} violation${violations.length === 1 ? '' : 's'})`);
  console.log(`  audit: ${relative(cwd, outPath) || outPath}\n`);
  return { verdict, risk: record.risk, violations, auditPath: outPath };
}

function loadPolicy(policyPath) {
  if (!existsSync(policyPath)) return DEFAULT_POLICY;
  const policy = JSON.parse(readFileSync(policyPath, 'utf-8'));
  return {
    ...DEFAULT_POLICY,
    ...policy,
    sensitivePaths: policy.sensitivePaths || DEFAULT_POLICY.sensitivePaths,
    secretPatterns: policy.secretPatterns || DEFAULT_POLICY.secretPatterns,
  };
}

function parseFiles(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(parseFiles);
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function normalizePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

function matchesSensitivePath(file, patterns) {
  return patterns.some(pattern => globToRegExp(normalizePath(pattern)).test(file));
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function resolveInside(root, file) {
  const abs = resolve(root, file);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`policy file escapes project root: ${file}`);
  }
  return abs;
}

function resolveOptionPath(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}
