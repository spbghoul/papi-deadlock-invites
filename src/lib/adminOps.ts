import type { Updateable } from 'kysely';
import type { InviteRequestsTable } from './db/schema';
import { findRequestById, iso, logEvent, setSetting, SETTING_PAUSED, SETTING_REMOVAL_DELAY, transition, type Db } from './repo';
import { isValidSteamId64 } from './steamid';
import type { RequestStatus } from './statuses';

export type AdminOp = 'retry' | 'approve' | 'reject' | 'mark_sent';

export class AdminOpError extends Error {}

/**
 * Admin state changes. Every operation is a guarded transition, so a stale dashboard
 * can never e.g. resend an invite that the worker already sent.
 */
export async function applyAdminOp(db: Db, id: number, op: AdminOp, now = new Date()): Promise<string> {
  const req = await findRequestById(db, id);
  if (!req) throw new AdminOpError(`Request #${id} not found`);

  let from: RequestStatus[];
  let to: RequestStatus;
  let message: string;
  const patch: Omit<Updateable<InviteRequestsTable>, 'id' | 'updated_at' | 'status'> = {};

  switch (op) {
    case 'retry':
      // needs_review: the admin confirms the previous attempt did NOT result in an invite.
      from = ['failed', 'needs_review', 'expired', 'cancelled', 'rejected'];
      to = req.status === 'expired' || req.status === 'cancelled' ? 'waiting_friendship' : 'invite_pending';
      Object.assign(patch, { next_attempt_at: iso(now), last_error: null, locked_at: null, attempts: 0 });
      message = `Request #${id} re-queued (${req.status} -> ${to}) by admin`;
      break;
    case 'approve':
      from = ['needs_review', 'rejected', 'failed'];
      to = 'invite_pending';
      Object.assign(patch, { next_attempt_at: iso(now), last_error: null, locked_at: null });
      message = `Request #${id} approved by admin`;
      break;
    case 'reject':
      from = ['waiting_friendship', 'invite_pending', 'awaiting_manual', 'needs_review', 'failed', 'expired'];
      to = 'rejected';
      Object.assign(patch, { last_error: 'Rejected by admin', locked_at: null });
      message = `Request #${id} rejected by admin`;
      break;
    case 'mark_sent':
      // Human confirmation that the invite was actually sent (manual provider or after reviewing an uncertain attempt).
      from = ['awaiting_manual', 'needs_review'];
      to = 'invite_sent';
      Object.assign(patch, { invite_sent_at: iso(now), last_error: null, locked_at: null });
      message = `Request #${id}: admin confirmed the invite was sent`;
      break;
  }

  const ok = await transition(db, id, from, { ...patch, status: to }, now);
  if (!ok) throw new AdminOpError(`Request #${id} is "${req.status}"; action "${op}" is not allowed in this state`);
  await logEvent(db, `admin_${op}`, req.steam_id, message, now);
  return message;
}

export async function setPaused(db: Db, paused: boolean): Promise<void> {
  await setSetting(db, SETTING_PAUSED, paused ? 'true' : 'false');
  await logEvent(db, paused ? 'automation_paused' : 'automation_resumed', null, `Automation ${paused ? 'paused' : 'resumed'} by admin`);
}

export async function setRemovalDelay(db: Db, seconds: number): Promise<void> {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 7 * 24 * 3600) throw new AdminOpError('Removal delay must be 0..604800 seconds');
  await setSetting(db, SETTING_REMOVAL_DELAY, String(seconds));
  await logEvent(db, 'settings_changed', null, `Removal delay set to ${seconds}s`);
}

export async function blockSteamId(db: Db, steamId: string, reason: string | null, now = new Date()): Promise<void> {
  if (!isValidSteamId64(steamId)) throw new AdminOpError('Invalid SteamID64');
  await db
    .insertInto('blocked_steam_ids')
    .values({ steam_id: steamId, reason: reason?.slice(0, 300) || null, created_at: iso(now) })
    .onConflict((oc) => oc.column('steam_id').doNothing())
    .execute();
  const req = await db.selectFrom('invite_requests').select(['id']).where('steam_id', '=', steamId).executeTakeFirst();
  if (req) {
    await transition(db, req.id, ['waiting_friendship', 'invite_pending', 'awaiting_manual', 'needs_review'], { status: 'rejected', last_error: 'Blocked by admin' }, now);
  }
  await logEvent(db, 'steam_id_blocked', steamId, `Blocked${reason ? `: ${reason}` : ''}`, now);
}

export async function unblockSteamId(db: Db, steamId: string): Promise<void> {
  await db.deleteFrom('blocked_steam_ids').where('steam_id', '=', steamId).execute();
  await logEvent(db, 'steam_id_unblocked', steamId, 'Unblocked');
}
