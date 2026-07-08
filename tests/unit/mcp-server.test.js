import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

function frame(json) {
  return `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;
}

function parseFrames(output) {
  const frames = [];
  const buffer = Buffer.from(output, 'utf-8');
  let offset = 0;
  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n', offset, 'utf-8');
    if (headerEnd === -1) break;
    const header = buffer.subarray(offset, headerEnd).toString('utf-8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;
    const start = headerEnd + 4;
    const end = start + Number(match[1]);
    if (buffer.length < end) break;
    frames.push(JSON.parse(buffer.subarray(start, end).toString('utf-8')));
    offset = end;
  }
  return frames;
}

async function runServer(input, isComplete) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/mcp/server.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LOOM_LAZY_TOOLS: '0' },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    function stopChild() {
      try { child.kill(); } catch {}
    }
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopChild();
      resolve({ stdout, stderr });
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopChild();
      reject(new Error(`server timed out\nstdout=${stdout}\nstderr=${stderr}`));
    }, 2000);
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', d => {
      stdout += d;
      if (isComplete?.(stdout)) finish();
    });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', () => {
      finish();
    });
    child.stdin.end(input);
  });
}

describe('MCP stdio transport', () => {
  it('handles newline-delimited JSON-RPC', async () => {
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const { stdout } = await runServer(ping + '\n', output => {
      try { return JSON.parse(output.trim()).id === 1; }
      catch { return false; }
    });

    expect(JSON.parse(stdout.trim())).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('handles Content-Length framed JSON-RPC messages', async () => {
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const initialize = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }, null, 2);
    const { stdout } = await runServer(frame(ping) + frame(initialize), output => parseFrames(output).length === 2);
    const responses = parseFrames(stdout);

    expect(responses).toHaveLength(2);
    expect(responses[0]).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(responses[1].id).toBe(2);
    expect(responses[1].result.serverInfo.name).toBe('loom-mcp-server');
  });

  it('negotiates the latest supported MCP protocol version', async () => {
    const initialize = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' }
    });
    const { stdout } = await runServer(frame(initialize), output => parseFrames(output).length === 1);
    const [response] = parseFrames(stdout);

    expect(response.result.protocolVersion).toBe('2025-11-25');
    expect(response.result.capabilities.resources).toEqual({ listChanged: false, subscribe: false });
    expect(response.result.capabilities.prompts).toEqual({ listChanged: false });
  });

  it('lists resource and prompt catalogs', async () => {
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'resources/list' },
      { jsonrpc: '2.0', id: 2, method: 'resources/templates/list' },
      { jsonrpc: '2.0', id: 3, method: 'prompts/list' },
    ].map(msg => frame(JSON.stringify(msg))).join('');

    const { stdout } = await runServer(messages, output => parseFrames(output).length === 3);
    const [resources, templates, prompts] = parseFrames(stdout);

    expect(resources.result.resources.map(r => r.uri)).toContain('loom://context/constitution');
    expect(templates.result.resourceTemplates.map(r => r.uriTemplate)).toContain('loom://spec/{spec_dir}/progress');
    expect(prompts.result.prompts.map(p => p.name)).toContain('loom-verify-work');
  });

  it('reads skill catalog resources and rejects unknown resources', async () => {
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'loom://skills/catalog' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'loom://unknown' } },
    ].map(msg => frame(JSON.stringify(msg))).join('');

    const { stdout } = await runServer(messages, output => parseFrames(output).length === 2);
    const [catalog, unknown] = parseFrames(stdout);
    const parsed = JSON.parse(catalog.result.contents[0].text);

    expect(catalog.result.contents[0].uri).toBe('loom://skills/catalog');
    expect(parsed.skills.map(s => s.name)).toContain('loom-using-loom');
    expect(unknown.error.code).toBe(-32602);
    expect(unknown.error.message).toMatch(/Unknown resource uri/);
  });

  it('returns prompt messages and validates required arguments', async () => {
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'loom-verify-work', arguments: { spec_dir: 'specs/2026-07-07+demo' } } },
      { jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: 'loom-write-plan', arguments: {} } },
    ].map(msg => frame(JSON.stringify(msg))).join('');

    const { stdout } = await runServer(messages, output => parseFrames(output).length === 2);
    const [prompt, invalid] = parseFrames(stdout);

    expect(prompt.result.description).toMatch(/final compile/);
    expect(prompt.result.messages[0]).toMatchObject({
      role: 'user',
      content: { type: 'text' },
    });
    expect(prompt.result.messages[0].content.text).toContain('specs/2026-07-07+demo');
    expect(invalid.error.code).toBe(-32602);
    expect(invalid.error.message).toMatch(/Missing required prompt argument: spec_dir/);
  });
});
