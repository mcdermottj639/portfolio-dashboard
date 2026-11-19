'use strict';
// Guards the 2026-11-18 instruction split: the default-context CLAUDE.md stays small and every
// reference doc it routes to exists and carries the archive banner. Docs only; reads no app code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const BUDGET = 40000;
const DOCS = ['architecture.md', 'process.md', 'key-files.md', 'gotchas.md', 'features.md', 'release-log.md'];

test('CLAUDE.md stays within its size budget', () => {
  const n = read('CLAUDE.md').length;
  assert.ok(n <= BUDGET, `CLAUDE.md is ${n} characters; budget ${BUDGET}. Move history to docs/claude/release-log.md and reference to docs/claude/*.md.`);
});

test('CLAUDE.md carries no per-release entries', () => {
  const heads = read('CLAUDE.md').split('\n').filter((l) => /^#{1,3} v\d{2,}\b/.test(l));
  assert.deepStrictEqual(heads, [], 'Release entries belong at the top of docs/claude/release-log.md');
});

test('every docs/claude file CLAUDE.md names exists, and every reference doc is named', () => {
  const s = read('CLAUDE.md');
  const named = new Set((s.match(/docs\/claude\/[a-z-]+\.md/g) || []).map((x) => x.slice('docs/claude/'.length)));
  for (const f of named) assert.ok(fs.existsSync(path.join(root, 'docs/claude', f)), `missing docs/claude/${f}`);
  for (const f of DOCS) assert.ok(named.has(f), `CLAUDE.md does not route to docs/claude/${f}`);
});

test('reference docs keep the archive banner and their index', () => {
  for (const f of DOCS) {
    const s = read('docs/claude/' + f);
    assert.match(s, /ARCHIVE \/ REFERENCE — not default context/, f);
  }
  for (const f of ['key-files.md', 'gotchas.md', 'features.md']) {
    assert.match(read('docs/claude/' + f), /\n## Index\n/, f + ' index');
  }
});

test('the agent entry points route to the new layout', () => {
  assert.match(read('AGENTS.md'), /docs\/claude\//);
  assert.match(read('CLAUDE.md'), /ACTIVE RULE/);
  assert.match(read('CLAUDE.md'), /APP_VERSION/); // release markers stay in default context
  assert.match(read('CLAUDE.md'), /UNVERIFIED/); // open items stay in default context
});

test('moved history is unchanged: every MIGRATION.json block re-hashes', () => {
  const crypto = require('crypto');
  const m = JSON.parse(read('docs/claude/MIGRATION.json'));
  assert.strictEqual(m.blocks.reduce((n, b) => n + b.lines, 0), m.sourceLines, 'blocks cover every source line');
  for (const b of m.blocks) {
    const lines = read(b.file).split('\n');
    let found = false;
    for (let i = 0; i + b.lines <= lines.length && !found; i++) {
      const h = crypto.createHash('sha256').update(lines.slice(i, i + b.lines).join('\n')).digest('hex');
      if (h === b.sha256) found = true;
    }
    assert.ok(found, `${b.file}: original lines ${b.origLines.join('-')} changed or missing`);
  }
});
