'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** True when a Google OAuth client ID is configured for this build. */
export const googleSignInEnabled = GOOGLE_CLIENT_ID !== '';

type GsiCredentialResponse = { credential?: string };

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (opts: Record<string, unknown>) => void;
                    renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
                };
            };
        };
    }
}

let gsiLoader: Promise<void> | null = null;

function loadGoogleIdentityServices(): Promise<void> {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (!gsiLoader) {
        gsiLoader = new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = GSI_SRC;
            script.async = true;
            script.defer = true;
            script.onload = () => resolve();
            script.onerror = () => {
                gsiLoader = null;
                reject(new Error('Google sign-in script failed to load'));
            };
            document.head.appendChild(script);
        });
    }
    return gsiLoader;
}

/** Same-site path from ?next=, else /dashboard (never an external URL). */
function nextPath(): string {
    const next = new URLSearchParams(window.location.search).get('next') ?? '';
    return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

/**
 * Google's official "Continue with Google" button (Google Identity Services).
 * First sign-in creates the account and a ProxyHubb-managed Solana wallet.
 * Renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set.
 */
export function GoogleSignInButton({
    text = 'continue_with',
    onCredential,
}: {
    text?: 'signin_with' | 'signup_with' | 'continue_with';
    /**
     * Reconfirm mode: hand the fresh Google ID token to the caller instead of
     * logging in (used to confirm a cash-out). The caller sends it to the server.
     */
    onCredential?: (credential: string) => void | Promise<void>;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { googleLogin } = useAuth();
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [newAccountsAvailable,setNewAccountsAvailable]=useState<boolean|null>(null);
    useEffect(()=>{let cancelled=false;void fetch("/v1/auth/capabilities").then((res)=>res.ok?res.json():null).then((data:{managed_wallet_signup?:boolean}|null)=>{if(!cancelled&&typeof data?.managed_wallet_signup==="boolean")setNewAccountsAvailable(data.managed_wallet_signup);}).catch(()=>{});return()=>{cancelled=true;};},[]);

    const handleCredential = async (credential: string) => {
        if (onCredential) {
            await onCredential(credential);
            return;
        }
        await googleLogin(credential);
        router.push(nextPath());
    };
    // GSI keeps the first callback it is given, so route through a ref to stay current.
    const loginRef = useRef(handleCredential);
    useEffect(() => {
        loginRef.current = handleCredential;
    });

    useEffect(() => {
        if (!googleSignInEnabled) return;
        let cancelled = false;
        loadGoogleIdentityServices()
            .then(() => {
                const el = containerRef.current;
                if (cancelled || !el || !window.google?.accounts?.id) return;
                window.google.accounts.id.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    ux_mode: 'popup',
                    auto_select: false,
                    callback: async (resp: GsiCredentialResponse) => {
                        if (!resp.credential) {
                            setError('Google did not return a sign-in token. Please try again.');
                            return;
                        }
                        setBusy(true);
                        setError(null);
                        try {
                            await loginRef.current(resp.credential);
                        } catch (err) {
                            setError(err instanceof Error ? err.message : 'Google sign-in failed');
                        } finally {
                            setBusy(false);
                        }
                    },
                });
                window.google.accounts.id.renderButton(el, {
                    type: 'standard',
                    theme: 'outline',
                    size: 'large',
                    shape: 'pill',
                    text,
                    logo_alignment: 'left',
                    width: Math.min(Math.max(el.offsetWidth, 200), 400),
                });
            })
            .catch(() => {
                if (!cancelled) setError("Couldn't load Google sign-in. Check your connection and refresh.");
            });
        return () => {
            cancelled = true;
        };
    }, [router, text]);

    if (!googleSignInEnabled) return null;

    return (
        <div className="space-y-2">
            <div className="relative flex min-h-[44px] justify-center">
                <div ref={containerRef} className="w-full flex justify-center" aria-hidden={busy} />
                {busy && (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-full bg-card/90 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {onCredential ? 'Confirming…' : 'Signing you in…'}
                    </div>
                )}
            </div>
            {!onCredential && newAccountsAvailable===false && <p className="text-center text-xs text-muted-foreground">Existing Google accounts can sign in. New account creation is temporarily unavailable.</p>}
            {error && (
                <p role="alert" className="text-center text-xs text-warning">
                    {error}
                </p>
            )}
        </div>
    );
}

/** "or" divider shown between Google and wallet sign-in. */
export function AuthMethodDivider() {
    if (!googleSignInEnabled) return null;
    return (
        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
        </div>
    );
}
