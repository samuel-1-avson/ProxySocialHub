/** Persist invite codes from ?ref= / ?referral= until wallet signup completes. */

const REFERRAL_STORAGE_KEY = "proxyhubb_referral_code";

function normalizeCode(raw: string): string {
    return raw.trim().toUpperCase();
}

export function captureReferralCodeFromSearch(search?: string): string | null {
    if (typeof window === "undefined") return null;
    const q = search ?? window.location.search;
    const params = new URLSearchParams(q.startsWith("?") ? q : `?${q}`);
    const raw =
        params.get("ref") ||
        params.get("referral") ||
        params.get("referral_code") ||
        "";
    const code = normalizeCode(raw);
    if (!code) return peekReferralCode();
    try {
        sessionStorage.setItem(REFERRAL_STORAGE_KEY, code);
    } catch {
        // ignore quota / private mode
    }
    return code;
}

export function peekReferralCode(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const code = sessionStorage.getItem(REFERRAL_STORAGE_KEY);
        return code ? normalizeCode(code) : null;
    } catch {
        return null;
    }
}

export function clearReferralCode(): void {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
    } catch {
        // ignore
    }
}
