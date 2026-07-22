import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, isAbsolute, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { extractRequirementIds, validateRequirementsFile } from './requirements.js';
import { validateTraceabilityFile } from './traceability.js';

const TASK_FILE_PATTERN = /^T(\d+)\.md$/;

function readTaskFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = match[1];
  const result = {};
  const parse = (key) => {
    const inline = new RegExp(`^${key}\\s*:\\s*\\[(.*?)\\]\\s*$`, 'm').exec(fm);
    if (inline) return inline[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const block = new RegExp(`^${key}\\s*:\\s*$([\\s\\S]*?)(?=^\\w+:|^---\\s*$|$)`, 'm').exec(fm);
    if (block) return block[1].split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
    return [];
  };
  result.owns = parse('owns');
  result.reads = parse('reads');
  result.depends_on = parse('depends_on');
  result.requirements = parse('requirements');
  result.behavior_ids = parse('behavior_ids');
  return result;
}

function listTaskFiles(specDir) {
  const tasksDir = join(specDir, 'tasks');
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir)
    .filter(f => TASK_FILE_PATTERN.test(f))
    .sort((a, b) => parseInt(a.match(TASK_FILE_PATTERN)[1]) - parseInt(b.match(TASK_FILE_PATTERN)[1]));
}

function sha256File(path) {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fingerprintPaths(specDir, paths) {
  const h = createHash('sha256');
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : join(specDir, p);
    if (!existsSync(abs)) {
      h.update(`missing:${p}`);
      continue;
    }
    h.update(p);
    h.update(readFileSync(abs));
  }
  return h.digest('hex');
}

export function buildImplementationPacket(specDir, taskId, options = {}) {
  const taskFile = `tasks/${taskId}.md`;
  const taskPath = join(specDir, taskFile);
  if (!existsSync(taskPath)) {
    return { ok: false, error: `Missing task file: ${taskFile}` };
  }

  const taskContent = readFileSync(taskPath, 'utf8');
  const fm = readTaskFrontmatter(taskContent);

  const requirements = validateRequirementsFile(specDir, []);
  const traceability = validateTraceabilityFile(specDir, [], { required: requirements.exists, requireEvidence: false });

  const behaviorIds = fm.behavior_ids || [];
  const requirementIds = fm.requirements || [];

  const behaviorsByReq = requirements.behaviorIdsByRequirement || {};
  const behaviorDefs = [];
  for (const reqId of requirementIds) {
    for (const bId of (behaviorsByReq[reqId] || [])) {
      if (behaviorIds.includes(bId)) {
        const reqEntry = (requirements.requirementIds || []).includes(reqId);
        behaviorDefs.push({ id: bId, requirement_id: reqId });
      }
    }
  }

  const acceptanceScenarios = [];
  for (const bId of behaviorIds) {
    acceptanceScenarios.push({ behavior_id: bId, scenario: `Verify ${bId} per requirements.json acceptance` });
  }

  const mustPreserve = [];
  for (const dep of (fm.depends_on || [])) {
    mustPreserve.push(`tasks/${dep}.md must remain unchanged`);
  }

  const codeContext = [];
  for (const own of (fm.owns || [])) {
    codeContext.push({ file: own, reason: 'declared ownership' });
  }
  for (const read of (fm.reads || [])) {
    codeContext.push({ file: read, reason: 'declared read' });
  }

  const allowedFiles = [...(fm.owns || []), ...(fm.reads || [])];

  const requiredCommands = [
    { command: 'npm test', reason: 'project-wide test baseline' }
  ];

  const packet = {
    task_id: taskId,
    spec_dir: specDir,
    obligation_ids: behaviorIds,
    requirement_ids: requirementIds,
    acceptance_scenarios: acceptanceScenarios,
    must_preserve: mustPreserve,
    code_context: codeContext,
    allowed_files: allowedFiles,
    required_commands: requiredCommands,
    behaviors: behaviorDefs,
    created_at: new Date().toISOString()
  };

  packet.packet_sha256 = fingerprintPaths(specDir, [
    `tasks/${taskId}.md`,
    'requirements.json',
    'traceability.json',
    'spec.md',
    'plan.md'
  ]);

  return { ok: true, packet };
}

export function generateImplementationPacket(specDir, taskId, options = {}) {
  const result = buildImplementationPacket(specDir, taskId, options);
  if (!result.ok) return result;
  const packetDir = join(specDir, 'implementation-packets');
  if (!existsSync(packetDir)) mkdirSync(packetDir, { recursive: true });
  const outPath = join(packetDir, `${taskId}.json`);
  writeFileSync(outPath, JSON.stringify(result.packet, null, 2) + '\n', 'utf8');
  return { ok: true, path: outPath, task_id: taskId };
}

export function validateImplementationPacket(specDir, taskId, errors = []) {
  const packetPath = join(specDir, 'implementation-packets', `${taskId}.json`);
  if (!existsSync(packetPath)) {
    errors.push(`Missing implementation packet: implementation-packets/${taskId}.json`);
    return { ok: false, errors };
  }
  let packet;
  try {
    packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  } catch (err) {
    errors.push(`implementation-packets/${taskId}.json is not valid JSON: ${err.message}`);
    return { ok: false, errors };
  }

  const taskPath = join(specDir, 'tasks', `${taskId}.md`);
  if (!existsSync(taskPath)) {
    errors.push(`implementation-packets/${taskId}.json references missing task ${taskId}.md`);
    return { ok: false, errors };
  }

  const rebuilt = buildImplementationPacket(specDir, taskId);
  if (!rebuilt.ok) {
    errors.push(`Cannot rebuild packet for ${taskId}: ${rebuilt.error}`);
    return { ok: false, errors };
  }

  if (rebuilt.packet.packet_sha256 !== packet.packet_sha256) {
    errors.push(`implementation-packets/${taskId}.json is stale: expected sha256 ${rebuilt.packet.packet_sha256}, got ${packet.packet_sha256}`);
  }

  if (!Array.isArray(packet.obligation_ids) || packet.obligation_ids.length === 0) {
    errors.push(`implementation-packets/${taskId}.json has no obligation_ids`);
  }

  if (!Array.isArray(packet.allowed_files) || packet.allowed_files.length === 0) {
    errors.push(`implementation-packets/${taskId}.json has no allowed_files`);
  }

  return { ok: errors.length === 0, errors };
}
