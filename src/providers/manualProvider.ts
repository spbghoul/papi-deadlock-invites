import { isValidSteamId64 } from '../lib/steamid';
import type { DeadlockInviteProvider, InviteOutcome } from './types';

/**
 * Fallback when automated invites are unavailable. The bot still verifies comments and handles the
 * friendship; requests then wait in "awaiting_manual" until an admin invites the user from the
 * Deadlock client (main menu -> friends list -> Invite) and clicks "Mark sent" in the dashboard.
 */
export class ManualInviteProvider implements DeadlockInviteProvider {
  readonly name = 'manual';

  async checkAvailability() {
    return { available: true, detail: 'Manual mode: invites are sent by an admin from the Deadlock client' };
  }

  async canInvite(steamId: string) {
    return isValidSteamId64(steamId) ? { ok: true, detail: 'ok' } : { ok: false, detail: 'Invalid SteamID64' };
  }

  async sendInvite(): Promise<InviteOutcome> {
    return { kind: 'manual_required', detail: 'Waiting for an admin to send the invite in the Deadlock client and confirm it' };
  }

  async verifyInviteStatus() {
    return { status: 'unknown' as const, detail: 'Manual invites are confirmed by the admin, not verified automatically' };
  }
}
