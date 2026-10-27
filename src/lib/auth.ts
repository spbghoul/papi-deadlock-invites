import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Format: scrypt:<saltB64url>:<hashB64url>  (no "$", so it is safe in .env / docker compose files)
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  if (password.length < 10) throw new Error('Admin password must be at least 10 characters');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length);
  return expected.length === KEY_LEN && timingSafeEqual(expected, actual);
}

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function createSessionToken(secret: string, ttlMs: number, now = Date.now()): string {
  const payload = `${now + ttlMs}.${randomBytes(8).toString('base64url')}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts as [string, string, string];
  const expected = Buffer.from(sign(`${exp}.${nonce}`, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(exp) > now;
}
