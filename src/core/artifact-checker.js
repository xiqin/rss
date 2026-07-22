/**
 * artifact-checker.js — 产物存在性与内容校验
 *
 * 每个流水线阶段进入前，检查前置产物是否齐全；
 * 阶段完成后，检查输出产物是否落地且无占位符。
 * 不执行代码，只做文件系统和文本扫描。
 */

import { NodeFileSystem } from './fs-interface.js';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { sha256File } from './fingerprints.js';

// 占位符标记：大写形式，区分大小写，避免误伤正文 "todo list" 这类普通词
const PLACEHOLDER_MARKER_RE = /\b(TBD|TODO|FIXME|XXX)\b/;
// 明确的英文占位短语：大小写不敏感（已移除 HH:mm，正常文档会出现时间格式说明）
const PLACEHOLDER_PHRASE_RE = /\b(implement later|fill in details|placeholder text)\b/i;
const TEMPLATE_VAR_RE = /\{\{[A-Z_]+\}\}/; // 未渲染的模板变量 {{FOO}}

export function hasPlaceholder(content) {
  return PLACEHOLDER_MARKER_RE.test(content)
    || PLACEHOLDER_PHRASE_RE.test(content)
    || TEMPLATE_VAR_RE.test(content);
}


// ── 核心函数 ───────────────────────────────────────────────────────────────

/**
 * 检查进入某阶段的前置条件
 * @param {string[]} requires - 元素尾 '/' 表示目录检查
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function checkPreconditions(specDir, requires, fs = new NodeFileSystem()) {
  const missing = [];
  for (const req of (requires || [])) {
    const isDir = req.endsWith('/');
    const rel  = isDir ? req.slice(0, -1) : req;
    if (!fs.existsSync(join(specDir, rel))) missing.push(req);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * 检查阶段完成后的产物是否落地且无占位符
 * @param {string[]} outputs
 * @returns {{ ok: boolean, missing: string[], withPlaceholders: string[] }}
 */
export function checkStageOutputs(specDir, outputs, fs = new NodeFileSystem()) {
  const missing = [];
  const withPlaceholders = [];

  for (const file of (outputs || [])) {
    const isDir = file.endsWith('/');
    const rel = isDir ? file.slice(0, -1) : file;
    const path = join(specDir, rel);
    if (!fs.existsSync(path)) {
      missing.push(file);
      continue;
    }
    if (isDir) continue;
    const content = fs.readFileSync(path, 'utf-8');
    if (hasPlaceholder(content)) withPlaceholders.push(file);
  }

  return {
    ok: missing.length === 0 && withPlaceholders.length === 0,
    missing,
    withPlaceholders
  };
}

/**
 * 通用 verdict 检查：读指定报告文件，verdict===PASS 则通过
 * @param {string} filename - 相对 specDir 的文件名
 */
export function isReportPassing(specDir, filename, fs = new NodeFileSystem(), options = {}) {
  const path = join(specDir, filename);
  if (!fs.existsSync(path)) return false;
  const content = fs.readFileSync(path, 'utf-8');
  const verdict = parseVerdict(content);
  if (verdict) {
    if (verdict !== 'PASS') return false;
    return !options.requireEvidence || validateReportEvidence(specDir, content, fs).ok;
  }
  // fallback 启发式（无显式裁定时保守判断）
  const hasFail = /\bFAIL\b|失败|不通过|\bBLOCKER\b/.test(content);
  const hasPass = /\bPASS\b|通过|all checks passed/i.test(content);
  if (!hasPass || hasFail) return false;
  return !options.requireEvidence || validateReportEvidence(specDir, content, fs).ok;
}

/**
 * Validate a compact evidence receipt embedded in a report.
 * Raw command output remains on disk, keeping prompts small while preventing a bare PASS.
 */
export function validateReportEvidence(specDir, content, fs = new NodeFileSystem()) {
  const field = name => content.match(new RegExp(`^\\s*(?:[-*]\\s*)?${name}\\s*:\\s*(.+?)\\s*$`, 'mi'))?.[1]?.replace(/^`|`$/g, '');
  const command = field('evidence-command');
  const exitCode = field('evidence-exit-code');
  const evidenceFile = field('evidence-file');
  const expectedHash = field('evidence-sha256')?.toLowerCase();
  const errors = [];

  if (!command) errors.push('missing evidence-command');
  if (exitCode !== '0') errors.push('evidence-exit-code must be 0');
  if (!evidenceFile) errors.push('missing evidence-file');
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) errors.push('invalid evidence-sha256');

  let actualHash = null;
  if (evidenceFile) {
    const candidate = resolve(specDir, evidenceFile);
    const rel = relative(resolve(specDir), candidate);
    if (isAbsolute(evidenceFile) || rel.startsWith('..') || isAbsolute(rel)) {
      errors.push('evidence-file escapes spec directory');
    } else {
      actualHash = sha256File(candidate, fs);
      if (!actualHash) errors.push('evidence-file missing');
      else if (expectedHash && actualHash !== expectedHash) errors.push('evidence-sha256 mismatch');
    }
  }

  return { ok: errors.length === 0, errors, command, exitCode, evidenceFile, actualHash };
}

/**
 * 检测 spec 目录当前所处的流水线阶段（基于文件存在性推断）
 * 仅作为 pipeline.state.json 缺失时的 fallback。状态文件存在时以它为准。
 *
 * 不再依赖 progress.md 的文本匹配（progress.md 是自动生成的，
 * 任何 task 曾 executing 就含该词，导致阶段判断永久卡死）。
 * 改用 task-states/ 目录是否非空来判断是否已进入执行阶段。
 */
export function inferStageFromArtifacts(specDir, fs = new NodeFileSystem()) {
  const has = (f) => fs.existsSync(join(specDir, f));

  if (has('verify-report.md') && markdownReportPasses(specDir, 'verify-report.md', fs)) return 'synced';
  if (has('convergence-report.json') && jsonStatusIn(specDir, 'convergence-report.json', ['converged'], fs)) return 'verification';
  if (has('test-report.md'))   return 'converge';

  // task-states 目录存在且非空 → subagent 已开工 → executing
  const taskStatesDir = join(specDir, 'task-states');
  if (fs.existsSync(taskStatesDir)) {
    try {
      if (fs.readdirSync(taskStatesDir).some(f => f.endsWith('.state.json'))) {
        return 'executing';
      }
    } catch {}
  }

  if (has('artifact-analysis.json') && jsonStatusIn(specDir, 'artifact-analysis.json', ['pass'], fs)) return 'approved';
  if (has('plan.md'))   return 'analyze-artifacts';
  if (has('handoffs/detail-expansion.json')) return 'planning';
  if (has('spec.md'))   return 'detail-expansion';
  return 'brainstorming';
}

function jsonStatusIn(specDir, file, allowed, fs) {
  try {
    const data = JSON.parse(fs.readFileSync(join(specDir, file), 'utf-8'));
    return allowed.includes(String(data.status || '').toLowerCase()) && Number(data.blocker_count || 0) === 0;
  } catch {
    return false;
  }
}

function markdownReportPasses(specDir, file, fs) {
  try {
    const content = fs.readFileSync(join(specDir, file), 'utf-8');
    const verdict = parseVerdict(content);
    if (verdict) return verdict === 'PASS';
    return /\bPASS\b/i.test(content) && !/\b(FAIL|FAILED|BLOCKER|ERROR)\b/i.test(content);
  } catch {
    return false;
  }
}

/**
 * 解析报告里的结构化裁定。
 * 优先读显式标记（任一行匹配 `verdict: PASS` / `**Verdict:** FAIL` / `结论：通过`），
 * 只认整行的裁定字段，不再扫全文关键词（避免 "确保不会 FAIL" 这类句子误判）。
 * @returns {'PASS'|'FAIL'|null} null 表示报告未给出明确裁定
 */
export function parseVerdict(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    // 匹配：可选 markdown 强调/前缀 + verdict/结论 + 分隔符 + 值
    const m = line.match(/^[\s>*_#-]*(?:verdict|结论|裁定)\s*[:：]\s*\**\s*([A-Za-z一-龥]+)/i);
    if (m) {
      const v = m[1].toUpperCase();
      if (v === 'PASS' || v === '通过') return 'PASS';
      if (v === 'FAIL' || v === '失败' || v === '不通过' || v === 'BLOCKED') return 'FAIL';
      if (v === 'PARTIAL' || v === '部分') return 'PARTIAL';
    }
  }
  return null;
}

// ── Skill-specific 验证 ────────────────────────────────────────────────────

/**
 * 按 skill 粒度验证产物完整性和质量
 * @param {string} specDir
 * @param {string} skillName - skill 名称（如 'loom-brainstorming'）
 * @param {object} [fs]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateSkillOutput(specDir, skillName, fs = new NodeFileSystem()) {
  const errors = [];
  const warnings = [];

  const checks = {
    'loom-brainstorming': {
      required: ['spec.md'],
      validate(dir) {
        const specPath = join(dir, 'spec.md');
        if (!fs.existsSync(specPath)) return;
        const content = fs.readFileSync(specPath, 'utf-8');
        if (hasPlaceholder(content)) {
          const markers = content.match(/\b(TBD|TODO|FIXME|XXX)\b|\{\{[A-Z_]+\}\}/g) || [];
          errors.push(`spec.md 包含未填充占位符: ${[...new Set(markers)].join(', ')}`);
        }
        if (content.length < 200) {
          warnings.push('spec.md 内容过短（<200字），可能分析不足');
        }
      }
    },
    'loom-writing-plans': {
      required: ['plan.md'],
      validate(dir) {
        const planPath = join(dir, 'plan.md');
        if (!fs.existsSync(planPath)) return;
        const content = fs.readFileSync(planPath, 'utf-8');
        if (!/^[-*]\s+\[[\sx]\]/m.test(content) && !/^[|]/m.test(content)) {
          warnings.push('plan.md 未找到明确的任务拆解（缺少 checklist 或表格）');
        }
        if (hasPlaceholder(content)) {
          errors.push('plan.md 包含未填充占位符');
        }
      }
    },
    'loom-subagent-driven-development': {
      required: [],
      validate(dir) {
        const testReportPath = join(dir, 'test-report.md');
        if (!fs.existsSync(testReportPath)) {
          warnings.push('缺少测试报告 (test-report.md)');
        } else {
          const reportContent = fs.readFileSync(testReportPath, 'utf-8');
          if (!/\bPASS\b|\bFAIL\b|✓|✗|成功|失败/i.test(reportContent)) {
            errors.push('测试报告格式不明确（无法识别测试结果）');
          }
        }
      }
    },
    'loom-verification-before-completion': {
      required: ['verification-report.md'],
      validate(dir) {
        const reportPath = join(dir, 'verification-report.md');
        if (!fs.existsSync(reportPath)) return;
        const content = fs.readFileSync(reportPath, 'utf-8');
        const requiredChecks = ['spec-coverage', 'type-consistency', 'compilation'];
        for (const check of requiredChecks) {
          if (!content.includes(check) && !content.includes(check.replace('-', ' '))) {
            warnings.push(`验证报告缺少 ${check} 检查项`);
          }
        }
      }
    }
  };

  const check = checks[skillName];
  if (!check) return { valid: true, errors: [], warnings: [] };

  for (const file of check.required) {
    if (!fs.existsSync(join(specDir, file))) {
      errors.push(`缺少产物: ${file}`);
    }
  }

  if (check.validate) check.validate(specDir);

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 验证流水线一致性：已完成的阶段必须有对应产物
 * @param {string} specDir
 * @param {string[]} completedStages - 已完成的阶段 ID 列表
 * @param {object} [fs]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePipelineConsistency(specDir, completedStages, fs = new NodeFileSystem()) {
  const errors = [];
  const stageOutputs = {
    'brainstorming': ['spec.md', 'requirements.json'],
    'planning': ['plan.md', 'traceability.json'],
    'executing': ['test-report.md', 'traceability.json'],
    'verification': ['verify-report.md', 'traceability.json']
  };

  for (const stage of completedStages) {
    const outputs = stageOutputs[stage];
    if (!outputs) continue;
    for (const out of outputs) {
      if (!fs.existsSync(join(specDir, out))) {
        errors.push(`阶段 "${stage}" 已完成，但缺少产物: ${out}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}

/**
 * 检查 .md 产物文件是否包含必需的 section 标题
 * @param {string} specDir
 * @param {string} filename - 相对 specDir 的文件名
 * @param {string[]} requiredSections - 必需的 section 标题（如 ['## Approach', '## Tasks']）
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function checkRequiredSections(specDir, filename, requiredSections, fs = new NodeFileSystem()) {
  const path = join(specDir, filename);
  if (!fs.existsSync(path)) return { ok: false, missing: [filename] };
  const content = fs.readFileSync(path, 'utf-8');
  const missing = [];
  for (const section of (requiredSections || [])) {
    if (!content.includes(section)) missing.push(section);
  }
  return { ok: missing.length === 0, missing };
}
