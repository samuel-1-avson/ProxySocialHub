import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// node-offer-signature.ts imports the API client through the "@/" alias. Transpile it and
// hand it a scripted fake of the two calls it makes (see listing-signer.test.mjs).
function load(api) {
  const exports = {};
  const source = new URL('../src/lib/proofs/node-offer-signature.ts', import.meta.url);
  const {outputText} = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  });
  vm.runInNewContext(outputText, {
    exports,
    setTimeout,
    clearTimeout,
    DOMException,
    Date,
    require: (name) => {
      if (name !== '@/lib/api/marketplace') throw new Error(`Unexpected dependency ${name}`);
      return api;
    },
  });
  return exports;
}

const PROOF = {message_type: 'PROXYHUB_LISTING_OFFER', signature: 'sig'};
const BODY = {listing: {title: 'Accra', proxy_type: 'residential', protocol: 'http', price_per_gb: 1, available_bandwidth_gb: 5}};
const FAST = {nodeName: 'Test1', pollMs: 1, listeningTimeoutMs: 200, offlineTimeoutMs: 60};

function fakeApi(views, {created} = {}) {
  const calls = {requested: [], polled: 0};
  return {
    calls,
    api: {
      requestNodeOfferSignature: async (body) => {
        calls.requested.push(body);
        return created ?? {id: 'r1', status: 'pending', node_listening: true};
      },
      getNodeOfferSignature: async (id) => {
        assert.equal(id, 'r1');
        calls.polled += 1;
        const next = views.length > 1 ? views.shift() : views[0];
        if (next instanceof Error) throw next;
        return {id: 'r1', ...next};
      },
    },
  };
}

test('returns the node proof once the node has signed', async () => {
  const {api, calls} = fakeApi([
    {status: 'pending', node_listening: true},
    {status: 'signed', node_listening: true, proof: PROOF},
  ]);
  const {signOfferWithNode} = load(api);
  const waiting = [];
  const proof = await signOfferWithNode(BODY, {...FAST, onWaiting: (l) => waiting.push(l)});
  assert.deepEqual(proof, PROOF);
  // The exact body to be published is what gets parked for the node.
  assert.deepEqual(calls.requested, [BODY]);
  assert.equal(calls.polled, 2);
  assert.ok(waiting.length >= 1 && waiting.every((l) => l === true));
});

test('a refusal ends the wait with the node’s reason', async () => {
  const {api} = fakeApi([{status: 'refused', node_listening: true, error: 'Your node declined: wrong node'}]);
  const {signOfferWithNode, NodeSignatureError} = load(api);
  await assert.rejects(signOfferWithNode(BODY, FAST), (err) => {
    assert.ok(err instanceof NodeSignatureError);
    assert.equal(err.reason, 'refused');
    assert.match(err.message, /wrong node/);
    return true;
  });
});

test('a node that never connects gives up quickly and says how to fix it', async () => {
  const {api} = fakeApi([{status: 'pending', node_listening: false}], {
    created: {id: 'r1', status: 'pending', node_listening: false},
  });
  const {signOfferWithNode} = load(api);
  const started = Date.now();
  await assert.rejects(signOfferWithNode(BODY, FAST), (err) => {
    assert.equal(err.reason, 'offline');
    assert.match(err.message, /Test1 is not connected/);
    assert.match(err.message, /1\.0\.13/);
    return true;
  });
  assert.ok(Date.now() - started < 190, 'used the shorter offline timeout');
});

test('a connected node that stays silent times out on the longer limit', async () => {
  const {api} = fakeApi([{status: 'pending', node_listening: true}]);
  const {signOfferWithNode} = load(api);
  const started = Date.now();
  await assert.rejects(signOfferWithNode(BODY, FAST), (err) => {
    assert.equal(err.reason, 'offline');
    assert.match(err.message, /did not sign in time/);
    return true;
  });
  assert.ok(Date.now() - started >= 190, 'waited the listening timeout');
});

test('an expired request (404) asks to publish again', async () => {
  const gone = Object.assign(new Error('gone'), {status: 404});
  const {api} = fakeApi([gone]);
  const {signOfferWithNode} = load(api);
  await assert.rejects(signOfferWithNode(BODY, FAST), (err) => {
    assert.equal(err.reason, 'expired');
    return true;
  });
});

test('other API errors are passed through unchanged', async () => {
  const boom = Object.assign(new Error('server down'), {status: 503});
  const {api} = fakeApi([boom]);
  const {signOfferWithNode} = load(api);
  await assert.rejects(signOfferWithNode(BODY, FAST), (err) => err === boom);
});
