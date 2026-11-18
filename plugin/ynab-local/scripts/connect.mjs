// Dependency-free stdio bridge for local desktop MCP hosts. All YNAB logic stays on the server.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

let endpoint, authorization;
try {
  let config = {};
  const configPath = process.env.YNAB_MCP_CLIENT_CONFIG ?? join(homedir(), '.config', 'ynab-mcp', 'client.json');
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  endpoint = new URL(process.env.YNAB_MCP_URL ?? config.url ?? 'http://127.0.0.1:3000/mcp');
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
  if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error();
  const file = process.env.YNAB_MCP_AUTHORIZATION_FILE ?? config.authorization_file;
  authorization = readFileSync(file, 'utf8').trim();
  if (!/^Bearer [A-Za-z0-9_-]{32,}$/.test(authorization)) throw new Error();
} catch {
  console.error('Configure ~/.config/ynab-mcp/client.json with url and authorization_file, or set YNAB_MCP_URL and YNAB_MCP_AUTHORIZATION_FILE. Use HTTPS for non-loopback connections.');
  process.exit(1);
}

let protocolVersion;
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let message;
  try {
    if (Buffer.byteLength(line) > 128 * 1024) throw new Error();
    message = JSON.parse(line);
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}) },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error();
    if (response.status === 202 || message.id === undefined) continue;
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error();
    const result = await response.json();
    if (message.method === 'initialize') protocolVersion = result.result?.protocolVersion;
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    if (message?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Cannot reach the YNAB MCP server. Check its URL, credential, and health.' } })}\n`);
    else console.error('Invalid notification or unavailable YNAB MCP server.');
  }
}
