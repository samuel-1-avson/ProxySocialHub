import client from './client';

// Session types
export interface Session {
    id: string;
    user_id: string;
    type: 'rotating' | 'sticky';
    status: 'active' | 'terminated';
    bandwidth_used: number;
    created_at: string;
    expires_at: string;
}

export interface ProxyCredentials {
    username: string;
    password: string;
    endpoint: string;
}

export interface CreateSessionResponse {
    session: Session;
    proxy_credentials: ProxyCredentials;
}

// Create a new proxy session
export async function createSession(type: 'rotating' | 'sticky'): Promise<CreateSessionResponse> {
    const response = await client.post('/sessions', { type });
    return response.data;
}

// Get all sessions
export async function getSessions(): Promise<Session[]> {
    const response = await client.get('/sessions');
    return response.data.sessions || [];
}

// Terminate a session
export async function terminateSession(sessionId: string): Promise<void> {
    await client.delete(`/sessions/${sessionId}`);
}

// Get session details
export async function getSession(sessionId: string): Promise<Session> {
    const response = await client.get(`/sessions/${sessionId}`);
    return response.data;
}

// Test proxy connectivity
export async function testProxyConnection(): Promise<{ status: string; latency?: number }> {
    try {
        const start = Date.now();
        const response = await client.get('/health');
        const latency = Date.now() - start;
        return { status: 'online', latency };
    } catch {
        return { status: 'offline' };
    }
}
