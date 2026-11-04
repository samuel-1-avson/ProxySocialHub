export type ExtensionPingResponse = {
    ok: boolean;
    installed: boolean;
    browser?: 'chrome' | 'firefox';
    signedIn?: boolean;
    version?: string;
    proxySet?: boolean;
    connectionState?: string;
    orderId?: string;
    /** Public IP seen through the proxy at the last check, when it is on. */
    ip?: string;
};

export type ExtensionPairMessageResponse = {
    ok: boolean;
    email?: string;
    error?: string;
};

export type ExtensionConnectMessageResponse = {
    ok: boolean;
    error?: string;
    status?: { state?: string; orderId?: string; verify?: { ip?: string } };
};

export type ExtensionDisconnectResponse = { ok: boolean; error?: string };

export type BrowserFamily = 'chrome' | 'firefox' | 'safari' | 'other';

/** chrome://extensions ID for an unpacked build. Not the Chrome Web Store item. */
export const UNPACKED_EXTENSION_ID_STORAGE_KEY = 'proxyhubb_unpacked_extension_id';

const CHROME_EXTENSION_ID = /^[a-p]{32}$/;

// Same format as apps/extension/src/lib/bridge-protocol.ts. The extension's
// content script relays these, so the page needs no extension ID (and Firefox,
// which has no externally_connectable, works too).
const BRIDGE_PAGE_SOURCE = 'proxyhubb-page';
const BRIDGE_EXT_SOURCE = 'proxyhubb-ext';
const BRIDGE_MARKER_ATTRIBUTE = 'data-proxyhubb-extension';

/** Connect opens an IP check tab and waits for it, so it can take a while. */
const CONNECT_TIMEOUT_MS = 60_000;
const QUICK_TIMEOUT_MS = 8_000;
/** How long to wait for the content script to announce itself. */
const BRIDGE_READY_WAIT_MS = 1_500;

type ChromeRuntime = {
    lastError?: { message: string };
    sendMessage: (extensionId: string, message: unknown, responseCallback?: (response: unknown) => void) => void;
};

type ExtensionWindow = Window & {
    __PROXYHUB_EXTENSION_ID__?: string;
    chrome?: { runtime?: ChromeRuntime };
};

function extensionWindow(): ExtensionWindow | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    return window as ExtensionWindow;
}

function chromeRuntime(): ChromeRuntime | undefined {
    return extensionWindow()?.chrome?.runtime;
}

export function normalizeChromeExtensionId(raw: string): string {
    return raw.trim().toLowerCase();
}

export function isChromeExtensionId(raw: string): boolean {
    return CHROME_EXTENSION_ID.test(normalizeChromeExtensionId(raw));
}

function readStoredUnpackedExtensionId(): string {
    try {
        const stored = extensionWindow()?.localStorage.getItem(UNPACKED_EXTENSION_ID_STORAGE_KEY) || '';
        const id = normalizeChromeExtensionId(stored);
        return isChromeExtensionId(id) ? id : '';
    } catch {
        return '';
    }
}

export function setStoredUnpackedExtensionId(raw: string): string {
    const id = normalizeChromeExtensionId(raw);
    if (!isChromeExtensionId(id)) {
        throw new Error('Extension ID must be 32 characters (a–p) from chrome://extensions.');
    }
    extensionWindow()?.localStorage.setItem(UNPACKED_EXTENSION_ID_STORAGE_KEY, id);
    return id;
}

export function clearStoredUnpackedExtensionId(): void {
    try {
        extensionWindow()?.localStorage.removeItem(UNPACKED_EXTENSION_ID_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

export function getConfiguredExtensionId(): string {
    const injected = extensionWindow()?.__PROXYHUB_EXTENSION_ID__?.trim();
    if (injected) {
        return injected;
    }
    const fromEnv = (process.env.NEXT_PUBLIC_EXTENSION_ID || '').trim();
    if (fromEnv) {
        return fromEnv;
    }
    return readStoredUnpackedExtensionId();
}

/** Shows the manual "unpacked extension ID" field (developers only). */
export function extensionDevToolsEnabled(): boolean {
    return process.env.NEXT_PUBLIC_EXTENSION_DEV === '1';
}

export function detectBrowser(): BrowserFamily {
    if (typeof navigator === 'undefined') {
        return 'other';
    }
    const ua = navigator.userAgent;
    if (/Firefox\/|FxiOS\//.test(ua)) {
        return 'firefox';
    }
    // Chrome, Edge, Brave, Opera and other Chromium browsers all take Chrome extensions.
    if (/Chrome\/|Chromium\/|CriOS\//.test(ua)) {
        return /Android|CriOS/.test(ua) ? 'other' : 'chrome';
    }
    if (/Safari\//.test(ua)) {
        return 'safari';
    }
    return 'other';
}

export function getExtensionChromeWebStoreUrl(): string {
    return (process.env.NEXT_PUBLIC_EXTENSION_CWS_URL || '').trim();
}

export function getExtensionFirefoxAddonsUrl(): string {
    return (process.env.NEXT_PUBLIC_EXTENSION_AMO_URL || '').trim();
}

export const CHROME_EXTENSION_RELEASE_URL =
    'https://github.com/samuel-1-avson/ProxySocialHub/releases/tag/extension-v0.7.0';
export const CHROME_EXTENSION_DOWNLOAD_URL =
    'https://github.com/samuel-1-avson/ProxySocialHub/releases/download/extension-v0.7.0/proxyhubb-extension-chrome-0.7.0.zip';

/**
 * Prefer an approved store listing, then a local test build when enabled.
 * Chrome can otherwise install the published GitHub preview.
 */
export function getExtensionInstallUrl(browser: BrowserFamily): string {
    const testBuilds = process.env.NEXT_PUBLIC_EXTENSION_TEST_DOWNLOAD === '1';
    if (browser === 'chrome') {
        return getExtensionChromeWebStoreUrl()
            || (testBuilds ? '/proxyhubb-extension-chrome.zip' : CHROME_EXTENSION_DOWNLOAD_URL);
    }
    if (browser === 'firefox') {
        return getExtensionFirefoxAddonsUrl() || (testBuilds ? '/proxyhubb-extension-firefox.zip' : '');
    }
    return '';
}

function bridgePresent(): boolean {
    return typeof document !== 'undefined' && document.documentElement.hasAttribute(BRIDGE_MARKER_ATTRIBUTE);
}

let bridgeReady: Promise<boolean> | null = null;

/**
 * Resolves true when the extension's content script is on this page: either
 * its <html> marker is there, or it answers a ping (the marker can be missing
 * if the page re-rendered <html>).
 */
function waitForBridge(): Promise<boolean> {
    if (bridgePresent()) {
        return Promise.resolve(true);
    }
    if (typeof window === 'undefined') {
        return Promise.resolve(false);
    }
    if (!bridgeReady) {
        bridgeReady = sendViaBridge<{ ok?: boolean }>({ type: 'ping' }, BRIDGE_READY_WAIT_MS, null).then((res) => {
            const found = res !== null || bridgePresent();
            if (!found) {
                bridgeReady = null; // check again next time (extension may be installed later)
            }
            return found;
        });
    }
    return bridgeReady;
}

let requestSeq = 0;

const NO_ANSWER = { ok: false, error: 'The extension did not answer. Reload the page and try again.' };

function sendViaBridge<T>(message: unknown, timeoutMs: number, onTimeout: unknown = NO_ANSWER): Promise<T | null> {
    return new Promise((resolve) => {
        const id = `${Date.now().toString(36)}-${++requestSeq}`;
        const onMessage = (event: MessageEvent) => {
            if (event.source !== window || event.origin !== window.location.origin) {
                return;
            }
            const data = event.data as { source?: string; id?: string; response?: unknown } | null;
            if (data?.source === BRIDGE_EXT_SOURCE && data.id === id) {
                finish((data.response as T | undefined) ?? null);
            }
        };
        const timer = window.setTimeout(() => finish(onTimeout as T | null), timeoutMs);
        const finish = (value: T | null) => {
            window.clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            resolve(value);
        };
        window.addEventListener('message', onMessage);
        window.postMessage({ source: BRIDGE_PAGE_SOURCE, id, message }, window.location.origin);
    });
}

function sendViaExtensionId<T>(message: unknown): Promise<T | null> {
    const runtime = chromeRuntime();
    const extensionId = getConfiguredExtensionId();
    if (!runtime || !extensionId) {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        try {
            runtime.sendMessage(extensionId, message, (response: unknown) => {
                if (runtime.lastError) {
                    resolve({ ok: false, error: runtime.lastError.message } as T);
                    return;
                }
                resolve((response as T | undefined) ?? null);
            });
        } catch {
            resolve(null);
        }
    });
}

/** Content-script bridge first; Chrome's ID-based messaging for older extension builds. */
async function sendExtensionMessage<T extends { ok?: boolean; error?: string }>(
    message: unknown,
    timeoutMs = QUICK_TIMEOUT_MS,
): Promise<T | null> {
    if (await waitForBridge()) {
        return sendViaBridge<T>(message, timeoutMs);
    }
    return sendViaExtensionId<T>(message);
}

export function pingProxyHubbExtension(): Promise<ExtensionPingResponse | null> {
    return sendExtensionMessage<ExtensionPingResponse>({ type: 'ping' }).then((res) => {
        if (!res) {
            return null;
        }
        if (res.ok && res.installed) {
            return res;
        }
        return null;
    });
}

export function sendExtensionPairCode(code: string): Promise<ExtensionPairMessageResponse | null> {
    return sendExtensionMessage<ExtensionPairMessageResponse>({ type: 'pair', code });
}

export function sendExtensionConnect(orderId: string, listingTitle = ''): Promise<ExtensionConnectMessageResponse | null> {
    return sendExtensionMessage<ExtensionConnectMessageResponse>(
        { type: 'connect', orderId, listingTitle },
        CONNECT_TIMEOUT_MS,
    );
}

export function sendExtensionDisconnect(): Promise<ExtensionDisconnectResponse | null> {
    return sendExtensionMessage<ExtensionDisconnectResponse>({ type: 'disconnect' }, CONNECT_TIMEOUT_MS);
}
