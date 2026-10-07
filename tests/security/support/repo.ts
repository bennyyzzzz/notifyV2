import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.turbo', 'generated']);
const TEXT_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|ya?ml|md|prisma|sql|toml|env|example|html|css)$|^Dockerfile$|^\.[a-z]+rc$/;

/** Lists repository text files (excluding dependencies, build output and generated code). */
export function listRepoFiles(dir = REPO_ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...listRepoFiles(full));
    } else if (TEXT_EXTENSIONS.test(entry) || entry.startsWith('.env')) {
      files.push(full);
    }
  }
  return files;
}

export function readRepoFile(path: string): string {
  return readFileSync(path, 'utf8');
}

export function repoRelative(path: string): string {
  return relative(REPO_ROOT, path).replaceAll('\\', '/');
}
