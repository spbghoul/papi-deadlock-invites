import { describe, expect, it } from 'vitest';
import { createSessionToken, hashPassword, verifyPassword, verifySessionToken } from '../src/lib/auth';
import { matchesPhrase } from '../src/lib/phrase';
import { accountIdToSteamId64, isValidSteamId64, parseSteamInput, steamId64ToAccountId } from '../src/lib/steamid';
import { parseCommentsHtml } from '../src/worker/comments';
import { backoffMs } from '../src/worker/backoff';

describe('steamid', () => {
  it('converts between account id and SteamID64', () => {
    expect(accountIdToSteamId64(22202)).toBe('76561197960287930');
    expect(steamId64ToAccountId('76561197960287930')).toBe(22202);
    expect(isValidSteamId64('76561197960265728')).toBe(false); // account id 0
    expect(isValidSteamId64('7656119796028793')).toBe(false);
  });

  it('parses user input', () => {
    expect(parseSteamInput('76561197960287930')).toEqual({ kind: 'steamid', steamId: '76561197960287930' });
    expect(parseSteamInput('https://steamcommunity.com/profiles/76561197960287930/')).toEqual({ kind: 'steamid', steamId: '76561197960287930' });
    expect(parseSteamInput('steamcommunity.com/id/gaben')).toEqual({ kind: 'vanity', vanity: 'gaben' });
    expect(parseSteamInput('https://evil.com/id/gaben').kind).toBe('invalid');
    expect(parseSteamInput('').kind).toBe('invalid');
    expect(parseSteamInput('<script>').kind).toBe('invalid');
  });
});

describe('phrase matching', () => {
  it.each([
    ['thank you papi', true],
    ['Thank You Papi', true],
    ['  thank  you\n papi  ', true],
    ['THANK YOU PAPI!!', true],
    ['thank you papi.', true],
    ['thankyou papi', false],
    ['thank you papi pls', false],
    ['ok thank you papi', false],
    ['', false],
  ])('%j -> %s', (text, expected) => {
    expect(matchesPhrase(text, 'thank you papi')).toBe(expected);
  });
});

describe('comment HTML parser', () => {
  const html = `
    <div class="commentthread_comment responsive_body_text" id="comment_4100000000000000001">
      <div class="commentthread_comment_avatar playerAvatar online">
        <a href="https://steamcommunity.com/id/someone" data-miniprofile="22202"><img src="x.jpg"></a>
      </div>
      <div class="commentthread_comment_content">
        <div class="commentthread_comment_author">
          <a class="hoverunderline commentthread_author_link" href="https://steamcommunity.com/id/someone" data-miniprofile="22202"><bdi>Some One</bdi></a>
          <span class="commentthread_comment_timestamp" title="27 October @ 12:00pm" data-timestamp="1793102400">27 Oct</span>
        </div>
        <div class="commentthread_comment_text" id="comment_content_4100000000000000001">
          thank you<br>papi
        </div>
      </div>
    </div>
    <div class="commentthread_comment" id="comment_bad"><a class="commentthread_author_link" data-miniprofile="1"></a></div>
    <div class="commentthread_comment" id="comment_42"><div class="commentthread_comment_text">no author</div></div>`;

  it('extracts id, SteamID64, text and timestamp', () => {
    const comments = parseCommentsHtml(html);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: '4100000000000000001',
      authorSteamId: '76561197960287930',
      authorProfileUrl: 'https://steamcommunity.com/id/someone',
      authorName: 'Some One',
    });
    expect(matchesPhrase(comments[0]!.text, 'thank you papi')).toBe(true);
    expect(comments[0]!.postedAt?.getTime()).toBe(1793102400 * 1000);
  });
});

describe('auth', () => {
  it('hashes and verifies passwords', () => {
    const h = hashPassword('correct horse battery');
    expect(h).not.toContain('$');
    expect(verifyPassword('correct horse battery', h)).toBe(true);
    expect(verifyPassword('wrong password!!', h)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });

  it('signs and expires session tokens', () => {
    const secret = 'a'.repeat(40);
    const t = createSessionToken(secret, 1000, 0);
    expect(verifySessionToken(t, secret, 500)).toBe(true);
    expect(verifySessionToken(t, secret, 1500)).toBe(false);
    expect(verifySessionToken(t, 'b'.repeat(40), 500)).toBe(false);
    expect(verifySessionToken(t.replace(/^\d+/, '999999999'), secret, 500)).toBe(false);
  });
});

describe('backoff', () => {
  it('grows exponentially and is capped', () => {
    const noJitter = () => 0.5;
    expect(backoffMs(1, 1000, 100_000, noJitter)).toBe(1000);
    expect(backoffMs(3, 1000, 100_000, noJitter)).toBe(4000);
    expect(backoffMs(30, 1000, 100_000, noJitter)).toBe(100_000);
  });
});
