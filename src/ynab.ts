import { ToolError } from './errors.js';

export type Data = Record<string, unknown>;
type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; query?: Record<string, string | number | undefined>; body?: unknown; fresh?: boolean };
type Cached = { expires: number; data: Data };

export class YnabClient {
  private cache = new Map<string, Cached>();
  private pending = new Map<string, Promise<Data>>();
  private calls: number[] = [];
  private epoch = 0;
  private cooldownUntil = 0;

  constructor(private options: {
    token: string;
    cacheTtlMs?: number;
    timeoutMs?: number;
    fetch?: typeof fetch;
    now?: () => number;
  }) {}

  async request(path: string, options: RequestOptions = {}): Promise<Data> {
    if (!/^\/plans(?:\/|$)/.test(path) || /[?#]|\.\./.test(path)) throw new ToolError('INVALID_PATH', 'Invalid YNAB resource.');
    const url = new URL(`https://api.ynab.com/v1${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    const key = url.href;
    const method = options.method ?? 'GET';
    const now = (this.options.now ?? Date.now)();
    if (method === 'GET' && !options.fresh) {
      const cached = this.cache.get(key);
      if (cached && cached.expires > now) return structuredClone(cached.data);
      const pending = this.pending.get(key);
      if (pending) return structuredClone(await pending);
    }
    const epoch = this.epoch;
    const promise = this.perform(url, options);
    if (method === 'GET' && !options.fresh) this.pending.set(key, promise);
    try {
      const data = await promise;
      if (method === 'GET' && epoch === this.epoch) {
        if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { data, expires: (this.options.now ?? Date.now)() + (this.options.cacheTtlMs ?? 30_000) });
      }
      return structuredClone(data);
    } finally {
      if (this.pending.get(key) === promise) this.pending.delete(key);
      // A timed-out write may have succeeded upstream; stale cached data is unsafe either way.
      if (method !== 'GET') { this.epoch++; this.cache.clear(); this.pending.clear(); }
    }
  }

  private async perform(url: URL, options: RequestOptions): Promise<Data> {
    const now = (this.options.now ?? Date.now)();
    this.calls = this.calls.filter(time => time > now - 3_600_000);
    if (now < this.cooldownUntil) throw new ToolError('RATE_LIMITED', 'YNAB is rate limiting requests. Wait before retrying.', Math.ceil((this.cooldownUntil - now) / 1000));
    if (this.calls.length >= 190) throw new ToolError('RATE_LIMITED', 'The local YNAB hourly request allowance is exhausted.', Math.ceil((this.calls[0]! + 3_600_000 - now) / 1000));
    this.calls.push(now);
    const method = options.method ?? 'GET';
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method,
        headers: { Authorization: `Bearer ${this.options.token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - now) / 1000) : 3600;
          const wait = Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 3600)) : 3600;
          this.cooldownUntil = now + wait * 1000;
          throw new ToolError('RATE_LIMITED', 'YNAB is rate limiting requests. Wait before retrying.', wait);
        }
        const known: Record<number, [string, string]> = {
          400: ['YNAB_VALIDATION_ERROR', 'YNAB rejected these values. Verify the IDs, dates, categories, and amounts.'],
          401: ['YNAB_UNAUTHORIZED', 'The YNAB token is invalid or has been revoked. Update the server secret.'],
          403: ['YNAB_FORBIDDEN', 'The YNAB token does not permit this operation.'],
          404: ['YNAB_NOT_FOUND', 'This YNAB resource does not exist or is not accessible.'],
          409: ['DUPLICATE_TRANSACTION', 'YNAB already has a transaction with this import ID. Check transactions before retrying.'],
        };
        const [code, message] = known[response.status] ?? ['YNAB_UNAVAILABLE', 'YNAB is temporarily unavailable. Check the current data before retrying a write.'];
        throw new ToolError(code, message);
      }
      // Bound memory even when the upstream omits Content-Length.
      const reader = response.body?.getReader();
      if (!reader) throw new ToolError('YNAB_INVALID_RESPONSE', 'YNAB returned an empty response.');
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 20_000_000) { await reader.cancel(); throw new ToolError('RESPONSE_TOO_LARGE', 'Narrow the transaction date range and try again.'); }
        chunks.push(chunk.value);
      }
      const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!isObject(payload) || !isObject(payload.data)) throw new ToolError('YNAB_INVALID_RESPONSE', 'YNAB returned an unexpected response.');
      return payload.data;
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error instanceof SyntaxError) throw new ToolError('YNAB_INVALID_RESPONSE', 'YNAB returned an invalid JSON response.');
      throw new ToolError('YNAB_CONNECTION_FAILED', method === 'GET'
        ? 'Could not reach YNAB within the request timeout. Try again later.'
        : 'The write outcome is unknown. Read the current YNAB data before retrying; reuse the same idempotency key for a create.');
    }
  }
}

export function isObject(value: unknown): value is Data { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function object(value: unknown): Data {
  if (!isObject(value)) throw new ToolError('YNAB_INVALID_RESPONSE', 'YNAB returned an unexpected object.');
  return value;
}
export function rows(value: unknown): Data[] {
  if (!Array.isArray(value) || !value.every(isObject)) throw new ToolError('YNAB_INVALID_RESPONSE', 'YNAB returned an unexpected list.');
  return value;
}
