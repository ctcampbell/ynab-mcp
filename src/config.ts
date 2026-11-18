import { readFileSync } from 'node:fs';
import { z } from 'zod';

export type Config = {
  host: string;
  port: number;
  ynabToken: string;
  mcpToken: string;
  writesEnabled: boolean;
  defaultPlanId?: string;
  allowedPlanIds: string[];
  allowedHosts: string[];
  allowedOrigins: string[];
  cacheTtlMs: number;
  requestTimeoutMs: number;
};

function readSecret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (env[name] && env[`${name}_FILE`]) throw new Error(`Set only ${name} or ${name}_FILE.`);
  if (env[`${name}_FILE`]) {
    try { return readFileSync(env[`${name}_FILE`]!, 'utf8').trim(); }
    catch { throw new Error(`Cannot read ${name}_FILE.`); }
  }
  return env[name]?.trim();
}

const csv = (value?: string) => value?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
const uuid = z.string().uuid();
function numberSetting(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}.`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const ynabToken = readSecret(env, 'YNAB_ACCESS_TOKEN');
  if (!ynabToken || ynabToken.length < 20 || /\s|replace|example|your.token/i.test(ynabToken)) {
    throw new Error('Configure a real YNAB_ACCESS_TOKEN or YNAB_ACCESS_TOKEN_FILE locally.');
  }
  const authorization = readSecret(env, 'MCP_AUTHORIZATION');
  const rawToken = readSecret(env, 'MCP_AUTH_TOKEN');
  if (authorization && rawToken) throw new Error('Set MCP_AUTHORIZATION or MCP_AUTH_TOKEN, not both.');
  const mcpToken = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1] ?? rawToken;
  if (!mcpToken || !/^[A-Za-z0-9_-]{32,}$/.test(mcpToken)) {
    throw new Error('Configure a strong MCP_AUTH_TOKEN or MCP_AUTHORIZATION_FILE; run pnpm setup to generate one.');
  }
  if (env.YNAB_ENABLE_WRITES !== undefined && !['true', 'false'].includes(env.YNAB_ENABLE_WRITES)) {
    throw new Error('YNAB_ENABLE_WRITES must be exactly true or false.');
  }
  const allowedPlanIds = csv(env.YNAB_ALLOWED_PLAN_IDS);
  if (allowedPlanIds.some(id => !uuid.safeParse(id).success)) throw new Error('YNAB_ALLOWED_PLAN_IDS must contain plan UUIDs.');
  const defaultPlanId = env.YNAB_DEFAULT_PLAN_ID || undefined;
  if (defaultPlanId && !uuid.safeParse(defaultPlanId).success) throw new Error('YNAB_DEFAULT_PLAN_ID must be a plan UUID.');
  if (defaultPlanId && allowedPlanIds.length && !allowedPlanIds.includes(defaultPlanId)) {
    throw new Error('The default plan must be in YNAB_ALLOWED_PLAN_IDS.');
  }
  const allowedHosts = csv(env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1],ynab-mcp');
  if (!allowedHosts.length || allowedHosts.some(h => /[\s/@?#*]/.test(h))) throw new Error('MCP_ALLOWED_HOSTS must contain explicit hostnames.');
  const allowedOrigins = csv(env.MCP_ALLOWED_ORIGINS);
  for (const origin of allowedOrigins) {
    try { if (new URL(origin).origin !== origin || !/^https?:/.test(origin)) throw new Error(); }
    catch { throw new Error('MCP_ALLOWED_ORIGINS must contain exact HTTP(S) origins.'); }
  }
  return {
    host: env.HOST || '127.0.0.1',
    port: numberSetting(env.PORT, 3000, 1, 65535, 'PORT'),
    ynabToken, mcpToken, defaultPlanId, allowedPlanIds,
    allowedHosts: allowedHosts.map(h => h.toLowerCase()), allowedOrigins,
    writesEnabled: env.YNAB_ENABLE_WRITES === 'true',
    cacheTtlMs: numberSetting(env.YNAB_CACHE_TTL_SECONDS, 30, 0, 300, 'YNAB_CACHE_TTL_SECONDS') * 1000,
    requestTimeoutMs: numberSetting(env.YNAB_TIMEOUT_SECONDS, 15, 1, 60, 'YNAB_TIMEOUT_SECONDS') * 1000,
  };
}
