'use client';

import { useEffect, useState } from 'react';
import { startExtensionPair } from '@/lib/api/extension';
import {
    clearStoredUnpackedExtensionId,
    getConfiguredExtensionId,
    getExtensionChromeWebStoreUrl,
    pingProxyHubbExtension,
    sendExtensionConnect,
    sendExtensionPairCode,
    setStoredUnpackedExtensionId,
    type ExtensionPingResponse,
} from '@/lib/extension';

type ExtensionConnectCardProps = {
    orderId: string;
    listingTitle?: string;
    compact?: boolean;
};

export function ExtensionConnectCard({ orderId, listingTitle = '', compact = false }: ExtensionConnectCardProps) {
    const [ping, setPing] = useState<ExtensionPingResponse | null>(null);
    const [checked, setChecked] = useState(false);
    const [code, setCode] = useState<string | null>(null);
    const [expiresIn, setExpiresIn] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const [unpackedIdDraft, setUnpackedIdDraft] = useState('');
    const [extensionId, setExtensionId] = useState('');
    const cwsUrl = getExtensionChromeWebStoreUrl();
    const installed = Boolean(ping?.ok && ping.installed);

    useEffect(() => {
        setExtensionId(getConfiguredExtensionId());
        setUnpackedIdDraft(getConfiguredExtensionId());
    }, []);

    useEffect(() => {
        let cancelled = false;
        void pingProxyHubbExtension().then((res) => {
            if (cancelled) {
                return;
            }
            setPing(res);
            setChecked(true);
            if (res?.connectionState === 'on' && res.orderId === orderId) {
                setConnected(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [orderId, extensionId]);

    const saveUnpackedId = () => {
        try {
            const id = setStoredUnpackedExtensionId(unpackedIdDraft);
            setExtensionId(id);
            setChecked(false);
            setPing(null);
            setMessage('Saved local extension ID. Checking…');
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not save extension ID');
        }
    };

    const connect = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const signedIn = Boolean(ping?.signedIn);
            const pairIfNeeded = async () => {
                const started = await startExtensionPair();
                setCode(started.code);
                setExpiresIn(started.expires_in);
                const paired = await sendExtensionPairCode(started.code);
                if (!paired?.ok) {
                    return false;
                }
                setPing((prev) =>
                    prev ? { ...prev, signedIn: true, installed: true } : { ok: true, installed: true, signedIn: true },
                );
                return true;
            };
            if (!signedIn) {
                const paired = await pairIfNeeded();
                if (!paired) {
                    setMessage(
                        installed
                            ? 'Code ready. Paste it in the ProxyHubb popup if this page cannot reach the extension, then click Connect again.'
                            : 'Code ready. Load the unpacked extension, paste this code in the popup, then Turn on.',
                    );
                    return;
                }
            }
            let result = await sendExtensionConnect(orderId, listingTitle);
            if (result?.error === 'pair this browser first') {
                const paired = await pairIfNeeded();
                if (paired) {
                    result = await sendExtensionConnect(orderId, listingTitle);
                }
            }
            if (result?.ok) {
                setConnected(true);
                setMessage('Connected. HTTP CONNECT is on for this order. Open the ProxyHubb popup to Turn off or check IP.');
                return;
            }
            setMessage(
                result?.error ||
                    'Could not Turn on from this page. Open the ProxyHubb popup, select this order, and Turn on.',
            );
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not start Connect');
        } finally {
            setBusy(false);
        }
    };

    const alreadyOn = connected || (ping?.connectionState === 'on' && ping.orderId === orderId);

    return (
        <div
            className={compact ? 'space-y-3 rounded-[var(--radius-md)] border border-border bg-secondary p-4' : 'space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4'}
            data-testid="extension-connect-card"
        >
            <p className={compact ? 'text-xs font-medium uppercase tracking-wide text-muted-foreground' : 'text-[9px] font-black uppercase tracking-widest text-white/40'}>
                Browser extension
            </p>
            <p className={compact ? 'text-xs text-muted-foreground' : 'text-[10px] text-white/40'}>
                Connect with ProxyHubb turns on HTTP CONNECT to proxy.proxyhubb.com:8090 with HMAC. Chrome uses local
                DNS; QUIC and WebRTC can bypass the proxy. This replaces any proxy already on in this browser.
            </p>
            <p className={compact ? 'text-xs text-muted-foreground' : 'text-[10px] text-white/50'} data-testid="extension-install-hint">
                {!checked
                    ? extensionId
                        ? 'Checking for the extension…'
                        : 'Load the unpacked extension, or paste a pairing code in the popup.'
                    : installed
                      ? alreadyOn
                          ? 'Extension is on for this order.'
                          : ping?.signedIn
                            ? 'Extension installed and paired.'
                            : 'Extension installed. Connect will authorize this browser.'
                      : cwsUrl
                        ? 'Extension not detected.'
                        : 'Extension not detected. Chrome → chrome://extensions → Load unpacked → apps/extension/dist. Paste the ID below, or paste a pairing code in the popup.'}
            </p>
            {!cwsUrl ? (
                <div className="space-y-2">
                    <label className={compact ? 'block text-xs text-muted-foreground' : 'block text-[10px] text-white/50'}>
                        Local unpacked extension ID
                        <input
                            value={unpackedIdDraft}
                            onChange={(e) => setUnpackedIdDraft(e.target.value)}
                            placeholder="32 characters from chrome://extensions"
                            spellCheck={false}
                            autoComplete="off"
                            data-testid="extension-unpacked-id"
                            className={
                                compact
                                    ? 'mt-1 w-full rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 font-mono text-xs'
                                    : 'mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px]'
                            }
                        />
                    </label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={saveUnpackedId}
                            className={compact ? 'text-xs font-medium text-purple-400' : 'text-[10px] font-bold uppercase tracking-widest text-purple-400'}
                        >
                            Use this ID
                        </button>
                        {extensionId ? (
                            <button
                                type="button"
                                onClick={() => {
                                    clearStoredUnpackedExtensionId();
                                    setExtensionId('');
                                    setUnpackedIdDraft('');
                                    setPing(null);
                                    setChecked(false);
                                }}
                                className={compact ? 'text-xs text-muted-foreground' : 'text-[10px] text-white/40'}
                            >
                                Clear
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
            {cwsUrl && checked && !installed ? (
                <a
                    href={cwsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={compact ? 'text-xs font-medium text-purple-400 hover:text-purple-300' : 'text-[10px] font-bold uppercase tracking-widest text-purple-400 hover:text-purple-300'}
                    data-testid="extension-cws-link"
                >
                    Install from Chrome Web Store
                </a>
            ) : null}
            <button
                type="button"
                onClick={() => void connect()}
                disabled={busy || alreadyOn || !checked}
                className={
                    compact
                        ? 'inline-flex w-full items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50'
                        : 'text-[10px] font-bold uppercase tracking-widest text-purple-400 hover:text-purple-300 disabled:opacity-50'
                }
                data-testid="extension-connect-button"
            >
                {busy ? 'Connecting…' : alreadyOn ? 'Connected in this browser' : 'Connect with ProxyHubb'}
            </button>
            {code ? (
                <p
                    className={compact ? 'break-all font-mono text-sm text-foreground' : 'break-all font-mono text-sm text-white/80'}
                    data-testid="extension-pair-code"
                >
                    {code}
                    {expiresIn ? <span className="ml-2 text-[10px] text-white/40">{expiresIn}s</span> : null}
                </p>
            ) : null}
            {message ? (
                <p className={compact ? 'text-xs text-muted-foreground' : 'text-[10px] text-white/50'} data-testid="extension-connect-status">
                    {message}
                </p>
            ) : null}
        </div>
    );
}
