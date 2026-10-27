import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const steamId64 = z.string().regex(/^7656119\d{10}$/, 'must be a SteamID64 (17 digits, starts with 7656119)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1).default('file:./data/app.db'),

  // Public bot info shown on the website.
  BOT_PROFILE_URL: z.string().url().default('https://steamcommunity.com/id/deadlockpapi/'),
  BOT_STEAM_ID: steamId64.optional(),
  COMMENT_PHRASE: z.string().min(3).max(100).default('thank you papi'),
  // Public repository link shown in the footer/FAQ once the code is published.
  SOURCE_CODE_URL: z.string().url().optional(),

  // Steam login. Prefer a refresh token obtained via `npm run steam:login`.
  STEAM_REFRESH_TOKEN: z.string().optional(),
  STEAM_TOKEN_FILE: z.string().default('./data/steam-refresh-token.txt'),
  STEAM_ACCOUNT_NAME: z.string().optional(),
  STEAM_PASSWORD: z.string().optional(),
  STEAM_SHARED_SECRET: z.string().optional(),

  // Deadlock invite integration.
  INVITE_PROVIDER: z.enum(['gc', 'manual', 'mock']).default('manual'),
  DEADLOCK_APP_ID: int(1422450, 1),
  DEADLOCK_INVITE_LOCATION: z.string().max(64).default(''),
  INVITE_RESPONSE_TIMEOUT_SECONDS: int(30, 5, 300),
  NOT_FRIENDS_LONG_ENOUGH_RETRY_MINUTES: int(60, 1, 10080),

  // Worker behaviour and safety limits.
  COMMENT_POLL_INTERVAL_SECONDS: int(60, 30, 3600),
  COMMENT_MAX_AGE_HOURS: int(72, 1, 24 * 90),
  WORKER_TICK_SECONDS: int(15, 5, 600),
  REMOVAL_DELAY_SECONDS: int(300, 0, 7 * 24 * 3600),
  FRIENDSHIP_WAIT_DAYS: int(7, 1, 60),
  MAX_ATTEMPTS: int(6, 1, 50),
  MAX_INVITES_PER_HOUR: int(20, 1, 500),
  MAX_FRIEND_ACTIONS_PER_HOUR: int(30, 1, 500),
  BOT_SEND_FRIEND_REQUESTS: bool,
  DECLINE_UNKNOWN_FRIEND_REQUESTS: bool,
  WORKER_HEALTH_PORT: int(3001, 1, 65535),

  // Admin dashboard.
  ADMIN_PASSWORD_HASH: z.string().optional(),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  COOKIE_SECURE: z.enum(['true', 'false', '1', '0']).optional(),
  TRUST_PROXY: bool,

  // Mock provider (development only).
  MOCK_REJECT_IDS: z.string().default(''),
  MOCK_UNCERTAIN_IDS: z.string().default(''),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  // Treat empty strings (e.g. `FOO=` in .env) as "not set".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Loads `.env` for CLI processes (worker, scripts). Next.js loads it on its own. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: rely on the real environment (e.g. Docker).
  }
}
