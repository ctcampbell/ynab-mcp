import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
export async function checkPlugin(directory) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const manifest = await json(resolve(directory, 'plugin.json'));
  const validate = ajv.compile(await json(resolve(root, 'schemas/plugin.schema.json')));
  if (!validate(manifest)) throw new Error(`Invalid plugin manifest: ${ajv.errorsText(validate.errors)}`);
  const apps = manifest.extensions?.['com.openai']?.apps;
  if (apps) {
    if (apps !== './.app.json') throw new Error('Unexpected app mapping path.');
    const mapping = await json(resolve(directory, '.app.json'));
    if (!/^plugin_asdk_app[A-Za-z0-9_-]+$/.test(mapping.apps?.ynab?.id) || mapping.apps.ynab.required !== true) throw new Error('Invalid registered ChatGPT app mapping.');
  } else {
    const mcp = await json(resolve(directory, 'mcp.json'));
    const validateMcp = ajv.compile(await json(resolve(root, 'schemas/mcp.schema.json')));
    if (!validateMcp(mcp)) throw new Error(`Invalid MCP manifest: ${ajv.errorsText(validateMcp.errors)}`);
    await access(resolve(directory, 'scripts/connect.mjs'));
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkPlugin(resolve(process.argv[2] ?? 'plugin/ynab-local'));
  console.log('Plugin manifest, connection configuration and referenced files are valid.');
}
