import type { Kysely } from 'kysely';
import { getConfig } from '../config';
import { createDb, dialectOf } from './index';
import { migrateToLatest } from './migrations';
import type { DB } from './schema';

const g = globalThis as unknown as { __ddiDb?: Promise<Kysely<DB>> };

/** Process-wide DB handle for the Next.js server (survives dev hot reloads). */
export function getDb(): Promise<Kysely<DB>> {
  g.__ddiDb ??= (async () => {
    const { DATABASE_URL } = getConfig();
    const db = createDb(DATABASE_URL);
    await migrateToLatest(db, dialectOf(DATABASE_URL));
    return db;
  })().catch((err) => {
    g.__ddiDb = undefined;
    throw err;
  });
  return g.__ddiDb;
}
