// Exercise the real orchestrator, validator and publisher with a synthetic builder
// and a local bare remote. No broker calls, credentials or production publication.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptEnvelope } from './emit.mjs';
import { makeKey, RH } from './key.mjs';
const source = dirname(fileURLToPath(import.meta.url)), passphrase = 'synthetic-run-test';
const replay = { recorded: {
  [makeKey(RH + 'get_portfolio', { account_number: 'ACCT' })]: { structuredContent: { data: { total_value: '10' } } },
  [makeKey(RH + 'get_equity_positions', { account_number: 'ACCT' })]: { structuredContent: { data: { positions: [] } } },
}, quotes: {}, hist: {} };
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
async function scenario({ pass = passphrase, valid = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'run-regression-'));
  try {
    const producer = join(root, 'producer'), remote = join(root, 'remote.git');
    mkdirSync(join(producer, 'raw'), { recursive: true });
    for (const file of ['run.mjs', 'snapshot-publish.mjs', 'market.mjs', 'emit.mjs', 'validate.mjs', 'key.mjs']) copyFileSync(join(source, file), join(producer, file));
    for (const file of ['portfolio.json', 'positions.json']) writeFileSync(join(producer, 'raw', file), '{}');
    writeFileSync(join(root, '.gitignore'), 'remote.git/\nproducer/raw/\n');
    writeFileSync(join(producer, 'build-data.mjs'), `import { emit } from './emit.mjs'; await emit(${JSON.stringify(valid ? replay : { recorded: {} })});`);
    const prior = JSON.stringify(await encryptEnvelope(JSON.stringify(replay), passphrase));
    writeFileSync(join(root, 'data.json'), prior);
    git(root, ['init', '--initial-branch=main']);
    git(root, ['config', 'user.name', 'Synthetic Test']); git(root, ['config', 'user.email', 'test@example.invalid']);
    git(root, ['add', '.']); git(root, ['commit', '-m', 'synthetic fixture']);
    git(root, ['init', '--bare', '--initial-branch=main', remote]);
    git(root, ['remote', 'add', 'origin', remote]); git(root, ['push', 'origin', 'main']);
    const before = git(remote, ['rev-parse', 'main']);
    const result = spawnSync(process.execPath, [join(producer, 'run.mjs'), 'synthetic refresh', '--no-av', '--no-extfund', '--no-flow'],
      { cwd: root, env: { ...process.env, PF_PASSPHRASE: pass }, encoding: 'utf8' });
    return { ...result, before, after: git(remote, ['rev-parse', 'main']),
      untouched: readFileSync(join(root, 'data.json'), 'utf8') === prior };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('orchestrator stops before build when the encryption key is missing', async () => {
  const result = await scenario({ pass: '' });
  assert.notEqual(result.status, 0); assert.equal(result.before, result.after); assert.equal(result.untouched, true);
});
test('orchestrator stops before build when prior history cannot be decrypted', async () => {
  const result = await scenario({ pass: 'wrong' });
  assert.notEqual(result.status, 0); assert.equal(result.before, result.after); assert.equal(result.untouched, true);
});
test('validation failure prevents commit and push', async () => {
  const result = await scenario({ valid: false });
  assert.notEqual(result.status, 0); assert.equal(result.before, result.after);
  assert.match(result.stderr, /validation failed/);
});
test('valid encrypted replay with empty holdings/historicals publishes and verifies', async () => {
  const result = await scenario();
  assert.equal(result.status, 0, result.stderr); assert.notEqual(result.before, result.after);
  assert.match(result.stdout, /PUBLISHED [a-f0-9]+/);
});
