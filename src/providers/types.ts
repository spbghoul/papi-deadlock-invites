/**
 * Result of a single invite attempt. Only `sent` may move a request to "invite_sent".
 * `sent` means the provider received an explicit success response; it does NOT guarantee delivery.
 */
export type InviteOutcome =
  /** Explicit success response from the invite backend. */
  | { kind: 'sent'; detail: string }
  /** No automation available: an admin must send the invite by hand and confirm it in the dashboard. */
  | { kind: 'manual_required'; detail: string }
  /** Explicit failure that is safe to retry (nothing was sent). Counts as an attempt. */
  | { kind: 'retry'; detail: string; retryAfterMs?: number }
  /** Not ready yet / provider-level limit. Does not count as an attempt. `global` pauses all invites. */
  | { kind: 'defer'; detail: string; retryAfterMs: number; global?: boolean }
  /** Explicit terminal refusal (e.g. user already has the game). Nothing was sent. */
  | { kind: 'rejected'; reason: 'already_has_access' | 'limited_account' | 'not_eligible'; detail: string }
  /** We do not know whether an invite was sent (timeout, crash, unknown response). Never auto-retried. */
  | { kind: 'uncertain'; detail: string };

export interface ProviderAvailability {
  available: boolean;
  detail: string;
}

export type VerifyStatus = 'confirmed_sent' | 'not_sent' | 'unknown';

export interface DeadlockInviteProvider {
  readonly name: string;
  checkAvailability(): Promise<ProviderAvailability>;
  canInvite(steamId: string): Promise<{ ok: boolean; detail: string }>;
  sendInvite(steamId: string): Promise<InviteOutcome>;
  verifyInviteStatus(steamId: string): Promise<{ status: VerifyStatus; detail: string }>;
}
