const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function tapeState() {
  const source = fs.readFileSync(require.resolve('../ui/ticker.js'), 'utf8');
  const sandbox = {
    window: {},
    document: { readyState: 'loading', addEventListener() {} },
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.PFTape._state;
}

test('tape shows freshness words without a second visible date or time', () => {
  const state = tapeState();
  const now = new Date('2026-11-17T15:00:00Z'); // Tue 10 AM Eastern
  const cases = [
    [state({ generatedAt: '2026-11-17T14:41:00Z' }, now), 'Live', 'is-live'],
    [state({ generatedAt: '2026-11-17T12:41:00Z' }, now), 'Delayed', 'is-stale'],
    [state({ generatedAt: '2026-11-17T14:41:00Z' }, new Date('2026-11-17T23:00:00Z')), 'Closed', ''],
    [state({ locked: true }, now), 'Locked', ''],
    [state({ error: true }, now), 'Offline', 'is-stale'],
  ];
  for (const [result, expected, kind] of cases) {
    assert.equal(result.label, expected);
    assert.equal(result.kind, kind);
    assert.doesNotMatch(result.label, /\\b(?:as of|\\d{1,2}:\\d{2}|nov)\\b/i);
  }
});

test('single snapshot date/time stays in the lower sticky header', () => {
  const index = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const tape = fs.readFileSync(require.resolve('../ui/ticker.js'), 'utf8');
  assert.match(index, /id='pf-fresh'/);
  assert.match(index, /id="pf-fresh-left"/);
  assert.match(index, /var displayDate=String\\(lab\\)/);
  assert.doesNotMatch(tape, /\\bAs of\\b.*timeLabel|timeLabel\\(d\\.generatedAt\\)/i);
});
