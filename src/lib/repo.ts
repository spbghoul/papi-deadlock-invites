import type { Kysely, Updateable } from 'kysely';
import type { DB, InviteRequest, InviteRequestsTable, WorkerStatus } from './db/schema';
import { ACTIVE_STATUSES, SENT_STATUSES, type RequestStatus } from './statuses';

export type Db = Kysely<DB>;

export const iso = (d: Date) => d.toISOString();

export const SETTING_PAUSED = 'automation_paused';
export const SETTING_REMOVAL_DELAY = 'removal_delay_seconds';

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.selectFrom('settings').select('value').where('key', '=', key).executeTakeFirst();
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string, now = new Date()): Promise<void> {
  await db
    .insertInto('settings')
    .values({ key, value, updated_at: iso(now) })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: iso(now) }))
    .execute();
}

export interface RuntimeSettings {
  paused: boolean;
  removalDelaySeconds: number;
}

export async function getRuntimeSettings(db: Db, defaultRemovalDelaySeconds: number): Promise<RuntimeSettings> {
  const rows = await db.selectFrom('settings').select(['key', 'value']).where('key', 'in', [SETTING_PAUSED, SETTING_REMOVAL_DELAY]).execute();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const delay = Number(map.get(SETTING_REMOVAL_DELAY));
  return {
    paused: map.get(SETTING_PAUSED) === 'true',
    removalDelaySeconds: Number.isInteger(delay) && delay >= 0 ? delay : defaultRemovalDelaySeconds,
  };
}

export async function logEvent(db: Db, eventType: string, steamId: string | null, description: string, now = new Date()): Promise<void> {
  await db.insertInto('bot_events').values({ event_type: eventType, steam_id: steamId, description: description.slice(0, 2000), timestamp: iso(now) }).execute();
}

export async function countEventsSince(db: Db, eventTypes: string[], since: Date): Promise<number> {
  const row = await db
    .selectFrom('bot_events')
    .select((eb) => eb.fn.countAll<string | number>().as('n'))
    .where('event_type', 'in', eventTypes)
    .where('timestamp', '>=', iso(since))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export async function isBlocked(db: Db, steamId: string): Promise<boolean> {
  const row = await db.selectFrom('blocked_steam_ids').select('steam_id').where('steam_id', '=', steamId).executeTakeFirst();
  return !!row;
}

export async function findRequestBySteamId(db: Db, steamId: string): Promise<InviteRequest | undefined> {
  return db.selectFrom('invite_requests').selectAll().where('steam_id', '=', steamId).executeTakeFirst();
}

export async function findRequestById(db: Db, id: number): Promise<InviteRequest | undefined> {
  return db.selectFrom('invite_requests').selectAll().where('id', '=', id).executeTakeFirst();
}

/**
 * Optimistic state transition: only applies when the row is still in one of `from`.
 * Returns false when another process changed the row first (idempotency / concurrency guard).
 */
export async function transition(
  db: Db,
  id: number,
  from: RequestStatus | RequestStatus[],
  patch: Omit<Updateable<InviteRequestsTable>, 'id' | 'updated_at'> & { status: RequestStatus },
  now = new Date(),
): Promise<boolean> {
  const fromList = Array.isArray(from) ? from : [from];
  return db.transaction().execute(async (trx) => {
    const res = await trx
      .updateTable('invite_requests')
      .set({ ...patch, updated_at: iso(now) })
      .where('id', '=', id)
      .where('status', 'in', fromList)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) return false;
    const row = await trx.selectFrom('invite_requests').select('steam_id').where('id', '=', id).executeTakeFirstOrThrow();
    await trx
      .updateTable('users')
      .set({
        status: patch.status,
        ...(patch.status === 'invite_sent' && patch.invite_sent_at ? { invited_at: patch.invite_sent_at } : {}),
      })
      .where('steam_id', '=', row.steam_id)
      .execute();
    return true;
  });
}

async function countByStatus(db: Db, statuses: RequestStatus[]): Promise<number> {
  const row = await db
    .selectFrom('invite_requests')
    .select((eb) => eb.fn.countAll<string | number>().as('n'))
    .where('status', 'in', statuses)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export interface PublicStats {
  invitesSent: number;
  pending: number;
}

export async function getPublicStats(db: Db): Promise<PublicStats> {
  const [invitesSent, pending] = await Promise.all([countByStatus(db, SENT_STATUSES), countByStatus(db, ACTIVE_STATUSES)]);
  return { invitesSent, pending };
}

export const WORKER_ID = 'main';
export const HEARTBEAT_STALE_MS = 90_000;

export async function upsertWorkerStatus(
  db: Db,
  patch: Partial<Omit<WorkerStatus, 'id' | 'updated_at'>>,
  now = new Date(),
): Promise<void> {
  const values = { state: 'starting', logged_in: 0, provider_available: 0, ...patch, id: WORKER_ID, updated_at: iso(now) };
  await db
    .insertInto('worker_status')
    .values(values)
    .onConflict((oc) => oc.column('id').doUpdateSet({ ...patch, updated_at: iso(now) }))
    .execute();
}

export async function getWorkerStatus(db: Db): Promise<WorkerStatus | undefined> {
  return db.selectFrom('worker_status').selectAll().where('id', '=', WORKER_ID).executeTakeFirst();
}

export function isBotOnline(status: WorkerStatus | undefined, now = new Date()): boolean {
  if (!status) return false;
  const fresh = now.getTime() - new Date(status.updated_at).getTime() < HEARTBEAT_STALE_MS;
  return fresh && status.state === 'online' && status.logged_in === 1;
}
