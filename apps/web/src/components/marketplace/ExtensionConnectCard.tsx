'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startExtensionPair } from '@/lib/api/extension';
import {
    clearStoredUnpackedExtensionId,
    detectBrowser,
    extensionDevToolsEnabled,
    getConfiguredExtensionId,
    getExtensionInstallUrl,
    pingProxyHubbExtension,
    sendExtensionConnect,
    sendExtensionDisconnect,
    sendExtensionPairCode,
    setStoredUnpackedExtensionId,
    type BrowserFamily,
    type ExtensionPingResponse,
} from '@/lib/extension';

type ExtensionConnectCardProps = {
    orderId: string;
    listingTitle?: string;
    compact?: boolean;
};

const BROWSER_LABEL: Record<BrowserFamily, string> = {
    chrome: 'Chrome',
    firefox: 'Firefox',
    safari: 'Safari',
    other: 'this browser',
};

/** Worker errors are terse; say what to do instead. */
function friendlyError(raw: string | undefined): string {
    if (!raw) {
        return 'Could not turn on the proxy. Try again in a moment.';
    }
    if (/no egress IP|verify failed/i.test(raw)) {
        return "The proxy didn't answer. Check that this order is still active, then try again.";
    }
    if (/another extension/i.test(raw)) {
        return 'Another extension is controlling this browser’s proxy. Turn that one off, then try again.';
    }
    if (/pairing code|pair this browser/i.test(raw)) {
        return 'This browser needs to be connected to your account first. Try again.';
    }
    return raw;
}

export function ExtensionConnectCard({ orderId, listingTitle = '', compact = false }: ExtensionConnectCardProps) {
    const [browser, setBrowser] = useState<BrowserFamily>('other');
    const [ping, setPing] = useState<ExtensionPingResponse | null>(null);
    const [checked, setChecked] = useState(false);
    const [code, setCode] = useState<string | null>(null);
    const [expiresIn, setExpiresIn] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [connectedIp, setConnectedIp] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const [unpackedIdDraft, setUnpackedIdDraft] = useState('');
    const devTools = extensionDevToolsEnabled();
    const installed = Boolean(ping?.ok && ping.installed);
    const isOn = connected || (ping?.connectionState === 'on' && ping.orderId === orderId);
    const installUrl = getExtensionInstallUrl(browser);
    const testBuild = installUrl.endsWith('.zip');

    const applyPing = useCallback(
        (res: ExtensionPingResponse | null) => {
            setPing(res);
            setChecked(true);
            if (res?.connectionState === 'on' && res.orderId === orderId) {
                setConnected(true);
                setConnectedIp(res.ip ?? null);
            }
        },
        [orderId],
    );

    const check = async () => {
        const res = await pingProxyHubbExtension();
        applyPing(res);
        return res;
    };

    useEffect(() => {
        let cancelled = false;
        void pingProxyHubbExtension().then((res) => {
            if (cancelled) {
                return;
            }
            // Browser detection reads navigator, so it runs after hydration.
            setBrowser(detectBrowser());
            setUnpackedIdDraft(getConfiguredExtensionId());
            applyPing(res);
        });
        return () => {
            cancelled = true;
        };
    }, [applyPing]);

    const pair = async () => {
        const started = await startExtensionPair();
        setCode(started.code);
        setExpiresIn(started.expires_in);
        const paired = await sendExtensionPairCode(started.code);
        if (!paired?.ok) {
            return false;
        }
        setCode(null);
        setPing((prev) => (prev ? { ...prev, signedIn: true } : { ok: true, installed: true, signedIn: true }));
        return true;
    };

    const turnOn = async () => {
        setBusy(true);
        setMessage(null);
        try {
            if (!ping?.signedIn && !(await pair())) {
                setMessage('Open the ProxyHubb extension from your toolbar and paste the code below.');
                return;
            }
            let result = await sendExtensionConnect(orderId, listingTitle);
            if (result?.error === 'pair this browser first' && (await pair())) {
                result = await sendExtensionConnect(orderId, listingTitle);
            }
            if (result?.ok) {
                setConnected(true);
                setConnectedIp(result.status?.verify?.ip ?? null);
                return;
            }
            setMessage(friendlyError(result?.error));
        } catch (err) {
            setMessage(friendlyError(err instanceof Error ? err.message : undefined));
        } finally {
            setBusy(false);
        }
    };

    const turnOff = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const result = await sendExtensionDisconnect();
            if (result?.ok) {
                setConnected(false);
                setConnectedIp(null);
                setPing((prev) => (prev ? { ...prev, connectionState: 'off' } : prev));
                return;
            }
            setMessage(result?.error || 'Could not turn off the proxy. Use the ProxyHubb extension in your toolbar.');
        } finally {
            setBusy(false);
        }
    };

    const recheck = async () => {
        setBusy(true);
        const res = await check();
        setBusy(false);
        setMessage(res ? null : 'Still not found. Reload this page after installing the extension.');
    };

    const saveUnpackedId = () => {
        try {
            setStoredUnpackedExtensionId(unpackedIdDraft);
            setChecked(false);
            void check();
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not save extension ID');
        }
    };

    const canUseExtension = browser === 'chrome' || browser === 'firefox';
    const browserLabel = BROWSER_LABEL[browser];

    let hint: string;
    if (!checked) {
        hint = 'Checking this browser…';
    } else if (isOn) {
        hint = connectedIp ? `Your IP now: ${connectedIp}` : 'Sites you open in this browser now use this proxy.';
    } else if (installed) {
        hint = 'One click and every site you open in this browser uses this proxy.';
    } else if (!canUseExtension) {
        hint = `${browserLabel} can't use the ProxyHubb extension. Use the details below in your proxy settings instead.`;
    } else if (installUrl) {
        hint = `Add the free ProxyHubb extension to ${browserLabel} once. After that it's one click.`;
    } else {
        hint = `The ProxyHubb extension for ${browserLabel} is coming soon. For now, use the details below in your proxy settings.`;
    }

    return (
        <div
            className={
                compact
                    ? 'space-y-3 rounded-[var(--radius-md)] border border-border bg-secondary p-4'
                    : 'space-y-3 rounded-lg border border-border bg-secondary p-4'
            }
            data-testid="extension-connect-card"
        >
            <div className="flex items-center gap-2">
                {isOn ? (
                    <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                ) : (
                    <Puzzle className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
                <p className="text-sm font-semibold text-foreground">
                    {isOn ? 'Proxy is on in this browser' : 'Use it in this browser'}
                </p>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="extension-install-hint">
                {hint}
            </p>

            {checked && isOn ? (
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => void turnOff()}
                    isLoading={busy}
                    data-testid="extension-disconnect-button"
                >
                    Turn off
                </Button>
            ) : null}

            {checked && !isOn && installed ? (
                <Button
                    className="w-full"
                    onClick={() => void turnOn()}
                    isLoading={busy}
                    data-testid="extension-connect-button"
                >
                    {busy ? 'Turning on…' : 'Turn on proxy'}
                </Button>
            ) : null}

            {checked && !installed && canUseExtension && installUrl ? (
                <div className="space-y-2">
                    <a
                        href={installUrl}
                        target={testBuild ? undefined : '_blank'}
                        rel="noreferrer"
                        download={testBuild || undefined}
                        className="inline-flex w-full items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                        data-testid="extension-install-link"
                    >
                        Add to {browserLabel}
                    </a>
                    {testBuild ? (
                        <p className="text-xs text-muted-foreground">
                            Test build: unzip it, then{' '}
                            {browser === 'firefox'
                                ? 'open about:debugging, choose This Firefox, Load Temporary Add-on, and pick manifest.json.'
                                : 'open chrome://extensions, turn on Developer mode, choose Load unpacked, and pick the folder.'}
                        </p>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => void recheck()}
                        disabled={busy}
                        className="w-full text-xs font-medium text-primary disabled:opacity-50"
                    >
                        I&apos;ve added it
                    </button>
                </div>
            ) : null}

            {code ? (
                <p className="text-sm text-foreground" data-testid="extension-pair-code">
                    Code: <span className="font-mono">{code}</span>
                    {expiresIn ? <span className="ml-2 text-xs text-muted-foreground">valid {expiresIn}s</span> : null}
                </p>
            ) : null}
            {message ? (
                <p className="text-xs text-muted-foreground" data-testid="extension-connect-status">
                    {message}
                </p>
            ) : null}

            {devTools ? (
                <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Developer: unpacked extension ID</summary>
                    <div className="mt-2 flex gap-2">
                        <input
                            value={unpackedIdDraft}
                            onChange={(e) => setUnpackedIdDraft(e.target.value)}
                            placeholder="32 characters from chrome://extensions"
                            spellCheck={false}
                            autoComplete="off"
                            data-testid="extension-unpacked-id"
                            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                        />
                        <button type="button" onClick={saveUnpackedId} className="font-medium text-primary">
                            Use
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                clearStoredUnpackedExtensionId();
                                setUnpackedIdDraft('');
                            }}
                        >
                            Clear
                        </button>
                    </div>
                </details>
            ) : null}
        </div>
    );
}
