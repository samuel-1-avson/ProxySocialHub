
import { type NextRequest, NextResponse } from 'next/server'
import { getRoutePolicyForPathname, isRoleAllowedForPolicy } from '@/lib/navigation/policies'

const STANDALONE_EXPLORER_ORIGIN = 'https://explorer.proxyhubb.com'

const accessTokenCookieName = 'proxyhubb_token'
const refreshTokenCookieName = 'proxyhubb_refresh_token'
const e2eAuthBypassCookieName = 'proxyhubb_e2e_auth'
const issuer = 'proxyhubb-control-api'

export async function middleware(request: NextRequest) {
    const explorerDestination = standaloneExplorerUrl(request.nextUrl.pathname, request.nextUrl.search)
    if (explorerDestination) {
        return NextResponse.redirect(explorerDestination, 307)
    }

    const routePolicy = getRoutePolicyForPathname(request.nextUrl.pathname)
    if (routePolicy === 'public') {
        return NextResponse.next({ request })
    }

    if (isLocalE2EBypassRequest(request)) {
        return NextResponse.next({ request })
    }

    const token = request.cookies.get(accessTokenCookieName)?.value?.trim()
    if (!token) {
        return redirectToLogin(request)
    }

    const jwtSecret = process.env.JWT_SECRET?.trim()
    if (jwtSecret) {
        const payload = await verifyToken(token, jwtSecret)
        if (!payload) {
            return redirectToLogin(request, true)
        }

        if (!isRoleAllowedForPolicy(getRoleFromPayload(payload), routePolicy)) {
            return redirectToUnauthorized(request, routePolicy)
        }

        return NextResponse.next({ request })
    }

    const session = await validateViaBackend(request, token)
    if (!session.isValid) {
        return redirectToLogin(request, true)
    }

    if (!isRoleAllowedForPolicy(session.role, routePolicy)) {
        return redirectToUnauthorized(request, routePolicy)
    }

    return NextResponse.next({ request })
}

function standaloneExplorerUrl(pathname: string, search: string): string | null {
    if (pathname !== '/explorer' && !pathname.startsWith('/explorer/')) return null
    const suffix = pathname.slice('/explorer'.length) || '/'
    const mapped: Record<string, string> = {
        '/': '/',
        '/map': '/nodes?view=map',
        '/leaderboard': '/nodes?view=rankings',
        '/wallets': '/search?type=wallets',
        '/contracts': '/search?type=contracts',
        '/nodes/compare': '/nodes?view=compare',
        '/about': '/about',
        '/about/protocol': '/about',
    }
    const direct = ['/nodes', '/transactions', '/blocks', '/analytics', '/health', '/search']
    let target = mapped[suffix]
    if (!target && direct.includes(suffix)) target = suffix
    if (!target) {
        const detail = suffix.match(/^\/(nodes|transactions|blocks|wallets|contracts)\/([^/]+)$/)
        if (detail) target = `/${detail[1]}/${encodeURIComponent(decodeURIComponent(detail[2]))}`
    }
    const url = new URL(target || '/', STANDALONE_EXPLORER_ORIGIN)
    const incoming = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    incoming.forEach((value, key) => {
        if (!url.searchParams.has(key)) url.searchParams.append(key, value)
    })
    return url.toString()
}

function isLocalE2EBypassRequest(request: NextRequest) {
    if (process.env.NODE_ENV === 'production') {
        return false
    }

    const hostname = request.nextUrl.hostname.trim().toLowerCase()
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return false
    }

    return request.cookies.get(e2eAuthBypassCookieName)?.value === '1'
}

function redirectToLogin(request: NextRequest, clearCookies = false) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)

    const response = NextResponse.redirect(loginUrl)
    if (clearCookies) {
        response.cookies.delete(accessTokenCookieName)
        response.cookies.delete(refreshTokenCookieName)
    }

    return response
}

function redirectToUnauthorized(request: NextRequest, policy: string) {
    const forbiddenUrl = request.nextUrl.clone()
    forbiddenUrl.pathname = '/403'
    forbiddenUrl.search = ''
    forbiddenUrl.searchParams.set('policy', policy)

    return NextResponse.redirect(forbiddenUrl)
}

async function validateViaBackend(request: NextRequest, token: string) {
    try {
        const apiBaseUrl = process.env.API_URL?.trim()
        const authUrl = apiBaseUrl
            ? new URL('/v1/auth/me', apiBaseUrl)
            : new URL('/v1/auth/me', request.url)

        const response = await fetch(authUrl, {
            headers: {
                authorization: `Bearer ${token}`,
                cookie: request.headers.get('cookie') || '',
            },
        })

        if (!response.ok) {
            return { isValid: false }
        }

        const user = await response.json() as { role?: unknown }
        return {
            isValid: true,
            role: typeof user.role === 'string' ? user.role : undefined,
        }
    } catch {
        return { isValid: false }
    }
}

async function verifyToken(token: string, secret: string) {
    const parts = token.split('.')
    if (parts.length !== 3) {
        return null
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts
    const header = parseJwtSegment(encodedHeader)
    const payload = parseJwtSegment(encodedPayload)
    if (!header || !payload || header.alg !== 'HS256') {
        return null
    }

    const expectedSignature = await signHmac(`${encodedHeader}.${encodedPayload}`, secret)
    const actualSignature = decodeBase64Url(encodedSignature)
    if (!timingSafeEqual(expectedSignature, actualSignature)) {
        return null
    }

    if (typeof payload.iss === 'string' && payload.iss !== issuer) {
        return null
    }

    if (typeof payload.exp === 'number' && Date.now() >= payload.exp * 1000) {
        return null
    }

    return payload
}

function getRoleFromPayload(payload: Record<string, unknown>) {
    return typeof payload.role === 'string' ? payload.role : undefined
}

function parseJwtSegment(input: string): Record<string, unknown> | null {
    try {
        return JSON.parse(decodeBase64UrlToString(input)) as Record<string, unknown>
    } catch {
        return null
    }
}

function decodeBase64UrlToString(input: string) {
    return atob(normalizeBase64Url(input))
}

function decodeBase64Url(input: string) {
    const binary = decodeBase64UrlToString(input)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function normalizeBase64Url(input: string) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
}

async function signHmac(data: string, secret: string) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    )

    return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
    if (left.length !== right.length) {
        return false
    }

    let diff = 0
    for (let index = 0; index < left.length; index += 1) {
        diff |= left[index] ^ right[index]
    }

    return diff === 0
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
    ],
}
