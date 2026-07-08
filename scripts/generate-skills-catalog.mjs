#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitIfOutOfSync, writeIfChanged } from './lib/generate-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_DIR = join(ROOT, 'skills');
const PIPELINE_SCHEMA_PATH = join(ROOT, 'config', 'pipeline.schema.json');

const MARKER_OPEN = '<!-- loom:generate:skills-catalog -->';
const MARKER_CLOSE = '<!-- /loom:generate:skills-catalog -->';

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const data = {};
  for (const line of yaml.split('\n')) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) {
      const val = kv[2].trim();
      if (val === '>' || val === '|') continue;
      if (val.startsWith('>')) {
        data[kv[1]] = val.slice(1).trim();
      } else {
        data[kv[1]] = val;
      }
    } else if (line.startsWith('  ') && data.description !== undefined) {
      data.description += ' ' + line.trim();
    }
  }
  return data;
}

function loadSkills() {
  const skills = [];
  for (const dir of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillFile = join(SKILLS_DIR, dir.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const content = readFileSync(skillFile, 'utf-8');
    const fm = parseFrontmatter(content);
    if (fm && fm.name) {
      skills.push({ name: fm.name, description: fm.description || '', dirName: dir.name });
    }
  }
  return skills;
}

function loadPipelineSteps() {
  const schema = JSON.parse(readFileSync(PIPELINE_SCHEMA_PATH, 'utf-8'));
  const steps = [];
  for (const [key, state] of Object.entries(schema.states)) {
    if (state.step != null && state.skill) {
      steps.push({ name: state.skill, step: state.step, description: state.description });
    }
  }
  steps.sort((a, b) => (typeof a.step === 'number' ? a.step : 99) - (typeof b.step === 'number' ? b.step : 99));
  return { steps, totalSteps: steps.length };
}

const PIPELINE_SKILLS = [
  'loom-brainstorming', 'loom-writing-plans', 'loom-using-git-worktrees',
  'loom-subagent-driven-development', 'loom-verification-before-completion', 'loom-index-update'
];
const AUX_SKILLS = ['loom-init-project', 'loom-router', 'loom-pipeline-selector', 'loom-using-loom'];
const GENERAL_SKILLS = [
  'loom-test-driven-development', 'loom-systematic-debugging',
  'loom-requesting-code-review', 'loom-receiving-code-review',
  'loom-dispatching-parallel-agents', 'loom-writing-skills',
  'loom-finishing-a-development-branch'
];
const QA_SKILLS = ['loom-qa'];

const SKILL_DETAILS = {
  'loom-brainstorming': { output: '`specs/<date+feature>/spec.md`', note: '需求头脑风暴, +可视化伴侣、设计自检、用户审查 Gate' },
  'loom-writing-plans': { output: '`specs/<date+feature>/plan.md`', note: '分层拆解 task, +模型选择、类型一致性检查' },
  'loom-using-git-worktrees': { output: 'feature 分支', note: '创建隔离分支, +测试基线验证' },
  'loom-subagent-driven-development': { output: '源码 + 测试报告', note: 'Subagent 派发 + 双重审查,独立模板文件、4种状态处理' },
  'loom-verification-before-completion': { output: '验证报告', note: '完成前验证, +Spec覆盖、类型一致性、编译测试' },
  'loom-index-update': { output: 'codegraph 同步 + 结构化记忆', note: 'codegraph 同步' },
  'loom-init-project': { note: '项目初始化（扫描 + 生成宪章/记忆/入口）' },
  'loom-router': { note: '轻量入口路由（分流到 skill 或 pipeline selector，不写流水线状态）' },
  'loom-pipeline-selector': { note: '开发流水线步骤选择（确认后写入 dynamic_steps）' },
  'loom-using-loom': { note: 'loom 框架使用指南（本 skill）' },
  'loom-test-driven-development': { note: 'TDD 测试驱动开发，+流程图、好/坏示例、常见借口表' },
  'loom-systematic-debugging': { note: '系统化调试, +4阶段流程图、条件等待、纵深防御' },
  'loom-requesting-code-review': { note: '请求代码审查, +预审查清单、审查模板' },
  'loom-receiving-code-review': { note: '接受代码审查, +响应模板、流程图' },
  'loom-dispatching-parallel-agents': { note: '并行 agent 派发, +模型选择、并发工作流图' },
  'loom-writing-skills': { note: '编写自定义 skills, +方法论深度、流程图' },
  'loom-finishing-a-development-branch': { note: '分支完成流程 , +选项展示（Merge/PR/Keep/Discard）' },
  'loom-qa': { output: '`qa/<date+target>/qa-report.md`', note: 'QA 验收流水线，测试人员使用：新功能验证 + 回归 + 集成测试 + 持久化用例库' },
};

function makeRow(skill) {
  const d = SKILL_DETAILS[skill];
  if (!d) return null;
  if (d.output) {
    return `| ${skill} | ${d.output} | ${d.note} |`;
  }
  return `| ${skill} | ${d.note} |`;
}

function generateFullCatalog() {
  const { totalSteps } = loadPipelineSteps();
  let md = '';
  md += `所有 skills 通过 \`/\` 命令或 Skill 工具调用。详见 \`.loom/skills/\` 目录（完整定义）\n\n`;
  md += `**核心流水线 Skills：**\n\n`;
  md += `| Skill                               | 输出                           | 说明                                               |\n`;
  md += `| ----------------------------------- | ------------------------------ | -------------------------------------------------- |\n`;
  for (const s of PIPELINE_SKILLS) {
    md += makeRow(s) + '\n';
  }
  md += `\n**辅助 Skills：**\n\n`;
  md += `| Skill             | 说明                               |\n`;
  md += `| ----------------- | ---------------------------------- |\n`;
  for (const s of AUX_SKILLS) {
    md += makeRow(s) + '\n';
  }
  md += `\n**通用 Skills：**\n\n`;
  md += `| Skill                               | 说明                                              |\n`;
  md += `| ----------------------------------- | ------------------------------------------------- |\n`;
  for (const s of GENERAL_SKILLS) {
    md += makeRow(s) + '\n';
  }
  md += `\n**测试 Skills：**\n\n`;
  md += `| Skill      | 输出                           | 说明                                                        |\n`;
  md += `| ---------- | ------------------------------ | ----------------------------------------------------------- |\n`;
  for (const s of QA_SKILLS) {
    md += makeRow(s) + '\n';
  }
  return md.trimEnd();
}

function generateSummaryCatalog() {
  const { totalSteps } = loadPipelineSteps();
  let md = '';
  md += `${totalSteps} 流水线 + ${AUX_SKILLS.length} 辅助 + ${GENERAL_SKILLS.length} 通用 + ${QA_SKILLS.length} 测试 Skill，共 ${PIPELINE_SKILLS.length + AUX_SKILLS.length + GENERAL_SKILLS.length + QA_SKILLS.length} 个\n\n`;
  md += `**核心流水线 Skills：**\n\n`;
  md += `| Skill                               | 输出                           | 说明                                               |\n`;
  md += `| ----------------------------------- | ------------------------------ | -------------------------------------------------- |\n`;
  for (const s of PIPELINE_SKILLS) {
    md += makeRow(s) + '\n';
  }
  md += `\n**辅助 Skills：**\n\n`;
  md += `| Skill             | 说明                               |\n`;
  md += `| ----------------- | ---------------------------------- |\n`;
  for (const s of AUX_SKILLS) {
    md += makeRow(s) + '\n';
  }
  md += `\n**通用 Skills：**\n\n`;
  md += `| Skill                               | 说明                                              |\n`;
  md += `| ----------------------------------- | ------------------------------------------------- |\n`;
  for (const s of GENERAL_SKILLS) {
    md += makeRow(s) + '\n';
  }
  md += `\n**测试 Skills：**\n\n`;
  md += `| Skill      | 输出                           | 说明                                                        |\n`;
  md += `| ---------- | ------------------------------ | ----------------------------------------------------------- |\n`;
  for (const s of QA_SKILLS) {
    md += makeRow(s) + '\n';
  }
  md += `\n> 完整定义详见 \`skills/loom-using-loom/SKILL.md\` 或 \`.loom/skills/\` 目录`;
  return md.trimEnd();
}

function injectIntoFile(filePath, content) {
  if (!existsSync(filePath)) {
    console.error(`  ✘ ${filePath} — file not found`);
    return false;
  }
  const fileContent = readFileSync(filePath, 'utf-8');
  const startIdx = fileContent.indexOf(MARKER_OPEN);
  const endIdx = fileContent.indexOf(MARKER_CLOSE);
  if (startIdx === -1 || endIdx === -1) {
    console.warn(`  ⚠ ${filePath} — markers not found, skipping`);
    return false;
  }
  const newContent = fileContent.slice(0, startIdx + MARKER_OPEN.length) + '\n' + content + '\n' + fileContent.slice(endIdx);
  return writeIfChanged(filePath, newContent);
}

const fullCatalog = generateFullCatalog();
const summaryCatalog = generateSummaryCatalog();

console.log('Skills catalog generation:\n');

injectIntoFile(join(ROOT, 'skills', 'loom-using-loom', 'SKILL.md'), fullCatalog);
injectIntoFile(join(ROOT, 'LOOM.md'), summaryCatalog);
injectIntoFile(join(ROOT, 'README.md'), summaryCatalog);

console.log('\n✔ Skills catalog generation complete');
exitIfOutOfSync();
