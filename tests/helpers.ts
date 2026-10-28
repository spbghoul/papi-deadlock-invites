import { createDb } from '../src/lib/db';
import { acceptedPhrases } from '../src/lib/i18n';
import { migrateToLatest } from '../src/lib/db/migrations';
import { silentLogger } from '../src/lib/logger';
import type { DeadlockInviteProvider } from '../src/providers/types';
import { FriendRelationship, type ProfileComment, type SteamGateway } from '../src/worker/gateway';
import { InviteWorkflow, type WorkflowConfig } from '../src/worker/workflow';

export const USER_A = '76561198000000001';
export const USER_B = '76561198000000002';
export const BOT = '76561198999999999';

export class FakeSteam implements SteamGateway {
  loggedOn = true;
  relationships = new Map<string, FriendRelationship>();
  calls: string[] = [];
  /** When true, accepting a request immediately turns it into a friendship (like Steam does). */
  acceptMakesFriend = true;

  isLoggedOn() {
    return this.loggedOn;
  }
  getRelationship(id: string) {
    return this.relationships.get(id) ?? FriendRelationship.None;
  }
  async acceptFriendRequest(id: string) {
    this.calls.push(`accept:${id}`);
    if (this.acceptMakesFriend) this.relationships.set(id, FriendRelationship.Friend);
  }
  async sendFriendRequest(id: string) {
    this.calls.push(`add:${id}`);
    this.relationships.set(id, FriendRelationship.RequestInitiator);
  }
  async removeFriend(id: string) {
    this.calls.push(`remove:${id}`);
    this.relationships.set(id, FriendRelationship.None);
  }
}

export class Clock {
  constructor(public t = new Date('2026-10-27T12:00:00Z').getTime()) {}
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

export function comment(id: string, author: string, text: string, postedAt: Date): ProfileComment {
  return { id, authorSteamId: author, authorProfileUrl: `https://steamcommunity.com/profiles/${author}`, authorName: `user${id}`, text, postedAt };
}

export async function setup(provider: DeadlockInviteProvider, overrides: Partial<WorkflowConfig> = {}) {
  const db = createDb(':memory:');
  await migrateToLatest(db, 'sqlite');
  const steam = new FakeSteam();
  const clock = new Clock();
  const config: WorkflowConfig = {
    phrases: acceptedPhrases('thank you papi'),
    botSteamId: BOT,
    commentMaxAgeHours: 72,
    friendshipWaitDays: 7,
    maxAttempts: 3,
    maxInvitesPerHour: 100,
    maxFriendActionsPerHour: 100,
    sendFriendRequests: false,
    declineUnknownFriendRequests: false,
    inviteTimeoutMs: 1000,
    defaultRemovalDelaySeconds: 300,
    ...overrides,
  };
  const workflow = new InviteWorkflow({ db, steam, provider, config, log: silentLogger, now: clock.now });
  const statusOf = async (steamId: string) =>
    (await db.selectFrom('invite_requests').select('status').where('steam_id', '=', steamId).executeTakeFirst())?.status;
  return { db, steam, clock, workflow, statusOf };
}
