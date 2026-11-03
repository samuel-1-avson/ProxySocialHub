import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// node-status.ts only needs react for its clock hook, which these tests do not run.
function load(relative) {
  const exports = {};
  const {outputText} = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  });
  vm.runInNewContext(outputText, {
    exports,
    window: {},
    require: (name) => {
      if (name !== 'react') throw new Error(`Unexpected dependency ${name}`);
      return {useState: () => [0, () => {}], useEffect: () => {}};
    },
  });
  return exports;
}

const {isNodeOnline, nodeStatusLabel, lastSeenText, NODE_STALE_AFTER_MS} = load('../src/lib/node-status.ts');
const now = Date.parse('2026-11-02T12:00:00Z');
const ago = (ms) => new Date(now - ms).toISOString();

test('an online node seen recently is online', () => {
  assert.equal(isNodeOnline({status: 'online', last_seen_at: ago(60_000)}, now), true);
  assert.equal(nodeStatusLabel({status: 'online', last_seen_at: ago(60_000)}, now), 'online');
});

test('an online node that went silent reads as offline', () => {
  const node = {status: 'online', last_seen_at: ago(NODE_STALE_AFTER_MS + 1000)};
  assert.equal(isNodeOnline(node, now), false);
  assert.equal(nodeStatusLabel(node, now), 'offline');
});

test('other statuses are never online, however fresh', () => {
  assert.equal(isNodeOnline({status: 'offline', last_seen_at: ago(1000)}, now), false);
  assert.equal(isNodeOnline({status: 'pending', last_seen_at: ago(1000)}, now), false);
  assert.equal(nodeStatusLabel({status: 'pending'}, now), 'pending');
});

test('a node with no usable last-seen time falls back to its stored status', () => {
  assert.equal(isNodeOnline({status: 'online'}, now), true);
  assert.equal(isNodeOnline({status: 'online', last_seen_at: 'not a date'}, now), true);
  assert.equal(isNodeOnline({status: 'offline'}, now), false);
});

test('last seen text', () => {
  assert.equal(lastSeenText({}, now), 'Never seen');
  assert.equal(lastSeenText({last_seen_at: ago(20_000)}, now), 'Last seen just now');
  assert.equal(lastSeenText({last_seen_at: ago(60_000)}, now), 'Last seen 1 minute ago');
  assert.equal(lastSeenText({last_seen_at: ago(7 * 60_000)}, now), 'Last seen 7 minutes ago');
  assert.equal(lastSeenText({last_seen_at: ago(3 * 3600_000)}, now), 'Last seen 3 hours ago');
  assert.equal(lastSeenText({last_seen_at: ago(5 * 86400_000)}, now), 'Last seen 5 days ago');
});
