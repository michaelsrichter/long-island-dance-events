// Builds public/admin/config.yml from cms/config.yml.
// The source uses YAML anchors to share field groups; Decap needs a flat list of fields, so
// nested lists (from `- *event-details`) are flattened and helper keys (x-*) are removed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function buildCmsConfig(sourceText) {
  const doc = YAML.parse(sourceText, { merge: true, maxAliasCount: -1 });
  for (const key of Object.keys(doc)) if (key.startsWith('x-')) delete doc[key];
  const flattenFields = (node) => {
    if (Array.isArray(node)) return node.map(flattenFields);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'fields' && Array.isArray(v)) node[k] = v.flat(Infinity).map(flattenFields);
        else node[k] = flattenFields(v);
      }
    }
    return node;
  };
  return flattenFields(doc);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = buildCmsConfig(readFileSync(join(root, 'cms/config.yml'), 'utf8'));
  const out = join(root, 'public/admin/config.yml');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `# GENERATED from cms/config.yml by scripts/build-cms-config.mjs. Edit the source file instead.\n${YAML.stringify(config, { aliasDuplicateObjects: false, lineWidth: 0 })}`);
  console.log(`[cms] wrote public/admin/config.yml (${config.collections.length} collections)`);
}
