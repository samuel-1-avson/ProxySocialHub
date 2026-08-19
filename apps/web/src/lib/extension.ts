export type ExtensionPingResponse = {
    ok: boolean;
    installed: boolean;
    signedIn?: boolean;
    version?: string;
    proxySet?: boolean;
    connectionState?: string;
    orderId?: string;
};

export type ExtensionPairMessageResponse = {
    ok: boolean;
    email?: string;
    error?: string;
};

export type ExtensionConnectMessageResponse = {
    ok: boolean;
    error?: string;
    status?: { state?: string; orderId?: string };
};

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

export function getConfiguredExtensionId(): string {
    const injected = extensionWindow()?.__PROXYHUB_EXTENSION_ID__?.trim();
    if (injected) {
        return injected;
    }
    return (process.env.NEXT_PUBLIC_EXTENSION_ID || '').trim();
}

export function getExtensionChromeWebStoreUrl(): string {
    return (process.env.NEXT_PUBLIC_EXTENSION_CWS_URL || '').trim();
}

function sendExtensionMessage<T extends { ok?: boolean; error?: string }>(
    message: unknown,
): Promise<T | null> {
    const runtime = chromeRuntime();
    const extensionId = getConfiguredExtensionId();
    if (!runtime || !extensionId) {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        try {
            runtime.sendMessage(extensionId, message, (response: T) => {
                if (runtime.lastError) {
                    resolve({ ok: false, error: runtime.lastError.message } as T);
                    return;
                }
                resolve(response ?? null);
            });
        } catch {
            resolve(null);
        }
    });
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
    return sendExtensionMessage<ExtensionConnectMessageResponse>({
        type: 'connect',
        orderId,
        listingTitle,
    });
}
