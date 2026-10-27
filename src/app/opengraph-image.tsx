import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

// Link preview card for Twitter/X, Discord, Telegram, etc. Generated once at build time.
export const alt = "Papi's Deadlock Invites — free Deadlock playtest invites";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const sketch = await readFile(path.join(process.cwd(), 'src/assets/papi-light.png'));
  const sketchSrc = `data:image/png;base64,${sketch.toString('base64')}`;
  const icon = await readFile(path.join(process.cwd(), 'src/app/icon.png'));
  const iconSrc = `data:image/png;base64,${icon.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #0f1922 0%, #1f3447 50%, #13202c 100%)',
          color: '#c6d4df',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '28px 56px', background: '#171a21' }}>
          <img src={iconSrc} width={48} height={48} style={{ borderRadius: 24, border: '2px solid #3a8fc4' }} />
          <div style={{ fontSize: 30, letterSpacing: 2, color: '#ffffff' }}>PAPI&apos;S DEADLOCK INVITES</div>
        </div>

        <img src={sketchSrc} width={540} height={310} style={{ position: 'absolute', right: -10, bottom: 0 }} />

        <div style={{ display: 'flex', flexDirection: 'column', padding: '46px 56px 0', width: 780 }}>
          <div style={{ fontSize: 22, letterSpacing: 8, color: '#8f98a0' }}>PLAYTEST ACCESS</div>
          <div style={{ fontSize: 112, color: '#ffffff', lineHeight: 1, marginTop: 12 }}>DEADLOCK</div>
          <div style={{ fontSize: 34, marginTop: 22 }}>Want to play Deadlock? Papi&apos;s got you.</div>
          <div style={{ display: 'flex', fontSize: 26, marginTop: 16, color: '#66c0f4' }}>Comment “thank you papi”, add Papi, get invite</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 34 }}>
            <div
              style={{
                display: 'flex',
                padding: '10px 26px',
                borderRadius: 4,
                background: 'linear-gradient(90deg, #75b022, #588a1b)',
                color: '#d2efa9',
                fontSize: 28,
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              FREE — get your invite
            </div>
            <div style={{ fontSize: 24, color: '#8f98a0' }}>deadlockpapi.duckdns.org</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
