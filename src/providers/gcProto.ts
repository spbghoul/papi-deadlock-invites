/**
 * Tiny protobuf encoder/decoder for the few Deadlock GC messages we use.
 * Message definitions come from SteamDatabase/GameTracking-Deadlock (Protobufs/citadel_gcmessages_client.proto):
 *
 *   message CMsgClientToGCSubmitPlaytestUser { optional string location = 3; optional uint32 target_account_id = 4; }
 *   message CMsgClientToGCSubmitPlaytestUserResponse {
 *     enum EResponse { eResponse_Success = 0; eResponse_InternalError = 1; eResponse_InvalidFriend = 3;
 *       eResponse_NotFriendsLongEnough = 4; eResponse_AlreadyHasGame = 5; eResponse_LimitedUser = 6;
 *       eResponse_InviteLimitReached = 7; }
 *     optional EResponse response = 1 [default = eResponse_Success];
 *   }
 */

export const GC_MSG = {
  // gcsdk_gcmessages.proto (EGCBaseClientMsg)
  ClientWelcome: 4004,
  ClientHello: 4006,
  ClientConnectionStatus: 4009,
  // citadel_gcmessages_client.proto (EGCCitadelClientMessages)
  SubmitPlaytestUser: 9189,
  SubmitPlaytestUserResponse: 9190,
} as const;

export const SubmitPlaytestResponse = {
  Success: 0,
  InternalError: 1,
  InvalidFriend: 3,
  NotFriendsLongEnough: 4,
  AlreadyHasGame: 5,
  LimitedUser: 6,
  InviteLimitReached: 7,
} as const;

function encodeVarint(value: number): number[] {
  if (!Number.isInteger(value) || value < 0) throw new Error(`varint must be a non-negative integer: ${value}`);
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

export function encodeSubmitPlaytestUser(msg: { location?: string; targetAccountId: number }): Buffer {
  const bytes: number[] = [];
  if (msg.location) {
    const str = Buffer.from(msg.location, 'utf8');
    bytes.push((3 << 3) | 2, ...encodeVarint(str.length), ...str);
  }
  bytes.push((4 << 3) | 0, ...encodeVarint(msg.targetAccountId));
  return Buffer.from(bytes);
}

/** Decodes top-level varint fields of any protobuf message; other wire types are skipped. */
export function decodeVarintFields(buf: Buffer): Map<number, number> {
  const fields = new Map<number, number>();
  let pos = 0;
  const readVarint = (): number => {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      if (pos >= buf.length) throw new Error('Truncated varint');
      const b = buf[pos++]!;
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 128;
    }
    throw new Error('Varint too long');
  };
  while (pos < buf.length) {
    const tag = readVarint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) fields.set(field, readVarint());
    else if (wire === 1) pos += 8;
    else if (wire === 2) pos += readVarint();
    else if (wire === 5) pos += 4;
    else throw new Error(`Unsupported wire type ${wire}`);
    if (pos > buf.length) throw new Error('Truncated message');
  }
  return fields;
}

export function decodeSubmitPlaytestUserResponse(buf: Buffer): number {
  return decodeVarintFields(buf).get(1) ?? SubmitPlaytestResponse.Success;
}

/** CMsgConnectionStatus.status: 0 = GCConnectionStatus_HAVE_SESSION. */
export function decodeConnectionStatus(buf: Buffer): number {
  return decodeVarintFields(buf).get(1) ?? 0;
}
