import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import bs58 from 'bs58';
import ts from 'typescript';

// listing-offer.ts imports through the app's "@/" alias, which plain Node cannot resolve (it broke when
// listing-protocols was imported at runtime). Transpile it and hand it the two runtime dependencies,
// the same way geo-hub-guard.test.mjs loads its modules.
function load(relative, dependencies = {}) {
  const exports = {};
  const source = new URL(relative, import.meta.url);
  const {outputText} = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  });
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const protocols = load('../src/lib/listing-protocols.ts');
const {resolveListingSigner} = load('../src/lib/proofs/listing-offer.ts', {
  bs58: {default: bs58},
  '@/lib/listing-protocols': protocols,
});

const HOTKEY = '7uwA2Vz2uEKDx2qQFtBfsJML7p6NBf8z1xWHms42aqiF';
const WALLET = 'HBr13ei1aLnaJiDvnVpD1MKcn5nwAHJn7swhx9w24kni';

function input(over){
  return {hasSecret:false,deviceHotkey:'',nodeHotkey:'',walletConnected:false,walletCanSign:false,walletHotkey:'',devServerSigning:false,...over};
}

test('browser secret matching the node hotkey wins',()=>{
  assert.equal(resolveListingSigner(input({hasSecret:true,deviceHotkey:HOTKEY,nodeHotkey:HOTKEY})),'local-secret');
});
test('any browser secret works when the node reported no hotkey',()=>{
  assert.equal(resolveListingSigner(input({hasSecret:true,deviceHotkey:'zzz'})),'local-secret');
});
test('CLI-configured node with no browser secret and a different wallet needs recovery',()=>{
  assert.equal(resolveListingSigner(input({nodeHotkey:HOTKEY,walletConnected:true,walletCanSign:true,walletHotkey:WALLET})),'none');
});
test('wallet matching the node hotkey signs when the secret does not',()=>{
  assert.equal(resolveListingSigner(input({hasSecret:true,deviceHotkey:'other',nodeHotkey:HOTKEY,walletConnected:true,walletCanSign:true,walletHotkey:HOTKEY})),'wallet');
});
test('wallet signs when there is no browser secret at all',()=>{
  assert.equal(resolveListingSigner(input({nodeHotkey:WALLET,walletConnected:true,walletCanSign:true,walletHotkey:WALLET})),'wallet');
});
test('wallet that cannot sign is skipped',()=>{
  assert.equal(resolveListingSigner(input({nodeHotkey:HOTKEY,walletConnected:true,walletCanSign:false,walletHotkey:HOTKEY})),'none');
});
test('empty wallet hotkey never matches',()=>{
  assert.equal(resolveListingSigner(input({walletConnected:true,walletCanSign:true,walletHotkey:''})),'none');
});
test('dev server signing is the last resort',()=>{
  assert.equal(resolveListingSigner(input({nodeHotkey:HOTKEY,devServerSigning:true})),'dev');
  assert.equal(resolveListingSigner(input({hasSecret:true,deviceHotkey:HOTKEY,nodeHotkey:HOTKEY,devServerSigning:true})),'local-secret');
});
test('node hotkey whitespace is ignored',()=>{
  assert.equal(resolveListingSigner(input({hasSecret:true,deviceHotkey:HOTKEY,nodeHotkey:'  '+HOTKEY+'  '})),'local-secret');
});

