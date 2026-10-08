// Publish ONLY an encrypted snapshot. A detached worktree leaves the working branch,
// tracked edits and staging area untouched. No force checkout, reset or force push.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { decryptEnvelope } from './emit.mjs';

export async function assertEncryptedSnapshot(bytes, passphrase) {
  if (!passphrase) throw new Error('PF_PASSPHRASE is required; refusing to publish.');
  const envelope = JSON.parse(bytes.toString());
  const keys = ['enc', 'v', 'iter', 'salt', 'iv', 'ct'];
  if (envelope?.enc !== 1 || envelope.v !== 1 || envelope.iter !== 150000
      || Object.keys(envelope).some(k => !keys.includes(k))) {
    throw new Error('Snapshot must contain only the supported encrypted envelope.');
  }
  for (const [key, size] of [['salt', 16], ['iv', 12], ['ct', null]]) {
    const value = envelope[key];
    if (typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value
        || (size ? Buffer.from(value, 'base64').length !== size : Buffer.from(value, 'base64').length < 16)) {
      throw new Error(`Invalid encrypted snapshot field: ${key}`);
    }
  }
  // Successful authentication is required, not merely an enc:1 marker.
  await decryptEnvelope(envelope, passphrase);
}

export async function publishSnapshot({ root, bytes, passphrase, sourceBlob, label }) {
  await assertEncryptedSnapshot(bytes, passphrase);
  if (!/^[a-f0-9]{40,64}$/.test(sourceBlob || '')) throw new Error('Missing source snapshot identity.');
  const git = (args, options = {}) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options,
  }).trim();
  git(['fetch', 'origin', 'main']);
  const parent = git(['rev-parse', 'refs/remotes/origin/main']);
  if (git(['rev-parse', `${parent}:data.json`]) !== sourceBlob) {
    throw new Error('Remote snapshot changed during this run. Refusing to overwrite newer history; start a fresh run.');
  }
  const blob = git(['hash-object', '-w', '--stdin'], { input: bytes });
  if (blob === sourceBlob) return { published: false, commit: parent };
  const raw = join(root, 'producer', 'raw');
  mkdirSync(raw, { recursive: true });
  const scratch = mkdtempSync(join(raw, 'snapshot-publish-'));
  const worktree = join(scratch, 'checkout');
  let attached = false;
  try {
    git(['worktree', 'add', '--detach', worktree, parent]);
    attached = true;
    writeFileSync(join(worktree, 'data.json'), bytes);
    const workGit = args => git(args, { cwd: worktree });
    workGit(['add', 'data.json']);
    // Normal commit preserves configured Git hooks. Inspect the finished commit too:
    // a hook must not silently stage unrelated files or change the encrypted payload.
    workGit(['commit', '-m', `data: snapshot ${label}`]);
    const commit = workGit(['rev-parse', 'HEAD']);
    const paths = workGit(['diff', '--name-only', parent, commit]);
    if (paths !== 'data.json') throw new Error('Publish tree contains unexpected changes.');
    if (workGit(['rev-parse', `${commit}:data.json`]) !== blob)
      throw new Error('Committed snapshot differs from the authenticated encrypted payload.');
    // A rejection is terminal. No alternate transport, force push, or blind retry.
    git(['push', 'origin', `${commit}:refs/heads/main`]);
    const remote = git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0];
    if (remote !== commit) {
      const error = new Error(`Push returned, but remote verification differs. Inspect commit ${commit}; do not blindly retry.`);
      error.code = 'PUBLISH_UNVERIFIED';
      throw error;
    }
    return { published: true, commit };
  } finally {
    // No force removal: preserve a failed hook's dirty checkout for diagnosis.
    if (attached) {
      try { git(['worktree', 'remove', worktree]); attached = false; }
      catch { console.warn('[publish] Retained temporary worktree after failure:', worktree); }
    }
    if (!attached) rmSync(scratch, { recursive: true });
  }
}
