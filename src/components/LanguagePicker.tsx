'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LOCALE_NAMES, LOCALES, type Locale } from '@/lib/i18n';

// Simple inline SVG flags (emoji flags don't render on Windows).
const FLAGS: Record<Locale, ReactNode> = {
  en: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0V20M0 10H30" stroke="#C8102E" strokeWidth="3.4" />
    </>
  ),
  ru: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#0039A6" />
      <rect y="13.33" width="30" height="6.67" fill="#D52B1E" />
    </>
  ),
  uk: (
    <>
      <rect width="30" height="10" fill="#0057B7" />
      <rect y="10" width="30" height="10" fill="#FFD700" />
    </>
  ),
  pl: (
    <>
      <rect width="30" height="10" fill="#fff" />
      <rect y="10" width="30" height="10" fill="#DC143C" />
    </>
  ),
  de: (
    <>
      <rect width="30" height="6.67" fill="#000" />
      <rect y="6.67" width="30" height="6.67" fill="#DD0000" />
      <rect y="13.33" width="30" height="6.67" fill="#FFCE00" />
    </>
  ),
  fr: (
    <>
      <rect width="10" height="20" fill="#0055A4" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#EF4135" />
    </>
  ),
  es: (
    <>
      <rect width="30" height="20" fill="#AA151B" />
      <rect y="5" width="30" height="10" fill="#F1BF00" />
    </>
  ),
  pt: (
    <>
      <rect width="30" height="20" fill="#009C3B" />
      <path d="M15 2.5L27 10L15 17.5L3 10Z" fill="#FFDF00" />
      <circle cx="15" cy="10" r="4.3" fill="#002776" />
    </>
  ),
  tr: (
    <>
      <rect width="30" height="20" fill="#E30A17" />
      <circle cx="11" cy="10" r="5" fill="#fff" />
      <circle cx="12.3" cy="10" r="4" fill="#E30A17" />
      <path d="M17.5 10l3.6-1.2-2.2 3.1V8.1l2.2 3.1z" fill="#fff" />
    </>
  ),
  zh: (
    <>
      <rect width="30" height="20" fill="#DE2910" />
      <path d="M6 3l1.2 3.6H11L7.9 8.8l1.2 3.6L6 10.2l-3.1 2.2 1.2-3.6L1 6.6h3.8z" fill="#FFDE00" />
    </>
  ),
  ja: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <circle cx="15" cy="10" r="6" fill="#BC002D" />
    </>
  ),
  ko: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <path d="M9.5 10a5.5 5.5 0 0 1 11 0z" fill="#CD2E3A" />
      <path d="M20.5 10a5.5 5.5 0 0 1-11 0z" fill="#0047A0" />
      <circle cx="12.25" cy="10" r="2.75" fill="#CD2E3A" />
      <circle cx="17.75" cy="10" r="2.75" fill="#0047A0" />
    </>
  ),
};

function Flag({ locale }: { locale: Locale }) {
  return (
    <svg viewBox="0 0 30 20" width="21" height="14" aria-hidden className="shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
      {FLAGS[locale]}
    </svg>
  );
}

export function LanguagePicker({ current, label, onChange }: { current: Locale; label: string; onChange: (locale: Locale) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (locale: Locale) => {
    setOpen(false);
    if (locale !== current) onChange(locale);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${LOCALE_NAMES[current]}`}
        className="flex items-center gap-1.5 rounded-sm px-1.5 py-2 text-[12px] uppercase text-[#b8b6b4] hover:bg-white/5 hover:text-white sm:py-1"
      >
        <Flag locale={current} />
        <span>{current}</span>
        <span aria-hidden className="text-[9px]">&#9662;</span>
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute right-0 z-50 mt-1 max-h-[70vh] w-44 overflow-y-auto rounded-sm border border-black/50 bg-ink-900 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
          {LOCALES.map((l) => (
            <li key={l} role="option" aria-selected={l === current}>
              <button
                type="button"
                onClick={() => choose(l)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-ink-700 ${l === current ? 'text-white' : 'text-bone'}`}
              >
                <Flag locale={l} />
                {LOCALE_NAMES[l]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
