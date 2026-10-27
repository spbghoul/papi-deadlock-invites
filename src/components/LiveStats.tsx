'use client';

import { useEffect, useState } from 'react';
import type { StatsPayload } from '@/lib/publicData';

export function LiveStats({ initial }: { initial: StatsPayload | null }) {
  const [stats, setStats] = useState<StatsPayload | null>(initial);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/stats', { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as StatsPayload;
        if (alive) {
          setStats(data);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString('en-US'));
  const online = stats?.bot.online ?? false;

  // SteamDB-style key/value table.
  return (
    <div className="panel overflow-hidden">
      <table className="w-full text-[13px]">
        <tbody className="zebra">
          <tr>
            <th className="w-1/2 px-4 py-2.5 text-left font-normal text-ink-400">Invitations sent</th>
            <td className="px-4 py-2.5 text-right font-mono text-xl text-white tabular-nums">{fmt(stats?.invitesSent)}</td>
          </tr>
          <tr>
            <th className="px-4 py-2.5 text-left font-normal text-ink-400">Invitations pending</th>
            <td className="px-4 py-2.5 text-right font-mono text-xl text-white tabular-nums">{fmt(stats?.pending)}</td>
          </tr>
          <tr>
            <th className="px-4 py-2.5 text-left font-normal text-ink-400">Bot status</th>
            <td className="px-4 py-2.5 text-right">
              <span className={`inline-flex items-center gap-2 ${online ? 'text-online' : 'text-ink-400'}`}>
                <span className={`size-2 rounded-full ${online ? 'bg-online' : 'bg-ink-500'}`} />
                {stats ? (online ? 'Online' : 'Offline') : '—'}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="border-t border-black/30 px-4 py-2 text-[11px] text-ink-400">
        {error ? 'Could not refresh stats.' : stats?.bot.online && !stats.bot.inviteAutomation ? 'Invites are sent with manual review.' : 'Live from the database and bot heartbeat. Refreshes every 30s.'}
      </p>
    </div>
  );
}
