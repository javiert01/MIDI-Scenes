// Downloads pinned source files once, into the gitignored `.cache/tone-sources/`.

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CACHE_DIR = fileURLToPath(new URL('../../.cache/tone-sources', import.meta.url));

export interface GitHubSet {
  /** owner/name */
  repo: string;
  /** A full commit SHA, never a branch or tag, so a rebuild reads the same bytes. */
  commit: string;
}

/** Returns the local path of a file from a pinned GitHub commit, fetching it if needed. */
export async function fetchFromGitHub(set: GitHubSet, file: string): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(set.commit)) throw new Error(`${set.repo}: pin a full commit SHA`);
  const local = path.join(CACHE_DIR, `${set.repo.replace('/', '__')}@${set.commit}`, file);
  if (existsSync(local)) return local;

  const url = `https://raw.githubusercontent.com/${set.repo}/${set.commit}/${file.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  mkdirSync(path.dirname(local), { recursive: true });
  writeFileSync(`${local}.part`, new Uint8Array(await response.arrayBuffer()));
  renameSync(`${local}.part`, local);
  return local;
}
