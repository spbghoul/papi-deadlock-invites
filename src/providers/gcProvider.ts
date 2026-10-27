import type { Logger } from '../lib/logger';
import { isValidSteamId64, steamId64ToAccountId } from '../lib/steamid';
import {
  decodeConnectionStatus,
  decodeSubmitPlaytestUserResponse,
  encodeSubmitPlaytestUser,
  GC_MSG,
  SubmitPlaytestResponse,
} from './gcProto';
import type { DeadlockInviteProvider, InviteOutcome } from './types';

/** The subset of steam-user's client used to talk to the Deadlock Game Coordinator. */
export interface GcClient {
  gamesPlayed(apps: number[]): void;
  sendToGC(
    appid: number,
    msgType: number,
    protoBufHeader: Record<string, unknown> | null,
    payload: Buffer,
    callback?: (appid: number, msgType: number, payload: Buffer) => void,
  ): void;
}

export interface GcProviderOptions {
  appId: number;
  location: string;
  responseTimeoutMs: number;
  notFriendsLongEnoughRetryMs: number;
  helloIntervalMs?: number;
  log: Logger;
}

/**
 * Real integration: sends CMsgClientToGCSubmitPlaytestUser (9189) to the Deadlock GC, the same
 * message the game client sends when a playtester invites a friend from the in-game friends list.
 *
 * Requirements (enforced by Valve, not by us): the bot account itself must have Deadlock access,
 * must not be a limited account, and the target must be the bot's Steam friend.
 */
export class DeadlockGcInviteProvider implements DeadlockInviteProvider {
  readonly name = 'deadlock-gc';
  private ready = false;
  private helloTimer: NodeJS.Timeout | null = null;
  private pending: ((payload: Buffer) => void) | null = null;

  constructor(
    private readonly client: GcClient,
    private readonly opts: GcProviderOptions,
  ) {}

  /** Call after Steam logon: "launch" Deadlock and say hello until the GC welcomes us. */
  start(): void {
    this.stopHello();
    this.ready = false;
    this.client.gamesPlayed([this.opts.appId]);
    const hello = () => {
      if (this.ready) return;
      this.opts.log.debug('Sending ClientHello to Deadlock GC');
      this.client.sendToGC(this.opts.appId, GC_MSG.ClientHello, {}, Buffer.alloc(0));
    };
    hello();
    this.helloTimer = setInterval(hello, this.opts.helloIntervalMs ?? 15_000);
  }

  stop(): void {
    this.stopHello();
    this.ready = false;
  }

  private stopHello() {
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.helloTimer = null;
  }

  /** Wire to steam-user's `receivedFromGC` event. */
  onGcMessage(appid: number, msgType: number, payload: Buffer): void {
    if (appid !== this.opts.appId) return;
    if (msgType === GC_MSG.ClientWelcome) {
      if (!this.ready) this.opts.log.info('Connected to Deadlock Game Coordinator');
      this.ready = true;
      this.stopHello();
    } else if (msgType === GC_MSG.ClientConnectionStatus) {
      const status = decodeConnectionStatus(payload);
      if (status !== 0 && this.ready) {
        this.opts.log.warn('Deadlock GC session lost', { status });
        this.start();
      }
    } else if (msgType === GC_MSG.SubmitPlaytestUserResponse && this.pending) {
      // Fallback when the response arrives without job routing.
      this.pending(payload);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async checkAvailability() {
    return this.ready
      ? { available: true, detail: 'Connected to Deadlock Game Coordinator' }
      : { available: false, detail: 'Not connected to the Deadlock Game Coordinator (does the bot account have Deadlock access?)' };
  }

  async canInvite(steamId: string) {
    return isValidSteamId64(steamId) ? { ok: true, detail: 'ok' } : { ok: false, detail: 'Invalid SteamID64' };
  }

  async sendInvite(steamId: string): Promise<InviteOutcome> {
    if (!this.ready) return { kind: 'defer', detail: 'Deadlock GC not connected', retryAfterMs: 60_000, global: true };
    if (this.pending) return { kind: 'defer', detail: 'Another invite is in flight', retryAfterMs: 5_000 };

    const payload = encodeSubmitPlaytestUser({ location: this.opts.location, targetAccountId: steamId64ToAccountId(steamId) });

    const response = await new Promise<Buffer | null>((resolve) => {
      const timer = setTimeout(() => finish(null), this.opts.responseTimeoutMs);
      const finish = (buf: Buffer | null) => {
        clearTimeout(timer);
        if (this.pending === finish) this.pending = null;
        resolve(buf);
      };
      this.pending = finish;
      try {
        this.client.sendToGC(this.opts.appId, GC_MSG.SubmitPlaytestUser, {}, payload, (_app, _type, body) => finish(body));
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        // Throwing synchronously means nothing left the process.
        resolve(Buffer.from([0x08, SubmitPlaytestResponse.InternalError]));
        this.opts.log.error('sendToGC threw', { err });
      }
    });

    if (!response) {
      return { kind: 'uncertain', detail: `No response from Deadlock GC within ${this.opts.responseTimeoutMs / 1000}s; the invite may or may not have been sent` };
    }

    let code: number;
    try {
      code = decodeSubmitPlaytestUserResponse(response);
    } catch (err) {
      return { kind: 'uncertain', detail: `Unparseable GC response: ${(err as Error).message}` };
    }
    return mapResponse(code, this.opts.notFriendsLongEnoughRetryMs);
  }

  async verifyInviteStatus(): Promise<{ status: 'unknown'; detail: string }> {
    // The GC exposes no query for "did this user receive/accept the playtest invite".
    return { status: 'unknown', detail: 'Deadlock GC provides no way to verify invite delivery' };
  }
}

export function mapResponse(code: number, notFriendsLongEnoughRetryMs: number): InviteOutcome {
  switch (code) {
    case SubmitPlaytestResponse.Success:
      return { kind: 'sent', detail: 'Deadlock GC returned eResponse_Success' };
    case SubmitPlaytestResponse.InternalError:
      return { kind: 'retry', detail: 'Deadlock GC returned eResponse_InternalError' };
    case SubmitPlaytestResponse.InvalidFriend:
      return { kind: 'retry', detail: 'Deadlock GC returned eResponse_InvalidFriend (not recognized as a friend yet)', retryAfterMs: 10 * 60_000 };
    case SubmitPlaytestResponse.NotFriendsLongEnough:
      return { kind: 'defer', detail: 'Deadlock GC returned eResponse_NotFriendsLongEnough', retryAfterMs: notFriendsLongEnoughRetryMs };
    case SubmitPlaytestResponse.AlreadyHasGame:
      return { kind: 'rejected', reason: 'already_has_access', detail: 'User already has Deadlock access (eResponse_AlreadyHasGame)' };
    case SubmitPlaytestResponse.LimitedUser:
      return { kind: 'rejected', reason: 'limited_account', detail: 'Deadlock GC returned eResponse_LimitedUser (limited Steam account)' };
    case SubmitPlaytestResponse.InviteLimitReached:
      return { kind: 'defer', detail: 'Bot reached its Deadlock invite limit (eResponse_InviteLimitReached)', retryAfterMs: 24 * 3600_000, global: true };
    default:
      return { kind: 'uncertain', detail: `Unknown Deadlock GC response code ${code}` };
  }
}
