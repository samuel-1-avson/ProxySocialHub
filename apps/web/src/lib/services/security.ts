import { API_BASE_URL, fetchWithAuth } from './client';

export interface APIKey {
    id: string;
    name: string;
    prefix: string;
    permissions: string[];
    rate_limit_per_minute: number;
    last_used_at?: string;
    expires_at?: string;
    created_at: string;
}

export interface UserSession {
    id: string;
    ip_address: string;
    user_agent: string;
    device_type: string;
    browser: string;
    os: string;
    is_active: boolean;
    last_active_at: string;
    created_at: string;
}

export interface MFAStatus {
    enabled: boolean;
    verified_at?: string;
}

export interface MFASetup {
    secret: string;
    qr_code_url: string;
    backup_codes: string[];
}

// --- MFA Actions ---
export async function getMFAStatus(): Promise<MFAStatus> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/mfa/status`);
    if (!res.ok) throw new Error('Failed to fetch MFA status');
    return res.json();
}

export async function setupMFA(): Promise<MFASetup> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/mfa/setup`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to setup MFA');
    return res.json();
}

export async function verifyMFA(code: string): Promise<{ backup_codes?: string[] }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Invalid code');
    }
    return res.json();
}

export async function disableMFA(code: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/mfa/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to disable MFA');
    }
}

export async function getBackupCodesCount(): Promise<{ remaining_codes: number }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/2fa/backup-codes`);
    if (!res.ok) throw new Error('Failed to fetch backup codes status');
    return res.json();
}

export async function regenerateBackupCodes(): Promise<{ backup_codes: string[] }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/2fa/backup-codes/regenerate`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to regenerate backup codes');
    return res.json();
}

// --- API Key (Identity Token) Actions ---
export async function listAPIKeys(): Promise<APIKey[]> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/api-keys`);
    if (!res.ok) throw new Error('Failed to list API keys');
    const data = await res.json();
    return data.api_keys || [];
}

export async function createAPIKey(name: string, permissions: string[] = ['read', 'proxy']): Promise<{ api_key: string & APIKey }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, permissions, rate_limit_per_minute: 100 })
    });
    if (!res.ok) throw new Error('Failed to create API key');
    return res.json();
}

export async function revokeAPIKey(id: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/api-keys/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to revoke API key');
}

// --- Session Actions ---
export async function getSessions(): Promise<UserSession[]> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/sessions`);
    if (!res.ok) throw new Error('Failed to fetch sessions');
    const data = await res.json();
    return data.sessions || [];
}

export async function revokeSession(id: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/sessions/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to revoke session');
}

export async function revokeAllSessions(): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/sessions`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to revoke all sessions');
}
