'use client';

import { useState, type FormEvent } from 'react';

interface StatusResult {
  steamId: string;
  state: string;
  detail: string;
  updatedAt: string | null;
}

const STEPS = ['Waiting for comment', 'Waiting for friendship', 'Invitation pending', 'Invitation sent', 'Completed'];

export function StatusChecker() {
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
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Lookup failed');
      else setResult(data as StatusResult);
    } catch {
      setError('Network error. Try again.');
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
          Steam profile URL or SteamID64
        </label>
        <input
          id="steam-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Profile URL or SteamID64"
          maxLength={200}
          autoComplete="off"
          className="field min-w-0 flex-1 text-[13px]"
        />
        <button type="submit" disabled={loading} className="btn-blue">
          {loading ? 'Checking…' : 'Check'}
        </button>
      </form>
      <p className="mt-2 text-[11px] text-ink-400">e.g. steamcommunity.com/id/yourname or 7656119…</p>

      {error && <p className="mt-3 rounded-sm bg-blood-600/25 px-3 py-2 text-[13px] text-[#ffb3b3]">{error}</p>}

      {result && (
        <div className="mt-4 border-t border-black/30 pt-3 text-[13px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={`text-[17px] ${failed ? 'text-blood-500' : 'text-white'}`}>{result.state}</span>
            <a href={`https://steamcommunity.com/profiles/${result.steamId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px]">
              {result.steamId}
            </a>
          </div>
          <p className="mt-1 text-ink-300">{result.detail}</p>
          {!failed && (
            <ol className="mt-3 grid grid-cols-5 gap-1" aria-label="Progress">
              {STEPS.map((s, i) => (
                <li key={s} title={s} className={`h-1 rounded-sm ${i <= stepIndex ? 'bg-accent-500' : 'bg-ink-700'}`} />
              ))}
            </ol>
          )}
          {result.updatedAt && <p className="mt-2 text-[11px] text-ink-400">Last update: {new Date(result.updatedAt).toLocaleString()}</p>}
        </div>
      )}
    </div>
  );
}
