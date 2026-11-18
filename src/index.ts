import { createApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const server = createApp(config).listen(config.port, config.host, () => {
    console.error(JSON.stringify({ event: 'listening', host: config.host, port: config.port, writes_enabled: config.writesEnabled }));
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on('error', () => { console.error('Could not start the HTTP listener. Check HOST and PORT.'); process.exitCode = 1; });
  const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Server configuration failed.');
  process.exitCode = 1;
}
