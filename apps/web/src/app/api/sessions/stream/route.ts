import { NextRequest } from 'next/server';

// Proxy the SSE session stream from the backend.
// Next.js rewrites buffer responses and break SSE — this API route streams
// the response incrementally using ReadableStream so the browser receives
// events in real-time without buffering.
export async function GET(req: NextRequest) {
    const token = req.nextUrl.searchParams.get('token') ?? '';
    const backendUrl = process.env.API_URL || 'http://localhost:8080';
    const upstream = `${backendUrl}/v1/sessions/stream?token=${encodeURIComponent(token)}`;

    const backendRes = await fetch(upstream, {
        headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
        // @ts-expect-error — Node.js fetch supports duplex
        duplex: 'half',
    });

    if (!backendRes.ok || !backendRes.body) {
        return new Response('SSE upstream error', { status: 502 });
    }

    return new Response(backendRes.body, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            Connection: 'keep-alive',
        },
    });
}

export const dynamic = 'force-dynamic';
