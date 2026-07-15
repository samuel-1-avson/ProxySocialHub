import bs58 from 'bs58';

/**
 * Build provider-node / proxyhubb-cli config for machines outside the repo.
 * Secrets (api_key) are only included when supplied from the current browser session.
 */

const STORAGE_KEY = 'proxyhubb_provider_api_key';
const SIGNING_KEY_STORAGE_KEY = 'proxyhubb_provider_signing_key';

export interface ProviderEndpoints {
    controlApiUrl: string;
    gatewayTunnelAddr: string;
    useTls: boolean;
}

export function getProviderEndpoints(): ProviderEndpoints {
    const controlApiUrl =
        process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:18080';
    const gatewayTunnelAddr =
        process.env.NEXT_PUBLIC_PROVIDER_TUNNEL_ADDR?.replace(/^https?:\/\//, '') ||
        'localhost:3128';
    const useTls =
        gatewayTunnelAddr.includes('proxyhubb.com') ||
        controlApiUrl.startsWith('https://');
    return { controlApiUrl, gatewayTunnelAddr, useTls };
}

export function saveProviderApiKey(token: string) {
    if (typeof window === 'undefined' || !token) return;
    try {
        sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
        /* quota / private mode */
    }
}

export function loadProviderApiKey(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return sessionStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

export function clearProviderApiKey() {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

export function generateProviderSigningKey(): string {
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    return bs58.encode(seed);
}

export function saveProviderSigningKey(key: string) {
    if (typeof window === 'undefined' || !key) return;
    try {
        sessionStorage.setItem(SIGNING_KEY_STORAGE_KEY, key);
    } catch {
        /* quota / private mode */
    }
}

export function loadProviderSigningKey(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return sessionStorage.getItem(SIGNING_KEY_STORAGE_KEY);
    } catch {
        return null;
    }
}

export function getOrCreateProviderSigningKey(): string | null {
    if (typeof window === 'undefined') return null;
    const existing = loadProviderSigningKey();
    if (existing) return existing;
    const generated = generateProviderSigningKey();
    saveProviderSigningKey(generated);
    return generated;
}

export interface BuildProviderTomlInput {
    nodeId: string;
    apiKey?: string | null;
    providerSigningKey?: string | null;
    connectionType?: string;
    endpoints?: ProviderEndpoints;
}

export function buildProviderToml(input: BuildProviderTomlInput): string {
    const endpoints = input.endpoints ?? getProviderEndpoints();
    const lines = [
        `control_api_url = "${endpoints.controlApiUrl}"`,
        `gateway_addr = "${endpoints.gatewayTunnelAddr}"`,
        `node_id = "${input.nodeId}"`,
        `connection_type = "${input.connectionType ?? 'residential'}"`,
        `use_tls = ${endpoints.useTls}`,
        'jwt_token = ""',
    ];
    if (input.apiKey) {
        lines.push(`api_key = "${input.apiKey}"`);
    } else {
        lines.push('# api_key = "<create a token in Dashboard → API Tokens>"');
    }
    if (input.providerSigningKey) {
        lines.push(`provider_signing_key = "${input.providerSigningKey}"`);
    } else {
        lines.push('# provider_signing_key = "<run provider-node keygen>"');
    }
    return `${lines.join('\n')}\n`;
}

export function defaultProviderConfigPath(): string {
    if (typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('win')) {
        return '%USERPROFILE%\\.proxyhubb\\provider.toml';
    }
    return '~/.config/proxyhubb/provider.toml';
}

export function buildStartCommand(configPath = defaultProviderConfigPath()): string {
    const quoted =
        configPath.includes(' ') && !configPath.startsWith('"')
            ? `"${configPath}"`
            : configPath;
    return `provider-node start --config ${quoted}`;
}

export function downloadProviderToml(filename: string, contents: string) {
    const blob = new Blob([contents], { type: 'application/toml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
