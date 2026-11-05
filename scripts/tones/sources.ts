// Downloads pinned source files once, into the gitignored `.cache/tone-sources/`: single
// files from a GitHub commit, or files inside a publisher's archive pinned by SHA-256.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

export interface ArchiveSet {
  /** The publisher's own download URL for a `.tar.xz`. */
  url: string;
  /** The archive's SHA-256, so a rebuild fails rather than read changed bytes. */
  sha256: string;
}

/**
 * Returns the local path of a file inside a pinned archive, downloading, checking and
 * unpacking it once. The system `tar` unpacks it, refusing absolute and `..` paths.
 */
export async function fetchFromArchive(set: ArchiveSet, file: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(set.sha256)) throw new Error(`${set.url}: pin a SHA-256`);
  const dir = path.join(CACHE_DIR, `archive@${set.sha256}`);
  const local = path.join(dir, file);
  if (!local.startsWith(dir + path.sep)) throw new Error(`${file} is outside the archive`);

  if (!existsSync(path.join(dir, '.unpacked'))) {
    const response = await fetch(set.url);
    if (!response.ok) throw new Error(`${set.url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== set.sha256) {
      throw new Error(`${set.url}: SHA-256 is ${sha256}, but the recipe pins ${set.sha256}`);
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, '.archive');
    writeFileSync(archive, bytes);
    execFileSync('tar', ['-xJf', archive, '-C', dir]);
    rmSync(archive);
    writeFileSync(path.join(dir, '.unpacked'), '');
  }
  if (!existsSync(local)) throw new Error(`${set.url} holds no ${file}`);
  return local;
}
