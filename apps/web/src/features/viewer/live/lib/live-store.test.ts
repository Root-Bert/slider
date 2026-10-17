import { LIVE_EVENT, LIVE_HEARTBEAT_MS, type LiveEvent, type LivePeer } from '@slider/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubStorage } from '@/test/storage';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  listeners = new Map<string, ((event: unknown) => void)[]>();
  close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED;
  });
  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(event: LiveEvent) {
    for (const listener of this.listeners.get(LIVE_EVENT) ?? [])
      listener({ data: JSON.stringify(event) });
  }
  fail(readyState: number) {
    this.readyState = readyState;
    for (const listener of this.listeners.get('error') ?? []) listener({});
  }
}

const peer = (connectionId: string, x = 0.5): LivePeer =>
  ({
    connectionId,
    author: { id: `a-${connectionId}`, name: connectionId, type: 'owner', color: 'blue' },
    activeSlideId: 's1',
    cursor: { slideId: 's1', point: { x, y: 0.5 } },
    focusedThreadId: null,
  }) as LivePeer;

let fetch: ReturnType<typeof vi.fn>;
let sendBeacon: ReturnType<typeof vi.fn>;
let now = 1_000;
let session: ReturnType<typeof stubStorage>;

async function load(previousTab?: string) {
  session = stubStorage(previousTab ? { 'slider.liveTab': previousTab } : {}, 'sessionStorage');
  return import('./live-store');
}

const latest = () => FakeEventSource.all.at(-1)!;
const posts = () => fetch.mock.calls.filter(([url]) => !String(url).endsWith('/leave'));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeEventSource.all = [];
  now = 1_000;
  fetch = vi.fn().mockResolvedValue({ status: 204 });
  sendBeacon = vi.fn(() => true);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('navigator', { sendBeacon });
  vi.stubGlobal('performance', { now: () => now });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connectLive', () => {
  it('takes over the reloaded tab only on the first connection', async () => {
    const live = await load('old-tab');
    const tab = session.values.get('slider.liveTab');
    expect(tab).toBeTruthy();
    expect(tab).not.toBe('old-tab');

    const close = live.connectLive('d 1', () => undefined);
    const first = new URL(latest().url, 'http://x');
    expect(first.pathname).toBe('/api/decks/d%201/live');
    expect(first.searchParams.get('tab')).toBe(tab);
    expect(first.searchParams.get('replaces')).toBe('old-tab');
    expect(latest().init).toEqual({ withCredentials: true });
    close();

    live.connectLive('d1', () => undefined);
    expect(new URL(latest().url, 'http://x').searchParams.has('replaces')).toBe(false);
  });

  it('says hello: connected, peers, presence posted once and comments refreshed', async () => {
    const live = await load();
    const onComments = vi.fn();
    live.connectLive('d1', onComments);
    latest().emit({ type: 'hello', connectionId: 'me', peers: [peer('p1')] } as LiveEvent);
    expect(live.getLiveSnapshot().connected).toBe(true);
    expect([...live.getLiveSnapshot().peers.keys()]).toEqual(['p1']);
    expect(live.lastMoved.get('p1')).toBe(1_000);
    expect(onComments).toHaveBeenCalledOnce();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![0]).toBe('/api/live/me');
    expect(JSON.parse((posts()[0]![1] as RequestInit).body as string)).toEqual({
      activeSlideId: null,
      cursor: null,
      focusedThreadId: null,
    });
  });

  it('tracks when peers move and drops those who leave', async () => {
    const live = await load();
    live.connectLive('d1', () => undefined);
    const source = latest();
    source.emit({ type: 'hello', connectionId: 'me', peers: [peer('p1')] } as LiveEvent);

    now = 2_000;
    source.emit({ type: 'peer', peer: peer('p1') } as LiveEvent);
    expect(live.lastMoved.get('p1')).toBe(1_000);
    source.emit({ type: 'peer', peer: peer('p1', 0.7) } as LiveEvent);
    expect(live.lastMoved.get('p1')).toBe(2_000);

    const before = live.getLiveSnapshot();
    source.emit({ type: 'leave', connectionId: 'nobody' } as LiveEvent);
    expect(live.getLiveSnapshot()).toBe(before);
    source.emit({ type: 'leave', connectionId: 'p1' } as LiveEvent);
    expect(live.getLiveSnapshot().peers.size).toBe(0);
    expect(live.lastMoved.has('p1')).toBe(false);
  });

  it('refreshes comments on a comments event', async () => {
    const live = await load();
    const onComments = vi.fn();
    live.connectLive('d1', onComments);
    latest().emit({ type: 'comments' } as LiveEvent);
    expect(onComments).toHaveBeenCalledOnce();
  });
});

describe('setPresence', () => {
  async function connected() {
    const live = await load();
    live.connectLive('d1', () => undefined);
    latest().emit({ type: 'hello', connectionId: 'me', peers: [] } as LiveEvent);
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockClear();
    return live;
  }

  it('does nothing without a connection or for an unchanged presence', async () => {
    const live = await load();
    live.setPresence({ activeSlideId: 's1' });
    expect(fetch).not.toHaveBeenCalled();
    const open = await connected();
    open.setPresence({ activeSlideId: null, cursor: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throttles posts and never overlaps them', async () => {
    const live = await connected();
    now += 100;
    let resolve!: (value: { status: number }) => void;
    fetch.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    live.setPresence({ activeSlideId: 's1' });
    expect(posts()).toHaveLength(1);
    live.setPresence({ activeSlideId: 's2' });
    expect(posts()).toHaveLength(1);
    resolve({ status: 204 });
    await vi.advanceTimersByTimeAsync(0);
    // Within 40 ms of the last post: waits.
    expect(posts()).toHaveLength(1);
    now += 40;
    await vi.advanceTimersByTimeAsync(40);
    expect(posts()).toHaveLength(2);
    expect(JSON.parse((posts()[1]![1] as RequestInit).body as string).activeSlideId).toBe('s2');
  });

  it('re-posts as a heartbeat', async () => {
    await connected();
    now += LIVE_HEARTBEAT_MS;
    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS);
    expect(posts()).toHaveLength(1);
  });

  it('reconnects when the server forgot the connection', async () => {
    const live = await connected();
    const first = latest();
    fetch.mockResolvedValueOnce({ status: 404 });
    now += 100;
    live.setPresence({ activeSlideId: 's1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sendBeacon).toHaveBeenCalledWith('/api/live/me/leave');
    expect(first.close).toHaveBeenCalled();
    expect(live.getLiveSnapshot().connected).toBe(false);
    expect(FakeEventSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeEventSource.all).toHaveLength(2);
  });
});

describe('stream errors', () => {
  it('only marks the connection offline while the browser retries', async () => {
    const live = await load();
    live.connectLive('d1', () => undefined);
    latest().emit({ type: 'hello', connectionId: 'me', peers: [] } as LiveEvent);
    latest().fail(FakeEventSource.CONNECTING);
    expect(live.getLiveSnapshot().connected).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeEventSource.all).toHaveLength(1);
  });

  it('starts over after the browser gave up', async () => {
    const live = await load();
    live.connectLive('d1', () => undefined);
    latest().fail(FakeEventSource.CLOSED);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeEventSource.all).toHaveLength(2);
  });
});

describe('closing', () => {
  it('says goodbye, stops timers and resets the snapshot', async () => {
    const live = await load();
    const close = live.connectLive('d1', () => undefined);
    const source = latest();
    source.emit({ type: 'hello', connectionId: 'me', peers: [peer('p1')] } as LiveEvent);
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockClear();
    close();
    expect(sendBeacon).toHaveBeenCalledWith('/api/live/me/leave');
    expect(source.close).toHaveBeenCalled();
    expect(live.getLiveSnapshot()).toEqual({ connected: false, peers: new Map() });
    expect(live.lastMoved.size).toBe(0);
    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS * 2);
    expect(fetch).not.toHaveBeenCalled();
    source.emit({ type: 'hello', connectionId: 'me', peers: [peer('p2')] } as LiveEvent);
    expect(live.getLiveSnapshot().peers.size).toBe(0);
  });

  it('says goodbye when the page is hidden', async () => {
    const live = await load();
    live.connectLive('d1', () => undefined);
    latest().emit({ type: 'hello', connectionId: 'me', peers: [] } as LiveEvent);
    for (const listener of session.listeners.get('pagehide') ?? []) listener({});
    expect(sendBeacon).toHaveBeenCalledWith('/api/live/me/leave');
  });
});

describe('hidden tabs', () => {
  const page = { hidden: false, listeners: new Set<() => void>() };
  const setHidden = (hidden: boolean) => {
    page.hidden = hidden;
    for (const listener of page.listeners) listener();
  };
  beforeEach(() => {
    page.hidden = false;
    page.listeners.clear();
    vi.stubGlobal('document', {
      get hidden() {
        return page.hidden;
      },
      addEventListener: (_type: string, listener: () => void) => page.listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => page.listeners.delete(listener),
    });
  });

  it('lets go of the stream while hidden and says hello again when shown', async () => {
    const live = await load();
    const onComments = vi.fn();
    const close = live.connectLive('d1', onComments);
    const first = latest();
    first.emit({ type: 'hello', connectionId: 'me', peers: [peer('p1')] } as LiveEvent);
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockClear();

    // Hidden: the connection is freed for the other tabs, and the others see us leave.
    setHidden(true);
    expect(first.close).toHaveBeenCalled();
    expect(sendBeacon).toHaveBeenCalledWith('/api/live/me/leave');
    expect(live.getLiveSnapshot()).toEqual({ connected: false, peers: new Map() });
    // No heartbeat, no reconnect while hidden; a late event of the old stream is ignored.
    now += LIVE_HEARTBEAT_MS * 2;
    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS * 2);
    expect(fetch).not.toHaveBeenCalled();
    expect(FakeEventSource.all).toHaveLength(1);
    first.emit({ type: 'hello', connectionId: 'old', peers: [peer('p2')] } as LiveEvent);
    expect(live.getLiveSnapshot().connected).toBe(false);

    // Shown again: a new stream; its hello refetches the comments missed meanwhile.
    setHidden(false);
    expect(FakeEventSource.all).toHaveLength(2);
    latest().emit({ type: 'hello', connectionId: 'me2', peers: [] } as LiveEvent);
    expect(live.getLiveSnapshot().connected).toBe(true);
    expect(onComments).toHaveBeenCalledTimes(2);
    close();
    expect(page.listeners.size).toBe(0);
  });

  it('opens no stream for a deck opened in a background tab until it shows', async () => {
    page.hidden = true;
    const live = await load();
    live.connectLive('d1', () => undefined);
    expect(FakeEventSource.all).toHaveLength(0);
    setHidden(false);
    expect(FakeEventSource.all).toHaveLength(1);
  });
});
