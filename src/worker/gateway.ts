/** Mirrors Steam's EFriendRelationship. */
export enum FriendRelationship {
  None = 0,
  Blocked = 1,
  RequestRecipient = 2, // they sent us a friend request
  Friend = 3,
  RequestInitiator = 4, // we sent them a friend request
  Ignored = 5,
  IgnoredFriend = 6,
}

export interface ProfileComment {
  id: string;
  authorSteamId: string;
  authorProfileUrl: string | null;
  authorName: string | null;
  text: string;
  postedAt: Date | null;
}

/** What the invite workflow needs from Steam. Implemented by SteamUserGateway; faked in tests. */
export interface SteamGateway {
  isLoggedOn(): boolean;
  getRelationship(steamId: string): FriendRelationship;
  acceptFriendRequest(steamId: string): Promise<void>;
  sendFriendRequest(steamId: string): Promise<void>;
  /** Removes a friend, or declines a pending incoming request. */
  removeFriend(steamId: string): Promise<void>;
}
