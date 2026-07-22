#!/usr/bin/env node

import { relative } from 'node:path';
import { generateRequirementsFile, validateRequirementsFile } from '../src/core/requirements.js';

const options = parseArgs(process.argv.slice(2));

if (options.mode === 'generate') {
  const result = generateRequirementsFile(options.specDir, { force: options.force });
  if (!result.ok) {
    console.error(`ERROR ${result.error}`);
    process.exit(1);
  }
  console.log(`Generated ${relative(process.cwd(), result.path) || 'requirements.json'} (${result.count} requirement(s))`);
} else {
  const errors = [];
  const result = validateRequirementsFile(options.specDir, errors, { required: options.required });
  for (const error of errors) console.error(`ERROR ${error}`);
  const count = result.requirementIds.length;
  console.log(`Checked requirements.json in ${relative(process.cwd(), options.specDir) || '.'} (${count} requirement(s))`);
  if (errors.length > 0) process.exit(1);
}

function parseArgs(argv) {
  const options = { mode: 'check', specDir: process.cwd(), force: false, required: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'generate' || arg === '--generate') options.mode = 'generate';
    else if (arg === 'check' || arg === '--check') options.mode = 'check';
    else if (arg === '--spec-dir') options.specDir = argv[++i];
    else if (arg === '--force') options.force = true;
    else if (arg === '--required') options.required = true;
  }
  return options;
}
