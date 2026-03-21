
import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
    // With wallet-only auth, JWT tokens are stored in localStorage (client-side).
    // Server-side middleware cannot access localStorage, so route protection
    // is handled client-side by AuthProvider which redirects unauthenticated
    // users to /login when accessing protected routes.
    //
    // This middleware is kept as a pass-through for future server-side checks
    // (e.g., cookie-based tokens, API key validation).
    return NextResponse.next({ request })
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - images/ (public images)
         */
        '/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
