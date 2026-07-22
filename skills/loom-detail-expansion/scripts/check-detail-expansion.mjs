#!/usr/bin/env node

import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  validateRequirementsFile,
  BEHAVIOR_CATEGORIES,
} from '../../../src/core/requirements.js';

const TYPE_TO_CATEGORY = {
  functional: 'happy-path',
  input: 'invalid-input',
  authorization: 'authorization',
  auth: 'authorization',
  write: 'atomicity',
  mutation: 'atomicity',
  state: 'state-transition',
  idempotent: 'idempotency',
  concurrent: 'concurrency',
  external: 'external-failure',
  security: 'security',
  performance: 'performance',
  observable: 'observability',
  recovery: 'recovery',
};

export function runDetailExpansionCheck(specDir) {
  const errors = [];
  const warnings = [];
  const stats = {
    total_reqs: 0,
    total_behaviors: 0,
    missing_category: 0,
    missing_test_plan: 0,
    requires_clarification: 0,
    placeholder_descriptions: 0,
  };

  const requirementsPath = join(specDir, 'requirements.json');
  if (!existsSync(requirementsPath)) {
    return {
      ok: false,
      error: `Missing requirements.json in ${specDir}`,
      errors: [`Missing requirements.json in ${specDir}`],
      warnings: [],
      stats,
    };
  }

  const result = validateRequirementsFile(specDir, errors, { required: true, requireTestPlan: true });
  if (errors.length > 0) {
    // keep errors but continue to collect more diagnostics
  }

  const data = JSON.parse(readFileSync(requirementsPath, 'utf8'));
  const requirements = Array.isArray(data.requirements)
    ? data.requirements
    : Object.values(data.requirements || {});

  for (const req of requirements) {
    stats.total_reqs += 1;
    const requiredCategories = collectRequiredCategories(req);
    const presentCategories = new Set(
      (req.behaviors || []).map((b) => b.category).filter(Boolean)
    );
    for (const category of requiredCategories) {
      if (!presentCategories.has(category)) {
        stats.missing_category += 1;
        errors.push(
          `requirements.json ${req.id} missing behavior category ${category}`
        );
      }
    }

    for (const behavior of req.behaviors || []) {
      stats.total_behaviors += 1;
      if (!isNonEmptyTestPlan(behavior.test_plan)) {
        stats.missing_test_plan += 1;
        errors.push(
          `requirements.json ${behavior.id} missing test_plan`
        );
      }
      if (
        behavior.applicability === 'requires-clarification' ||
        behavior.status === 'requires-clarification'
      ) {
        stats.requires_clarification += 1;
        errors.push(
          `requirements.json ${behavior.id} still requires clarification`
        );
      }
      if (
        !behavior.description ||
        /^(verifiable behavior for|default behavior)/i.test(behavior.description)
      ) {
        stats.placeholder_descriptions += 1;
        errors.push(
          `requirements.json ${behavior.id} description is still placeholder`
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

function isNonEmptyTestPlan(testPlan) {
  if (!testPlan || typeof testPlan !== 'object') return false;
  return Object.values(testPlan).some(value => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function collectRequiredCategories(req) {
  const categories = [];
  const seen = new Set();
  for (const category of req.required_categories || []) {
    if (!seen.has(category)) {
      seen.add(category);
      categories.push(category);
    }
  }
  if (req.types) {
    for (const type of req.types) {
      const mapped = TYPE_TO_CATEGORY[type];
      if (mapped && !seen.has(mapped)) {
        seen.add(mapped);
        categories.push(mapped);
      }
    }
  }
  return categories;
}

// ── CLI 包装层（仅供 loom 仓库内开发/测试用，部署后路径会断裂） ──
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('check-detail-expansion.mjs');
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const r = runDetailExpansionCheck(options.specDir);
  for (const warning of r.warnings) console.warn(`WARN ${warning}`);
  for (const error of r.errors) console.error(`ERROR ${error}`);
  console.log(
    `Checked detail-expansion in ${options.specDir} (${r.stats.total_reqs} REQ, ${r.stats.total_behaviors} behaviors, ${r.stats.missing_category} missing category, ${r.stats.missing_test_plan} missing test_plan, ${r.stats.requires_clarification} requires-clarification, ${r.stats.placeholder_descriptions} placeholder descriptions)`
  );
  if (!r.ok) process.exit(1);
}

function parseArgs(argv) {
  const options = { specDir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spec-dir') options.specDir = argv[++i];
  }
  return options;
}
