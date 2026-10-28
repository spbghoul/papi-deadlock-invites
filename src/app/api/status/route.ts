import { NextResponse, type NextRequest } from 'next/server';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { clientIp, limiter } from '@/lib/rateLimit';
import { findRequestBySteamId } from '@/lib/repo';
import { publicStatus } from '@/lib/statuses';
import { parseSteamInput } from '@/lib/steamid';
import { resolveVanity } from '@/lib/steamProfile';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers, getConfig().TRUST_PROXY);
  const rl = limiter('status', 20, 60_000).check(ip);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many lookups. Try again in a minute.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const parsed = parseSteamInput(req.nextUrl.searchParams.get('q') ?? '');
  if (parsed.kind === 'invalid') return NextResponse.json({ error: parsed.reason }, { status: 400 });

  let steamId: string;
  if (parsed.kind === 'vanity') {
    // Vanity lookups hit steamcommunity.com from the same IP the bot uses; cap them globally so
    // nobody can get the server rate-limited by Steam through this endpoint.
    if (!limiter('vanity-global', 60, 60_000).check('all').ok) {
      return NextResponse.json({ error: 'Lookups by custom URL are busy right now. Use your SteamID64 or try again in a minute.' }, { status: 429 });
    }
    const resolved = await resolveVanity(parsed.vanity);
    if (!resolved) return NextResponse.json({ error: 'Could not find that Steam profile. Try your SteamID64 instead.' }, { status: 404 });
    steamId = resolved;
  } else {
    steamId = parsed.steamId;
  }

  try {
    const db = await getDb();
    const request = await findRequestBySteamId(db, steamId);
    // Blocked IDs without a request look exactly like "no comment yet": block lists are not revealed.
    const pub = publicStatus(request?.status ?? null);
    return NextResponse.json({
      steamId,
      code: request?.status ?? null,
      state: pub.state,
      detail: pub.detail,
      updatedAt: request?.updated_at ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Status lookup is temporarily unavailable' }, { status: 503 });
  }
}
