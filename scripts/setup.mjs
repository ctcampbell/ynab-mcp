import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
await mkdir(new URL('.secrets/', root), { recursive: true, mode: 0o700 });
async function create(path, content, mode = 0o600) {
  try { await writeFile(new URL(path, root), content, { flag: 'wx', mode }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
await create('.secrets/mcp-authorization', `Bearer ${randomBytes(32).toString('base64url')}\n`);
await create('.secrets/ynab-token', 'REPLACE_WITH_YNAB_PERSONAL_ACCESS_TOKEN\n');
await create('.secrets/openai-tunnel-key', 'REPLACE_WITH_OPENAI_TUNNEL_RUNTIME_KEY\n');
let env = await readFile(new URL('.env.example', root), 'utf8');
env = env.replace('PUID=1000', `PUID=${process.getuid?.() ?? 1000}`).replace('PGID=1000', `PGID=${process.getgid?.() ?? 1000}`);
await create('.env', env);
console.log(`Setup files are ready in ${fileURLToPath(root)}. Existing files were preserved.`);
console.log('Edit .secrets/ynab-token locally, then run docker compose up -d --build.');
console.log('For ChatGPT, follow docs/chatgpt.md to set up the private tunnel. No secret has been printed.');
