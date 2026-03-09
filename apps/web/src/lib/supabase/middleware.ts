
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
    // Check if Supabase is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    // If Supabase is not configured, skip session handling
    // The app will rely on client-side JWT/wallet authentication
    if (!supabaseUrl || !supabaseKey || supabaseUrl === 'http://localhost:54321') {
        // Allow all requests - client-side auth will handle redirects
        return NextResponse.next({ request })
    }

    let supabaseResponse = NextResponse.next({
        request,
    })

    try {
        const supabase = createServerClient(
            supabaseUrl,
            supabaseKey,
            {
                cookies: {
                    getAll() {
                        return request.cookies.getAll()
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            request.cookies.set(name, value)
                        )
                        supabaseResponse = NextResponse.next({
                            request,
                        })
                        cookiesToSet.forEach(({ name, value, options }) =>
                            supabaseResponse.cookies.set(name, value, options)
                        )
                    },
                },
            }
        )

        const {
            data: { user },
        } = await supabase.auth.getUser()

        // If user is signed in and the current path is / or /login or /register, redirect the user to /dashboard
        if (user && (request.nextUrl.pathname === '/' || request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/register'))) {
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
        }

        // For dashboard routes, let client-side auth handle the check
        if (
            !user &&
            request.nextUrl.pathname !== '/' &&
            !request.nextUrl.pathname.startsWith('/login') &&
            !request.nextUrl.pathname.startsWith('/register') &&
            !request.nextUrl.pathname.startsWith('/auth') &&
            !request.nextUrl.pathname.startsWith('/dashboard') &&
            !request.nextUrl.pathname.startsWith('/marketplace') &&
            !request.nextUrl.pathname.startsWith('/feed')
        ) {
            const url = request.nextUrl.clone()
            url.pathname = '/login'
            return NextResponse.redirect(url)
        }

        return supabaseResponse
    } catch (error) {
        // If Supabase client fails, just continue without session handling
        console.warn('Supabase session check failed:', error)
        return NextResponse.next({ request })
    }
}
