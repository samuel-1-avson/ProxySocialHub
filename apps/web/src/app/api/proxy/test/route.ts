import { NextResponse } from 'next/server';

// Test proxy connectivity
export async function GET() {
    try {
        // For now, just return success - in production this would actually test the proxy
        const proxyEndpoint = process.env.NEXT_PUBLIC_PROXY_ENDPOINT || 'localhost:3128';

        // Check if edge-gateway is reachable (via control-api health check)
        const controlApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

        const response = await fetch(`${controlApiUrl}/health`, {
            method: 'GET',
            cache: 'no-cache',
        });

        if (response.ok) {
            return NextResponse.json({
                status: 'online',
                endpoint: proxyEndpoint,
                message: 'Proxy gateway is operational'
            });
        } else {
            return NextResponse.json({
                status: 'offline',
                endpoint: proxyEndpoint,
                message: 'Control API unreachable'
            }, { status: 503 });
        }
    } catch (error) {
        return NextResponse.json({
            status: 'offline',
            message: 'Failed to connect to proxy infrastructure',
            error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 503 });
    }
}
