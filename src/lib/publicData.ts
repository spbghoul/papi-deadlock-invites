import type { Kysely } from 'kysely';
import type { DB } from './db/schema';
import { getPublicStats, getWorkerStatus, isBotOnline } from './repo';

export interface StatsPayload {
  invitesSent: number;
  pending: number;
  bot: { online: boolean; inviteAutomation: boolean; lastSeen: string | null };
}

/** Only real database counts and the worker's real heartbeat. */
export async function getStatsPayload(db: Kysely<DB>): Promise<StatsPayload> {
  const [stats, worker] = await Promise.all([getPublicStats(db), getWorkerStatus(db)]);
  const online = isBotOnline(worker);
  return {
    ...stats,
    bot: {
      online,
      inviteAutomation: online && worker?.provider === 'deadlock-gc' && worker.provider_available === 1,
      lastSeen: worker?.updated_at ?? null,
    },
  };
}
