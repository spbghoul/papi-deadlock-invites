import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from './auth';
import { getConfig } from './config';

export const ADMIN_COOKIE = 'ddi_admin';
export const SESSION_TTL_MS = 12 * 3600_000;

export function adminConfigured(): boolean {
  const cfg = getConfig();
  return !!cfg.ADMIN_PASSWORD_HASH && !!cfg.SESSION_SECRET;
}

export function cookieSecure(): boolean {
  const v = getConfig().COOKIE_SECURE;
  if (v !== undefined) return v === 'true' || v === '1';
  return getConfig().NODE_ENV === 'production';
}

export async function isAdmin(): Promise<boolean> {
  const secret = getConfig().SESSION_SECRET;
  if (!secret || !adminConfigured()) return false;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return verifySessionToken(token, secret);
}

/** Call at the top of every admin page and server action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect('/admin/login');
}
