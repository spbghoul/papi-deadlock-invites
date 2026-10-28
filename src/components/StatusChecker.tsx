'use client';

import { useState, type FormEvent } from 'react';
import type { Dict, StateKey, StatusKey } from '@/lib/i18n';

interface StatusResult {
  steamId: string;
  code: StatusKey | null;
  state: StateKey;
  updatedAt: string | null;
}

const STEPS: StateKey[] = ['Waiting for comment', 'Waiting for friendship', 'Invitation pending', 'Invitation sent', 'Completed'];

export function StatusChecker({ t, dateLocale }: { t: Dict['status']; dateLocale: string }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/status?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
      if (res.ok) setResult((await res.json()) as StatusResult);
      else setError(res.status === 400 ? t.errors.invalid : res.status === 404 ? t.errors.notFound : res.status === 429 ? t.errors.tooMany : t.errors.failed);
    } catch {
      setError(t.errors.network);
    } finally {
      setLoading(false);
    }
  };

  const failed = result?.state === 'Failed';
  const stepIndex = result ? STEPS.indexOf(result.state) : -1;

  return (
    <div className="panel p-4">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="steam-query" className="sr-only">
          {t.placeholder}
        </label>
        <input
          id="steam-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.placeholder}
          maxLength={200}
          autoComplete="off"
          className="field min-w-0 flex-1 text-[13px]"
        />
        <button type="submit" disabled={loading} className="btn-blue">
          {loading ? t.checking : t.check}
        </button>
      </form>
      <p className="mt-2 text-[11px] text-ink-400">{t.example}</p>

      {error && <p className="mt-3 rounded-sm bg-blood-600/25 px-3 py-2 text-[13px] text-[#ffb3b3]">{error}</p>}

      {result && (
        <div className="mt-4 border-t border-black/30 pt-3 text-[13px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={`text-[17px] ${failed ? 'text-blood-500' : 'text-white'}`}>{t.states[result.state] ?? result.state}</span>
            <a href={`https://steamcommunity.com/profiles/${result.steamId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px]">
              {result.steamId}
            </a>
          </div>
          <p className="mt-1 text-ink-300">{t.details[result.code ?? 'none']}</p>
          {!failed && (
            <ol className="mt-3 grid grid-cols-5 gap-1" aria-label="Progress">
              {STEPS.map((s, i) => (
                <li key={s} title={t.states[s]} className={`h-1 rounded-sm ${i <= stepIndex ? 'bg-accent-500' : 'bg-ink-700'}`} />
              ))}
            </ol>
          )}
          {result.updatedAt && (
            <p className="mt-2 text-[11px] text-ink-400">
              {t.lastUpdate}: {new Date(result.updatedAt).toLocaleString(dateLocale)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
