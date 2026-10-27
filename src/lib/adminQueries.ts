import type { Kysely } from 'kysely';
import type { DB } from './db/schema';
import { countEventsSince, getRuntimeSettings, getWorkerStatus, isBotOnline } from './repo';
import { REQUEST_STATUSES, type RequestStatus } from './statuses';

export const PAGE_SIZE = 50;

export async function listRequests(db: Kysely<DB>, opts: { status?: RequestStatus; q?: string; page: number }) {
  let query = db.selectFrom('invite_requests').leftJoin('users', 'users.steam_id', 'invite_requests.steam_id');
  if (opts.status) query = query.where('invite_requests.status', '=', opts.status);
  if (opts.q) query = query.where((eb) => eb.or([eb('invite_requests.steam_id', 'like', `%${opts.q}%`), eb('users.persona_name', 'like', `%${opts.q}%`)]));
  const [rows, total] = await Promise.all([
    query
      .select([
        'invite_requests.id',
        'invite_requests.steam_id',
        'invite_requests.status',
        'invite_requests.attempts',
        'invite_requests.last_error',
        'invite_requests.provider',
        'invite_requests.next_attempt_at',
        'invite_requests.invite_sent_at',
        'invite_requests.created_at',
        'invite_requests.updated_at',
        'users.persona_name',
        'users.profile_url',
      ])
      .orderBy('invite_requests.updated_at', 'desc')
      .limit(PAGE_SIZE)
      .offset((opts.page - 1) * PAGE_SIZE)
      .execute(),
    query.select((eb) => eb.fn.countAll<string | number>().as('n')).executeTakeFirstOrThrow(),
  ]);
  return { rows, total: Number(total.n) };
}

export async function statusCounts(db: Kysely<DB>): Promise<Record<RequestStatus, number>> {
  const rows = await db
    .selectFrom('invite_requests')
    .select(['status', (eb) => eb.fn.countAll<string | number>().as('n')])
    .groupBy('status')
    .execute();
  const out = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>;
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

export async function recentEvents(db: Kysely<DB>, opts: { errorsOnly: boolean; limit: number }) {
  let q = db.selectFrom('bot_events').selectAll().orderBy('id', 'desc').limit(opts.limit);
  if (opts.errorsOnly) {
    q = q.where('event_type', 'in', ['invite_failed', 'invite_rejected', 'invite_uncertain', 'invite_retry', 'invite_deferred', 'friend_action_error', 'comment_poll_error', 'bot_offline']);
  }
  return q.execute();
}

export async function blockedList(db: Kysely<DB>) {
  return db.selectFrom('blocked_steam_ids').selectAll().orderBy('created_at', 'desc').limit(500).execute();
}

export async function performance(db: Kysely<DB>, now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const hourAgo = new Date(now.getTime() - 3600_000);
  const [sent24h, sentHour, attempts24h, errors24h, comments24h, recentSent] = await Promise.all([
    countEventsSince(db, ['invite_sent'], dayAgo),
    countEventsSince(db, ['invite_sent'], hourAgo),
    countEventsSince(db, ['invite_attempt'], dayAgo),
    countEventsSince(db, ['invite_failed', 'invite_rejected', 'invite_uncertain', 'friend_action_error', 'comment_poll_error'], dayAgo),
    countEventsSince(db, ['comment_verified'], dayAgo),
    db.selectFrom('invite_requests').select(['created_at', 'invite_sent_at']).where('invite_sent_at', 'is not', null).orderBy('invite_sent_at', 'desc').limit(200).execute(),
  ]);
  const durations = recentSent.map((r) => new Date(r.invite_sent_at!).getTime() - new Date(r.created_at).getTime()).filter((d) => d >= 0);
  const avgMinutes = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60_000) : null;
  return { sent24h, sentHour, attempts24h, errors24h, comments24h, avgMinutesToInvite: avgMinutes };
}

export async function dashboardOverview(db: Kysely<DB>, defaultRemovalDelay: number) {
  const [worker, settings, counts, perf] = await Promise.all([
    getWorkerStatus(db),
    getRuntimeSettings(db, defaultRemovalDelay),
    statusCounts(db),
    performance(db),
  ]);
  return { worker, online: isBotOnline(worker), settings, counts, perf };
}
