import { LIVE_EVENT, type LiveEvent, type LivePeer } from '@slider/shared';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectLive, useLiveConnected } from './live-store';
import { useLivePeople } from './live-people';

vi.mock('../../hooks/useColorOverrides', () => ({ useColorOverrides: () => ({}) }));

class FakeEventSource {
  static readonly CLOSED = 2;
  static latest: FakeEventSource;
  readyState = 1;
  listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor() {
    FakeEventSource.latest = this;
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {}
  emit(event: LiveEvent) {
    for (const listener of this.listeners.get(LIVE_EVENT) ?? [])
      listener({ data: JSON.stringify(event) });
  }
}

const peer = (x: number): LivePeer =>
  ({
    connectionId: 'p1',
    author: { id: 'a1', name: 'Anna', type: 'owner', color: 'blue' },
    activeSlideId: 's1',
    cursor: { slideId: 's1', point: { x, y: 0.5 } },
    focusedThreadId: null,
  }) as LivePeer;

let disconnect: () => void;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
  vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
  disconnect = connectLive('d1', () => undefined);
});

afterEach(() => {
  act(() => disconnect());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live hooks', () => {
  it('re-render on connection and presence changes, not on every cursor move', () => {
    let connectedRenders = 0;
    let peopleRenders = 0;
    let connected = false;
    function Connected() {
      connected = useLiveConnected();
      connectedRenders += 1;
      return null;
    }
    function People() {
      useLivePeople();
      peopleRenders += 1;
      return null;
    }
    render(
      <>
        <Connected />
        <People />
      </>,
    );
    act(() => FakeEventSource.latest.emit({ type: 'hello', connectionId: 'me', peers: [peer(0)] }));
    expect(connected).toBe(true);
    const [connectedBefore, peopleBefore] = [connectedRenders, peopleRenders];

    for (let x = 1; x <= 20; x += 1)
      act(() => FakeEventSource.latest.emit({ type: 'peer', peer: peer(x / 40) }));

    expect(connectedRenders).toBe(connectedBefore);
    expect(peopleRenders).toBe(peopleBefore);
  });
});
