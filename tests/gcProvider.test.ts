import { describe, expect, it } from 'vitest';
import { silentLogger } from '../src/lib/logger';
import { DeadlockGcInviteProvider, mapResponse, type GcClient } from '../src/providers/gcProvider';
import { decodeVarintFields, encodeSubmitPlaytestUser, GC_MSG } from '../src/providers/gcProto';

const APP = 1422450;

class FakeGc implements GcClient {
  sent: { type: number; payload: Buffer }[] = [];
  played: number[][] = [];
  reply: ((payload: Buffer) => Buffer | null) | null = null;
  gamesPlayed(apps: number[]) {
    this.played.push(apps);
  }
  sendToGC(_app: number, type: number, _h: unknown, payload: Buffer, cb?: (a: number, t: number, p: Buffer) => void) {
    this.sent.push({ type, payload });
    const body = type === GC_MSG.SubmitPlaytestUser && this.reply ? this.reply(payload) : null;
    if (body && cb) setTimeout(() => cb(APP, GC_MSG.SubmitPlaytestUserResponse, body), 1);
  }
}

function makeProvider(client: FakeGc, timeout = 200) {
  return new DeadlockGcInviteProvider(client, { appId: APP, location: '', responseTimeoutMs: timeout, notFriendsLongEnoughRetryMs: 3600_000, helloIntervalMs: 60_000, log: silentLogger });
}

describe('gc protobuf', () => {
  it('encodes CMsgClientToGCSubmitPlaytestUser', () => {
    const buf = encodeSubmitPlaytestUser({ targetAccountId: 22202 });
    expect([...buf]).toEqual([0x20, 0xba, 0xad, 0x01]);
    expect(decodeVarintFields(buf).get(4)).toBe(22202);
    const withLoc = encodeSubmitPlaytestUser({ location: 'ab', targetAccountId: 1 });
    expect([...withLoc]).toEqual([0x1a, 0x02, 0x61, 0x62, 0x20, 0x01]);
  });

  it('maps every documented response code', () => {
    expect(mapResponse(0, 1).kind).toBe('sent');
    expect(mapResponse(1, 1).kind).toBe('retry');
    expect(mapResponse(3, 1).kind).toBe('retry');
    expect(mapResponse(4, 1).kind).toBe('defer');
    expect(mapResponse(5, 1)).toMatchObject({ kind: 'rejected', reason: 'already_has_access' });
    expect(mapResponse(6, 1)).toMatchObject({ kind: 'rejected', reason: 'limited_account' });
    expect(mapResponse(7, 1)).toMatchObject({ kind: 'defer', global: true });
    expect(mapResponse(99, 1).kind).toBe('uncertain');
  });
});

describe('DeadlockGcInviteProvider', () => {
  it('is unavailable until the GC welcomes us', async () => {
    const gc = new FakeGc();
    const p = makeProvider(gc);
    p.start();
    expect(gc.played).toEqual([[APP]]);
    expect(gc.sent[0]!.type).toBe(GC_MSG.ClientHello);
    expect((await p.checkAvailability()).available).toBe(false);
    expect((await p.sendInvite('76561197960287930')).kind).toBe('defer');
    p.onGcMessage(APP, GC_MSG.ClientWelcome, Buffer.alloc(0));
    expect((await p.checkAvailability()).available).toBe(true);
    p.stop();
  });

  it('sends the invite to the right account and reports success only on eResponse_Success', async () => {
    const gc = new FakeGc();
    const p = makeProvider(gc);
    p.start();
    p.onGcMessage(APP, GC_MSG.ClientWelcome, Buffer.alloc(0));

    gc.reply = () => Buffer.alloc(0); // empty body = default eResponse_Success
    expect((await p.sendInvite('76561197960287930')).kind).toBe('sent');
    const invite = gc.sent.find((s) => s.type === GC_MSG.SubmitPlaytestUser)!;
    expect(decodeVarintFields(invite.payload).get(4)).toBe(22202);

    gc.reply = () => Buffer.from([0x08, 0x05]);
    expect((await p.sendInvite('76561197960287930')).kind).toBe('rejected');
    p.stop();
  });

  it('returns uncertain when the GC does not answer', async () => {
    const gc = new FakeGc();
    const p = makeProvider(gc, 30);
    p.start();
    p.onGcMessage(APP, GC_MSG.ClientWelcome, Buffer.alloc(0));
    gc.reply = () => null;
    expect((await p.sendInvite('76561197960287930')).kind).toBe('uncertain');
    p.stop();
  });
});
