import { sql } from 'kysely';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    await sql`select 1`.execute(db);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
