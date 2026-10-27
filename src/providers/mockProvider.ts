import { isValidSteamId64 } from '../lib/steamid';
import type { DeadlockInviteProvider, InviteOutcome } from './types';

/**
 * Local testing only. Never sends anything to Steam. Refused by the worker when NODE_ENV=production.
 * Every outcome detail is prefixed with [MOCK] so it can never be mistaken for a real invite.
 */
export class MockInviteProvider implements DeadlockInviteProvider {
  readonly name = 'mock';
  readonly sent: string[] = [];

  constructor(private readonly outcomes: Map<string, InviteOutcome> = new Map()) {}

  static fromEnv(rejectIds: string, uncertainIds: string): MockInviteProvider {
    const map = new Map<string, InviteOutcome>();
    for (const id of rejectIds.split(',').map((s) => s.trim()).filter(Boolean)) {
      map.set(id, { kind: 'rejected', reason: 'already_has_access', detail: '[MOCK] configured rejection' });
    }
    for (const id of uncertainIds.split(',').map((s) => s.trim()).filter(Boolean)) {
      map.set(id, { kind: 'uncertain', detail: '[MOCK] configured uncertain outcome' });
    }
    return new MockInviteProvider(map);
  }

  async checkAvailability() {
    return { available: true, detail: '[MOCK] provider - no real invites are sent' };
  }

  async canInvite(steamId: string) {
    return isValidSteamId64(steamId) ? { ok: true, detail: 'ok' } : { ok: false, detail: 'Invalid SteamID64' };
  }

  async sendInvite(steamId: string): Promise<InviteOutcome> {
    const configured = this.outcomes.get(steamId);
    if (configured) return configured;
    this.sent.push(steamId);
    return { kind: 'sent', detail: '[MOCK] simulated success - no real invite was sent' };
  }

  async verifyInviteStatus(steamId: string) {
    return this.sent.includes(steamId)
      ? { status: 'confirmed_sent' as const, detail: '[MOCK] recorded in memory' }
      : { status: 'not_sent' as const, detail: '[MOCK] not recorded' };
  }
}
