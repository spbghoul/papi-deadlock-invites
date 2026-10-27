import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getStatsPayload } from '@/lib/publicData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await getStatsPayload(await getDb());
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'public, max-age=10' } });
  } catch {
    return NextResponse.json({ error: 'Statistics are temporarily unavailable' }, { status: 503 });
  }
}
