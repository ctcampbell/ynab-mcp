import type { Config } from '../src/config.js';
import { YnabClient } from '../src/ynab.js';
import { vi } from 'vitest';

export const PLAN = '11111111-1111-4111-8111-111111111111';
export const OTHER_PLAN = '99999999-9999-4999-8999-999999999999';
export const ACCOUNT = '22222222-2222-4222-8222-222222222222';
export const CATEGORY = '33333333-3333-4333-8333-333333333333';
export const TRANSACTION = '44444444-4444-4444-8444-444444444444';
export const PAYEE = '55555555-5555-4555-8555-555555555555';
export const KEY = '66666666-6666-4666-8666-666666666666';
export const config: Config = {
  host: '127.0.0.1', port: 3000, ynabToken: 'ynab-private-test-token-1234567890', mcpToken: 'mcp-private-test-token-12345678901234567890',
  writesEnabled: false, defaultPlanId: PLAN, allowedPlanIds: [], allowedHosts: ['127.0.0.1', 'localhost'], allowedOrigins: [], cacheTtlMs: 30_000, requestTimeoutMs: 5000,
};
export function fixture() {
  const payee: Record<string, unknown> = { id: PAYEE, name: 'Grocer', transfer_account_id: null };
  const transaction: Record<string, unknown> = { id: TRANSACTION, date: '2026-10-01', account_id: ACCOUNT, amount: -12340, payee_id: PAYEE, payee_name: 'Grocer', category_id: CATEGORY, memo: 'Lunch', cleared: 'uncleared', approved: false, deleted: false, subtransactions: [] };
  const category = { id: CATEGORY, name: 'Food', budgeted: 100000, activity: -12340, balance: 87660, hidden: false, deleted: false };
  const requests: { url: URL; method: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method, body });
    let data: unknown;
    const path = url.pathname.replace('/v1', '');
    if (path === '/plans') data = { plans: [{ id: PLAN, name: 'Home', currency_format: { iso_code: 'GBP' } }, { id: OTHER_PLAN, name: 'Other' }] };
    else if (path.endsWith('/settings')) data = { settings: { currency_format: { iso_code: 'GBP' } } };
    else if (path.endsWith(`/accounts/${ACCOUNT}`)) data = { account: { id: ACCOUNT, closed: false, deleted: false, balance: 500000 } };
    else if (path.endsWith('/accounts')) data = { accounts: [{ id: ACCOUNT, closed: false }, { id: OTHER_PLAN, closed: true }] };
    else if (/\/months\/\d{4}-\d{2}-01\/categories\//.test(path)) {
      if (method === 'PATCH') category.budgeted = body.category.budgeted;
      data = { category: { ...category } };
    }
    else if (path.endsWith('/categories')) data = { category_groups: [{ id: KEY, name: 'Everyday', categories: [category, { id: OTHER_PLAN, hidden: true }] }] };
    else if (/\/months\/\d{4}-\d{2}-01$/.test(path)) data = { month: { month: '2026-10-01', budgeted: 100000, to_be_budgeted: 50000, categories: [category] } };
    else if (path.endsWith('/months')) data = { months: [{ month: '2026-10-01' }, { month: '2026-09-01' }] };
    else if (path.endsWith(`/payees/${PAYEE}`)) data = { payee };
    else if (path.endsWith('/payees')) data = { payees: [payee] };
    else if (path.endsWith('/scheduled_transactions')) data = { scheduled_transactions: [{ id: KEY, account_id: ACCOUNT, date_next: '2026-10-20', amount: -10000 }] };
    else if (path.endsWith(`/transactions/${TRANSACTION}`)) {
      if (method === 'PUT') Object.assign(transaction, body.transaction);
      data = { transaction: { ...transaction } };
    }
    else if (path.endsWith('/transactions')) {
      data = method === 'POST' ? { transaction: { id: TRANSACTION, ...body.transaction } } : { transactions: [{ ...transaction }] };
    }
    else return Response.json({ error: 'Unknown fixture route' }, { status: 404 });
    return Response.json({ data });
  });
  const api = new YnabClient({ token: config.ynabToken, fetch: fetcher as typeof fetch });
  return { api, fetcher, requests, transaction, category, payee };
}
