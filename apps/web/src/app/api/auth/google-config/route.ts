// The OAuth client ID is public. Keep all other OAuth settings server-side.
export const dynamic = 'force-dynamic';

export async function GET() {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
  return Response.json({ clientId }, { headers: { 'Cache-Control': 'no-store' } });
}
