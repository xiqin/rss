#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { generateImplementationPacket, validateImplementationPacket } from '../src/core/implementation-packets.js';

const args = process.argv.slice(2);
const command = args[0];

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const specDir = getArg('--spec-dir');
const taskId = getArg('--task');

if (!command || !specDir || !taskId) {
  console.error('Usage:');
  console.error('  node scripts/implementation-packets.mjs generate --spec-dir <dir> --task T1');
  console.error('  node scripts/implementation-packets.mjs check   --spec-dir <dir> --task T1');
  process.exit(1);
}

if (command === 'generate') {
  const result = generateImplementationPacket(specDir, taskId);
  if (!result.ok) {
    console.error(`ERROR: ${result.error}`);
    process.exit(1);
  }
  console.log(`Generated ${result.path} (task ${result.task_id})`);
} else if (command === 'check') {
  const errors = [];
  validateImplementationPacket(specDir, taskId, errors);
  if (errors.length > 0) {
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`ERROR: implementation packet for ${taskId} is invalid`);
    process.exit(1);
  }
  console.log(`Checked implementation packet for ${taskId} in ${specDir}`);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
