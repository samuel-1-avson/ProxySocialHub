import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

/** Safely extract a string message from any caught value. */
export function getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'An unexpected error occurred';
}

/** Allow http(s) URLs only. Bare hosts are treated as https. */
export function safeHttpUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

export function socialProfileUrl(platform: string, handle: unknown): string | null {
    if (typeof handle !== 'string' || !handle.trim()) return null;
    const trimmed = handle.trim();
    const direct = safeHttpUrl(trimmed);
    if (direct) return direct;
    const slug = trimmed.replace(/^@/, '');
    if (!/^[a-zA-Z0-9._-]+$/.test(slug)) return null;
    if (platform === 'twitter' || platform === 'x') return `https://x.com/${slug}`;
    if (platform === 'github') return `https://github.com/${slug}`;
    if (platform === 'linkedin') return `https://www.linkedin.com/in/${slug}`;
    return null;
}
