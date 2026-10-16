import { describe, expect, it } from 'vitest';
import type { Author, LiveEvent } from '@slider/shared';
import { LIVE_STALE_MS, LiveHub } from '../src/realtime/live-hub';

const anna: Author = { id: 'anna', name: 'Anna', type: 'owner', color: 'blue' };
const ben: Author = { id: 'ben', name: 'Ben', type: 'owner', color: 'red' };

/** A hub with a hand-driven clock, plus a recorder per connection. */
function setup() {
  let now = 1_000_000;
  const hub = new LiveHub(() => now);
  const inbox = () => {
    const events: LiveEvent[] = [];
    return { events, send: (event: LiveEvent) => events.push(event) };
  };
  return {
    hub,
    inbox,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const presence = (activeSlideId: string | null, x = 0.5) => ({
  activeSlideId,
  cursor: activeSlideId ? { slideId: activeSlideId, point: { x, y: 0.5 } } : null,
  focusedThreadId: null,
});

describe('LiveHub', () => {
  it('greets a joiner with the peers already there and announces it to them', () => {
    const { hub, inbox } = setup();
    const a = inbox();
    const b = inbox();
    const aId = hub.join('deck', anna, a.send);
    expect(a.events).toEqual([{ type: 'hello', connectionId: aId, peers: [] }]);

    const bId = hub.join('deck', ben, b.send);
    expect(b.events).toEqual([
      {
        type: 'hello',
        connectionId: bId,
        peers: [
          {
            connectionId: hub.peerIdOf(aId),
            author: anna,
            activeSlideId: null,
            cursor: null,
            focusedThreadId: null,
          },
        ],
      },
    ]);
    // The joiner gets no peer event about itself; the others do.
    expect(a.events.at(-1)).toEqual({
      type: 'peer',
      peer: {
        connectionId: hub.peerIdOf(bId),
        author: ben,
        activeSlideId: null,
        cursor: null,
        focusedThreadId: null,
      },
    });
    expect(hub.peers('deck').map((p) => p.connectionId)).toEqual([
      hub.peerIdOf(aId),
      hub.peerIdOf(bId),
    ]);
    expect(hub.has(aId)).toBe(true);
    hub.leave(aId);
    hub.leave(bId);
  });

  it('keeps decks apart', () => {
    const { hub, inbox } = setup();
    const a = inbox();
    const b = inbox();
    const aId = hub.join('one', anna, a.send);
    const bId = hub.join('two', ben, b.send);
    expect(a.events).toHaveLength(1);
    hub.commentsChanged('two');
    expect(a.events).toHaveLength(1);
    expect(b.events.at(-1)).toEqual({ type: 'comments' });
    hub.leave(aId);
    hub.leave(bId);
  });

  it('a second connection of the same tab and person replaces the first', () => {
    const { hub, inbox } = setup();
    const watcher = inbox();
    const watcherId = hub.join('deck', ben, watcher.send);
    const first = hub.join('deck', anna, inbox().send, { tab: 'tab-aaaa', replaces: null });
    const firstPeer = hub.peerIdOf(first);
    const second = hub.join('deck', anna, inbox().send, { tab: 'tab-aaaa', replaces: null });

    expect(hub.has(first)).toBe(false);
    expect(hub.has(second)).toBe(true);
    expect(watcher.events).toContainEqual({ type: 'leave', connectionId: firstPeer });
    expect(hub.peers('deck').map((p) => p.connectionId)).toEqual([
      hub.peerIdOf(watcherId),
      hub.peerIdOf(second),
    ]);
    hub.leave(watcherId);
    hub.leave(second);
  });

  it('keeps the same tab id of another person, and connections without a tab', () => {
    const { hub, inbox } = setup();
    const a = hub.join('deck', anna, inbox().send, { tab: 'tab-aaaa', replaces: null });
    const b = hub.join('deck', ben, inbox().send, { tab: 'tab-aaaa', replaces: null });
    const c = hub.join('deck', anna, inbox().send);
    const d = hub.join('deck', anna, inbox().send);
    expect([a, b, c, d].every((id) => hub.has(id))).toBe(true);
    for (const id of [a, b, c, d]) hub.leave(id);
  });

  it('drops the connection of the page load a reload replaces', () => {
    const { hub, inbox } = setup();
    const before = hub.join('deck', anna, inbox().send, { tab: 'load-1111', replaces: null });
    const after = hub.join('deck', anna, inbox().send, { tab: 'load-2222', replaces: 'load-1111' });
    expect(hub.has(before)).toBe(false);
    expect(hub.has(after)).toBe(true);
    hub.leave(after);
  });

  it('update: false for unknown connections, no broadcast when nothing changed', () => {
    const { hub, inbox } = setup();
    const a = inbox();
    const b = inbox();
    const aId = hub.join('deck', anna, a.send);
    const bId = hub.join('deck', ben, b.send);
    expect(hub.update('gone', presence(null))).toBe(false);

    const before = b.events.length;
    expect(hub.update(aId, presence(null))).toBe(true);
    expect(b.events).toHaveLength(before);

    const aBefore = a.events.length;
    expect(hub.update(aId, presence('slide-1'))).toBe(true);
    expect(b.events.at(-1)).toEqual({
      type: 'peer',
      peer: { connectionId: hub.peerIdOf(aId), author: anna, ...presence('slide-1') },
    });
    // The sender hears nothing about its own move.
    expect(a.events).toHaveLength(aBefore);

    // Same values again: a heartbeat only.
    const count = b.events.length;
    expect(hub.update(aId, presence('slide-1'))).toBe(true);
    expect(b.events).toHaveLength(count);
    // A moved cursor alone is a change.
    hub.update(aId, presence('slide-1', 0.7));
    expect(b.events).toHaveLength(count + 1);
    expect(
      hub.peers('deck').find((p) => p.connectionId === hub.peerIdOf(aId))?.cursor?.point.x,
    ).toBe(0.7);
    hub.leave(aId);
    hub.leave(bId);
  });

  it('commentsChanged reaches everyone in the deck, the author included', () => {
    const { hub, inbox } = setup();
    const a = inbox();
    const b = inbox();
    const ids = [hub.join('deck', anna, a.send), hub.join('deck', ben, b.send)];
    hub.commentsChanged('deck');
    expect(a.events.at(-1)).toEqual({ type: 'comments' });
    expect(b.events.at(-1)).toEqual({ type: 'comments' });
    for (const id of ids) hub.leave(id);
  });

  it('sweep drops connections silent for longer than LIVE_STALE_MS, keeps the others', () => {
    const { hub, inbox, advance } = setup();
    const stale = hub.join('deck', anna, inbox().send);
    const stalePeer = hub.peerIdOf(stale);
    const watcher = inbox();
    const fresh = hub.join('deck', ben, watcher.send);
    advance(LIVE_STALE_MS - 1);
    hub.update(fresh, presence(null));
    hub.sweep();
    expect(hub.has(stale)).toBe(true);

    advance(2);
    hub.sweep();
    expect(hub.has(stale)).toBe(false);
    expect(hub.has(fresh)).toBe(true);
    expect(watcher.events.at(-1)).toEqual({ type: 'leave', connectionId: stalePeer });
    hub.leave(fresh);
  });

  it('peers only ever see public ids, which neither move nor end a connection', () => {
    const { hub, inbox } = setup();
    const a = inbox();
    const b = inbox();
    const aKey = hub.join('deck', anna, a.send);
    const bKey = hub.join('deck', ben, b.send);
    hub.update(aKey, presence('slide-1'));
    const seenByBen = JSON.stringify(b.events);
    expect(seenByBen).not.toContain(aKey);
    expect(JSON.stringify(a.events)).not.toContain(bKey);

    const annaPublic = hub.peerIdOf(aKey)!;
    expect(seenByBen).toContain(annaPublic);
    // Ben knows Anna's public id – it gets him nowhere.
    expect(hub.update(annaPublic, presence('slide-9'))).toBe(false);
    hub.leave(annaPublic);
    expect(hub.has(aKey)).toBe(true);
    expect(hub.peers('deck').find((p) => p.author.id === 'anna')?.activeSlideId).toBe('slide-1');
    hub.leave(aKey);
    hub.leave(bKey);
  });

  it('removes the room with its last connection; leaving twice is harmless', () => {
    const { hub, inbox } = setup();
    const a = inbox();
    const aId = hub.join('deck', anna, a.send);
    hub.leave(aId);
    hub.leave(aId);
    expect(hub.has(aId)).toBe(false);
    expect(hub.peers('deck')).toEqual([]);
    // Nobody left to hear the goodbye, not even the one who left.
    expect(a.events).toHaveLength(1);
    // A new joiner starts an empty room.
    const b = inbox();
    const bId = hub.join('deck', ben, b.send);
    expect(b.events).toEqual([{ type: 'hello', connectionId: bId, peers: [] }]);
    hub.leave(bId);
  });
});
