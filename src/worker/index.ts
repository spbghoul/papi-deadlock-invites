import http from 'node:http';
import { getConfig, loadDotEnv } from '../lib/config';
import { createDb, dialectOf } from '../lib/db';
import { migrateToLatest } from '../lib/db/migrations';
import { createLogger, errorMessage } from '../lib/logger';
import { getRuntimeSettings, getWorkerStatus, iso, logEvent, upsertWorkerStatus } from '../lib/repo';
import { DeadlockGcInviteProvider } from '../providers/gcProvider';
import { ManualInviteProvider } from '../providers/manualProvider';
import { MockInviteProvider } from '../providers/mockProvider';
import type { DeadlockInviteProvider } from '../providers/types';
import { SteamCommentSource, SteamRateLimitError } from './comments';
import { SteamUserGateway } from './steamGateway';
import { InviteWorkflow } from './workflow';

loadDotEnv();
const cfg = getConfig();
const log = createLogger({ svc: 'worker' }, cfg.LOG_LEVEL);

async function main() {
  if (cfg.INVITE_PROVIDER === 'mock' && cfg.NODE_ENV === 'production') {
    throw new Error('INVITE_PROVIDER=mock is not allowed with NODE_ENV=production (it would record fake invites).');
  }

  const db = createDb(cfg.DATABASE_URL);
  const applied = await migrateToLatest(db, dialectOf(cfg.DATABASE_URL));
  if (applied.length) log.info('Applied migrations', { applied });

  const steam = new SteamUserGateway({
    refreshToken: cfg.STEAM_REFRESH_TOKEN,
    tokenFile: cfg.STEAM_TOKEN_FILE,
    accountName: cfg.STEAM_ACCOUNT_NAME,
    password: cfg.STEAM_PASSWORD,
    sharedSecret: cfg.STEAM_SHARED_SECRET,
    log: log.child({ mod: 'steam' }),
  });

  let gcProvider: DeadlockGcInviteProvider | null = null;
  let provider: DeadlockInviteProvider;
  if (cfg.INVITE_PROVIDER === 'gc') {
    gcProvider = new DeadlockGcInviteProvider(steam.client, {
      appId: cfg.DEADLOCK_APP_ID,
      location: cfg.DEADLOCK_INVITE_LOCATION,
      responseTimeoutMs: cfg.INVITE_RESPONSE_TIMEOUT_SECONDS * 1000,
      notFriendsLongEnoughRetryMs: cfg.NOT_FRIENDS_LONG_ENOUGH_RETRY_MINUTES * 60_000,
      log: log.child({ mod: 'deadlock-gc' }),
    });
    steam.client.on('receivedFromGC', (appid: number, msgType: number, payload: Buffer) => gcProvider!.onGcMessage(appid, msgType, payload));
    provider = gcProvider;
  } else if (cfg.INVITE_PROVIDER === 'mock') {
    log.warn('Using MOCK invite provider: no real invites will be sent');
    provider = MockInviteProvider.fromEnv(cfg.MOCK_REJECT_IDS, cfg.MOCK_UNCERTAIN_IDS);
  } else {
    provider = new ManualInviteProvider();
  }

  let botSteamId: string | null = cfg.BOT_STEAM_ID ?? null;
  const workflow = new InviteWorkflow({
    db,
    steam,
    provider,
    log: log.child({ mod: 'workflow' }),
    config: {
      phrase: cfg.COMMENT_PHRASE,
      get botSteamId() {
        return botSteamId;
      },
      commentMaxAgeHours: cfg.COMMENT_MAX_AGE_HOURS,
      friendshipWaitDays: cfg.FRIENDSHIP_WAIT_DAYS,
      maxAttempts: cfg.MAX_ATTEMPTS,
      maxInvitesPerHour: cfg.MAX_INVITES_PER_HOUR,
      maxFriendActionsPerHour: cfg.MAX_FRIEND_ACTIONS_PER_HOUR,
      sendFriendRequests: cfg.BOT_SEND_FRIEND_REQUESTS,
      declineUnknownFriendRequests: cfg.DECLINE_UNKNOWN_FRIEND_REQUESTS,
      inviteTimeoutMs: (cfg.INVITE_RESPONSE_TIMEOUT_SECONDS + 10) * 1000,
      defaultRemovalDelaySeconds: cfg.REMOVAL_DELAY_SECONDS,
    },
  });

  const recovered = await workflow.recoverAfterRestart();
  if (recovered) log.warn('Moved in-flight invites to needs_review after restart', { count: recovered });

  const startedAt = iso(new Date());
  let lastPollAt: string | null = null;
  const writeStatus = async () => {
    const avail = await provider.checkAvailability();
    await upsertWorkerStatus(db, {
      state: steam.getState(),
      logged_in: steam.isLoggedOn() ? 1 : 0,
      provider: provider.name,
      provider_available: avail.available ? 1 : 0,
      provider_detail: avail.detail,
      bot_steam_id: botSteamId,
      last_comment_poll_at: lastPollAt,
      last_error: steam.lastError,
      started_at: startedAt,
    });
  };

  steam.on('loggedOn', (id: string | null) => {
    if (id && cfg.BOT_STEAM_ID && id !== cfg.BOT_STEAM_ID) log.warn('BOT_STEAM_ID does not match the logged-in account', { configured: cfg.BOT_STEAM_ID, actual: id });
    botSteamId = id ?? botSteamId;
    gcProvider?.start();
    void logEvent(db, 'bot_online', null, `Logged on as ${id}`);
    void writeStatus();
  });
  steam.on('disconnected', () => {
    gcProvider?.stop();
    void logEvent(db, 'bot_offline', null, 'Disconnected from Steam');
  });
  steam.on('stateChanged', () => void writeStatus().catch(() => undefined));
  steam.on('friendRelationship', (sid: string, rel: number) => {
    workflow.handleFriendRelationship(sid, rel).catch((err) => log.error('friendRelationship handler failed', { err }));
  });
  steam.on('friendsList', () => {
    workflow.tick().catch((err) => log.error('tick failed', { err }));
  });

  // Comment polling with backoff on errors / Steam rate limits.
  const comments = new SteamCommentSource(() => steam.getWebAuth(), log.child({ mod: 'comments' }));
  let pollTimer: NodeJS.Timeout | null = null;
  let pollFailures = 0;
  let stopping = false;
  const poll = async () => {
    let delay = cfg.COMMENT_POLL_INTERVAL_SECONDS * 1000;
    try {
      const paused = (await getRuntimeSettings(db, cfg.REMOVAL_DELAY_SECONDS)).paused;
      if (steam.isLoggedOn() && botSteamId && !paused) {
        const { comments: list, complete } = await comments.fetchRecent(botSteamId, (ids) => workflow.knownCommentIds(ids));
        const created = await workflow.ingestComments(list);
        await workflow.cancelDeletedComments(list, complete);
        lastPollAt = iso(new Date());
        if (created) log.info('New invite requests from comments', { created });
      }
      pollFailures = 0;
    } catch (err) {
      pollFailures++;
      delay = err instanceof SteamRateLimitError ? 15 * 60_000 : Math.min(30 * 60_000, delay * 2 ** Math.min(pollFailures, 5));
      log.warn('Comment poll failed', { err: errorMessage(err), retryInSec: Math.round(delay / 1000) });
      await logEvent(db, 'comment_poll_error', null, errorMessage(err)).catch(() => undefined);
    }
    if (!stopping) pollTimer = setTimeout(poll, delay);
  };

  let tickPromise: Promise<void> = Promise.resolve();
  const tickTimer = setInterval(() => {
    tickPromise = workflow.tick().catch((err) => log.error('tick failed', { err }));
  }, cfg.WORKER_TICK_SECONDS * 1000);
  // Watchdog: if Steam stays unreachable for too long, exit and let Docker restart us for a fresh
  // login with the stored refresh token. Not for auth problems (need a human) or Steam rate limits.
  const RECONNECT_GIVE_UP_MS = 10 * 60_000;
  let lastOnlineAt = Date.now();
  const heartbeatTimer = setInterval(() => {
    void writeStatus().catch((err) => log.error('heartbeat failed', { err }));
    const state = steam.getState();
    if (state === 'online') lastOnlineAt = Date.now();
    else if (state !== 'auth_required' && state !== 'rate_limited' && Date.now() - lastOnlineAt > RECONNECT_GIVE_UP_MS) {
      log.warn('Steam reconnect is taking too long; restarting the worker', { state });
      void shutdown('watchdog');
    }
  }, 20_000);

  // Health endpoint for Docker / monitoring.
  const health = http.createServer(async (req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    try {
      const st = await getWorkerStatus(db);
      const body = { ok: true, steam: steam.getState(), provider: provider.name, lastCommentPollAt: lastPollAt, updatedAt: st?.updated_at };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: errorMessage(err) }));
    }
  });
  health.listen(cfg.WORKER_HEALTH_PORT, () => log.info('Worker health endpoint listening', { port: cfg.WORKER_HEALTH_PORT }));

  await writeStatus();
  steam.logOn();
  pollTimer = setTimeout(poll, 10_000);

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('Shutting down', { signal });
    clearInterval(tickTimer);
    clearInterval(heartbeatTimer);
    if (pollTimer) clearTimeout(pollTimer);
    await tickPromise; // let an in-flight invite finish and be recorded
    gcProvider?.stop();
    await steam.shutdown();
    await upsertWorkerStatus(db, { state: 'offline', logged_in: 0 }).catch(() => undefined);
    health.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('Worker failed to start', { err: errorMessage(err) });
  process.exit(1);
});
