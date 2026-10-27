import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import type { Logger } from '../lib/logger';
import type { WebAuth } from './comments';
import { FriendRelationship, type SteamGateway } from './gateway';

export interface SteamLoginOptions {
  refreshToken?: string;
  tokenFile: string;
  accountName?: string;
  password?: string;
  sharedSecret?: string;
  log: Logger;
}

// EResult codes that mean "credentials are no longer valid" -> a human must log in again.
const AUTH_FATAL = new Set([5 /* InvalidPassword */, 15 /* AccessDenied */, 18 /* AccountNotFound */, 63 /* AccountLogonDenied */, 65 /* InvalidLoginAuthCode */, 27 /* Expired */]);
// Steam asked us to slow down.
const RATE_LIMITED = new Set([84 /* RateLimitExceeded */, 87 /* AccountLoginDeniedThrottle */]);

export function readTokenFile(file: string): string | undefined {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export function writeTokenFile(file: string, token: string): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
}

export type GatewayState = 'connecting' | 'online' | 'offline' | 'auth_required' | 'rate_limited';

/**
 * steam-user based Steam client. Emits:
 *  - 'loggedOn'(botSteamId), 'disconnected', 'stateChanged'(state)
 *  - 'friendRelationship'(steamId64, relationship), 'friendsList'
 */
export class SteamUserGateway extends EventEmitter implements SteamGateway {
  readonly client: SteamUser;
  private state: GatewayState = 'offline';
  private web: WebAuth | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopping = false;
  lastError: string | null = null;

  constructor(private readonly opts: SteamLoginOptions) {
    super();
    this.client = new SteamUser({ autoRelogin: true, renewRefreshTokens: true, dataDirectory: null });
    const c = this.client;

    c.on('loggedOn', () => {
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.setState('online');
      c.setPersona(SteamUser.EPersonaState.Online);
      this.opts.log.info('Logged on to Steam', { steamId: c.steamID?.getSteamID64() });
      this.emit('loggedOn', c.steamID?.getSteamID64() ?? null);
    });

    c.on('refreshToken', (token: string) => {
      writeTokenFile(this.opts.tokenFile, token);
      this.opts.log.info('Stored renewed Steam refresh token', { file: this.opts.tokenFile });
    });

    c.on('webSession', (sessionId: string, cookies: string[]) => {
      this.web = { sessionId, cookies };
      this.opts.log.debug('Steam web session ready');
    });

    c.on('friendRelationship', (sid: { getSteamID64(): string }, rel: number) => {
      this.emit('friendRelationship', sid.getSteamID64(), rel as FriendRelationship);
    });
    c.on('friendsList', () => this.emit('friendsList'));

    c.on('disconnected', (eresult: number, msg?: string) => {
      // steam-user reconnects automatically (autoRelogin) after a plain disconnect.
      this.web = null;
      this.setState(this.stopping ? 'offline' : 'connecting');
      this.opts.log.warn('Disconnected from Steam', { eresult, reason: msg });
      this.emit('disconnected');
    });

    c.on('error', (err: Error & { eresult?: number }) => {
      this.web = null;
      this.lastError = err.message;
      const eresult = err.eresult ?? -1;
      this.opts.log.error('Steam client error', { eresult, err });
      if (this.stopping) return;
      if (AUTH_FATAL.has(eresult)) {
        this.setState('auth_required');
        this.opts.log.error('Steam credentials rejected. Run `npm run steam:login` to obtain a new refresh token, then restart the worker.');
        return;
      }
      if (RATE_LIMITED.has(eresult)) {
        this.setState('rate_limited');
        this.scheduleReconnect(30 * 60_000);
        return;
      }
      this.scheduleReconnect();
    });

    c.on('steamGuard', (_domain: string | null, callback: (code: string) => void, lastCodeWrong: boolean) => {
      // Only the account owner's own shared secret may answer Steam Guard. Never bypassed.
      if (this.opts.sharedSecret && !lastCodeWrong) {
        callback(SteamTotp.generateAuthCode(this.opts.sharedSecret));
        return;
      }
      this.lastError = 'Steam Guard code required';
      this.setState('auth_required');
      this.opts.log.error('Steam Guard code required. Run `npm run steam:login` interactively to create a refresh token.');
      this.stopping = true;
      c.logOff();
    });
  }

  private setState(s: GatewayState) {
    if (this.state !== s) {
      this.state = s;
      this.emit('stateChanged', s);
    }
  }

  getState(): GatewayState {
    return this.state;
  }

  getWebAuth(): WebAuth | null {
    return this.web;
  }

  botSteamId(): string | null {
    return this.client.steamID?.getSteamID64() ?? null;
  }

  logOn(): void {
    const token = readTokenFile(this.opts.tokenFile) ?? this.opts.refreshToken;
    this.setState('connecting');
    if (token) {
      this.client.logOn({ refreshToken: token, machineName: 'papis-deadlock-invites' });
    } else if (this.opts.accountName && this.opts.password) {
      this.client.logOn({ accountName: this.opts.accountName, password: this.opts.password, machineName: 'papis-deadlock-invites' });
    } else {
      this.setState('auth_required');
      throw new Error('No Steam credentials: set STEAM_REFRESH_TOKEN or run `npm run steam:login` (or set STEAM_ACCOUNT_NAME/STEAM_PASSWORD).');
    }
  }

  private scheduleReconnect(minDelayMs = 0) {
    if (this.reconnectTimer || this.stopping) return;
    this.reconnectAttempt++;
    const delay = Math.max(minDelayMs, Math.min(15 * 60_000, 10_000 * 2 ** (this.reconnectAttempt - 1)));
    this.opts.log.info('Reconnecting to Steam later', { delaySec: Math.round(delay / 1000) });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      try {
        this.logOn();
      } catch (err) {
        this.opts.log.error('Reconnect failed', { err });
      }
    }, delay);
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.client.gamesPlayed([]);
      this.client.logOff();
    } catch {
      // already disconnected
    }
    this.setState('offline');
  }

  isLoggedOn(): boolean {
    return this.state === 'online';
  }

  getRelationship(steamId: string): FriendRelationship {
    return (this.client.myFriends[steamId] ?? FriendRelationship.None) as FriendRelationship;
  }

  private addFriend(steamId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.addFriend(steamId, (err) => (err ? reject(err) : resolve()));
    });
  }

  acceptFriendRequest(steamId: string): Promise<void> {
    return this.addFriend(steamId);
  }

  sendFriendRequest(steamId: string): Promise<void> {
    return this.addFriend(steamId);
  }

  async removeFriend(steamId: string): Promise<void> {
    this.client.removeFriend(steamId);
  }
}
