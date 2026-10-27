/**
 * One-time interactive Steam login. You type the bot's account name, password and Steam Guard code
 * yourself; the script stores only the resulting refresh token (STEAM_TOKEN_FILE). The worker then
 * logs in with that token and never needs the password.
 */
import { createInterface } from 'node:readline/promises';
import SteamUser from 'steam-user';
import { getConfig, loadDotEnv } from '../src/lib/config';
import { writeTokenFile } from '../src/worker/steamGateway';

loadDotEnv();
const cfg = getConfig();
const rl = createInterface({ input: process.stdin, output: process.stdout });

const accountName = cfg.STEAM_ACCOUNT_NAME ?? (await rl.question('Bot Steam account name: '));
const password = cfg.STEAM_PASSWORD ?? (await rl.question('Password (input is visible): '));

const client = new SteamUser({ autoRelogin: false, dataDirectory: null });

client.on('steamGuard', async (domain: string | null, callback: (code: string) => void, lastCodeWrong: boolean) => {
  if (lastCodeWrong) console.log('That code was wrong.');
  const where = domain ? `email (${domain})` : 'Steam Guard mobile app';
  callback((await rl.question(`Steam Guard code from ${where}: `)).trim());
});

client.on('refreshToken', (token: string) => {
  writeTokenFile(cfg.STEAM_TOKEN_FILE, token);
  console.log(`\nRefresh token saved to ${cfg.STEAM_TOKEN_FILE}. Keep this file private.`);
});

client.on('loggedOn', () => {
  console.log(`Logged on as ${client.steamID?.getSteamID64()}. Set BOT_STEAM_ID to this value.`);
  setTimeout(() => {
    client.logOff();
    rl.close();
    process.exit(0);
  }, 3000);
});

client.on('error', (err: Error) => {
  console.error(`Login failed: ${err.message}`);
  rl.close();
  process.exit(1);
});

client.logOn({ accountName, password, machineName: 'papis-deadlock-invites' });
