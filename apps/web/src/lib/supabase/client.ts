import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    // Return null if Supabase is not configured
    if (!url || !key) {
        console.warn('Supabase not configured - authentication will use backend JWT only')
        return null as any
    }
    
    return createBrowserClient(url, key)
}

// Helper to check if Supabase is available
export function isSupabaseConfigured(): boolean {
    return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}
