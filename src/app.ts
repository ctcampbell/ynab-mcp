import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { createMcpServer } from './tools.js';
import { YnabClient } from './ynab.js';

export function createApp(config: Config, api = new YnabClient({ token: config.ynabToken, cacheTtlMs: config.cacheTtlMs, timeoutMs: config.requestTimeoutMs })) {
  const app = express();
  app.disable('x-powered-by');
  const expected = createHash('sha256').update(config.mcpToken).digest();
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Validate Host without trusting forwarded headers or enabling Express trust proxy.
    let hostname: string;
    try {
      const host = req.headers.host;
      if (!host || /[\s/@?#]/.test(host)) throw new Error();
      hostname = new URL(`http://${host}`).hostname.toLowerCase();
    } catch { res.status(400).json({ error: 'Invalid Host header.' }); return; }
    if (!config.allowedHosts.includes(hostname)) { res.status(421).json({ error: 'Host is not allowed.' }); return; }
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) { res.status(403).json({ error: 'Origin is not allowed.' }); return; }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');
    }
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'ynab-local-mcp' }));
  app.options('/mcp', (_req, res) => { res.sendStatus(204); });
  let active = 0;
  app.use('/mcp', (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1] ?? '';
    if (!timingSafeEqual(createHash('sha256').update(token).digest(), expected)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="ynab-local"');
      res.status(401).json({ error: 'Authentication required.' }); return;
    }
    if (active >= 16) { res.setHeader('Retry-After', '1'); res.status(503).json({ error: 'Server busy.' }); return; }
    active++;
    res.once('close', () => { active--; });
    next();
  });
  app.use('/mcp', express.json({ limit: '128kb' }));
  app.all('/mcp', async (req, res) => {
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'POST, GET, DELETE, OPTIONS'); res.sendStatus(405); return; }
    const server = createMcpServer(config, api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => { void transport.close().catch(() => {}); void server.close().catch(() => {}); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch {
      // Never log request bodies, Authorization, memos, or upstream error payloads.
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error.' }, id: null });
    }
  });
  app.use((_req, res) => { res.status(404).json({ error: 'Not found.' }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: status === 413 ? 'Request too large.' : status === 400 ? 'Invalid JSON.' : 'Internal server error.' });
  };
  app.use(errors);
  return app;
}
