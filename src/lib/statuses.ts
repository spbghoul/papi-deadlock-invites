export const REQUEST_STATUSES = [
  'waiting_friendship', // comment verified, waiting until we are Steam friends
  'invite_pending', // friends, queued for the invite provider
  'inviting', // invite call in flight (never retried automatically after a crash)
  'awaiting_manual', // manual provider: an admin must send the invite in the Deadlock client
  'needs_review', // outcome unknown (timeout / crash) - admin must decide
  'invite_sent', // provider confirmed the invite was submitted; waiting for removal delay
  'completed', // invite sent and friend removed
  'failed', // terminal error
  'rejected', // rejected by admin or blocked
  'expired', // no friendship within FRIENDSHIP_WAIT_DAYS
  'cancelled', // the user deleted their comment before becoming friends
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const ACTIVE_STATUSES: RequestStatus[] = ['waiting_friendship', 'invite_pending', 'inviting', 'awaiting_manual', 'needs_review'];
export const SENT_STATUSES: RequestStatus[] = ['invite_sent', 'completed'];

export function isRequestStatus(v: string): v is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(v);
}

export type PublicState =
  | 'Waiting for comment'
  | 'Comment verified'
  | 'Waiting for friendship'
  | 'Invitation pending'
  | 'Invitation sent'
  | 'Completed'
  | 'Failed';

export function publicStatus(status: RequestStatus | null): { state: PublicState; detail: string } {
  switch (status) {
    case null:
      return { state: 'Waiting for comment', detail: 'No verified comment found yet. Comments are checked about once a minute.' };
    case 'waiting_friendship':
      return { state: 'Waiting for friendship', detail: "Your comment is verified. Send Papi a Steam friend request — it will be accepted automatically." };
    case 'invite_pending':
    case 'inviting':
      return { state: 'Invitation pending', detail: "You're friends with Papi. Your invitation is queued." };
    case 'awaiting_manual':
    case 'needs_review':
      return { state: 'Invitation pending', detail: 'Your request is waiting for a manual check by the admin.' };
    case 'invite_sent':
      return { state: 'Invitation sent', detail: 'Steam accepted the invitation request. Check your Steam notifications / playtest invites.' };
    case 'completed':
      return { state: 'Completed', detail: 'Invitation sent. Check steamcommunity.com/my/playtestinvites if it does not show up.' };
    case 'rejected':
      return { state: 'Failed', detail: 'This request was not approved.' };
    case 'expired':
      return { state: 'Failed', detail: 'No friend request was received in time. Comment again to start over.' };
    case 'cancelled':
      return { state: 'Failed', detail: 'Your comment was deleted, so the request was cancelled. Comment again to start over.' };
    case 'failed':
      return { state: 'Failed', detail: 'The invitation could not be sent.' };
  }
}
