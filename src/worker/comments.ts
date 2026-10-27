import * as cheerio from 'cheerio';
import type { Logger } from '../lib/logger';
import { accountIdToSteamId64 } from '../lib/steamid';
import type { ProfileComment } from './gateway';

export class SteamRateLimitError extends Error {}

/** Parses the `comments_html` fragment returned by steamcommunity.com/comment/Profile/render/... */
export function parseCommentsHtml(html: string): ProfileComment[] {
  const $ = cheerio.load(html);
  const out: ProfileComment[] = [];
  $('.commentthread_comment').each((_, el) => {
    const $el = $(el);
    const idMatch = /^comment_(\d+)$/.exec($el.attr('id') ?? '');
    if (!idMatch) return;

    const author = $el.find('.commentthread_author_link').first();
    const mini = author.attr('data-miniprofile') ?? $el.find('[data-miniprofile]').first().attr('data-miniprofile');
    if (!mini || !/^\d{1,10}$/.test(mini)) return;
    let steamId: string;
    try {
      steamId = accountIdToSteamId64(mini);
    } catch {
      return;
    }

    const textEl = $el.find('.commentthread_comment_text').first();
    textEl.find('br').replaceWith(' ');
    const ts = $el.find('.commentthread_comment_timestamp').first().attr('data-timestamp');
    const href = author.attr('href');

    out.push({
      id: idMatch[1]!,
      authorSteamId: steamId,
      authorProfileUrl: href && /^https:\/\/steamcommunity\.com\//.test(href) ? href : null,
      authorName: author.text().trim() || null,
      text: textEl.text().trim(),
      postedAt: ts && /^\d+$/.test(ts) ? new Date(Number(ts) * 1000) : null,
    });
  });
  return out;
}

export interface WebAuth {
  sessionId: string;
  cookies: string[];
}

const PAGE_SIZE = 50;
const MAX_PAGES = 4;

/** Reads comments from the bot's own profile through the Steam Community comment endpoint. */
export class SteamCommentSource {
  constructor(
    private readonly getAuth: () => WebAuth | null,
    private readonly log: Logger,
  ) {}

  private async fetchPage(profileSteamId: string, start: number): Promise<ProfileComment[]> {
    const auth = this.getAuth();
    const body = new URLSearchParams({ start: String(start), count: String(PAGE_SIZE), feature2: '-1' });
    if (auth) body.set('sessionid', auth.sessionId);
    const res = await fetch(`https://steamcommunity.com/comment/Profile/render/${profileSteamId}/-1/`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (compatible; PapisDeadlockInvites/1.0)',
        ...(auth ? { Cookie: auth.cookies.join('; ') } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) throw new SteamRateLimitError('Steam Community rate limit (HTTP 429)');
    if (!res.ok) throw new Error(`Comment fetch failed: HTTP ${res.status}`);
    const json = (await res.json()) as { success?: boolean; comments_html?: string };
    if (!json.success || typeof json.comments_html !== 'string') throw new Error('Comment fetch returned success=false');
    return parseCommentsHtml(json.comments_html);
  }

  /** Newest-first pages until a page contains an already-known comment (max MAX_PAGES pages). */
  async fetchRecent(profileSteamId: string, isKnown: (ids: string[]) => Promise<Set<string>>): Promise<ProfileComment[]> {
    const all: ProfileComment[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const comments = await this.fetchPage(profileSteamId, page * PAGE_SIZE);
      all.push(...comments);
      if (comments.length < PAGE_SIZE) break;
      const known = await isKnown(comments.map((c) => c.id));
      if (known.size > 0) break;
    }
    this.log.debug('Fetched profile comments', { count: all.length });
    return all;
  }
}
