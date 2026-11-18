import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { checkPlugin } from './check-plugin.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--app-id' || !/^plugin_asdk_app[A-Za-z0-9_-]+$/.test(args[1]))) {
  console.error('Usage: pnpm plugin:build [--app-id plugin_asdk_app…]'); process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suffix = args.length ? 'chatgpt' : 'desktop';
const marketplace = resolve(root, `artifacts/ynab-${suffix}-marketplace`);
const target = join(marketplace, 'plugins/ynab-local');
await mkdir(dirname(target), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(resolve(root, 'plugin/ynab-local'), target, { recursive: true });
await cp(resolve(root, 'LICENSE'), join(target, 'LICENSE'));
if (args.length) {
  const file = join(target, 'plugin.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.extensions['com.openai'].apps = './.app.json';
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(target, '.app.json'), `${JSON.stringify({ apps: { ynab: { id: args[1], required: true } } }, null, 2)}\n`);
  await rm(join(target, 'mcp.json'));
  await rm(join(target, 'scripts'), { recursive: true });
}
await checkPlugin(target);
const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) files[relative(target, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
    else throw new Error('Plugin packages may not contain links or special files.');
  }
}
await collect(target);
const archive = resolve(root, `artifacts/ynab-local-${suffix}.zip`);
await writeFile(archive, zipSync(files));
await mkdir(join(marketplace, '.agents/plugins'), { recursive: true });
await writeFile(join(marketplace, '.agents/plugins/marketplace.json'), `${JSON.stringify({
  name: `ynab-${suffix}`, interface: { displayName: 'YNAB Local' },
  plugins: [{ name: 'ynab-local', source: { source: 'local', path: './plugins/ynab-local' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
}, null, 2)}\n`);
console.log(`Built ${relative(root, archive)} and ${relative(root, marketplace)}. No credentials are included.`);
