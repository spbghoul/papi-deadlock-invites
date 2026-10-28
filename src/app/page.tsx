import { HomeClient } from '@/components/HomeClient';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { getLocale } from '@/lib/locale';
import { getStatsPayload, type StatsPayload } from '@/lib/publicData';
import { getProfileSummary } from '@/lib/steamProfile';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const cfg = getConfig();
  let initialStats: StatsPayload | null = null;
  try {
    initialStats = await getStatsPayload(await getDb());
  } catch {
    initialStats = null;
  }
  const [initialLocale, bot] = await Promise.all([getLocale(), getProfileSummary(cfg.BOT_PROFILE_URL)]);

  return (
    <HomeClient
      initialLocale={initialLocale}
      englishPhrase={cfg.COMMENT_PHRASE}
      profileUrl={cfg.BOT_PROFILE_URL}
      sourceUrl={cfg.SOURCE_CODE_URL}
      bot={bot}
      initialStats={initialStats}
    />
  );
}
