
import { type NextRequest, NextResponse } from 'next/server'

const accessTokenCookieName = 'proxyhubb_token'
const refreshTokenCookieName = 'proxyhubb_refresh_token'
const issuer = 'proxyhubb-control-api'

export async function middleware(request: NextRequest) {
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

        return NextResponse.next({ request })
    }

    const isValid = await validateViaBackend(request, token)
    if (!isValid) {
        return redirectToLogin(request, true)
    }

    return NextResponse.next({ request })
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

async function validateViaBackend(request: NextRequest, token: string) {
    try {
        const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.trim()
        const authUrl = apiBaseUrl
            ? new URL('/v1/auth/me', apiBaseUrl)
            : new URL('/v1/auth/me', request.url)

        const response = await fetch(authUrl, {
            headers: {
                authorization: `Bearer ${token}`,
                cookie: request.headers.get('cookie') || '',
            },
        })

        return response.ok
    } catch {
        return false
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
        '/dashboard/:path*',
        '/settings/:path*',
        '/governance/:path*',
    ],
}
