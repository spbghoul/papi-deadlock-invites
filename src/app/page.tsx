import { CopyPhrase } from '@/components/CopyPhrase';
import { LiveStats } from '@/components/LiveStats';
import { StatusChecker } from '@/components/StatusChecker';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { getStatsPayload, type StatsPayload } from '@/lib/publicData';
import { getProfileSummary } from '@/lib/steamProfile';

export const dynamic = 'force-dynamic';

const faq = (phrase: string, sourceUrl: string | undefined) => [
  {
    q: 'What do I need to get an invite?',
    a: "A Steam account that isn't limited (Valve requires accounts that have spent at least $5), a profile that allows comments, and a free slot in your friends list. One invite per Steam account.",
  },
  {
    q: 'How long does it take?',
    a: 'Comments are checked roughly every minute. Once you are friends with Papi the invite is queued immediately, but Valve may require you to be friends for a while before an invite is allowed — the bot simply retries later. Invites are also rate-limited to protect the bot account.',
  },
  {
    q: 'My comment does not count?',
    a: `The comment must be exactly "${phrase}" (any capitalization, extra spaces are fine). Comments with extra words are ignored. Only one comment per account is processed.`,
  },
  {
    q: 'Where is my invite?',
    a: 'Deadlock playtest invites show up as a Steam notification and on steamcommunity.com/my/playtestinvites. Steam sometimes delays the notification — check that page directly. A sent invite does not guarantee Steam delivers it instantly.',
  },
  {
    q: 'Why did Papi remove me from friends?',
    a: 'After your invite is confirmed, Papi removes you to keep the friends list free for the next person. Nothing personal.',
  },
  {
    q: 'My status says Failed.',
    a: 'Common reasons: you already have Deadlock, your account is limited, you never sent a friend request in time, or the request was rejected. The status details explain which one.',
  },
  {
    q: 'Is this official?',
    a: 'No. This is an independent community project. Invites are free — never pay anyone for a Deadlock invite and never click "invite links" sent to you in DMs.',
  },
  {
    q: 'What data do you store? Is the code public?',
    a: `Only your SteamID64, public profile URL and name, the comment ID, and the status of your request — enough to send one invite and not send it twice. Papi never needs your password or Steam Guard code: if anyone asks for them, it's a scam. ${
      sourceUrl ? `The full source code is open (MIT license): ${sourceUrl}` : 'The source code will be published openly under the MIT license.'
    }`,
  },
];

export default async function Home() {
  const cfg = getConfig();
  let initialStats: StatsPayload | null = null;
  try {
    initialStats = await getStatsPayload(await getDb());
  } catch {
    initialStats = null;
  }
  const bot = await getProfileSummary(cfg.BOT_PROFILE_URL);
  const profileUrl = cfg.BOT_PROFILE_URL;
  const online = initialStats?.bot.online ?? false;

  const steps = [
    {
      title: "Open Papi's Steam profile",
      body: (
        <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5">
          {profileUrl.replace(/^https:\/\//, '')}
        </a>
      ),
    },
    { title: 'Leave the comment', body: <CopyPhrase phrase={cfg.COMMENT_PHRASE} /> },
    { title: 'Send Papi a friend request', body: <span>Click “Add Friend” on the profile. It is accepted automatically once your comment is verified.</span> },
    { title: 'Receive your Deadlock invitation', body: <span>Papi invites you as soon as Steam allows it. Track progress in Request status below.</span> },
    { title: 'Enjoy Deadlock!', body: <span>Accept the invite from your Steam notifications and install the game.</span> },
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
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] uppercase tracking-wide">
            {[
              ['#how-it-works', 'How it works'],
              ['#stats', 'Stats'],
              ['#status', 'Status'],
              ['#faq', 'FAQ'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="py-2 text-[#b8b6b4] no-underline hover:text-white sm:py-0">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto site-col max-w-[1100px] px-4 pb-16">
        {/* Breadcrumb + title, like a store app page */}
        <div className="pt-6 text-xs text-ink-400">
          All Games &gt; Action Games &gt; <span className="text-accent-500">Deadlock</span> &gt; Invites
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[26px] font-normal leading-tight text-white">Papi&rsquo;s Deadlock Invites</h1>
          <span className="pb-1 text-sm text-ink-300">Want to play Deadlock? Papi&rsquo;s got you.</span>
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
            <p className="relative text-xs uppercase tracking-[0.3em] text-ink-400">Playtest access</p>
            <p className="relative mt-3 text-4xl font-bold uppercase leading-none tracking-tight text-white sm:text-5xl">Deadlock</p>
            <p className="relative mt-3 max-w-md text-[15px] leading-relaxed text-bone sm:max-w-[58%]">
              Deadlock is still invite-only. Leave one comment, add Papi as a friend, and the bot sends you a playtest invite — free, automatic, no strings.
            </p>
            <ul className="relative mt-5 flex flex-wrap gap-1.5 text-xs sm:max-w-[58%]">
              {['Free', 'Automatic', '1 invite per account', 'Community project'].map((t) => (
                <li key={t} className="rounded-sm bg-[rgba(103,193,245,0.2)] px-2 py-1 text-accent-500">
                  {t}
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
                <div className={online ? 'text-online' : 'text-ink-400'}>{online ? 'Online' : 'Offline'}</div>
              </div>
            </a>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="uppercase text-ink-400">Comment</dt>
              <dd className="text-accent-500">&ldquo;{cfg.COMMENT_PHRASE}&rdquo;</dd>
              <dt className="uppercase text-ink-400">Price</dt>
              <dd className="text-bone">Free</dd>
              <dt className="uppercase text-ink-400">Sent</dt>
              <dd className="text-bone">{initialStats ? initialStats.invitesSent.toLocaleString('en-US') : '—'}</dd>
            </dl>
            <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="btn-blue mt-4 w-full">
              View Steam profile
            </a>
          </aside>
        </section>

        {/* Purchase area */}
        <section className="purchase-area relative mt-6 px-4 pb-10 pt-4 sm:px-5">
          <h2 className="text-[21px] text-white">Get Deadlock Playtest Invite</h2>
          <p className="mt-1 text-[13px] text-bone">Comment &ldquo;{cfg.COMMENT_PHRASE}&rdquo; on Papi&rsquo;s profile, then add Papi as a friend.</p>
          <div className="absolute -bottom-4 right-4 flex items-stretch rounded-sm bg-black p-0.5 sm:right-5">
            <span className="flex items-center px-3 text-[13px] text-bone">Free</span>
            <a href="#how-it-works" className="btn-green">
              Get your invite
            </a>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mt-14 scroll-mt-6">
          <h2 className="block-header">How it works</h2>
          <ol className="zebra mt-3 overflow-hidden rounded-sm">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4 px-4 py-3.5">
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
            <h2 className="block-header">Live statistics</h2>
            <div className="mt-3">
              <LiveStats initial={initialStats} />
            </div>
          </section>

          {/* Status */}
          <section id="status" className="scroll-mt-6">
            <h2 className="block-header">Request status</h2>
            <div className="mt-3">
              <StatusChecker />
            </div>
          </section>
        </div>

        {/* FAQ */}
        <section id="faq" className="mt-12 scroll-mt-6">
          <h2 className="block-header">Frequently asked questions</h2>
          <div className="zebra mt-3 overflow-hidden rounded-sm">
            {faq(cfg.COMMENT_PHRASE, cfg.SOURCE_CODE_URL).map((f) => (
              <details key={f.q} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] text-accent-500 hover:text-white">
                  {f.q}
                  <span aria-hidden className="text-ink-400 transition group-open:rotate-90">&#9656;</span>
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="bg-ink-900 py-8 text-[12px] text-ink-400">
        <div className="mx-auto site-col max-w-[1100px] border-t border-ink-700 px-4 pt-5">
          <p>Papi&rsquo;s Deadlock Invites is an independent community project. It is not affiliated with, endorsed by, or sponsored by Valve Corporation.</p>
          <p className="mt-1">Deadlock, Steam and the Steam logo are trademarks of Valve Corporation.</p>
          {cfg.SOURCE_CODE_URL && (
            <p className="mt-3">
              <a href={cfg.SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5">
                Source code on GitHub
              </a>{' '}
              · MIT license
            </p>
          )}
        </div>
      </footer>
    </>
  );
}
