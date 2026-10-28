import type { Metadata, Viewport } from 'next';
import { getLocale } from '@/lib/locale';
import './globals.css';

const title = "Papi's Deadlock Invites";
const description = "Want to play Deadlock? Papi's got you. Leave a comment, add Papi on Steam, get your free playtest invite.";

export const metadata: Metadata = {
  // Absolute base for link-preview image URLs (Twitter/Discord/Telegram need full URLs).
  metadataBase: new URL(process.env.SITE_URL ?? 'https://deadlockpapi.duckdns.org'),
  title,
  description,
  openGraph: { type: 'website', siteName: title, title, description, url: '/' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport: Viewport = {
  themeColor: '#171a21',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh font-sans antialiased selection:bg-accent-500/40">{children}</body>
    </html>
  );
}
