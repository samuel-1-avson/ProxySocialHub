import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({
    service: 'proxyhubb-explorer',
    scope: 'frontend',
    revision: process.env.EXPLORER_BUILD_REVISION || 'unknown',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
