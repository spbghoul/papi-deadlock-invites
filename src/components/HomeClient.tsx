'use client';

import { useState } from 'react';
import { CopyPhrase } from '@/components/CopyPhrase';
import { LanguagePicker } from '@/components/LanguagePicker';
import { LiveStats } from '@/components/LiveStats';
import { StatusChecker } from '@/components/StatusChecker';
import { DICTS, LOCALE_COOKIE, phraseFor, type Locale } from '@/lib/i18n';
import type { StatsPayload } from '@/lib/publicData';

export interface HomeData {
  initialLocale: Locale;
  englishPhrase: string;
  profileUrl: string;
  sourceUrl: string | undefined;
  bot: { name: string | null; avatarUrl: string | null };
  initialStats: StatsPayload | null;
}

/** Turns https:// URLs inside translated text into links. */
function linkify(text: string) {
  return text.split(/(https:\/\/[^\s)]+)/g).map((part, i) =>
    part.startsWith('https://') ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part.replace(/^https:\/\//, '')}
      </a>
    ) : (
      part
    ),
  );
}

/**
 * The whole public page. All translations ship with the page, so switching language is instant
 * (no reload, no server round trip); the choice is stored in a cookie for the next visit.
 */
export function HomeClient({ initialLocale, englishPhrase, profileUrl, sourceUrl, bot, initialStats }: HomeData) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const t = DICTS[locale];
  const phrase = phraseFor(locale, englishPhrase);
  const online = initialStats?.bot.online ?? false;

  const changeLocale = (next: Locale) => {
    setLocale(next);
    document.documentElement.lang = next;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  const steps = [
    {
      title: t.steps.openProfile,
      body: (
        <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5">
          {profileUrl.replace(/^https:\/\//, '')}
        </a>
      ),
    },
    { title: t.steps.leaveComment, body: <CopyPhrase phrase={phrase} copyLabel={t.copy} copiedLabel={t.copied} /> },
    { title: t.steps.addFriend, body: <span>{t.steps.addFriendBody}</span> },
    { title: t.steps.receive, body: <span>{t.steps.receiveBody}</span> },
    { title: t.steps.enjoy, body: <span>{t.steps.enjoyBody}</span> },
  ];

  return (
    <>
      {/* Global header bar */}
      <header className="bg-ink-900 shadow-[0_1px_0_rgba(0,0,0,0.5)]">
        <div className="mx-auto flex site-col max-w-[1100px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <a href="#" className="flex items-center gap-2.5 text-bone no-underline hover:text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="" width={28} height={28} className="size-7 rounded-full ring-1 ring-[#3a8fc4]" />
            <span className="text-[15px] font-bold uppercase tracking-wide">Papi&rsquo;s Deadlock Invites</span>
          </a>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <nav className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] uppercase tracking-wide">
              {[
                ['#how-it-works', t.nav.how],
                ['#stats', t.nav.stats],
                ['#status', t.nav.status],
                ['#faq', t.nav.faq],
              ].map(([href, label]) => (
                <a key={href} href={href} className="py-2 text-[#b8b6b4] no-underline hover:text-white sm:py-0">
                  {label}
                </a>
              ))}
            </nav>
            <LanguagePicker current={locale} label={t.language} onChange={changeLocale} />
          </div>
        </div>
      </header>

      <main className="mx-auto site-col max-w-[1100px] px-4 pb-16">
        {/* Breadcrumb + title, like a store app page */}
        <div className="pt-6 text-xs text-ink-400">
          {t.breadcrumb.all} &gt; {t.breadcrumb.action} &gt; <span className="text-accent-500">Deadlock</span> &gt; {t.breadcrumb.invites}
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[26px] font-normal leading-tight text-white">Papi&rsquo;s Deadlock Invites</h1>
          <span className="pb-1 text-sm text-ink-300">{t.tagline}</span>
        </div>

        {/* App header: capsule + info box */}
        <section className="mt-4 grid gap-3 md:grid-cols-[1fr_360px]">
          <div className="relative overflow-hidden rounded-sm bg-[linear-gradient(135deg,#0f1922_0%,#1f3447_45%,#13202c_100%)] p-6 shadow-[0_0_6px_rgba(0,0,0,0.5)]">
            <div aria-hidden className="absolute -right-10 -top-16 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(102,192,244,0.25),transparent)]" />
            {/* Papi sketch: inverted + screen blend so the white paper vanishes into the dark banner. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/papi.png"
              alt="Papi"
              width={366}
              height={210}
              className="pointer-events-none absolute -right-2 bottom-0 hidden w-[42%] max-w-[300px] opacity-90 mix-blend-screen invert [mask-image:linear-gradient(to_right,transparent,black_22%)] sm:block"
            />
            <p className="relative text-xs uppercase tracking-[0.3em] text-ink-400">{t.playtestAccess}</p>
            <p className="relative mt-3 text-4xl font-bold uppercase leading-none tracking-tight text-white sm:text-5xl">Deadlock</p>
            <p className="relative mt-3 max-w-md text-[15px] leading-relaxed text-bone sm:max-w-[58%]">{t.heroText}</p>
            <ul className="relative mt-5 flex flex-wrap gap-1.5 text-xs sm:max-w-[58%]">
              {t.chips.map((c) => (
                <li key={c} className="rounded-sm bg-[rgba(103,193,245,0.2)] px-2 py-1 text-accent-500">
                  {c}
                </li>
              ))}
            </ul>
          </div>

          <aside className="rounded-sm bg-black/25 p-4 text-[13px]">
            <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 no-underline">
              {bot.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bot.avatarUrl} alt="" width={64} height={64} className={`size-16 rounded-sm border-2 ${online ? 'border-online' : 'border-ink-500'}`} />
              ) : (
                <div className="grid size-16 place-items-center rounded-sm border-2 border-ink-500 bg-ink-700 text-2xl text-white">P</div>
              )}
              <div className="min-w-0">
                <div className="truncate text-lg text-white">{bot.name ?? 'Papi'}</div>
                <div className={online ? 'text-online' : 'text-ink-400'}>{online ? t.online : t.offline}</div>
              </div>
            </a>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="uppercase text-ink-400">{t.comment}</dt>
              <dd className="text-accent-500">&ldquo;{phrase}&rdquo;</dd>
              <dt className="uppercase text-ink-400">{t.price}</dt>
              <dd className="text-bone">{t.free}</dd>
              <dt className="uppercase text-ink-400">{t.sent}</dt>
              <dd className="text-bone">{initialStats ? initialStats.invitesSent.toLocaleString('en-US') : '—'}</dd>
            </dl>
            <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="btn-blue mt-4 w-full">
              {t.viewProfile}
            </a>
          </aside>
        </section>

        {/* Purchase area */}
        <section className="purchase-area relative mt-6 px-4 pb-10 pt-4 sm:px-5">
          <h2 className="text-[21px] text-white">{t.purchaseTitle}</h2>
          <p className="mt-1 text-[13px] text-bone">{t.purchaseText(phrase)}</p>
          <div className="absolute -bottom-4 right-4 flex items-stretch rounded-sm bg-black p-0.5 sm:right-5">
            <span className="flex items-center px-3 text-[13px] text-bone">{t.free}</span>
            <a href="#how-it-works" className="btn-green">
              {t.getInvite}
            </a>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mt-14 scroll-mt-6">
          <h2 className="block-header">{t.howItWorks}</h2>
          <ol className="zebra mt-3 overflow-hidden rounded-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-4 px-4 py-3.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm bg-ink-700 text-sm font-bold text-white">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] text-white">{s.title}</h3>
                  <div className="mt-1 text-[13px] text-ink-300">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-12 grid gap-10 md:grid-cols-[1fr_1fr]">
          {/* Stats */}
          <section id="stats" className="scroll-mt-6">
            <h2 className="block-header">{t.liveStats}</h2>
            <div className="mt-3">
              <LiveStats initial={initialStats} t={t.stats} online={t.online} offline={t.offline} />
            </div>
          </section>

          {/* Status */}
          <section id="status" className="scroll-mt-6">
            <h2 className="block-header">{t.requestStatus}</h2>
            <div className="mt-3">
              <StatusChecker t={t.status} dateLocale={locale} />
            </div>
          </section>
        </div>

        {/* FAQ */}
        <section id="faq" className="mt-12 scroll-mt-6">
          <h2 className="block-header">{t.faqTitle}</h2>
          <div className="zebra mt-3 overflow-hidden rounded-sm">
            {t.faq(phrase, sourceUrl).map((f, i) => (
              <details key={i} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] text-accent-500 hover:text-white">
                  {f.q}
                  <span aria-hidden className="text-ink-400 transition group-open:rotate-90">&#9656;</span>
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{linkify(f.a)}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="bg-ink-900 py-8 text-[12px] text-ink-400">
        <div className="mx-auto site-col max-w-[1100px] border-t border-ink-700 px-4 pt-5">
          <p>{t.footerIndependent}</p>
          <p className="mt-1">{t.footerTrademarks}</p>
          {sourceUrl && (
            <p className="mt-3">
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5">
                {t.sourceCode}
              </a>{' '}
              · MIT license
            </p>
          )}
        </div>
      </footer>
    </>
  );
}
