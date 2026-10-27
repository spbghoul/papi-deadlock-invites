import { describe, expect, it } from 'vitest';
import { applyAdminOp, blockSteamId, setPaused } from '../src/lib/adminOps';
import { ManualInviteProvider } from '../src/providers/manualProvider';
import { MockInviteProvider } from '../src/providers/mockProvider';
import type { DeadlockInviteProvider, InviteOutcome } from '../src/providers/types';
import { FriendRelationship } from '../src/worker/gateway';
import { BOT, comment, setup, USER_A, USER_B } from './helpers';

const MIN = 60_000;

/** Provider whose outcome can be scripted per call. */
class ScriptedProvider implements DeadlockInviteProvider {
  readonly name = 'scripted';
  calls: string[] = [];
  constructor(public outcomes: InviteOutcome[]) {}
  async checkAvailability() {
    return { available: true, detail: '' };
  }
  async canInvite() {
    return { ok: true, detail: '' };
  }
  async sendInvite(id: string) {
    this.calls.push(id);
    return this.outcomes.shift() ?? { kind: 'sent' as const, detail: 'ok' };
  }
  async verifyInviteStatus() {
    return { status: 'unknown' as const, detail: '' };
  }
}

describe('invite workflow', () => {
  it('runs the full happy path: comment -> friend request -> invite -> delayed removal -> completed', async () => {
    const provider = new MockInviteProvider();
    const { workflow, steam, clock, statusOf, db } = await setup(provider);

    await workflow.ingestComments([comment('100', USER_A, '  Thank   You PAPI! ', clock.now())]);
    expect(await statusOf(USER_A)).toBe('waiting_friendship');

    // User sends a friend request -> bot accepts -> friendship -> queued.
    steam.relationships.set(USER_A, FriendRelationship.RequestRecipient);
    await workflow.handleFriendRelationship(USER_A, FriendRelationship.RequestRecipient);
    expect(steam.calls).toContain(`accept:${USER_A}`);
    expect(await statusOf(USER_A)).toBe('invite_pending');

    await workflow.tick();
    expect(provider.sent).toEqual([USER_A]);
    expect(await statusOf(USER_A)).toBe('invite_sent');
    expect(steam.calls).not.toContain(`remove:${USER_A}`); // removal delay not elapsed

    clock.advance(4 * MIN);
    await workflow.tick();
    expect(await statusOf(USER_A)).toBe('invite_sent');

    clock.advance(2 * MIN);
    await workflow.tick();
    expect(steam.calls).toContain(`remove:${USER_A}`);
    expect(await statusOf(USER_A)).toBe('completed');

    const user = await db.selectFrom('users').selectAll().where('steam_id', '=', USER_A).executeTakeFirstOrThrow();
    expect(user.invited_at).not.toBeNull();
    expect(user.status).toBe('completed');
  });

  it('ignores non-matching, own, invalid and too-old comments', async () => {
    const { workflow, clock, statusOf } = await setup(new MockInviteProvider());
    const old = new Date(clock.now().getTime() - 100 * 3600_000);
    const created = await workflow.ingestComments([
      comment('1', USER_A, 'thank you papi please', clock.now()),
      comment('2', BOT, 'thank you papi', clock.now()),
      comment('3', '123', 'thank you papi', clock.now()),
      comment('4', USER_B, 'thank you papi', old),
    ]);
    expect(created).toBe(0);
    expect(await statusOf(USER_A)).toBeUndefined();
    expect(await statusOf(USER_B)).toBeUndefined();
  });

  it('never creates two requests for the same SteamID or reprocesses a comment', async () => {
    const provider = new MockInviteProvider();
    const { workflow, clock, db, steam } = await setup(provider);
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    const c1 = comment('10', USER_A, 'thank you papi', clock.now());
    const c2 = comment('11', USER_A, 'thank you papi', clock.now());

    // Simulate concurrent polls and a re-fetch of the same page.
    const results = await Promise.all([workflow.ingestComments([c1, c2]), workflow.ingestComments([c1, c2])]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    await workflow.ingestComments([c1, c2]);

    const rows = await db.selectFrom('invite_requests').selectAll().execute();
    expect(rows).toHaveLength(1);

    await workflow.tick();
    await workflow.tick();
    expect(provider.sent).toEqual([USER_A]);
  });

  it('does not accept friend requests from users without a verified comment', async () => {
    const { workflow, steam } = await setup(new MockInviteProvider());
    steam.relationships.set(USER_B, FriendRelationship.RequestRecipient);
    await workflow.handleFriendRelationship(USER_B, FriendRelationship.RequestRecipient);
    expect(steam.calls).toEqual([]);
  });

  it('declines unknown friend requests when configured', async () => {
    const { workflow, steam } = await setup(new MockInviteProvider(), { declineUnknownFriendRequests: true });
    steam.relationships.set(USER_B, FriendRelationship.RequestRecipient);
    await workflow.handleFriendRelationship(USER_B, FriendRelationship.RequestRecipient);
    expect(steam.calls).toEqual([`remove:${USER_B}`]);
  });

  it('ignores comments from blocked SteamIDs', async () => {
    const { workflow, clock, db, statusOf } = await setup(new MockInviteProvider());
    await blockSteamId(db, USER_A, 'spam');
    await workflow.ingestComments([comment('20', USER_A, 'thank you papi', clock.now())]);
    expect(await statusOf(USER_A)).toBeUndefined();
  });

  it('moves an in-flight invite to needs_review after a crash and never resends it automatically', async () => {
    const provider = new MockInviteProvider();
    const { workflow, clock, db, steam, statusOf } = await setup(provider);
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    await workflow.ingestComments([comment('30', USER_A, 'thank you papi', clock.now())]);
    // Simulate a crash while the invite was being sent.
    await db.updateTable('invite_requests').set({ status: 'inviting' }).where('steam_id', '=', USER_A).execute();

    expect(await workflow.recoverAfterRestart()).toBe(1);
    expect(await statusOf(USER_A)).toBe('needs_review');
    await workflow.tick();
    expect(provider.sent).toEqual([]);
    expect(steam.calls).not.toContain(`remove:${USER_A}`);
  });

  it('marks uncertain outcomes for review and keeps the friend', async () => {
    const provider = new ScriptedProvider([{ kind: 'uncertain', detail: 'timeout' }]);
    const { workflow, clock, steam, statusOf } = await setup(provider, { defaultRemovalDelaySeconds: 0 });
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    await workflow.ingestComments([comment('40', USER_A, 'thank you papi', clock.now())]);
    await workflow.tick();
    clock.advance(60 * MIN);
    await workflow.tick();
    expect(await statusOf(USER_A)).toBe('needs_review');
    expect(provider.calls).toHaveLength(1);
    expect(steam.calls).not.toContain(`remove:${USER_A}`);
  });

  it('treats a provider that hangs as uncertain (timeout)', async () => {
    const hanging: DeadlockInviteProvider = {
      name: 'hang',
      checkAvailability: async () => ({ available: true, detail: '' }),
      canInvite: async () => ({ ok: true, detail: '' }),
      sendInvite: () => new Promise(() => undefined),
      verifyInviteStatus: async () => ({ status: 'unknown', detail: '' }),
    };
    const { workflow, clock, steam, statusOf } = await setup(hanging, { inviteTimeoutMs: 50 });
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    await workflow.ingestComments([comment('41', USER_A, 'thank you papi', clock.now())]);
    await workflow.tick();
    expect(await statusOf(USER_A)).toBe('needs_review');
  });

  it('retries explicit failures with backoff, then fails after max attempts', async () => {
    const provider = new ScriptedProvider([
      { kind: 'retry', detail: 'internal error' },
      { kind: 'retry', detail: 'internal error' },
      { kind: 'retry', detail: 'internal error' },
    ]);
    const { workflow, clock, steam, statusOf } = await setup(provider, { maxAttempts: 3 });
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    await workflow.ingestComments([comment('50', USER_A, 'thank you papi', clock.now())]);

    await workflow.tick();
    expect(await statusOf(USER_A)).toBe('invite_pending');
    await workflow.tick(); // backoff not elapsed
    expect(provider.calls).toHaveLength(1);

    for (let i = 0; i < 2; i++) {
      clock.advance(6 * 3600_000);
      await workflow.tick();
    }
    expect(provider.calls).toHaveLength(3);
    expect(await statusOf(USER_A)).toBe('failed');
    expect(steam.calls).not.toContain(`remove:${USER_A}`);
  });

  it('defers NotFriendsLongEnough without consuming attempts', async () => {
    const provider = new ScriptedProvider([
      { kind: 'defer', detail: 'not friends long enough', retryAfterMs: 60 * MIN },
      { kind: 'sent', detail: 'ok' },
    ]);
    const { workflow, clock, steam, statusOf, db } = await setup(provider);
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    await workflow.ingestComments([comment('60', USER_A, 'thank you papi', clock.now())]);
    await workflow.tick();
    const row = await db.selectFrom('invite_requests').selectAll().where('steam_id', '=', USER_A).executeTakeFirstOrThrow();
    expect(row.status).toBe('invite_pending');
    expect(row.attempts).toBe(0);
    clock.advance(61 * MIN);
    await workflow.tick();
    expect(await statusOf(USER_A)).toBe('invite_sent');
  });

  it('does not invite when the user removed the bot before the invite', async () => {
    const provider = new MockInviteProvider();
    const { workflow, clock, steam, statusOf } = await setup(provider);
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    await workflow.ingestComments([comment('70', USER_A, 'thank you papi', clock.now())]);
    expect(await statusOf(USER_A)).toBe('invite_pending');
    steam.relationships.set(USER_A, FriendRelationship.None);
    await workflow.handleFriendRelationship(USER_A, FriendRelationship.None);
    await workflow.tick();
    expect(provider.sent).toEqual([]);
    expect(await statusOf(USER_A)).toBe('waiting_friendship');
  });

  it('respects pause', async () => {
    const provider = new MockInviteProvider();
    const { workflow, clock, steam, db } = await setup(provider);
    await setPaused(db, true);
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    await workflow.ingestComments([comment('80', USER_A, 'thank you papi', clock.now())]);
    await workflow.tick();
    expect(provider.sent).toEqual([]);
    await setPaused(db, false);
    await workflow.tick();
    expect(provider.sent).toEqual([USER_A]);
  });

  it('enforces the hourly invite limit', async () => {
    const provider = new MockInviteProvider();
    const { workflow, clock, steam } = await setup(provider, { maxInvitesPerHour: 1 });
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    steam.relationships.set(USER_B, FriendRelationship.Friend);
    await workflow.ingestComments([comment('90', USER_A, 'thank you papi', clock.now()), comment('91', USER_B, 'thank you papi', clock.now())]);
    await workflow.tick();
    expect(provider.sent).toHaveLength(1);
    clock.advance(61 * MIN);
    await workflow.tick();
    expect(provider.sent).toHaveLength(2);
  });

  it('manual provider waits for admin confirmation before counting an invite', async () => {
    const { workflow, clock, steam, db, statusOf } = await setup(new ManualInviteProvider(), { defaultRemovalDelaySeconds: 0 });
    steam.relationships.set(USER_A, FriendRelationship.Friend);
    await workflow.ingestComments([comment('95', USER_A, 'thank you papi', clock.now())]);
    await workflow.tick();
    expect(await statusOf(USER_A)).toBe('awaiting_manual');
    expect(steam.calls).not.toContain(`remove:${USER_A}`);

    const req = await db.selectFrom('invite_requests').select('id').where('steam_id', '=', USER_A).executeTakeFirstOrThrow();
    await applyAdminOp(db, req.id, 'mark_sent', clock.now());
    await workflow.tick();
    expect(await statusOf(USER_A)).toBe('completed');
    expect(steam.calls).toContain(`remove:${USER_A}`);
  });

  it('admin cannot mark a pending (unsent) request as sent', async () => {
    const { workflow, clock, steam, db } = await setup(new MockInviteProvider());
    await workflow.ingestComments([comment('96', USER_A, 'thank you papi', clock.now())]);
    const req = await db.selectFrom('invite_requests').select('id').where('steam_id', '=', USER_A).executeTakeFirstOrThrow();
    await expect(applyAdminOp(db, req.id, 'mark_sent')).rejects.toThrow(/not allowed/);
    expect(steam.calls).toEqual([]);
  });

  it('expires requests that never become friends', async () => {
    const { workflow, clock, statusOf } = await setup(new MockInviteProvider(), { friendshipWaitDays: 1 });
    await workflow.ingestComments([comment('97', USER_A, 'thank you papi', clock.now())]);
    clock.advance(25 * 3600_000);
    await workflow.tick();
    expect(await statusOf(USER_A)).toBe('expired');
  });
});
