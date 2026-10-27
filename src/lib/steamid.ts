// SteamID64 of an individual account in the public universe = BASE + accountId.
const BASE = 76561197960265728n;
const MAX_ACCOUNT_ID = 0xffffffffn;

export function isValidSteamId64(value: string): boolean {
  if (!/^\d{17}$/.test(value)) return false;
  const accountId = BigInt(value) - BASE;
  return accountId > 0n && accountId <= MAX_ACCOUNT_ID;
}

export function accountIdToSteamId64(accountId: string | number): string {
  const n = BigInt(accountId);
  if (n <= 0n || n > MAX_ACCOUNT_ID) throw new Error(`Invalid Steam account id: ${accountId}`);
  return (BASE + n).toString();
}

export function steamId64ToAccountId(steamId: string): number {
  if (!isValidSteamId64(steamId)) throw new Error(`Invalid SteamID64: ${steamId}`);
  return Number(BigInt(steamId) - BASE);
}

export type ParsedSteamInput =
  | { kind: 'steamid'; steamId: string }
  | { kind: 'vanity'; vanity: string }
  | { kind: 'invalid'; reason: string };

const VANITY = /^[A-Za-z0-9_-]{2,32}$/;

/** Accepts a SteamID64, a /profiles/<id> URL, a /id/<vanity> URL or a bare vanity name. */
export function parseSteamInput(raw: string): ParsedSteamInput {
  const input = raw.trim();
  if (!input || input.length > 200) return { kind: 'invalid', reason: 'Enter a Steam profile URL or SteamID64.' };

  if (/^\d+$/.test(input)) {
    return isValidSteamId64(input)
      ? { kind: 'steamid', steamId: input }
      : { kind: 'invalid', reason: 'That number is not a valid SteamID64.' };
  }

  const urlMatch = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(input);
  if (urlMatch) {
    const [, type, value] = urlMatch;
    if (type!.toLowerCase() === 'profiles') {
      return isValidSteamId64(value!)
        ? { kind: 'steamid', steamId: value! }
        : { kind: 'invalid', reason: 'The profile URL does not contain a valid SteamID64.' };
    }
    return VANITY.test(value!) ? { kind: 'vanity', vanity: value! } : { kind: 'invalid', reason: 'Invalid custom profile URL.' };
  }

  if (VANITY.test(input)) return { kind: 'vanity', vanity: input };
  return { kind: 'invalid', reason: 'Enter a Steam profile URL (steamcommunity.com/...) or SteamID64.' };
}
