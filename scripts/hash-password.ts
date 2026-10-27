import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/lib/auth';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = process.argv[2] ?? (await rl.question('New admin password (min 10 chars): '));
rl.close();

console.log('\nAdd these lines to your .env:\n');
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('base64url')}`);
