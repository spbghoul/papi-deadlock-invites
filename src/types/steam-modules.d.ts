// Minimal typings for the parts of steam-user / steam-totp this project uses.

declare module 'steam-user' {
  import { EventEmitter } from 'node:events';

  interface SteamID {
    getSteamID64(): string;
  }

  interface LogOnDetails {
    refreshToken?: string;
    accountName?: string;
    password?: string;
    twoFactorCode?: string;
    machineName?: string;
  }

  interface SteamUserOptions {
    autoRelogin?: boolean;
    renewRefreshTokens?: boolean;
    dataDirectory?: string | null;
    machineIdType?: number;
  }

  class SteamUser extends EventEmitter {
    constructor(options?: SteamUserOptions);
    static EPersonaState: { Offline: 0; Online: 1; Busy: 2; Away: 3; Snooze: 4; LookingToTrade: 5; LookingToPlay: 6; Invisible: 7 };
    static EResult: Record<string, number> & Record<number, string>;
    steamID: SteamID | null;
    myFriends: Record<string, number>;
    logOn(details: LogOnDetails): void;
    logOff(): void;
    setPersona(state: number, name?: string): void;
    gamesPlayed(apps: number[] | number): void;
    addFriend(steamID: string, callback?: (err: Error | null, personaName?: string) => void): void;
    removeFriend(steamID: string): void;
    sendToGC(
      appid: number,
      msgType: number,
      protoBufHeader: Record<string, unknown> | null,
      payload: Buffer,
      callback?: (appid: number, msgType: number, payload: Buffer) => void,
    ): void;
  }

  export = SteamUser;
}

declare module 'steam-totp' {
  export function generateAuthCode(sharedSecret: string, timeOffset?: number): string;
}
