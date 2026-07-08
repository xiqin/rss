#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_DIR = dirname(__dirname);
const PACKAGE_ROOT = join(SKILL_DIR, '..', '..');

const COMMON_IGNORE = [
  'node_modules/',
  'vendor/',
  'dist/',
  'build/',
  '.cache/',
  '.git/',
  '*.lock',
  '*.log',
  '__pycache__/',
  '.venv/',
  'venv/',
  '.coverage',
  '*.pyc',
  '*.pyo',
  '*.egg-info/',
  '.tox/',
  '.worktree/',
];

const ROLE_ALIASES = new Map([
  ['pm', 'pm'],
  ['product', 'pm'],
  ['product-manager', 'pm'],
  ['dev', 'dev'],
  ['developer', 'dev'],
  ['engineering', 'dev'],
  ['engineer', 'dev'],
]);

const TOOL_ALIASES = new Map([
  ['claude', 'claude-code'],
  ['claudecode', 'claude-code'],
  ['claude_code', 'claude-code'],
  ['claude-code', 'claude-code'],
  ['codex', 'codex'],
  ['cursor', 'cursor'],
  ['copilot', 'copilot'],
  ['github-copilot', 'copilot'],
  ['github_copilot', 'copilot'],
  ['opencode', 'opencode'],
  ['open-code', 'opencode'],
  ['open_code', 'opencode'],
]);

export function initProject(options = {}) {
  const cwd = options.cwd || process.cwd();
  const force = Boolean(options.force);
  const templateDir = resolveTemplateDir(options.templateDir);
  const roles = detectRoles(options.roles);
  const graphBackend = detectGraphBackend(options.graphBackend);
  const facts = analyzeProject(cwd);
  const variables = buildVariables(facts);
  // 入口文件「必读上下文」按角色裁剪，避免指向未生成的文件
  variables.REQUIRED_CONTEXT = buildRequiredContext(roles, graphBackend);
  variables.GRAPH_BACKEND_DESC = renderGraphBackendDesc(graphBackend);
  variables.GRAPH_SYNC_DESC = renderGraphSyncDesc(graphBackend);
  const result = {
    root: cwd,
    projectName: facts.projectName,
    techStack: variables.TECH_STACK_SUMMARY,
    roles: [...roles].sort(),
    graphBackend,
    written: [],
    skipped: [],
    detectedTools: [],
  };

  // 所有角色共用：结构化记忆 + 流水线定义（workflow 单文件含全部 pipeline）
  writeRendered(templateDir, 'memory.md', join(cwd, '.loom', 'memory', 'MEMORY.md'), variables, result, force);
  writeFile(join(cwd, '.loom', 'memory', 'store.json'), renderMemoryStore(variables), result, force);
  writeRendered(templateDir, 'workflow.yaml', join(cwd, '.loom', 'workflow.yaml'), variables, result, force);

  // dev 角色：工程上下文（宪章 / subagent 上下文）+ 图后端配置
  if (roles.has('dev')) {
    const constitutionPath = join(cwd, '.loom', 'rules', 'constitution.md');
    writeRendered(templateDir, 'constitution.md', constitutionPath, variables, result, force);
    const constitution = readTextIfExists(constitutionPath) || '';
    writeFile(
      join(cwd, '.loom', 'contexts', 'subagent-context.md'),
      renderSubagentContext(variables, constitution),
      result,
      force
    );
    // 写入图后端配置；codegraph 后端额外尝试自动建图（向后兼容）
    writeGraphConfig(cwd, graphBackend, result, force);
    if (graphBackend === 'codegraph') {
      ensureCodegraphIndex(cwd, result);
    }
  }

  // pm 角色：产品上下文模板（变量由 SKILL.md 问卷后填充，此处保留占位符待补）
  if (roles.has('pm')) {
    writeFile(
      join(cwd, '.loom', 'rules', 'product.md'),
      readTemplate(templateDir, 'product.md'),
      result,
      force
    );
  }

  const tools = detectTools(cwd, options.tools);
  result.detectedTools = [...tools].sort();
  const wrapper = renderTemplate(readTemplate(templateDir, 'agents.md'), variables);

  if (tools.has('codex') || tools.has('opencode') || tools.has('claude-code')) {
    writeFile(join(cwd, 'AGENTS.md'), wrapper, result, force);
  }
  if (tools.has('claude-code')) {
    writeFile(join(cwd, 'CLAUDE.md'), '@AGENTS.md\n', result, force);
    writeIgnoreFile(join(cwd, '.claudeignore'), result, force);
  }
  if (tools.has('copilot')) {
    writeFile(join(cwd, '.github', 'copilot-instructions.md'), wrapper, result, force);
  }
  if (tools.has('cursor')) {
    writeFile(join(cwd, '.cursor', 'rules', 'loom.mdc'), renderCursorRule(wrapper), result, force);
    writeIgnoreFile(join(cwd, '.cursorignore'), result, force);
  }
  if (tools.has('codex')) {
    writeIgnoreFile(join(cwd, '.codexignore'), result, force);
  }
  if (tools.has('opencode')) {
    mergeOpenCodeIgnore(join(cwd, 'opencode.json'), result);
  }

  return result;
}

function resolveTemplateDir(explicitDir) {
  const candidates = [
    explicitDir,
    join(SKILL_DIR, 'templates'),
    join(PACKAGE_ROOT, 'templates'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'constitution.md'))) return candidate;
  }

  throw new Error('Cannot find loom templates directory.');
}

function analyzeProject(root) {
  const pkg = readJsonIfExists(join(root, 'package.json'));
  const goMod = readTextIfExists(join(root, 'go.mod'));
  const pyproject = readTextIfExists(join(root, 'pyproject.toml'));
  const requirements = readTextIfExists(join(root, 'requirements.txt'));
  const cargo = readTextIfExists(join(root, 'Cargo.toml'));
  const pom = readTextIfExists(join(root, 'pom.xml'));
  const gradle = readTextIfExists(join(root, 'build.gradle')) || readTextIfExists(join(root, 'build.gradle.kts'));

  const projectName = pkg?.name || extractGoModuleName(goMod) || basename(root);
  const projectDesc = pkg?.description || extractReadmeSummary(root) || '[TODO: 补充项目描述]';
  const tech = detectTech({ root, pkg, goMod, pyproject, requirements, cargo, pom, gradle });

  return {
    root,
    projectName,
    projectDesc,
    packageJson: pkg,
    tech,
    directoryTree: buildDirectoryTree(root),
    factSources: [
      'package.json', 'go.mod', 'pyproject.toml', 'requirements.txt',
      'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'tsconfig.json'
    ].filter(name => existsSync(join(root, name))),
  };
}

function detectTech({ root, pkg, goMod, pyproject, requirements, cargo, pom, gradle }) {
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasTs = Boolean(deps.typescript || existsSync(join(root, 'tsconfig.json')));
    return {
      language: hasTs ? 'TypeScript' : 'JavaScript',
      languageVersion: pkg.engines?.node || '[TODO: Node 版本]',
      framework: findFirstDependency(deps, ['next', 'vite', 'react', 'vue', 'express', 'koa', 'fastify']) || '[TODO: Web 框架]',
      orm: findFirstDependency(deps, ['prisma', 'typeorm', 'sequelize', 'mongoose']) || '[TODO: ORM]',
      database: findFirstDependency(deps, ['pg', 'mysql2', 'sqlite3', 'better-sqlite3', 'mongodb']) || '[TODO: 数据库]',
      cache: findFirstDependency(deps, ['redis', 'ioredis']) || '[TODO: 缓存]',
      logging: findFirstDependency(deps, ['pino', 'winston', 'debug']) || '[TODO: 日志]',
      di: findFirstDependency(deps, ['inversify', 'tsyringe']) || '[TODO: 依赖注入]',
      buildCmd: pkg.scripts?.build ? 'npm run build' : '[TODO: 构建命令]',
      vetCmd: pkg.scripts?.lint ? 'npm run lint' : 'npm test',
      testCmd: pkg.scripts?.test ? 'npm test' : '[TODO: 测试命令]',
    };
  }

  if (goMod) {
    return {
      language: 'Go',
      languageVersion: extractGoVersion(goMod) || '[TODO: Go 版本]',
      framework: includesAny(goMod, ['gin-gonic/gin', 'labstack/echo', 'gofiber/fiber']) || '[TODO: Web 框架]',
      orm: includesAny(goMod, ['gorm.io/gorm', 'entgo.io/ent']) || '[TODO: ORM]',
      database: includesAny(goMod, ['go-sql-driver/mysql', 'jackc/pgx', 'mattn/go-sqlite3']) || '[TODO: 数据库]',
      cache: includesAny(goMod, ['redis/go-redis']) || '[TODO: 缓存]',
      logging: includesAny(goMod, ['uber-go/zap', 'sirupsen/logrus', 'rs/zerolog']) || '[TODO: 日志]',
      di: includesAny(goMod, ['google/wire', 'uber-go/fx']) || '[TODO: 依赖注入]',
      buildCmd: 'go build ./...',
      vetCmd: 'go vet ./...',
      testCmd: 'go test ./... -v -count=1',
    };
  }

  if (pyproject || requirements) {
    return {
      language: 'Python',
      languageVersion: '[TODO: Python 版本]',
      framework: includesAny(`${pyproject}\n${requirements}`, ['fastapi', 'django', 'flask']) || '[TODO: Web 框架]',
      orm: includesAny(`${pyproject}\n${requirements}`, ['sqlalchemy', 'django', 'tortoise-orm']) || '[TODO: ORM]',
      database: includesAny(`${pyproject}\n${requirements}`, ['psycopg', 'pymysql', 'sqlite']) || '[TODO: 数据库]',
      cache: includesAny(`${pyproject}\n${requirements}`, ['redis']) || '[TODO: 缓存]',
      logging: 'logging',
      di: '[TODO: 依赖注入]',
      buildCmd: 'python -m compileall .',
      vetCmd: 'ruff check .',
      testCmd: 'pytest -v',
    };
  }

  if (cargo) {
    return {
      language: 'Rust',
      languageVersion: '[TODO: Rust 版本]',
      framework: includesAny(cargo, ['axum', 'actix-web', 'rocket']) || '[TODO: Web 框架]',
      orm: includesAny(cargo, ['diesel', 'sqlx', 'sea-orm']) || '[TODO: ORM]',
      database: includesAny(cargo, ['postgres', 'mysql', 'sqlite']) || '[TODO: 数据库]',
      cache: includesAny(cargo, ['redis']) || '[TODO: 缓存]',
      logging: includesAny(cargo, ['tracing', 'log']) || '[TODO: 日志]',
      di: '[TODO: 依赖注入]',
      buildCmd: 'cargo build',
      vetCmd: 'cargo clippy',
      testCmd: 'cargo test',
    };
  }

  if (pom || gradle) {
    return {
      language: 'Java',
      languageVersion: '[TODO: Java 版本]',
      framework: includesAny(`${pom}\n${gradle}`, ['spring-boot', 'micronaut', 'quarkus']) || '[TODO: Web 框架]',
      orm: includesAny(`${pom}\n${gradle}`, ['hibernate', 'mybatis', 'jpa']) || '[TODO: ORM]',
      database: includesAny(`${pom}\n${gradle}`, ['mysql', 'postgresql', 'h2']) || '[TODO: 数据库]',
      cache: includesAny(`${pom}\n${gradle}`, ['redis', 'caffeine']) || '[TODO: 缓存]',
      logging: includesAny(`${pom}\n${gradle}`, ['logback', 'log4j']) || '[TODO: 日志]',
      di: 'Spring DI',
      buildCmd: pom ? 'mvn compile' : 'gradle build',
      vetCmd: pom ? 'mvn checkstyle:check' : 'gradle check',
      testCmd: pom ? 'mvn test' : 'gradle test',
    };
  }

  return {
    language: '[TODO: 编程语言]',
    languageVersion: '[TODO: 语言版本]',
    framework: '[TODO: Web 框架]',
    orm: '[TODO: ORM]',
    database: '[TODO: 数据库]',
    cache: '[TODO: 缓存]',
    logging: '[TODO: 日志]',
    di: '[TODO: 依赖注入]',
    buildCmd: '[TODO: 构建命令]',
    vetCmd: '[TODO: 静态检查命令]',
    testCmd: '[TODO: 测试命令]',
  };
}

function buildVariables(facts) {
  const tech = facts.tech;
  const stack = [
    tech.language,
    tech.framework,
    tech.orm,
    tech.database,
    tech.cache,
    tech.logging,
  ].filter(item => item && !item.startsWith('[TODO')).join(' / ') || '[TODO: 技术栈摘要]';

  return {
    PROJECT_NAME: facts.projectName,
    PROJECT_DESC: facts.projectDesc,
    INIT_DATE: new Date().toISOString().slice(0, 10),
    TECH_STACK_SUMMARY: stack,
    LANGUAGE: tech.language,
    LANGUAGE_VERSION: tech.languageVersion,
    WEB_FRAMEWORK: tech.framework,
    FRAMEWORK_VERSION: versionOf(tech.framework, facts.packageJson),
    ORM: tech.orm,
    ORM_VERSION: versionOf(tech.orm, facts.packageJson),
    DATABASE: tech.database,
    DATABASE_VERSION: versionOf(tech.database, facts.packageJson),
    CACHE: tech.cache,
    CACHE_VERSION: versionOf(tech.cache, facts.packageJson),
    LOGGING: tech.logging,
    LOGGING_VERSION: versionOf(tech.logging, facts.packageJson),
    DI: tech.di,
    DI_VERSION: versionOf(tech.di, facts.packageJson),
    BUILD_CMD: tech.buildCmd,
    VET_CMD: tech.vetCmd,
    TEST_CMD: tech.testCmd,
    DIRECTORY_TREE: facts.directoryTree,
    ARCH_PATTERN: inferArchPattern(facts.directoryTree),
    ENTRY_POINTS: '[TODO: 入口文件]',
    ARCH_PRINCIPLE: '遵循现有架构边界',
    ARCH_DESC: '新增代码放在既有分层中，不为单次需求创建额外架构层。',
    DI_PRINCIPLE: '依赖显式传递',
    DI_DESC: '优先复用项目现有依赖注入方式，避免隐藏全局状态。',
    CONFIG_PRINCIPLE: '配置集中管理',
    CONFIG_DESC: '新增配置必须进入项目既有配置系统，并提供安全默认值。',
    ERROR_PRINCIPLE: '错误可诊断',
    ERROR_DESC: '保留调用上下文，面向用户和日志使用一致的错误语义。',
    CODEGEN_PRINCIPLE: '生成物可追踪',
    CODEGEN_DESC: '生成代码必须有来源、命令和再生成方式。',
    CODING_REDLINES: '- [TODO] 补充项目禁止事项、兼容性边界和安全红线。',
    FACT_SOURCES: facts.factSources.join(', ') || 'none (inspect source before implementation)',
  };
}

function writeRendered(templateDir, templateName, target, variables, result, force) {
  const content = renderTemplate(readTemplate(templateDir, templateName), variables);
  writeFile(target, content, result, force);
}

function readTemplate(templateDir, name, fallbackName) {
  const primary = join(templateDir, name);
  if (existsSync(primary)) return readFileSync(primary, 'utf8');
  if (fallbackName) return readFileSync(join(templateDir, fallbackName), 'utf8');
  throw new Error(`Missing template: ${name}`);
}

function renderTemplate(template, variables) {
  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => variables[key] ?? `[TODO: ${key}]`);
  const unresolved = rendered.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (unresolved) {
    throw new Error(`Unresolved template variables: ${[...new Set(unresolved)].join(', ')}`);
  }
  return rendered;
}

function writeFile(target, content, result, force) {
  if (existsSync(target) && !force) {
    const current = readFileSync(target, 'utf8');
    if (!isGeneratedByLoom(current)) {
      result.skipped.push({ path: target, reason: 'existing file is not loom-managed' });
      return;
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, normalizeNewlines(content), 'utf8');
  result.written.push(target);
}

function writeIgnoreFile(target, result, force) {
  const content = `# Generated by loom init-project\n${COMMON_IGNORE.join('\n')}\n`;
  writeFile(target, content, result, force);
}

function mergeOpenCodeIgnore(configPath, result) {
  const config = readJsonIfExists(configPath) || {};
  config.watcher ||= {};
  config.watcher.ignore ||= [];
  let changed = false;
  for (const pattern of COMMON_IGNORE) {
    const normalized = pattern.replace(/\/$/, '');
    if (!config.watcher.ignore.includes(normalized)) {
      config.watcher.ignore.push(normalized);
      changed = true;
    }
  }
  if (changed || !existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    result.written.push(configPath);
  }
}

export function normalizeRoles(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  const roles = new Set();
  for (const item of items) {
    const normalized = String(item).trim().toLowerCase();
    if (!normalized) continue;
    const canonical = ROLE_ALIASES.get(normalized);
    if (!canonical) {
      throw new Error(`Unsupported role "${item}". Supported roles: pm, dev.`);
    }
    roles.add(canonical);
  }
  return [...roles];
}

function detectRoles(explicitRoles) {
  if (explicitRoles?.length) return new Set(normalizeRoles(explicitRoles));
  // 未指定时默认 dev（与历史行为一致：生成完整工程上下文）
  return new Set(['dev']);
}

// 按角色生成入口文件「必读上下文」清单，只列出实际会生成的文件
function buildRequiredContext(roles, graphBackend = 'codegraph') {
  const items = [];
  if (roles.has('pm')) {
    items.push('`.loom/rules/product.md`：产品定位、目标用户、原型约束（PM 视角）。');
  }
  if (roles.has('dev')) {
    items.push('`.loom/rules/constitution.md`：项目原则、技术栈、目录分层、架构模式、验证命令和红线。');
    items.push(renderGraphBackendContextItem(graphBackend));
  }
  items.push('`.loom/memory/store.json`：结构化记忆源；`.loom/memory/MEMORY.md` 是只读导出视图。');
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

// 渲染「必读上下文」中的图后端条目
function renderGraphBackendContextItem(graphBackend) {
  switch (graphBackend) {
    case 'codegraph':
      return '图后端 codegraph：通过 `loom_graph_query` 查询；未启用时跳过图索引同步。';
    case 'sourcegraph':
      return '图后端 sourcegraph：通过 `loom_graph_query` 查询；未启用时跳过图索引同步。';
    case 'scip':
      return '图后端 scip：通过 `loom_graph_query` 查询；索引由用户自行生成（`.lsif` / `.scip`）。';
    case 'none':
      return '图后端未启用：所有代码查询走源码搜索和 git diff。';
    default:
      return `图后端 ${graphBackend}：通过 \`loom_graph_query\` 查询；未启用时跳过图索引同步。`;
  }
}

// 渲染 agents.md 中的 {{GRAPH_BACKEND_DESC}} 占位符文案（上下文读取策略 + 完成前检查）
function renderGraphBackendDesc(graphBackend) {
  switch (graphBackend) {
    case 'codegraph':
      return '图后端 codegraph：通过 `loom_graph_query` 查询；不可用时跳过图查询并用源码搜索补充判断';
    case 'sourcegraph':
      return '图后端 sourcegraph：通过 `loom_graph_query` 查询；不可用时跳过图查询并用源码搜索补充判断';
    case 'scip':
      return '图后端 scip：通过 `loom_graph_query` 查询（需要 `.lsif` / `.scip` 索引文件）；不可用时跳过图查询并用源码搜索补充判断';
    case 'none':
      return '图后端未启用：所有代码查询走源码搜索和 git diff';
    default:
      return `图后端 ${graphBackend}：通过 \`loom_graph_query\` 查询；不可用时跳过图查询并用源码搜索补充判断`;
  }
}

// 渲染 agents.md 中「完成前检查」里的图后端同步文案
function renderGraphSyncDesc(graphBackend) {
  switch (graphBackend) {
    case 'codegraph':
      return '新增/删除的路由、模块、命令、关键约定已同步图后端（`loom index`：后端可用时委派同步；不可用时注明已跳过）';
    case 'sourcegraph':
      return '新增/删除的路由、模块、命令、关键约定已同步图后端（`loom index`：后端可用时委派同步；不可用时注明已跳过）';
    case 'scip':
      return '新增/删除的路由、模块、命令、关键约定已同步图后端（`loom index`：后端可用时委派同步；不可用时注明已跳过）';
    case 'none':
      return '图后端未启用，无需同步图索引（确认关键改动已在源码和 git diff 中体现）';
    default:
      return `新增/删除的路由、模块、命令、关键约定已同步图后端（\`loom index\`：后端可用时委派同步；不可用时注明已跳过）`;
  }
}

// 解析 --graph-backend 参数；默认 codegraph，与历史行为一致
export function normalizeGraphBackend(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'codegraph';
  const ALLOWED = new Set(['codegraph', 'sourcegraph', 'scip', 'none']);
  if (!ALLOWED.has(normalized)) {
    throw new Error(`Unsupported graph backend "${value}". Supported: codegraph, sourcegraph, scip, none.`);
  }
  return normalized;
}

function detectGraphBackend(explicit) {
  if (explicit) return normalizeGraphBackend(explicit);
  // 环境变量覆盖（CI/高安全环境可禁用图后端）
  if (process.env.LOOM_GRAPH_BACKEND) return normalizeGraphBackend(process.env.LOOM_GRAPH_BACKEND);
  return 'codegraph';
}

// 写入 .loom/graph.config.json
function writeGraphConfig(root, backend, result, force) {
  const config = buildGraphConfig(backend);
  const target = join(root, '.loom', 'graph.config.json');
  writeFile(target, `${JSON.stringify(config, null, 2)}\n`, result, force);
}

function buildGraphConfig(backend) {
  const base = {
    version: 1,
    backend,
    enabled: backend !== 'none',
    requiredCapabilities: ['explore', 'definition', 'references', 'impact'],
    fallback: { useSourceSearch: true, reportLimitations: true },
    trust: { allowRepositoryAdapter: false, allowNetwork: false },
  };
  if (backend === 'none') {
    base.requiredCapabilities = [];
  }
  return base;
}

// codegraph 后端：尝试 codegraph init 自动建图（向后兼容）；不可用时不失败
function ensureCodegraphIndex(root, result) {
  try {
    execSync('codegraph init', { cwd: root, stdio: 'ignore', timeout: 30000 });
    result.codegraphInit = 'ok';
  } catch {
    result.codegraphInit = 'unavailable (codegraph CLI not found or init failed; graph queries will be skipped)';
  }
}

export function normalizeToolIds(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  const tools = new Set();
  for (const item of items) {
    const normalized = String(item).trim().toLowerCase();
    if (!normalized) continue;
    const canonical = TOOL_ALIASES.get(normalized);
    if (!canonical) {
      throw new Error(`Unsupported tool "${item}". Supported tools: claude-code, codex, cursor, copilot, opencode.`);
    }
    tools.add(canonical);
  }
  return [...tools];
}

function detectTools(root, explicitTools) {
  if (explicitTools?.length) return new Set(normalizeToolIds(explicitTools));

  const tools = new Set(['codex']);
  if (existsSync(join(root, '.claude')) || existsSync(join(root, 'CLAUDE.md'))) tools.add('claude-code');
  if (existsSync(join(root, '.cursor'))) tools.add('cursor');
  if (existsSync(join(root, '.github'))) tools.add('copilot');
  if (existsSync(join(root, '.opencode')) || existsSync(join(root, 'opencode.json'))) tools.add('opencode');
  return tools;
}

function renderCursorRule(wrapper) {
  return `---\ndescription: "loom project entry. Read .loom source files before coding."\nalwaysApply: true\n---\n\n${wrapper}`;
}

function renderSubagentContext(variables, constitution = '') {
  const grounded = value => String(value || '')
    .replace(/^\[TODO:\s*(.+?)\]$/, 'UNKNOWN ($1; inspect project source before use)');
  const constitutionHash = createHash('sha256').update(constitution).digest('hex');
  return `# Subagent Context\n\n> Compact, generated grounding context. Keep this short; read source only for the requirement and files currently in scope.\n> constitution-sha256: ${constitutionHash}\n\n## Verified project facts\n\n- Name: ${grounded(variables.PROJECT_NAME)}\n- Stack: ${grounded(variables.TECH_STACK_SUMMARY)}\n- Architecture hint: ${grounded(variables.ARCH_PATTERN)} (directory-name inference only; verify against source)\n- Build: ${grounded(variables.BUILD_CMD)}\n- Check: ${grounded(variables.VET_CMD)}\n- Test: ${grounded(variables.TEST_CMD)}\n- Fact sources: ${variables.FACT_SOURCES}\n\n## Grounding priority\n\n1. Current source and command output\n2. Approved spec requirement IDs and constitution\n3. Handoffs (navigation hints only; verify signatures against source)\n\nIf a needed fact is UNKNOWN or conflicts with source, return NEEDS_CONTEXT instead of inventing it.\n\n## Boundaries\n\n- Follow .loom/rules/constitution.md.\n- Keep changes scoped to declared requirement IDs and owned files.\n- Report changed files, verification receipts, and unresolved risks.\n`;
}

function renderMemoryStore(variables) {
  const entry = {
    id: 'init',
    type: '状态',
    content: '项目初始化完成',
    author: 'loom-init-project',
    tags: [],
    context: variables.TECH_STACK_SUMMARY,
    created_at: `${variables.INIT_DATE}T00:00:00.000Z`,
  };
  return `${JSON.stringify({ entries: [entry], sessions: [] }, null, 2)}\n`;
}

function buildDirectoryTree(root, maxDepth = 2) {
  const ignored = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.cache', '.worktree']);
  const lines = [basename(root)];

  function walk(dir, depth, prefix) {
    if (depth > maxDepth) return;
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter(entry => !ignored.has(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 30);

    for (const entry of entries) {
      const marker = entry.isDirectory() ? '/' : '';
      lines.push(`${prefix}${entry.name}${marker}`);
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), depth + 1, `${prefix}  `);
      }
    }
  }

  walk(root, 1, '  ');
  return lines.join('\n');
}

function inferArchPattern(tree) {
  const checks = [
    ['internal/', 'Go internal package layout'],
    ['src/', 'src-based application layout'],
    ['app/', 'application router layout'],
    ['packages/', 'monorepo packages layout'],
  ];
  return checks.find(([needle]) => tree.includes(needle))?.[1] || '[TODO: 架构模式]';
}

function isGeneratedByLoom(content) {
  return content.includes('loom init-project')
    || content.includes('/loom-init-project')
    || content.includes('Generated by loom');
}

function normalizeNewlines(content) {
  return `${content.replace(/\r\n/g, '\n').replace(/\s+$/u, '')}\n`;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function extractGoModuleName(goMod) {
  return goMod.match(/^module\s+(.+)$/m)?.[1]?.split('/').pop();
}

function extractGoVersion(goMod) {
  return goMod.match(/^go\s+(.+)$/m)?.[1];
}

function extractReadmeSummary(root) {
  const readme = ['README.md', 'readme.md'].map(name => join(root, name)).find(existsSync);
  if (!readme) return '';
  return readFileSync(readme, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#')) || '';
}

function findFirstDependency(deps, names) {
  return names.find(name => deps?.[name]);
}

function includesAny(text, needles) {
  return needles.find(needle => text.includes(needle));
}

function versionOf(name, pkg) {
  if (!name || name.startsWith('[TODO') || !pkg) return '[TODO: 版本]';
  return pkg.dependencies?.[name] || pkg.devDependencies?.[name] || '[TODO: 版本]';
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cwd') options.cwd = argv[++i];
    else if (arg === '--force') options.force = true;
    else if (arg === '--roles') options.roles = normalizeRoles(argv[++i]);
    else if (arg === '--tools') options.tools = normalizeToolIds(argv[++i]);
    else if (arg === '--graph-backend') options.graphBackend = normalizeGraphBackend(argv[++i]);
    else if (arg === '--template-dir') options.templateDir = argv[++i];
  }
  return options;
}

function printReport(result) {
  console.log(`loom init-project: ${result.projectName}`);
  console.log(`roles: ${result.roles.join(', ') || 'none'}`);
  console.log(`graph backend: ${result.graphBackend}`);
  console.log(`tech stack: ${result.techStack}`);
  console.log(`tools: ${result.detectedTools.join(', ') || 'none'}`);
  if (result.codegraphInit) {
    console.log(`codegraph init: ${result.codegraphInit}`);
  }
  console.log(`written: ${result.written.length}`);
  for (const file of result.written) {
    console.log(`  + ${relative(result.root, file)}`);
  }
  if (result.skipped.length) {
    console.log(`skipped: ${result.skipped.length}`);
    for (const item of result.skipped) {
      console.log(`  - ${relative(result.root, item.path)} (${item.reason})`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = initProject(parseArgs(process.argv.slice(2)));
  printReport(result);
}
