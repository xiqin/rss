/**
 * server.js — loom MCP Server（stdio transport）
 *
 * 实现 MCP 协议（JSON-RPC over stdin/stdout），暴露 loom 工具集。
 * 无第三方 MCP SDK 依赖，直接实现协议子集（足以被 Claude Code / Cursor 调用）。
 *
 * 启动方式：
 *   node src/mcp/server.js              — 直接启动
 *   loom mcp-serve                      — 通过 CLI 启动
 *   在 MCP 配置中: "command": "loom", "args": ["mcp-serve"]
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { TOOL_DEFINITIONS, executeToolCall, readMcpResource } from './tools.js';
import { SessionStore } from './session-store.js';
import { recordCall, printSummary } from './telemetry.js';

const SERVER_NAME = 'loom-mcp-server';
// 版本从 package.json 单源读取，避免与发布版本不同步
const SERVER_VERSION = (() => {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version || '0.0.0';
  } catch { return '0.0.0'; }
})();
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'];
const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const RESOURCE_DEFINITIONS = [
  {
    uri: 'loom://context/constitution',
    name: 'Project constitution',
    description: 'Project architecture, rules, and engineering constraints from .loom/rules/constitution.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'loom://memory',
    name: 'Project memory',
    description: 'Structured project memory export from .loom/memory/MEMORY.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'loom://skills/catalog',
    name: 'Skill catalog',
    description: 'L0 catalog of available Loom skills for progressive disclosure',
    mimeType: 'application/json',
  },
];

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'loom://context/{doc}',
    name: 'Context document',
    description: 'Context document by key, such as constitution or memory',
    mimeType: 'text/markdown',
  },
  {
    uriTemplate: 'loom://spec/{spec_dir}/state',
    name: 'Pipeline state',
    description: 'Pipeline state JSON for a spec directory',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'loom://spec/{spec_dir}/progress',
    name: 'Pipeline progress',
    description: 'Generated progress.md for a spec directory',
    mimeType: 'text/markdown',
  },
  {
    uriTemplate: 'loom://spec/{spec_dir}/handoffs/{id}',
    name: 'Stage or task handoff',
    description: 'Handoff JSON for a stage or task in a spec directory',
    mimeType: 'application/json',
  },
];

const PROMPT_DEFINITIONS = [
  {
    name: 'loom-start-feature',
    title: 'Start Feature Pipeline',
    description: 'Clarify a new feature request and prepare a Loom pipeline selection.',
    arguments: [
      { name: 'request', description: 'User feature request', required: true },
    ],
  },
  {
    name: 'loom-write-plan',
    title: 'Write Implementation Plan',
    description: 'Turn an approved spec into ordered, independently verifiable tasks.',
    arguments: [
      { name: 'spec_dir', description: 'Spec directory to plan', required: true },
    ],
  },
  {
    name: 'loom-verify-work',
    title: 'Verify Work',
    description: 'Run final compile, test, placeholder, and spec coverage verification.',
    arguments: [
      { name: 'spec_dir', description: 'Spec directory to verify', required: true },
    ],
  },
  {
    name: 'loom-request-review',
    title: 'Request Code Review',
    description: 'Prepare a review request with change summary, verification evidence, and focus areas.',
    arguments: [
      { name: 'spec_dir', description: 'Spec directory to summarize', required: true },
    ],
  },
];

const PROMPT_TEMPLATES = {
  'loom-start-feature': ({ request }) => ({
    description: 'Clarify a new feature request and prepare a Loom pipeline selection.',
    required: ['request'],
    text: [
      'Start a Loom feature pipeline for this request.',
      '',
      `User request: ${request}`,
      '',
      'Use loom_list_capabilities first, then use the pipeline selector. Present the selected steps, source, risk level, and reasoning before initializing state.'
    ].join('\n'),
  }),
  'loom-write-plan': ({ spec_dir }) => ({
    description: 'Turn an approved spec into ordered, independently verifiable tasks.',
    required: ['spec_dir'],
    text: [
      `Write an implementation plan for Loom spec: ${spec_dir}`,
      '',
      'Read the pipeline context and spec artifacts first. Produce ordered task files with dependencies, acceptance criteria, and verification commands.'
    ].join('\n'),
  }),
  'loom-verify-work': ({ spec_dir }) => ({
    description: 'Run final compile, test, placeholder, and spec coverage verification.',
    required: ['spec_dir'],
    text: [
      `Verify the completed work for Loom spec: ${spec_dir}`,
      '',
      'Run the project verification commands, check generated artifacts, scan for placeholders, and write a verification report with command evidence.'
    ].join('\n'),
  }),
  'loom-request-review': ({ spec_dir }) => ({
    description: 'Prepare a review request with change summary, verification evidence, and focus areas.',
    required: ['spec_dir'],
    text: [
      `Prepare a code review request for Loom spec: ${spec_dir}`,
      '',
      'Summarize changed files, behavior changes, verification evidence, residual risks, and reviewer focus areas.'
    ].join('\n'),
  }),
};

const sessionStore = new SessionStore();
// 每个 server 进程对应一个 stdio 连接，握手时生成唯一 sessionId
let sessionId = randomUUID();
let currentResponseFramed = false;

function lazyToolsEnabled() {
  return process.env.LOOM_LAZY_TOOLS !== '0';
}

function toMcpTool({ name, description, inputSchema, annotations, loom }) {
  return { name, description, inputSchema, annotations, loom };
}

export function listVisibleTools(store, id, { lazyEnabled = lazyToolsEnabled() } = {}) {
  if (!lazyEnabled) return TOOL_DEFINITIONS.map(toMcpTool);
  const loadedGroups = store.getLoadedGroups(id);
  return TOOL_DEFINITIONS
    .filter(t => loadedGroups.has(t.group))
    .map(toMcpTool);
}

function notifyToolsListChanged() {
  writeMessage({
    jsonrpc: '2.0',
    method: 'notifications/tools/list_changed'
  }, { framed: currentResponseFramed });
}

// ── JSON-RPC 处理 ──────────────────────────────────────────────────────────

function makeResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function negotiateProtocolVersion(requested) {
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  return PROTOCOL_VERSION;
}

function getPrompt(name, args = {}) {
  if (!name) throw new Error('Missing prompt name');
  const template = PROMPT_TEMPLATES[name];
  if (!template) throw new Error(`Unknown prompt: ${name}`);
  const rendered = template(args);
  for (const field of rendered.required) {
    if (!args[field]) throw new Error(`Missing required prompt argument: ${field}`);
  }
  return {
    description: rendered.description,
    messages: [{
      role: 'user',
      content: { type: 'text', text: rendered.text },
    }],
  };
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {

    case 'initialize':
      sessionId = randomUUID(); // 新握手 → 新会话，清掉上一连接的 spec 绑定残留
      return makeResponse(id, {
        protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
        capabilities: {
          tools: { listChanged: lazyToolsEnabled() },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });

    case 'notifications/initialized':
      return null; // 无需响应

    case 'tools/list': {
      // 默认按 session loadedGroups 过滤工具列表（懒加载），减少上下文占用。
      // 设置 LOOM_LAZY_TOOLS=0 可恢复全量注册（向后兼容）。
      const tools = listVisibleTools(sessionStore, sessionId);
      return makeResponse(id, { tools });
    }

    case 'resources/list':
      return makeResponse(id, { resources: RESOURCE_DEFINITIONS });

    case 'resources/templates/list':
      return makeResponse(id, { resourceTemplates: RESOURCE_TEMPLATES });

    case 'resources/read': {
      try {
        return makeResponse(id, readMcpResource(params?.uri, sessionStore, sessionId));
      } catch (error) {
        return makeError(id, -32602, error.message);
      }
    }

    case 'prompts/list':
      return makeResponse(id, { prompts: PROMPT_DEFINITIONS });

    case 'prompts/get': {
      try {
        return makeResponse(id, getPrompt(params?.name, params?.arguments || {}));
      } catch (error) {
        return makeError(id, -32602, error.message);
      }
    }

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (!toolName) return makeError(id, -32602, 'Missing tool name');

      const tool = TOOL_DEFINITIONS.find(t => t.name === toolName);
      if (!tool) return makeError(id, -32602, `Unknown tool: ${toolName}`);

      const startTime = Date.now();
      try {
        const result = await executeToolCall(toolName, args, sessionStore, sessionId);
        const text = JSON.stringify(result, null, 2);
        recordCall(toolName, Date.now() - startTime, {
          responseBytes: Buffer.byteLength(text, 'utf-8')
        });
        if (toolName === 'loom_load_tool_group' && result?.ok && lazyToolsEnabled()) {
          notifyToolsListChanged();
        }
        return makeResponse(id, {
          content: [{ type: 'text', text }]
        });
      } catch (error) {
        const text = JSON.stringify({ error: error.message });
        recordCall(toolName, Date.now() - startTime, {
          responseBytes: Buffer.byteLength(text, 'utf-8')
        });
        return makeResponse(id, {
          content: [{ type: 'text', text }],
          isError: true
        });
      }
    }

    case 'ping':
      return makeResponse(id, {});

    default:
      if (method?.startsWith('notifications/')) return null;
      return makeError(id, -32601, `Method not found: ${method}`);
  }
}

// ── stdio transport ─────────────────────────────────────────────────────────

function writeMessage(msg, { framed = false } = {}) {
  const json = JSON.stringify(msg);
  if (framed) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

async function processRawMessage(raw, { framed = false } = {}) {
  try {
    const msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf-8') : raw);
    currentResponseFramed = framed;
    const response = await handleRequest(msg);
    if (response) writeMessage(response, { framed });
  } catch (err) {
    writeMessage(makeError(null, -32700, `Parse error: ${err.message}`), { framed });
  } finally {
    currentResponseFramed = false;
  }
}

export function startServer() {
  let buffer = Buffer.alloc(0);
  let processing = Promise.resolve();

  async function drainBuffer() {
    while (buffer.length > 0) {
      const asText = buffer.toString('utf-8', 0, Math.min(buffer.length, 64));
      if (/^Content-Length:/i.test(asText)) {
        const crlfEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
        const lfEnd = buffer.indexOf(Buffer.from('\n\n'));
        const headerEnd = crlfEnd !== -1 ? crlfEnd : lfEnd;
        if (headerEnd === -1) return;

        const separatorLength = crlfEnd !== -1 ? 4 : 2;
        const header = buffer.toString('utf-8', 0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          writeMessage(makeError(null, -32700, 'Parse error: Missing Content-Length'), { framed: true });
          buffer = buffer.subarray(headerEnd + separatorLength);
          continue;
        }

        const length = Number(match[1]);
        const bodyStart = headerEnd + separatorLength;
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd) return;

        const body = buffer.subarray(bodyStart, bodyEnd);
        buffer = buffer.subarray(bodyEnd);
        await processRawMessage(body, { framed: true });
        continue;
      }

      const newlineIdx = buffer.indexOf(0x0a);
      if (newlineIdx === -1) return;
      const line = buffer.toString('utf-8', 0, newlineIdx).trim();
      buffer = buffer.subarray(newlineIdx + 1);
      if (!line) continue;
      await processRawMessage(line, { framed: false });
    }
  }

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    processing = processing.then(drainBuffer);
  });

  process.stdin.on('end', () => {
    processing = processing.then(async () => {
      const rest = buffer.toString('utf-8').trim();
      buffer = Buffer.alloc(0);
      if (rest && !/^Content-Length:/i.test(rest)) {
        await processRawMessage(rest, { framed: false });
      }
    });
  });

  process.stdin.on('close', () => {
    processing.finally(() => {
      printSummary();
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    processing.finally(() => {
      printSummary();
      process.exit(0);
    });
  });

  // stderr 用于 debug 日志（不污染 stdout JSON 协议）
  process.stderr.write(`[${SERVER_NAME}] Started on stdio\n`);
}

// 直接运行时启动
const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server');
if (isMain) {
  startServer();
}
