import Link from 'next/link';
import { blockedList, dashboardOverview, listRequests, PAGE_SIZE, recentEvents } from '@/lib/adminQueries';
import type { AdminOp } from '@/lib/adminOps';
import { requireAdmin } from '@/lib/adminSession';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { isRequestStatus, REQUEST_STATUSES, type RequestStatus } from '@/lib/statuses';
import { blockAction, logoutAction, pauseAction, removalDelayAction, requestAction, unblockAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin · Papi’s Deadlock Invites', robots: { index: false } };

const ACTIONS: Partial<Record<RequestStatus, { op: AdminOp; label: string; tone: 'primary' | 'blood' | 'plain' }[]>> = {
  waiting_friendship: [{ op: 'reject', label: 'Reject', tone: 'blood' }],
  invite_pending: [{ op: 'reject', label: 'Reject', tone: 'blood' }],
  awaiting_manual: [
    { op: 'mark_sent', label: 'Mark sent', tone: 'primary' },
    { op: 'reject', label: 'Reject', tone: 'blood' },
  ],
  needs_review: [
    { op: 'mark_sent', label: 'Was sent', tone: 'primary' },
    { op: 'retry', label: 'Not sent · retry', tone: 'plain' },
    { op: 'reject', label: 'Reject', tone: 'blood' },
  ],
  failed: [
    { op: 'retry', label: 'Retry', tone: 'primary' },
    { op: 'reject', label: 'Reject', tone: 'blood' },
  ],
  expired: [
    { op: 'retry', label: 'Retry', tone: 'primary' },
    { op: 'reject', label: 'Reject', tone: 'blood' },
  ],
  cancelled: [{ op: 'retry', label: 'Retry', tone: 'primary' }],
  rejected: [{ op: 'approve', label: 'Approve', tone: 'primary' }],
};

const STATUS_COLOR: Record<RequestStatus, string> = {
  waiting_friendship: 'bg-sky-500/15 text-sky-300',
  invite_pending: 'bg-amber-500/15 text-amber-300',
  inviting: 'bg-amber-500/25 text-amber-200',
  awaiting_manual: 'bg-violet-500/15 text-violet-300',
  needs_review: 'bg-fuchsia-500/20 text-fuchsia-200',
  invite_sent: 'bg-emerald-500/15 text-emerald-300',
  completed: 'bg-emerald-500/25 text-emerald-200',
  failed: 'bg-red-500/15 text-red-300',
  rejected: 'bg-zinc-500/20 text-zinc-300',
  expired: 'bg-zinc-500/15 text-zinc-400',
  cancelled: 'bg-zinc-500/15 text-zinc-400',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }) : '—');

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; msg?: string; errors?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const status = sp.status && isRequestStatus(sp.status) ? sp.status : undefined;
  const q = sp.q?.trim().slice(0, 64) || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const errorsOnly = sp.errors === '1';

  const cfg = getConfig();
  const db = await getDb();
  const [overview, requests, events, blocked] = await Promise.all([
    dashboardOverview(db, cfg.REMOVAL_DELAY_SECONDS),
    listRequests(db, { status, q, page }),
    recentEvents(db, { errorsOnly, limit: 150 }),
    blockedList(db),
  ]);
  const { worker, online, settings, counts, perf } = overview;
  const keep = `${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${page > 1 ? `&page=${page}` : ''}`;
  const pages = Math.max(1, Math.ceil(requests.total / PAGE_SIZE));
  const qs = (p: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, q, ...p })) if (v) params.set(k, v);
    return `/admin?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold uppercase tracking-wide">Control room</h1>
          <p className="text-sm text-ink-400">Papi&rsquo;s Deadlock Invites · admin</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-ink-300 hover:text-bone">
            View site
          </Link>
          <form action={logoutAction}>
            <button className="rounded-md border border-ink-600 px-3 py-1.5 text-sm hover:border-ink-400">Log out</button>
          </form>
        </div>
      </header>

      {sp.msg && <p className="mt-6 rounded-md border border-accent-500/30 bg-accent-500/10 px-4 py-2.5 text-sm text-accent-300">{sp.msg.slice(0, 300)}</p>}

      {/* Bot + controls */}
      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="panel rounded-lg p-5 lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-300">Bot connection</h2>
          <div className="mt-3 flex items-center gap-3">
            <span className={`size-3 rounded-full ${online ? 'bg-moss-400' : 'bg-blood-500'}`} />
            <span className="text-2xl font-bold">{online ? 'ONLINE' : 'OFFLINE'}</span>
            <span className="text-sm text-ink-400">state: {worker?.state ?? 'never started'}</span>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row k="Bot SteamID" v={worker?.bot_steam_id ?? '—'} />
            <Row k="Heartbeat" v={fmt(worker?.updated_at ?? null)} />
            <Row k="Invite provider" v={`${worker?.provider ?? '—'} · ${worker?.provider_available ? 'available' : 'unavailable'}`} />
            <Row k="Provider detail" v={worker?.provider_detail ?? '—'} />
            <Row k="Last comment poll" v={fmt(worker?.last_comment_poll_at ?? null)} />
            <Row k="Worker started" v={fmt(worker?.started_at ?? null)} />
            {worker?.last_error && <Row k="Last Steam error" v={worker.last_error} danger />}
          </dl>
        </div>

        <div className="panel space-y-5 rounded-lg p-5">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-300">Automation</h2>
            <form action={pauseAction} className="mt-3 flex items-center justify-between gap-3">
              <span className={`text-xl font-bold ${settings.paused ? 'text-amber-300' : 'text-moss-400'}`}>{settings.paused ? 'PAUSED' : 'RUNNING'}</span>
              <input type="hidden" name="paused" value={settings.paused ? 'false' : 'true'} />
              <button className={`rounded-md px-4 py-2 text-sm font-semibold ${settings.paused ? 'bg-moss-400 text-ink-950' : 'bg-amber-400 text-ink-950'}`}>
                {settings.paused ? 'Resume' : 'Pause'}
              </button>
            </form>
          </div>
          <form action={removalDelayAction}>
            <label htmlFor="seconds" className="text-xs font-semibold uppercase tracking-widest text-ink-300">
              Friend removal delay (seconds)
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="seconds"
                name="seconds"
                type="number"
                min={0}
                max={604800}
                defaultValue={settings.removalDelaySeconds}
                className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2"
              />
              <button className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-ink-950">Save</button>
            </div>
          </form>
        </div>
      </section>

      {/* Metrics */}
      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="Sent total" value={counts.invite_sent + counts.completed} accent />
        <Metric label="Sent 24h" value={perf.sent24h} />
        <Metric label="Sent 1h" value={perf.sentHour} />
        <Metric label="Attempts 24h" value={perf.attempts24h} />
        <Metric label="Comments 24h" value={perf.comments24h} />
        <Metric label="Errors 24h" value={perf.errors24h} danger={perf.errors24h > 0} />
        <Metric label="Needs review" value={counts.needs_review + counts.awaiting_manual} danger={counts.needs_review > 0} />
        <Metric label="Avg to invite" value={perf.avgMinutesToInvite === null ? '—' : `${perf.avgMinutesToInvite}m`} />
      </section>

      {/* Requests */}
      <section className="panel mt-6 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold uppercase">Invite requests</h2>
          <form className="flex gap-2" action="/admin">
            {status && <input type="hidden" name="status" value={status} />}
            <input name="q" defaultValue={q} placeholder="SteamID or name" className="rounded-md border border-ink-600 bg-ink-950 px-3 py-1.5 text-sm" />
            <button className="rounded-md border border-ink-600 px-3 py-1.5 text-sm">Search</button>
          </form>
        </div>
        <nav className="mt-4 flex flex-wrap gap-1.5 text-xs">
          <FilterChip href={qs({ status: undefined, page: undefined })} active={!status} label={`all`} />
          {REQUEST_STATUSES.map((s) => (
            <FilterChip key={s} href={`/admin?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ''}`} active={status === s} label={`${s} (${counts[s]})`} />
          ))}
        </nav>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-ink-400">
              <tr className="border-b border-white/5">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Tries</th>
                <th className="py-2 pr-3">Last error</th>
                <th className="py-2 pr-3">Updated</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-400">
                    No requests.
                  </td>
                </tr>
              )}
              {requests.rows.map((r) => (
                <tr key={r.id} className="border-b border-white/5 align-top hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-3 text-ink-400">{r.id}</td>
                  <td className="py-2.5 pr-3">
                    <a href={r.profile_url ?? `https://steamcommunity.com/profiles/${r.steam_id}`} target="_blank" rel="noopener noreferrer" className="hover:text-accent-300">
                      {r.persona_name ?? 'unknown'}
                    </a>
                    <div className="font-mono text-xs text-ink-400">{r.steam_id}</div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                    {r.provider && <div className="mt-1 text-xs text-ink-400">{r.provider}</div>}
                  </td>
                  <td className="py-2.5 pr-3">{r.attempts}</td>
                  <td className="max-w-xs py-2.5 pr-3 text-xs text-red-200/80">
                    {r.last_error ?? ''}
                    {r.status === 'invite_pending' && r.next_attempt_at && <div className="text-ink-400">next: {fmt(r.next_attempt_at)}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-ink-300">{fmt(r.updated_at)}</td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {(ACTIONS[r.status] ?? []).map((a) => (
                        <form key={a.op} action={requestAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="op" value={a.op} />
                          <input type="hidden" name="keep" value={keep} />
                          <button
                            className={`rounded px-2.5 py-1 text-xs font-semibold ${
                              a.tone === 'primary' ? 'bg-accent-500 text-ink-950' : a.tone === 'blood' ? 'bg-blood-600/80 text-white' : 'border border-ink-600'
                            }`}
                          >
                            {a.label}
                          </button>
                        </form>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-ink-400">
          <span>
            {requests.total} total · page {page}/{pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && <Link href={qs({ page: String(page - 1) })}>← Prev</Link>}
            {page < pages && <Link href={qs({ page: String(page + 1) })}>Next →</Link>}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Events */}
        <div className="panel rounded-lg p-5 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold uppercase">Events & errors</h2>
            <Link href={errorsOnly ? '/admin' : '/admin?errors=1'} className="text-xs text-accent-400">
              {errorsOnly ? 'Show all' : 'Errors only'}
            </Link>
          </div>
          <ul className="mt-4 max-h-[520px] space-y-1 overflow-y-auto font-mono text-xs">
            {events.map((e) => (
              <li key={e.id} className="grid grid-cols-[auto_auto_1fr] gap-3 border-b border-white/5 py-1.5">
                <span className="text-ink-400">{fmt(e.timestamp)}</span>
                <span className={/error|failed|uncertain|rejected|offline/.test(e.event_type) ? 'text-red-300' : 'text-accent-300'}>{e.event_type}</span>
                <span className="break-words text-ink-300">
                  {e.steam_id && <span className="text-ink-400">{e.steam_id} · </span>}
                  {e.description}
                </span>
              </li>
            ))}
            {events.length === 0 && <li className="text-ink-400">No events yet.</li>}
          </ul>
        </div>

        {/* Blocked */}
        <div className="panel rounded-lg p-5 lg:col-span-2">
          <h2 className="text-xl font-bold uppercase">Blocked SteamIDs</h2>
          <form action={blockAction} className="mt-4 space-y-2">
            <input name="steamId" required placeholder="SteamID64 or /profiles/ URL" className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <input name="reason" placeholder="Reason (optional)" maxLength={300} className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 text-sm" />
              <button className="rounded-md bg-blood-600 px-4 py-2 text-sm font-semibold text-white">Block</button>
            </div>
          </form>
          <ul className="mt-4 max-h-[400px] space-y-1 overflow-y-auto text-sm">
            {blocked.map((b) => (
              <li key={b.steam_id} className="flex items-center justify-between gap-2 border-b border-white/5 py-1.5">
                <div className="min-w-0">
                  <div className="font-mono text-xs">{b.steam_id}</div>
                  {b.reason && <div className="truncate text-xs text-ink-400">{b.reason}</div>}
                </div>
                <form action={unblockAction}>
                  <input type="hidden" name="steamId" value={b.steam_id} />
                  <button className="text-xs text-accent-400 hover:text-accent-300">Unblock</button>
                </form>
              </li>
            ))}
            {blocked.length === 0 && <li className="text-ink-400">Nobody is blocked.</li>}
          </ul>
        </div>
      </section>
    </main>
  );
}

function Row({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-ink-400">{k}:</dt>
      <dd className={`break-all ${danger ? 'text-red-300' : ''}`}>{v}</dd>
    </div>
  );
}

function Metric({ label, value, accent, danger }: { label: string; value: number | string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="panel rounded-lg p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-white' : danger ? 'text-red-300' : ''}`}>{value}</div>
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={`rounded-full border px-3 py-1 ${active ? 'border-accent-500 bg-accent-500/15 text-accent-300' : 'border-ink-600 text-ink-300 hover:border-ink-400'}`}>
      {label}
    </Link>
  );
}
