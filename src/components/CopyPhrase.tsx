'use client';

import { useState } from 'react';

export function CopyPhrase({ phrase, copyLabel, copiedLabel }: { phrase: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
    } catch {
      // Fallback for browsers without the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = phrase;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mt-1.5 flex max-w-sm items-stretch">
      <code className="field flex-1 rounded-r-none font-mono text-[14px] whitespace-nowrap text-white">{phrase}</code>
      <button type="button" onClick={copy} className="btn-blue rounded-l-none" aria-label={`Copy the comment "${phrase}" to clipboard`}>
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}
