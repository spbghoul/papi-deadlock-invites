import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import type { DB } from './schema';

export type DialectKind = 'sqlite' | 'postgres';

export function dialectOf(url: string): DialectKind {
  return /^postgres(ql)?:\/\//i.test(url) ? 'postgres' : 'sqlite';
}

/** DATABASE_URL: `file:./data/app.db`, `:memory:` or `postgres://user:pass@host/db`. */
export function createDb(url: string): Kysely<DB> {
  if (dialectOf(url) === 'postgres') {
    return new Kysely<DB>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 10 }) }),
    });
  }
  const file = url.startsWith('file:') ? url.slice('file:'.length) : url;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL'); // web + worker processes share the file
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
}

export type { DB } from './schema';
