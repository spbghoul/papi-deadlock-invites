'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { AdminOpError, applyAdminOp, blockSteamId, setPaused, setRemovalDelay, unblockSteamId, type AdminOp } from '@/lib/adminOps';
import { ADMIN_COOKIE, adminConfigured, cookieSecure, requireAdmin, SESSION_TTL_MS } from '@/lib/adminSession';
import { createSessionToken, verifyPassword } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { clientIp, limiter } from '@/lib/rateLimit';
import { parseSteamInput } from '@/lib/steamid';

const OPS: AdminOp[] = ['retry', 'approve', 'reject', 'mark_sent'];

function back(msg: string, params = ''): never {
  redirect(`/admin?msg=${encodeURIComponent(msg)}${params}`);
}

export async function loginAction(formData: FormData) {
  const cfg = getConfig();
  if (!adminConfigured()) redirect('/admin/login?error=not_configured');
  const ip = clientIp(await headers(), cfg.TRUST_PROXY);
  if (!limiter('admin-login', 5, 15 * 60_000).check(ip).ok) redirect('/admin/login?error=rate_limited');

  const password = String(formData.get('password') ?? '');
  if (!password || password.length > 200 || !verifyPassword(password, cfg.ADMIN_PASSWORD_HASH!)) {
    redirect('/admin/login?error=invalid');
  }
  (await cookies()).set(ADMIN_COOKIE, createSessionToken(cfg.SESSION_SECRET!, SESSION_TTL_MS), {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure(),
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect('/admin');
}

export async function logoutAction() {
  (await cookies()).delete(ADMIN_COOKIE);
  redirect('/admin/login');
}

export async function requestAction(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('id'));
  const op = String(formData.get('op')) as AdminOp;
  const keep = String(formData.get('keep') ?? '');
  if (!Number.isInteger(id) || id <= 0 || !OPS.includes(op)) back('Invalid action');
  let msg: string;
  try {
    msg = await applyAdminOp(await getDb(), id, op);
  } catch (err) {
    msg = err instanceof AdminOpError ? err.message : 'Action failed';
  }
  revalidatePath('/admin');
  back(msg, /^(&(status|page|q)=[\w%.+-]*)*$/.test(keep) ? keep : '');
}

export async function pauseAction(formData: FormData) {
  await requireAdmin();
  const paused = formData.get('paused') === 'true';
  await setPaused(await getDb(), paused);
  revalidatePath('/admin');
  back(paused ? 'Automation paused' : 'Automation resumed');
}

export async function removalDelayAction(formData: FormData) {
  await requireAdmin();
  const seconds = Number(formData.get('seconds'));
  let msg = `Removal delay set to ${seconds}s`;
  try {
    await setRemovalDelay(await getDb(), seconds);
  } catch (err) {
    msg = err instanceof AdminOpError ? err.message : 'Could not save setting';
  }
  revalidatePath('/admin');
  back(msg);
}

export async function blockAction(formData: FormData) {
  await requireAdmin();
  const parsed = parseSteamInput(String(formData.get('steamId') ?? ''));
  if (parsed.kind !== 'steamid') back('Enter a SteamID64 (or a /profiles/ URL) to block');
  let msg = `Blocked ${parsed.steamId}`;
  try {
    await blockSteamId(await getDb(), parsed.steamId, String(formData.get('reason') ?? '') || null);
  } catch (err) {
    msg = err instanceof AdminOpError ? err.message : 'Could not block';
  }
  revalidatePath('/admin');
  back(msg);
}

export async function unblockAction(formData: FormData) {
  await requireAdmin();
  const steamId = String(formData.get('steamId') ?? '');
  await unblockSteamId(await getDb(), steamId);
  revalidatePath('/admin');
  back(`Unblocked ${steamId}`);
}
