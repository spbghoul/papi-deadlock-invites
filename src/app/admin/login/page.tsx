import { redirect } from 'next/navigation';
import { adminConfigured, isAdmin } from '@/lib/adminSession';
import { loginAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin login · Papi’s Deadlock Invites', robots: { index: false } };

const ERRORS: Record<string, string> = {
  invalid: 'Wrong password.',
  rate_limited: 'Too many attempts. Wait 15 minutes.',
  not_configured: 'Admin is not configured. Set ADMIN_PASSWORD_HASH and SESSION_SECRET (npm run admin:hash-password).',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect('/admin');
  const { error } = await searchParams;
  const configured = adminConfigured();

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form action={loginAction} className="panel w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold uppercase tracking-wide">Admin</h1>
        <p className="mt-1 text-sm text-ink-400">Papi&rsquo;s control room</p>
        {(error || !configured) && (
          <p className="mt-5 rounded-md border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-sm text-red-200">
            {ERRORS[error ?? 'not_configured'] ?? 'Login failed.'}
          </p>
        )}
        <label htmlFor="password" className="mt-6 block text-xs font-semibold uppercase tracking-widest text-ink-300">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-2 w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2.5 focus:border-accent-500 focus:outline-none"
        />
        <button type="submit" disabled={!configured} className="mt-6 w-full rounded-md bg-accent-500 py-2.5 font-bold uppercase tracking-widest text-ink-950 transition hover:bg-accent-400 disabled:opacity-50">
          Sign in
        </button>
      </form>
    </main>
  );
}
