/**
 * Contract check for the wallet session events (logout / user switch).
 * Run: npm run test:wallet-session
 *
 * Loads the real src/lib/solana-wallet-session.ts (transpiled with the repo's TypeScript) and
 * drives it with browser-style events. Regression guard: the listener for the session-clear event
 * used to raise that same event again, so every logout overflowed the call stack.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/solana-wallet-session.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function fakeBrowser() {
    const store = new Map([['walletName', '"Phantom"'], ['walletAdapter', 'x'], ['SolanaWalletAdapter', 'y']]);
    const win = new EventTarget();
    win.localStorage = { removeItem: (k) => store.delete(k), getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    win.sessionStorage = { removeItem() {}, getItem: () => null, setItem() {} };
    globalThis.window = win;
    return { win, store };
}

// 1. Raising the session-clear event reaches the listener once and terminates.
{
    const { win, store } = fakeBrowser();
    let disconnects = 0;
    const unbind = mod.bindWalletSessionClear({
        isConnected: () => true,
        disconnect: async () => { disconnects++; },
        target: win,
    });
    mod.clearSolanaWalletAdapterSession(); // would overflow the stack if the listener re-cleared
    assert(disconnects === 1, `session clear: expected 1 disconnect, got ${disconnects}`);
    assert(store.size === 0, 'session clear: wallet storage keys were not removed');
    unbind();
}

// 2. Logout order used by auth.tsx: clear storage, then raise the logout event.
{
    const { win } = fakeBrowser();
    let disconnects = 0;
    const unbind = mod.bindWalletSessionClear({
        isConnected: () => true, // a stale `connected` closure, as in React before the re-render
        disconnect: async () => { disconnects++; },
        target: win,
    });
    mod.clearSolanaWalletAdapterSession();
    win.dispatchEvent(new CustomEvent(mod.AUTH_LOGOUT_EVENT));
    assert(disconnects >= 1 && disconnects <= 2, `logout: expected 1-2 disconnects, got ${disconnects}`);
    unbind();
}

// 3. Not connected: nothing to disconnect. A failing disconnect never throws out of the listener.
{
    const { win } = fakeBrowser();
    let disconnects = 0;
    const unbindIdle = mod.bindWalletSessionClear({ isConnected: () => false, disconnect: async () => { disconnects++; }, target: win });
    mod.clearSolanaWalletAdapterSession();
    assert(disconnects === 0, 'idle wallet: disconnect must not be called');
    unbindIdle();

    const unbindFail = mod.bindWalletSessionClear({ isConnected: () => true, disconnect: async () => { throw new Error('wallet gone'); }, target: win });
    mod.clearSolanaWalletAdapterSession();
    await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the process here
    unbindFail();
}

// 4. After unbind the listener is gone.
{
    const { win } = fakeBrowser();
    let disconnects = 0;
    const unbind = mod.bindWalletSessionClear({ isConnected: () => true, disconnect: async () => { disconnects++; }, target: win });
    unbind();
    mod.clearSolanaWalletAdapterSession();
    win.dispatchEvent(new CustomEvent(mod.AUTH_LOGOUT_EVENT));
    assert(disconnects === 0, 'unbind: listener still fired');
}

// 5. Sign-in failures: a declined request is not a fault; Phantom's bare "Unexpected error"
//    means the connection is stale and the wallet must be reset; anything else passes through.
{
    const walletErr = (message) => Object.assign(new Error(message), { name: 'WalletSignMessageError' });
    const declined = mod.classifySignInError(walletErr('User rejected the request.'), 'x');
    assert(declined.resetWallet === false && /cancelled/.test(declined.message), 'declined request should not reset the wallet');
    const stale = mod.classifySignInError(walletErr('Unexpected error'), 'x');
    assert(stale.resetWallet === true && /connect/.test(stale.message), 'Unexpected error should reset the wallet');
    assert(mod.classifySignInError(walletErr(''), 'x').resetWallet === true, 'empty sign error should reset the wallet');
    const other = mod.classifySignInError(walletErr('Ledger does not support signMessage'), 'x');
    assert(other.resetWallet === false && other.message === 'Ledger does not support signMessage', 'other wallet errors pass through');
    const net = mod.classifySignInError(new Error('Wallet challenge returned non-JSON response (status 502).'), 'x');
    assert(net.resetWallet === false && /502/.test(net.message), 'API errors pass through');
    assert(mod.classifySignInError({ weird: true }, 'fallback text').message === 'fallback text', 'unknown values use the fallback');
    // A different error type with the same words is not treated as a wallet fault.
    assert(mod.classifySignInError(new Error('Unexpected error'), 'x').resetWallet === false, 'only WalletSignMessageError resets');
}

console.log('wallet-session contract OK');
