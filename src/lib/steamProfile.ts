import { isValidSteamId64 } from './steamid';

// Public Steam Community XML profile endpoint (no API key needed).
const cache = new Map<string, { value: unknown; expires: number }>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 5000) cache.clear();
  return value;
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'PapisDeadlockInvites/1.0' } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const cdata = (xml: string, tag: string) =>
  new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`).exec(xml)?.slice(1).find((v) => v !== undefined)?.trim() ?? null;

/** Resolves a custom URL (vanity) to a SteamID64, or null if it does not exist. */
export function resolveVanity(vanity: string): Promise<string | null> {
  return cached(`vanity:${vanity.toLowerCase()}`, 10 * 60_000, async () => {
    const xml = await fetchXml(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`);
    const id = xml ? cdata(xml, 'steamID64') : null;
    return id && isValidSteamId64(id) ? id : null;
  });
}

export interface ProfileSummary {
  name: string | null;
  avatarUrl: string | null;
}

export function getProfileSummary(profileUrl: string): Promise<ProfileSummary> {
  return cached(`summary:${profileUrl}`, 60 * 60_000, async () => {
    if (!/^https:\/\/steamcommunity\.com\/(id|profiles)\/[^/?#]+\/?$/.test(profileUrl)) return { name: null, avatarUrl: null };
    const xml = await fetchXml(`${profileUrl.replace(/\/$/, '')}/?xml=1`);
    if (!xml) return { name: null, avatarUrl: null };
    const avatar = cdata(xml, 'avatarFull');
    return { name: cdata(xml, 'steamID'), avatarUrl: avatar?.startsWith('https://') ? avatar : null };
  });
}
