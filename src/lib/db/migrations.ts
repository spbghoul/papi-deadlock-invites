import { Migrator, type CreateTableBuilder, type Kysely, type Migration } from 'kysely';
import type { DialectKind } from './index';

type AnyTable = CreateTableBuilder<string, string>;

/** Migrations are written with Kysely's schema builder so they run on SQLite and PostgreSQL. */
export function buildMigrations(kind: DialectKind): Record<string, Migration> {
  const withId = (t: AnyTable): AnyTable =>
    kind === 'postgres'
      ? t.addColumn('id', 'serial', (c) => c.primaryKey())
      : t.addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement());

  return {
    '001_initial': {
      async up(db: Kysely<any>) {
        await db.schema
          .createTable('users')
          .addColumn('steam_id', 'text', (c) => c.primaryKey())
          .addColumn('profile_url', 'text')
          .addColumn('persona_name', 'text')
          .addColumn('first_seen_at', 'text', (c) => c.notNull())
          .addColumn('invited_at', 'text')
          .addColumn('status', 'text', (c) => c.notNull())
          .execute();

        // UNIQUE(steam_id): one invite request per Steam account, ever -> no duplicate invites.
        // UNIQUE(comment_id): a comment can never create two requests.
        await withId(db.schema.createTable('invite_requests'))
          .addColumn('steam_id', 'text', (c) => c.notNull().unique())
          .addColumn('comment_id', 'text', (c) => c.notNull().unique())
          .addColumn('comment_text', 'text')
          .addColumn('status', 'text', (c) => c.notNull())
          .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('last_error', 'text')
          .addColumn('provider', 'text')
          .addColumn('next_attempt_at', 'text')
          .addColumn('locked_at', 'text')
          .addColumn('friend_since', 'text')
          .addColumn('friend_request_sent_at', 'text')
          .addColumn('invite_sent_at', 'text')
          .addColumn('completed_at', 'text')
          .addColumn('created_at', 'text', (c) => c.notNull())
          .addColumn('updated_at', 'text', (c) => c.notNull())
          .execute();
        await db.schema.createIndex('invite_requests_status_idx').on('invite_requests').columns(['status', 'next_attempt_at']).execute();

        await withId(db.schema.createTable('bot_events'))
          .addColumn('event_type', 'text', (c) => c.notNull())
          .addColumn('steam_id', 'text')
          .addColumn('description', 'text', (c) => c.notNull())
          .addColumn('timestamp', 'text', (c) => c.notNull())
          .execute();
        await db.schema.createIndex('bot_events_timestamp_idx').on('bot_events').column('timestamp').execute();
        await db.schema.createIndex('bot_events_type_idx').on('bot_events').columns(['event_type', 'timestamp']).execute();

        await db.schema
          .createTable('processed_comments')
          .addColumn('comment_id', 'text', (c) => c.primaryKey())
          .addColumn('steam_id', 'text')
          .addColumn('matched', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('processed_at', 'text', (c) => c.notNull())
          .execute();

        await db.schema
          .createTable('blocked_steam_ids')
          .addColumn('steam_id', 'text', (c) => c.primaryKey())
          .addColumn('reason', 'text')
          .addColumn('created_at', 'text', (c) => c.notNull())
          .execute();

        await db.schema
          .createTable('settings')
          .addColumn('key', 'text', (c) => c.primaryKey())
          .addColumn('value', 'text', (c) => c.notNull())
          .addColumn('updated_at', 'text', (c) => c.notNull())
          .execute();

        await db.schema
          .createTable('worker_status')
          .addColumn('id', 'text', (c) => c.primaryKey())
          .addColumn('state', 'text', (c) => c.notNull())
          .addColumn('logged_in', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('provider', 'text')
          .addColumn('provider_available', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('provider_detail', 'text')
          .addColumn('bot_steam_id', 'text')
          .addColumn('last_comment_poll_at', 'text')
          .addColumn('last_error', 'text')
          .addColumn('started_at', 'text')
          .addColumn('updated_at', 'text', (c) => c.notNull())
          .execute();
      },
      async down(db: Kysely<any>) {
        for (const t of ['worker_status', 'settings', 'blocked_steam_ids', 'processed_comments', 'bot_events', 'invite_requests', 'users']) {
          await db.schema.dropTable(t).ifExists().execute();
        }
      },
    },
  };
}

export async function migrateToLatest(db: Kysely<any>, kind: DialectKind): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => buildMigrations(kind) },
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
