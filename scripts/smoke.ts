import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.YNAB_MCP_URL ?? 'http://127.0.0.1:3000/mcp');
const authorization = readFileSync(process.env.YNAB_MCP_AUTHORIZATION_FILE ?? '.secrets/mcp-authorization', 'utf8').trim();
const client = new Client({ name: 'ynab-smoke', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: authorization } } }));
  const result = await client.listTools();
  console.log(`MCP connection succeeded; ${result.tools.length} tools advertised.`);
  const plans = await client.callTool({ name: 'ynab_list_plans', arguments: {} });
  if (plans.isError) throw new Error('The YNAB read failed. Check the token, network, and API rate limit.');
  console.log('YNAB authentication and plan lookup succeeded. No budget data printed and no writes performed.');
} catch {
  console.error('Smoke check failed. Check the server URL, local MCP credential, YNAB token, and network access.');
  process.exitCode = 1;
} finally { await client.close(); }
