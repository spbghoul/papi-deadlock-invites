type Level = 'debug' | 'info' | 'warn' | 'error';
type Context = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /pass(word)?|token|secret|cookie|session/i;

export interface Logger {
  debug(msg: string, ctx?: Context): void;
  info(msg: string, ctx?: Context): void;
  warn(msg: string, ctx?: Context): void;
  error(msg: string, ctx?: Context): void;
  child(bindings: Context): Logger;
}

function sanitize(ctx: Context): Context {
  const out: Context = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SECRET_KEY.test(k)) out[k] = '[redacted]';
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

/** Minimal structured JSON logger (one JSON object per line on stdout/stderr). */
export function createLogger(bindings: Context = {}, level?: Level): Logger {
  const min = LEVELS[level ?? ((process.env.LOG_LEVEL as Level | undefined) ?? 'info')] ?? LEVELS.info;
  const write = (lvl: Level, msg: string, ctx?: Context) => {
    if (LEVELS[lvl] < min) return;
    // time/level/msg go last so context keys can never overwrite them.
    const line = JSON.stringify({ ...sanitize(bindings), ...sanitize(ctx ?? {}), time: new Date().toISOString(), level: lvl, msg });
    (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  };
  return {
    debug: (m, c) => write('debug', m, c),
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, c) => write('error', m, c),
    child: (b) => createLogger({ ...bindings, ...b }, level),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
