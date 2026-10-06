/**
 * Where the community /api code is: server/api/ in the deployed package (the deploy workflow copies it there),
 * or api/ next to server/ in the repository. null when it is not there.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function apiDir() {
  if (process.env.API_DIR) return process.env.API_DIR;
  for (const rel of ['../../api/', '../../../api/']) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(join(dir, 'src', 'functions'))) return dir;
  }
  return null;
}
