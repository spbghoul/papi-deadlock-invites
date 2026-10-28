import { errorMessage, type Logger } from '../lib/logger';
import { matchesPhrase } from '../lib/phrase';
import {
  countEventsSince,
  findRequestBySteamId,
  getRuntimeSettings,
  isBlocked,
  iso,
  logEvent,
  transition,
  type Db,
} from '../lib/repo';
import type { InviteRequest } from '../lib/db/schema';
import { isValidSteamId64 } from '../lib/steamid';
import type { DeadlockInviteProvider, InviteOutcome } from '../providers/types';
import { backoffMs, withTimeout } from './backoff';
import { FriendRelationship, type ProfileComment, type SteamGateway } from './gateway';

export interface WorkflowConfig {
  phrase: string;
  botSteamId: string | null;
  commentMaxAgeHours: number;
  friendshipWaitDays: number;
  maxAttempts: number;
  maxInvitesPerHour: number;
  maxFriendActionsPerHour: number;
  sendFriendRequests: boolean;
  declineUnknownFriendRequests: boolean;
  inviteTimeoutMs: number;
  defaultRemovalDelaySeconds: number;
}

export interface WorkflowDeps {
  db: Db;
  steam: SteamGateway;
  provider: DeadlockInviteProvider;
  config: WorkflowConfig;
  log: Logger;
  now?: () => Date;
}

const HOUR = 3600_000;
const FRIEND_ACTION_EVENTS = ['friend_request_accepted', 'friend_request_sent', 'friend_request_declined'];

/**
 * The invite state machine. All state lives in the database; every status change is a guarded
 * transition so restarts or a second worker can never send the same invite twice.
 */
export class InviteWorkflow {
  private providerCooldownUntil = 0;
  private ticking = false;

  constructor(private readonly deps: WorkflowDeps) {}

  private get db() {
    return this.deps.db;
  }
  private get cfg() {
    return this.deps.config;
  }
  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
  private event(type: string, steamId: string | null, description: string) {
    return logEvent(this.db, type, steamId, description, this.now());
  }

  /** Requests left "inviting" by a crash have an unknown outcome: hand them to a human. */
  async recoverAfterRestart(): Promise<number> {
    const stuck = await this.db.selectFrom('invite_requests').select(['id', 'steam_id']).where('status', '=', 'inviting').execute();
    for (const r of stuck) {
      const ok = await transition(
        this.db,
        r.id,
        'inviting',
        { status: 'needs_review', locked_at: null, last_error: 'Worker stopped while the invite was in flight; outcome unknown' },
        this.now(),
      );
      if (ok) await this.event('invite_uncertain', r.steam_id, 'Recovered in-flight invite after restart -> needs_review');
    }
    return stuck.length;
  }

  async knownCommentIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db.selectFrom('processed_comments').select('comment_id').where('comment_id', 'in', ids).execute();
    return new Set(rows.map((r) => r.comment_id));
  }

  /** Returns how many new invite requests were created. */
  async ingestComments(comments: ProfileComment[]): Promise<number> {
    const known = await this.knownCommentIds(comments.map((c) => c.id));
    const fresh = comments
      .filter((c) => !known.has(c.id))
      .sort((a, b) => (a.postedAt?.getTime() ?? 0) - (b.postedAt?.getTime() ?? 0) || Number(BigInt(a.id) - BigInt(b.id)));
    let created = 0;
    for (const c of fresh) {
      try {
        if (await this.ingestComment(c)) created++;
      } catch (err) {
        this.deps.log.error('Failed to process comment', { commentId: c.id, err });
      }
    }
    return created;
  }

  private async ingestComment(c: ProfileComment): Promise<boolean> {
    const now = this.now();
    const validId = isValidSteamId64(c.authorSteamId);
    const matched =
      validId &&
      c.authorSteamId !== this.cfg.botSteamId &&
      matchesPhrase(c.text, this.cfg.phrase) &&
      (!c.postedAt || now.getTime() - c.postedAt.getTime() <= this.cfg.commentMaxAgeHours * HOUR);

    const blocked = matched && (await isBlocked(this.db, c.authorSteamId));

    const outcome = await this.db.transaction().execute(async (trx) => {
      const claimed = await trx
        .insertInto('processed_comments')
        .values({ comment_id: c.id, steam_id: validId ? c.authorSteamId : null, matched: matched ? 1 : 0, processed_at: iso(now) })
        .onConflict((oc) => oc.column('comment_id').doNothing())
        .executeTakeFirst();
      if (Number(claimed.numInsertedOrUpdatedRows ?? 0n) === 0) return 'already_processed' as const;
      if (!matched) return 'ignored' as const;
      if (blocked) return 'blocked' as const;

      await trx
        .insertInto('users')
        .values({
          steam_id: c.authorSteamId,
          profile_url: c.authorProfileUrl,
          persona_name: c.authorName?.slice(0, 64) ?? null,
          first_seen_at: iso(now),
          status: 'waiting_friendship',
        })
        .onConflict((oc) => oc.column('steam_id').doUpdateSet({ profile_url: c.authorProfileUrl, persona_name: c.authorName?.slice(0, 64) ?? null }))
        .execute();

      const inserted = await trx
        .insertInto('invite_requests')
        .values({
          steam_id: c.authorSteamId,
          comment_id: c.id,
          comment_text: c.text.slice(0, 200),
          status: 'waiting_friendship',
          created_at: iso(now),
          updated_at: iso(now),
        })
        .onConflict((oc) => oc.column('steam_id').doNothing())
        .executeTakeFirst();
      if (Number(inserted.numInsertedOrUpdatedRows ?? 0n) === 1) return 'created' as const;

      // One request per account, but a cancelled/expired one (nothing was ever sent) can start over.
      const reopened = await trx
        .updateTable('invite_requests')
        .set({
          comment_id: c.id,
          comment_text: c.text.slice(0, 200),
          status: 'waiting_friendship',
          attempts: 0,
          last_error: null,
          friend_since: null,
          friend_request_sent_at: null,
          next_attempt_at: null,
          updated_at: iso(now),
        })
        .where('steam_id', '=', c.authorSteamId)
        .where('status', 'in', ['cancelled', 'expired'])
        .executeTakeFirst();
      if (Number(reopened.numUpdatedRows) === 1) {
        await trx.updateTable('users').set({ status: 'waiting_friendship' }).where('steam_id', '=', c.authorSteamId).execute();
        return 'reopened' as const;
      }
      return 'duplicate' as const;
    });

    switch (outcome) {
      case 'blocked':
        await this.event('blocked_comment', c.authorSteamId, `Ignored comment ${c.id} from blocked SteamID`);
        return false;
      case 'duplicate':
        await this.event('duplicate_comment', c.authorSteamId, `Comment ${c.id} ignored: this SteamID already has a request`);
        return false;
      case 'created':
      case 'reopened':
        await this.event('comment_verified', c.authorSteamId, `Verified comment ${c.id}${outcome === 'reopened' ? ' (request reopened)' : ''}`);
        await this.syncFriendship(c.authorSteamId);
        return true;
      default:
        return false;
    }
  }

  /**
   * Cancels requests still waiting for friendship whose comment is gone from the profile.
   * A comment counts as deleted only if it would have been inside the fetched window:
   * either we saw every comment (`complete`) or it is newer than the oldest fetched one.
   */
  async cancelDeletedComments(fetched: ProfileComment[], complete: boolean): Promise<number> {
    const present = new Set(fetched.map((c) => c.id));
    const numericIds = fetched.map((c) => c.id).filter((id) => /^\d+$/.test(id)).map((id) => BigInt(id));
    const oldest = numericIds.length ? numericIds.reduce((a, b) => (b < a ? b : a)) : null;

    const waiting = await this.db.selectFrom('invite_requests').select(['id', 'steam_id', 'comment_id']).where('status', '=', 'waiting_friendship').execute();
    let cancelled = 0;
    for (const r of waiting) {
      if (present.has(r.comment_id) || !/^\d+$/.test(r.comment_id)) continue;
      const inWindow = complete || (oldest !== null && BigInt(r.comment_id) > oldest);
      if (!inWindow) continue;
      if (await transition(this.db, r.id, 'waiting_friendship', { status: 'cancelled', last_error: 'Comment was deleted' }, this.now())) {
        await this.event('comment_deleted', r.steam_id, `Comment ${r.comment_id} was deleted before friendship; request cancelled`);
        cancelled++;
      }
    }
    return cancelled;
  }

  private async friendBudgetLeft(): Promise<number> {
    const used = await countEventsSince(this.db, FRIEND_ACTION_EVENTS, new Date(this.now().getTime() - HOUR));
    return this.cfg.maxFriendActionsPerHour - used;
  }

  /** Reconciles a request with the current Steam friend relationship. */
  async syncFriendship(steamId: string): Promise<void> {
    const req = await findRequestBySteamId(this.db, steamId);
    if (!req) return;
    let rel = this.deps.steam.getRelationship(steamId);

    if (req.status === 'waiting_friendship') {
      if (rel === FriendRelationship.RequestRecipient) {
        if ((await this.friendBudgetLeft()) <= 0) return; // retried on the next tick
        try {
          await this.deps.steam.acceptFriendRequest(steamId);
          await this.event('friend_request_accepted', steamId, 'Accepted incoming friend request');
          rel = this.deps.steam.getRelationship(steamId);
        } catch (err) {
          await this.event('friend_action_error', steamId, `Accepting friend request failed: ${errorMessage(err)}`);
          return;
        }
      } else if (rel === FriendRelationship.None && this.cfg.sendFriendRequests && !req.friend_request_sent_at) {
        if ((await this.friendBudgetLeft()) <= 0) return;
        try {
          await this.deps.steam.sendFriendRequest(steamId);
          await this.db.updateTable('invite_requests').set({ friend_request_sent_at: iso(this.now()) }).where('id', '=', req.id).execute();
          await this.event('friend_request_sent', steamId, 'Sent friend request');
        } catch (err) {
          await this.event('friend_action_error', steamId, `Sending friend request failed: ${errorMessage(err)}`);
        }
        return;
      }

      if (rel === FriendRelationship.Friend) {
        const now = iso(this.now());
        if (await transition(this.db, req.id, 'waiting_friendship', { status: 'invite_pending', friend_since: now, next_attempt_at: now }, this.now())) {
          await this.event('friendship_confirmed', steamId, 'Friendship confirmed; invite queued');
        }
      }
      return;
    }

    if ((req.status === 'invite_pending' || req.status === 'awaiting_manual') && rel !== FriendRelationship.Friend) {
      if (await transition(this.db, req.id, req.status, { status: 'waiting_friendship', friend_since: null }, this.now())) {
        await this.event('friendship_lost', steamId, 'No longer friends before the invite was sent');
      }
    }
  }

  /** Wire to steam-user's `friendRelationship` event. */
  async handleFriendRelationship(steamId: string, rel: FriendRelationship): Promise<void> {
    if (!isValidSteamId64(steamId)) return;
    const req = await findRequestBySteamId(this.db, steamId);

    if (!req) {
      if (rel !== FriendRelationship.RequestRecipient) return;
      const blocked = await isBlocked(this.db, steamId);
      if (blocked || this.cfg.declineUnknownFriendRequests) {
        if ((await this.friendBudgetLeft()) <= 0) return;
        await this.deps.steam.removeFriend(steamId);
        await this.event('friend_request_declined', steamId, blocked ? 'Declined friend request from blocked SteamID' : 'Declined friend request without a verified comment');
      } else {
        await this.event('friend_request_unmatched', steamId, 'Friend request received before any verified comment; waiting for the comment');
      }
      return;
    }

    if (req.status === 'invite_sent' && rel === FriendRelationship.None) {
      if (await transition(this.db, req.id, 'invite_sent', { status: 'completed', completed_at: iso(this.now()) }, this.now())) {
        await this.event('completed', steamId, 'User removed the bot after the invite was sent');
      }
      return;
    }
    await this.syncFriendship(steamId);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!this.deps.steam.isLoggedOn()) return;
      const settings = await getRuntimeSettings(this.db, this.cfg.defaultRemovalDelaySeconds);
      if (settings.paused) return;
      await this.processWaitingFriendships();
      await this.processInvites();
      await this.processRemovals(settings.removalDelaySeconds);
    } finally {
      this.ticking = false;
    }
  }

  private async processWaitingFriendships(): Promise<void> {
    const rows = await this.db.selectFrom('invite_requests').selectAll().where('status', 'in', ['waiting_friendship', 'invite_pending', 'awaiting_manual']).orderBy('id').limit(500).execute();
    const expireBefore = this.now().getTime() - this.cfg.friendshipWaitDays * 24 * HOUR;
    for (const r of rows) {
      if (r.status === 'waiting_friendship' && new Date(r.updated_at).getTime() < expireBefore) {
        if (await transition(this.db, r.id, 'waiting_friendship', { status: 'expired', last_error: 'No friendship established in time' }, this.now())) {
          await this.event('request_expired', r.steam_id, `No friendship within ${this.cfg.friendshipWaitDays} days`);
        }
        continue;
      }
      await this.syncFriendship(r.steam_id);
    }
  }

  private async processInvites(): Promise<void> {
    const now = this.now();
    if (now.getTime() < this.providerCooldownUntil) return;
    const availability = await this.deps.provider.checkAvailability();
    if (!availability.available) return;

    const used = await countEventsSince(this.db, ['invite_attempt'], new Date(now.getTime() - HOUR));
    const budget = this.cfg.maxInvitesPerHour - used;
    if (budget <= 0) return;

    const due = await this.db
      .selectFrom('invite_requests')
      .selectAll()
      .where('status', '=', 'invite_pending')
      .where('next_attempt_at', '<=', iso(now))
      .orderBy('created_at')
      .limit(budget)
      .execute();

    for (const r of due) {
      if (this.now().getTime() < this.providerCooldownUntil) break;
      await this.attemptInvite(r);
    }
  }

  private async attemptInvite(r: InviteRequest): Promise<void> {
    const { db, steam, provider } = this.deps;
    if (steam.getRelationship(r.steam_id) !== FriendRelationship.Friend) {
      await this.syncFriendship(r.steam_id);
      return;
    }
    if (await isBlocked(db, r.steam_id)) {
      await transition(db, r.id, 'invite_pending', { status: 'rejected', last_error: 'Blocked' }, this.now());
      return;
    }
    const can = await provider.canInvite(r.steam_id);
    if (!can.ok) {
      if (await transition(db, r.id, 'invite_pending', { status: 'failed', last_error: can.detail }, this.now())) {
        await this.event('invite_failed', r.steam_id, can.detail);
      }
      return;
    }

    const attempt = r.attempts + 1;
    const claimed = await transition(db, r.id, 'invite_pending', { status: 'inviting', locked_at: iso(this.now()), attempts: attempt, provider: provider.name }, this.now());
    if (!claimed) return;
    await this.event('invite_attempt', r.steam_id, `Attempt #${attempt} via ${provider.name}`);

    let outcome: InviteOutcome;
    try {
      outcome = await withTimeout(provider.sendInvite(r.steam_id), this.cfg.inviteTimeoutMs, 'sendInvite');
    } catch (err) {
      outcome = { kind: 'uncertain', detail: `sendInvite did not complete: ${errorMessage(err)}` };
    }
    await this.applyOutcome(r, attempt, outcome);
  }

  private async applyOutcome(r: InviteRequest, attempt: number, outcome: InviteOutcome): Promise<void> {
    const now = this.now();
    const sid = r.steam_id;
    switch (outcome.kind) {
      case 'sent':
        await transition(this.db, r.id, 'inviting', { status: 'invite_sent', invite_sent_at: iso(now), locked_at: null, last_error: null }, now);
        await this.event('invite_sent', sid, outcome.detail);
        return;
      case 'manual_required':
        await transition(this.db, r.id, 'inviting', { status: 'awaiting_manual', locked_at: null, last_error: null }, now);
        await this.event('manual_invite_required', sid, outcome.detail);
        return;
      case 'retry':
        if (attempt >= this.cfg.maxAttempts) {
          await transition(this.db, r.id, 'inviting', { status: 'failed', locked_at: null, last_error: `${outcome.detail} (max attempts reached)` }, now);
          await this.event('invite_failed', sid, `${outcome.detail}; giving up after ${attempt} attempts`);
        } else {
          const delay = outcome.retryAfterMs ?? backoffMs(attempt);
          await transition(this.db, r.id, 'inviting', { status: 'invite_pending', locked_at: null, last_error: outcome.detail, next_attempt_at: iso(new Date(now.getTime() + delay)) }, now);
          await this.event('invite_retry', sid, `${outcome.detail}; retry in ${Math.round(delay / 1000)}s`);
        }
        return;
      case 'defer':
        await transition(
          this.db,
          r.id,
          'inviting',
          { status: 'invite_pending', locked_at: null, attempts: attempt - 1, last_error: outcome.detail, next_attempt_at: iso(new Date(now.getTime() + outcome.retryAfterMs)) },
          now,
        );
        if (outcome.global) this.providerCooldownUntil = now.getTime() + outcome.retryAfterMs;
        await this.event('invite_deferred', sid, `${outcome.detail}; next try in ${Math.round(outcome.retryAfterMs / 1000)}s${outcome.global ? ' (all invites paused)' : ''}`);
        return;
      case 'rejected':
        await transition(this.db, r.id, 'inviting', { status: 'failed', locked_at: null, last_error: outcome.detail }, now);
        await this.event('invite_rejected', sid, outcome.detail);
        return;
      case 'uncertain':
        await transition(this.db, r.id, 'inviting', { status: 'needs_review', locked_at: null, last_error: outcome.detail }, now);
        await this.event('invite_uncertain', sid, outcome.detail);
        return;
    }
  }

  /** Removes friends only after a confirmed invite and the configured delay. */
  private async processRemovals(delaySeconds: number): Promise<void> {
    const cutoff = iso(new Date(this.now().getTime() - delaySeconds * 1000));
    const rows = await this.db
      .selectFrom('invite_requests')
      .select(['id', 'steam_id'])
      .where('status', '=', 'invite_sent')
      .where('invite_sent_at', '<=', cutoff)
      .orderBy('invite_sent_at')
      .limit(50)
      .execute();
    for (const r of rows) {
      try {
        if (this.deps.steam.getRelationship(r.steam_id) === FriendRelationship.Friend) {
          await this.deps.steam.removeFriend(r.steam_id);
          await this.event('friend_removed', r.steam_id, `Removed from friends ${delaySeconds}s after the invite was sent`);
        }
        if (await transition(this.db, r.id, 'invite_sent', { status: 'completed', completed_at: iso(this.now()) }, this.now())) {
          await this.event('completed', r.steam_id, 'Request completed');
        }
      } catch (err) {
        await this.event('friend_action_error', r.steam_id, `Removing friend failed: ${errorMessage(err)}`);
      }
    }
  }
}
