import type { Generated, Selectable } from 'kysely';
import type { RequestStatus } from '../statuses';

// All timestamps are ISO-8601 UTC strings: portable between SQLite and PostgreSQL and sortable as text.

export interface UsersTable {
  steam_id: string;
  profile_url: string | null;
  persona_name: string | null;
  first_seen_at: string;
  invited_at: string | null;
  status: string;
}

export interface InviteRequestsTable {
  id: Generated<number>;
  steam_id: string;
  comment_id: string;
  comment_text: string | null;
  status: RequestStatus;
  attempts: Generated<number>;
  last_error: string | null;
  provider: string | null;
  next_attempt_at: string | null;
  locked_at: string | null;
  friend_since: string | null;
  friend_request_sent_at: string | null;
  invite_sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BotEventsTable {
  id: Generated<number>;
  event_type: string;
  steam_id: string | null;
  description: string;
  timestamp: string;
}

export interface ProcessedCommentsTable {
  comment_id: string;
  steam_id: string | null;
  matched: number;
  processed_at: string;
}

export interface BlockedSteamIdsTable {
  steam_id: string;
  reason: string | null;
  created_at: string;
}

export interface SettingsTable {
  key: string;
  value: string;
  updated_at: string;
}

export interface WorkerStatusTable {
  id: string;
  state: string;
  logged_in: number;
  provider: string | null;
  provider_available: number;
  provider_detail: string | null;
  bot_steam_id: string | null;
  last_comment_poll_at: string | null;
  last_error: string | null;
  started_at: string | null;
  updated_at: string;
}

export interface DB {
  users: UsersTable;
  invite_requests: InviteRequestsTable;
  bot_events: BotEventsTable;
  processed_comments: ProcessedCommentsTable;
  blocked_steam_ids: BlockedSteamIdsTable;
  settings: SettingsTable;
  worker_status: WorkerStatusTable;
}

export type InviteRequest = Selectable<InviteRequestsTable>;
export type BotEvent = Selectable<BotEventsTable>;
export type WorkerStatus = Selectable<WorkerStatusTable>;
