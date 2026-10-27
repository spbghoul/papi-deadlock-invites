import { getConfig, loadDotEnv } from '../src/lib/config';
import { createDb, dialectOf } from '../src/lib/db';
import { migrateToLatest } from '../src/lib/db/migrations';

loadDotEnv();
const { DATABASE_URL } = getConfig();
const db = createDb(DATABASE_URL);
try {
  const applied = await migrateToLatest(db, dialectOf(DATABASE_URL));
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await db.destroy();
}
