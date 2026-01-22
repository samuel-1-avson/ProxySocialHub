import { supabase } from './supabase';

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
    const { data: { session } } = await supabase.auth.getSession();

    let token = session?.access_token;
    if (!token && typeof window !== 'undefined') {
        token = localStorage.getItem('proxyhubb_token') || undefined;
    }

    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
    };

    const response = await fetch(url, { ...options, headers });
    return response;
}
