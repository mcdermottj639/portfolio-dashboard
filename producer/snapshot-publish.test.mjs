import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptEnvelope } from './emit.mjs';
import { assertEncryptedSnapshot, publishSnapshot } from './snapshot-publish.mjs';
const passphrase = 'synthetic-test-only';
const bytes = Buffer.from(JSON.stringify(await encryptEnvelope(JSON.stringify({ synthetic: true }), passphrase)));
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
async function fixture(fn) {
  const temp = mkdtempSync(join(tmpdir(), 'snapshot-test-'));
  try {
    const root = join(temp, 'work'), remote = join(temp, 'remote.git');
    mkdirSync(root);
    git(temp, ['init', '--bare', '--initial-branch=main', remote]);
    git(root, ['init', '--initial-branch=main']);
    git(root, ['config', 'user.name', 'Synthetic Test']);
    git(root, ['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(root, 'data.json'), bytes);
    writeFileSync(join(root, 'code.txt'), 'original');
    git(root, ['add', '.']); git(root, ['commit', '-m', 'fixture']);
    git(root, ['remote', 'add', 'origin', remote]); git(root, ['push', '-u', 'origin', 'main']);
    const sourceBlob = git(root, ['rev-parse', 'HEAD:data.json']);
    const fresh = Buffer.from(JSON.stringify(await encryptEnvelope(JSON.stringify({ synthetic: 'fresh' }), passphrase)));
    await fn({ root, remote, temp, sourceBlob, fresh });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
test('only encrypted data.json publishes; branch, staging area and worktree survive', async () => fixture(async ({ root, remote, sourceBlob, fresh }) => {
  git(root, ['switch', '-c', 'test-session']);
  writeFileSync(join(root, 'code.txt'), 'staged'); git(root, ['add', 'code.txt']);
  writeFileSync(join(root, 'code.txt'), 'unstaged');
  const head = git(root, ['rev-parse', 'HEAD']), staged = git(root, ['diff', '--cached']);
  const result = await publishSnapshot({ root, bytes: fresh, passphrase, sourceBlob, label: 'synthetic test' });
  assert.equal(result.published, true);
  assert.equal(git(root, ['rev-parse', 'HEAD']), head);
  assert.equal(git(root, ['branch', '--show-current']), 'test-session');
  assert.equal(git(root, ['diff', '--cached']), staged);
  assert.equal(readFileSync(join(root, 'code.txt'), 'utf8'), 'unstaged');
  assert.equal(git(remote, ['show', 'main:code.txt']), 'original');
  assert.equal(git(remote, ['show', 'main:data.json']), fresh.toString());
  assert.equal(git(remote, ['diff', '--name-only', 'main^', 'main']), 'data.json');
}));
test('reject plaintext, extra plaintext fields, missing passphrase and wrong key', async () => {
  await assert.rejects(assertEncryptedSnapshot(Buffer.from('{"holdings":[]}'), passphrase));
  await assert.rejects(assertEncryptedSnapshot(Buffer.from(JSON.stringify({ ...JSON.parse(bytes), holdings: [] })), passphrase));
  await assert.rejects(assertEncryptedSnapshot(bytes, ''));
  await assert.rejects(assertEncryptedSnapshot(bytes, 'wrong-key'));
});
test('newer remote data cannot be overwritten by a stale build', async () => fixture(async ({ root, sourceBlob, fresh }) => {
  await publishSnapshot({ root, bytes: fresh, passphrase, sourceBlob, label: 'first' });
  const before = git(root, ['ls-remote', 'origin', 'refs/heads/main']);
  await assert.rejects(publishSnapshot({ root, bytes, passphrase, sourceBlob, label: 'stale' }), /Remote snapshot changed/);
  assert.equal(git(root, ['ls-remote', 'origin', 'refs/heads/main']), before);
}));
test('remote code changes survive a data-only publication', async () => fixture(async ({ root, remote, sourceBlob, fresh }) => {
  writeFileSync(join(root, 'code.txt'), 'new code'); git(root, ['add', 'code.txt']);
  git(root, ['commit', '-m', 'concurrent code']); git(root, ['push', 'origin', 'main']);
  await publishSnapshot({ root, bytes: fresh, passphrase, sourceBlob, label: 'synthetic' });
  assert.equal(git(remote, ['show', 'main:code.txt']), 'new code');
}));
test('remote rejection stops after one attempt and leaves remote unchanged', async () => fixture(async ({ root, remote, sourceBlob, fresh }) => {
  const hook = join(remote, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho attempt >> attempts\necho "synthetic policy rejection" >&2\nexit 1\n'); chmodSync(hook, 0o755);
  const before = git(remote, ['rev-parse', 'main']);
  await assert.rejects(publishSnapshot({ root, bytes: fresh, passphrase, sourceBlob, label: 'rejected' }));
  assert.equal(git(remote, ['rev-parse', 'main']), before);
  assert.equal(readFileSync(join(remote, 'attempts'), 'utf8').trim(), 'attempt');
}));
test('configured commit hooks remain enforced', async () => fixture(async ({ root, remote, sourceBlob, fresh }) => {
  const hook = join(root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "synthetic commit-hook rejection" >&2\nexit 1\n'); chmodSync(hook, 0o755);
  const before = git(remote, ['rev-parse', 'main']);
  await assert.rejects(publishSnapshot({ root, bytes: fresh, passphrase, sourceBlob, label: 'hook rejected' }));
  assert.equal(git(remote, ['rev-parse', 'main']), before);
}));
