import { afterEach, describe, it, expect } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { get, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createApp } from '../src/app.js';
import { config, fixture, PLAN, OTHER_PLAN, ACCOUNT, CATEGORY, TRANSACTION, PAYEE, KEY } from './helpers.js';
import type { Config } from '../src/config.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function running(overrides: Partial<Config> = {}) {
  const mock = fixture();
  const server: Server = createApp({ ...config, ...overrides }, mock.api).listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanup.push(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${config.mcpToken}` } } }));
  cleanup.push(() => client.close());
  const call = async (name: string, args: Record<string, unknown> = {}) => CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  return { ...mock, url, client, call };
}

describe('HTTP and MCP transport', () => {
  it('authenticates every MCP request, denies unapproved origins and hosts, and exposes only a minimal health check', async () => {
    const { url } = await running();
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: `Bearer ${config.mcpToken}`, Origin: 'https://attacker.example' } })).status).toBe(403);
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    expect(hostileHostStatus).toBe(421);
    const health = await fetch(url.replace('/mcp', '/healthz'));
    expect(await health.json()).toEqual({ status: 'ok', service: 'ynab-local-mcp' });
    expect(health.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects malformed and oversized authenticated requests', async () => {
    const { url } = await running();
    const headers = { Authorization: `Bearer ${config.mcpToken}`, 'Content-Type': 'application/json' };
    expect((await fetch(url, { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ data: 'x'.repeat(140000) }) })).status).toBe(413);
  });
  it('advertises read tools only, and serves its resource and prompt', async () => {
    const { client, call, requests } = await running();
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(13);
    expect(tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect((await call('ynab_create_transaction', {})).isError).toBe(true);
    expect(requests).toHaveLength(0);
    expect((await client.readResource({ uri: 'ynab://guide' })).contents[0]).toMatchObject({ mimeType: 'text/plain' });
    expect((await client.getPrompt({ name: 'review_budget', arguments: { month: '2026-10-01' } })).messages).toHaveLength(1);
  });
  it('runs the packaged stdio plugin through the actual HTTP server', async () => {
    const { url } = await running();
    const directory = await mkdtemp(join(tmpdir(), 'ynab-plugin-test-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const secret = join(directory, 'authorization');
    await writeFile(secret, `Bearer ${config.mcpToken}`, { mode: 0o600 });
    const client = new Client({ name: 'plugin-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('plugin/ynab-local/scripts/connect.mjs')], env: { YNAB_MCP_URL: url, YNAB_MCP_AUTHORIZATION_FILE: secret }, stderr: 'pipe' }));
    cleanup.push(() => client.close());
    expect((await client.listTools()).tools).toHaveLength(13);
    const result = CallToolResultSchema.parse(await client.callTool({ name: 'ynab_list_plans', arguments: {} }));
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.plans).toEqual(expect.arrayContaining([expect.objectContaining({ id: PLAN })]));
  });
});

describe('budget reads', () => {
  it('calls all read tools against representative YNAB API responses', async () => {
    const { call } = await running();
    const cases: [string, Record<string, unknown>][] = [
      ['ynab_get_status', {}], ['ynab_list_plans', {}], ['ynab_get_plan_settings', {}],
      ['ynab_list_accounts', {}], ['ynab_get_account', { account_id: ACCOUNT }],
      ['ynab_list_categories', {}], ['ynab_get_category', { category_id: CATEGORY, month: '2026-10-01' }],
      ['ynab_list_months', {}], ['ynab_get_month', { month: '2026-10-01' }], ['ynab_list_payees', { search: 'gro' }],
      ['ynab_list_transactions', { since_date: '2026-10-01', until_date: '2026-10-05', account_id: ACCOUNT, category_id: CATEGORY, payee_id: PAYEE }],
      ['ynab_get_transaction', { transaction_id: TRANSACTION }], ['ynab_list_scheduled_transactions', {}],
    ];
    for (const [name, args] of cases) {
      const result = await call(name, args);
      expect(result.isError, name).not.toBe(true);
      expect(result.structuredContent, name).toBeDefined();
    }
  });
  it('enforces plan restrictions, including direct calls, before any YNAB request', async () => {
    const { call, requests } = await running({ allowedPlanIds: [PLAN] });
    const result = await call('ynab_list_plans');
    expect(result.structuredContent?.plans).toHaveLength(1);
    const forbidden = await call('ynab_list_accounts', { plan_id: OTHER_PLAN });
    expect(forbidden.structuredContent?.error).toMatchObject({ code: 'PLAN_FORBIDDEN' });
    expect(requests).toHaveLength(1);
  });
  it('requires plan selection when no default is set and validates dates, UUIDs, and extra fields', async () => {
    const { call, requests } = await running({ defaultPlanId: undefined });
    expect((await call('ynab_list_accounts')).structuredContent?.error).toMatchObject({ code: 'PLAN_REQUIRED' });
    expect((await call('ynab_list_accounts', { plan_id: '../../user' })).isError).toBe(true);
    expect((await call('ynab_list_accounts', { plan_id: PLAN, unexpected: true })).isError).toBe(true);
    expect((await call('ynab_list_transactions', { plan_id: PLAN, since_date: '2026-02-30', until_date: '2026-03-01' })).isError).toBe(true);
    expect((await call('ynab_list_transactions', { plan_id: PLAN, since_date: '2026-10-05', until_date: '2026-10-01' })).isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
  it('keeps pagination explicit and includes matching split transactions without double counting the parent', async () => {
    const { call, transaction } = await running();
    const page = await call('ynab_list_accounts', { limit: 1, include_closed: true });
    expect(page.structuredContent).toMatchObject({ total: 2, next_offset: 1 });
    const end = await call('ynab_list_accounts', { limit: 1, include_closed: true, offset: 1 });
    expect(end.structuredContent).toMatchObject({ total: 2, next_offset: null });
    transaction.category_id = null;
    transaction.subtransactions = [{ id: KEY, category_id: CATEGORY, memo: 'Milk', deleted: false, amount: -12340 }];
    const split = await call('ynab_list_transactions', { since_date: '2026-10-01', until_date: '2026-10-05', category_id: CATEGORY, search: 'milk' });
    expect(split.structuredContent).toMatchObject({ total: 1 });
  });
});

describe('optional edits', () => {
  it('advertises writes with correct annotations and previews a precise, deduplicated create without writing', async () => {
    const { client, call, requests } = await running({ writesEnabled: true });
    const writes = (await client.listTools()).tools.filter(tool => !tool.annotations?.readOnlyHint);
    expect(writes).toHaveLength(3);
    expect(writes.every(tool => tool.annotations?.destructiveHint === true)).toBe(true);
    const args = { plan_id: PLAN, account_id: ACCOUNT, date: '2026-10-01', amount: '-0.29', idempotency_key: KEY, payee_id: PAYEE };
    const preview = await call('ynab_create_transaction', args);
    expect(preview.structuredContent).toMatchObject({ dry_run: true, transaction: { amount: -290, approved: false, import_id: expect.stringMatching(/^mcp:[a-f0-9]{32}$/) } });
    expect(requests.every(r => r.method === 'GET')).toBe(true);
    const commit = await call('ynab_create_transaction', { ...args, dry_run: false });
    expect(commit.isError).not.toBe(true);
    const first = requests.find(r => r.method === 'POST')!;
    await call('ynab_create_transaction', { ...args, dry_run: false });
    expect(requests.filter(r => r.method === 'POST')[1]!.body).toEqual(first.body);
  });
  it('requires an unchanged transaction preview before committing, and invalidates cached reads', async () => {
    const { call, requests, transaction } = await running({ writesEnabled: true });
    const args = { plan_id: PLAN, transaction_id: TRANSACTION, changes: { memo: 'Edited', amount: '-15.99' } };
    expect((await call('ynab_update_transaction', { ...args, dry_run: false })).structuredContent?.error).toMatchObject({ code: 'STALE_PREVIEW' });
    const preview = await call('ynab_update_transaction', args);
    const expected = preview.structuredContent?.expected_fingerprint;
    transaction.memo = 'Changed in YNAB';
    expect((await call('ynab_update_transaction', { ...args, expected_fingerprint: expected, dry_run: false })).structuredContent?.error).toMatchObject({ code: 'STALE_PREVIEW' });
    expect(requests.some(r => r.method === 'PUT')).toBe(false);
    const fresh = await call('ynab_update_transaction', args);
    const commit = await call('ynab_update_transaction', { ...args, expected_fingerprint: fresh.structuredContent?.expected_fingerprint, dry_run: false });
    expect(commit.structuredContent).toMatchObject({ transaction: { memo: 'Edited', amount: -15990 } });
  });
  it('previews absolute category assignments and prevents stale commits', async () => {
    const { call, category, requests } = await running({ writesEnabled: true });
    const args = { plan_id: PLAN, category_id: CATEGORY, month: '2026-10-01', amount: '150.01' };
    expect((await call('ynab_set_category_budget', args)).structuredContent).toMatchObject({ dry_run: true, expected_budgeted: 100000, budgeted: 150010 });
    category.budgeted = 110000;
    expect((await call('ynab_set_category_budget', { ...args, expected_budgeted: 100000, dry_run: false })).isError).toBe(true);
    expect(requests.some(r => r.method === 'PATCH')).toBe(false);
    expect((await call('ynab_set_category_budget', { ...args, expected_budgeted: 110000, dry_run: false })).structuredContent).toMatchObject({ dry_run: false, category: { budgeted: 150010 } });
  });
  it('clears the old payee ID for a payee-name change and rejects transfer payees', async () => {
    const { call, payee, requests } = await running({ writesEnabled: true });
    const args = { plan_id: PLAN, transaction_id: TRANSACTION, changes: { payee_name: 'New shop' } };
    expect((await call('ynab_update_transaction', args)).structuredContent).toMatchObject({ changes: { payee_name: 'New shop', payee_id: null } });
    payee.transfer_account_id = ACCOUNT;
    expect((await call('ynab_update_transaction', { ...args, changes: { payee_id: PAYEE } })).structuredContent?.error).toMatchObject({ code: 'UNSUPPORTED_EDIT' });
    expect(requests.some(r => r.method !== 'GET')).toBe(false);
  });
  it('rejects unsafe inputs and unsupported reconciled/split/transfer edits before writing', async () => {
    const { call, transaction, requests } = await running({ writesEnabled: true });
    const args = { plan_id: PLAN, account_id: ACCOUNT, date: '2026-10-01', amount: '-1.1234', idempotency_key: KEY };
    expect((await call('ynab_create_transaction', args)).isError).toBe(true);
    expect((await call('ynab_create_transaction', { ...args, amount: '-1', date: '2999-01-01' })).isError).toBe(true);
    expect((await call('ynab_create_transaction', { ...args, amount: '-1', payee_id: PAYEE, payee_name: 'Conflicting' })).isError).toBe(true);
    transaction.cleared = 'reconciled';
    expect((await call('ynab_update_transaction', { plan_id: PLAN, transaction_id: TRANSACTION, changes: { memo: 'Wrong' } })).structuredContent?.error).toMatchObject({ code: 'UNSUPPORTED_EDIT' });
    expect(requests.every(r => r.method === 'GET')).toBe(true);
  });
});
