import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = {};
async function add(path) {
  files[`ynab-local/${path}`] = new Uint8Array(await readFile(join(root, path)));
}
async function directory(path) {
  for (const item of await readdir(join(root, path), { withFileTypes: true })) {
    const child = `${path}/${item.name}`;
    if (item.isDirectory()) await directory(child);
    else if (item.isFile()) await add(child);
    else throw new Error('Source packages may not contain links or special files.');
  }
}
// An explicit allowlist prevents credentials, caches, or generated artifacts entering the archive.
for (const path of ['README.md', 'CONTRIBUTING.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.gitattributes', 'Dockerfile', 'compose.yaml', '.env.example', '.gitignore', '.dockerignore', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.build.json']) await add(path);
for (const path of ['src', 'scripts', 'tests', 'docs', 'schemas', 'plugin', '.github', 'LICENSES']) await directory(path);
await mkdir(join(root, 'artifacts'), { recursive: true });
await writeFile(join(root, 'artifacts/ynab-local-server.zip'), zipSync(files));
console.log(`Built artifacts/ynab-local-server.zip (${Object.keys(files).length} source/configuration files; no credentials or dependencies).`);
