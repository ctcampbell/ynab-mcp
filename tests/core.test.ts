import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { toMilliunits, fromMilliunits } from '../src/money.js';
import { YnabClient } from '../src/ynab.js';
import { safeError } from '../src/errors.js';
import { config, PLAN, OTHER_PLAN, fixture } from './helpers.js';

describe('configuration', () => {
  const env = { YNAB_ACCESS_TOKEN: config.ynabToken, MCP_AUTH_TOKEN: config.mcpToken };
  it('fails closed and disables writes by default', () => {
    expect(() => loadConfig({})).toThrow('YNAB_ACCESS_TOKEN');
    expect(() => loadConfig({ YNAB_ACCESS_TOKEN: config.ynabToken })).toThrow('MCP_AUTH');
    expect(loadConfig(env).writesEnabled).toBe(false);
    expect(loadConfig(env).host).toBe('127.0.0.1');
    expect(loadConfig({ ...env, YNAB_ENABLE_WRITES: 'true' }).writesEnabled).toBe(true);
    expect(() => loadConfig({ ...env, YNAB_ENABLE_WRITES: 'yes' })).toThrow();
  });
  it('validates restricted plans, hosts, origins and secrets', () => {
    expect(() => loadConfig({ ...env, YNAB_DEFAULT_PLAN_ID: PLAN, YNAB_ALLOWED_PLAN_IDS: OTHER_PLAN })).toThrow('default plan');
    expect(() => loadConfig({ ...env, MCP_ALLOWED_HOSTS: '*' })).toThrow();
    expect(() => loadConfig({ ...env, MCP_ALLOWED_ORIGINS: 'https://example.com/path' })).toThrow();
    expect(() => loadConfig({ ...env, MCP_AUTH_TOKEN: 'weak' })).toThrow();
    expect(() => loadConfig({ ...env, YNAB_ACCESS_TOKEN_FILE: '/missing' })).toThrow('Set only');
    expect(loadConfig({ ...env, MCP_AUTH_TOKEN: undefined, MCP_AUTHORIZATION: `Bearer ${config.mcpToken}` }).mcpToken).toBe(config.mcpToken);
  });
});

describe('currency', () => {
  it.each([['-12.34', -12340], ['0.001', 1], ['0.29', 290], ['1', 1000], ['-0.001', -1], ['99999999999.999', 99999999999999]])('converts %s exactly', (input, expected) => {
    expect(toMilliunits(input)).toBe(expected);
    expect(toMilliunits(fromMilliunits(expected))).toBe(expected);
  });
  it.each(['1.0001', '1e3', 'NaN', '12,34', '01.00', '9007199254740992'])('rejects ambiguous or unsafe amounts: %s', input => expect(() => toMilliunits(input)).toThrow());
});

describe('YNAB client', () => {
  it('caches and coalesces reads, returns copies, and invalidates after writes', async () => {
    const { api, fetcher } = fixture();
    const [first, second] = await Promise.all([api.request('/plans'), api.request('/plans')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    first.plans = [];
    expect((await api.request('/plans')).plans).not.toEqual([]);
    await api.request(`/plans/${PLAN}/transactions`, { method: 'POST', body: { transaction: { amount: -1 } } });
    await api.request('/plans');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('uses the fixed HTTPS API, never follows redirects, and encodes query parameters', async () => {
    const { api, fetcher } = fixture();
    await api.request(`/plans/${PLAN}/transactions`, { query: { since_date: '2026-10-01', until_date: '2026-10-05' } });
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(`https://api.ynab.com/v1/plans/${PLAN}/transactions?since_date=2026-10-01&until_date=2026-10-05`);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
    await expect(api.request('/plans/../../user')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
  it('redacts upstream errors and respects Retry-After across calls', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { detail: `secret=${config.ynabToken}` } }, { status: 429, headers: { 'Retry-After': '60' } }));
    let now = 0;
    const api = new YnabClient({ token: config.ynabToken, fetch: fetcher, now: () => now });
    await expect(api.request('/plans')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
    await expect(api.request('/plans')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 61000;
    await expect(api.request('/plans')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(safeError(new Error(config.ynabToken)))).not.toContain(config.ynabToken);
  });
  it('never automatically retries an ambiguous write', async () => {
    const fetcher = vi.fn(async () => { throw new Error('upstream token secret'); });
    const api = new YnabClient({ token: config.ynabToken, fetch: fetcher });
    await expect(api.request(`/plans/${PLAN}/transactions`, { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'YNAB_CONNECTION_FAILED', message: expect.stringContaining('outcome is unknown') });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed upstream data without leaking it', async () => {
    const api = new YnabClient({ token: config.ynabToken, fetch: async () => Response.json({ secret: config.ynabToken }) });
    await expect(api.request('/plans')).rejects.toMatchObject({ code: 'YNAB_INVALID_RESPONSE' });
  });
});
