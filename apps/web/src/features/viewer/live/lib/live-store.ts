import {
  API_PREFIX,
  LIVE_EVENT,
  LIVE_HEARTBEAT_MS,
  type LiveEvent,
  type LivePeer,
  type LivePresenceInput,
} from '@slider/shared';
import { useSyncExternalStore } from 'react';
import { sameCursor } from './cursor-anchor';

/**
 * The open deck's realtime connection (BER-104): one `EventSource` per viewer, the peers it
 * reports, and the presence this viewer posts back. Outside React state – cursors move many times
 * a second; components read through the hooks below, the cursor layer reads every frame.
 */

export interface LiveSnapshot {
  connected: boolean;
  /** Other open viewers (other people and your own other tabs) by connection id. */
  peers: ReadonlyMap<string, LivePeer>;
}

/** When a peer's cursor last moved (`performance.now()`), for the idle look. */
export const lastMoved = new Map<string, number>();

let snapshot: LiveSnapshot = { connected: false, peers: new Map() };
const listeners = new Set<() => void>();

function setSnapshot(next: Partial<LiveSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getLiveSnapshot = () => snapshot;

export function useLiveSnapshot(): LiveSnapshot {
  return useSyncExternalStore(subscribe, getLiveSnapshot);
}

/**
 * A string derived from the snapshot: the component re-renders only when it changes – not on
 * every cursor move.
 */
export function useLiveKey(select: (snapshot: LiveSnapshot) => string): string {
  return useSyncExternalStore(subscribe, () => select(snapshot));
}

/** Whether the stream is up – re-renders only when that flips, not on cursor moves. */
export const useLiveConnected = () =>
  useLiveKey((current) => (current.connected ? '1' : '')) === '1';

// ── Connection ──────────────────────────────────────────────────────────────

/** Never post presence faster than this (ms) – the others interpolate in between. */
const POST_INTERVAL_MS = 40;
/** After a dropped stream: wait, then reconnect (EventSource's own retry gives up on HTTP errors). */
const RECONNECT_MS = 2_000;

/**
 * This page load's tab id, and the one before it in this tab (kept in `sessionStorage`, which
 * survives a reload): the server drops the reloaded page's connection right away instead of
 * letting its cursor linger until it times out.
 */
const TAB_KEY = 'slider.liveTab';
const TAB_ID = crypto.randomUUID();
let replacedTab: string | null = (() => {
  try {
    const previous = sessionStorage.getItem(TAB_KEY);
    sessionStorage.setItem(TAB_KEY, TAB_ID);
    return previous;
  } catch {
    return null;
  }
})();

function liveUrl(deckId: string) {
  const params = new URLSearchParams({ tab: TAB_ID });
  // Only the first connection of a page load takes over the old page's.
  if (replacedTab) params.set('replaces', replacedTab);
  replacedTab = null;
  return `${API_PREFIX}/decks/${encodeURIComponent(deckId)}/live?${params}`;
}

interface Connection {
  deckId: string;
  source: EventSource | null;
  connectionId: string | null;
  presence: LivePresenceInput;
  /** Presence changed since the last post. */
  dirty: boolean;
  inFlight: boolean;
  lastPost: number;
  timer: ReturnType<typeof setTimeout> | null;
  reconnect: ReturnType<typeof setTimeout> | null;
  heartbeat: ReturnType<typeof setInterval>;
  onComments: () => void;
  closed: boolean;
  /** The tab is hidden: the stream is let go until it shows again (`suspend`). */
  suspended: boolean;
}

const isHidden = () => typeof document !== 'undefined' && document.hidden;

let current: Connection | null = null;

/** Opens the deck's stream; returns the function that closes it. */
export function connectLive(deckId: string, onComments: () => void): () => void {
  const connection: Connection = {
    deckId,
    source: null,
    connectionId: null,
    presence: { activeSlideId: null, cursor: null, focusedThreadId: null },
    dirty: true,
    inFlight: false,
    lastPost: 0,
    timer: null,
    reconnect: null,
    // Posting the same presence again tells the server we're still here.
    heartbeat: setInterval(() => {
      connection.dirty = true;
      flush(connection);
    }, LIVE_HEARTBEAT_MS),
    onComments,
    closed: false,
    suspended: isHidden(),
  };
  current = connection;
  if (!connection.suspended) open(connection);
  // Closing the tab: say goodbye, so the others drop our cursor right away.
  const onPageHide = () => sayGoodbye(connection);
  window.addEventListener('pagehide', onPageHide);
  // A hidden tab lets go of its stream: over HTTP/1.1 a browser opens six connections per
  // server, shared by all tabs – six open decks would hold them all and stall every request.
  // Shown again, it says hello anew, which also refetches the comments it missed.
  const onVisibilityChange = () => {
    if (isHidden()) suspend(connection);
    else resume(connection);
  };
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onVisibilityChange);
    sayGoodbye(connection);
    connection.closed = true;
    clearInterval(connection.heartbeat);
    connection.source?.close();
    if (connection.timer) clearTimeout(connection.timer);
    if (connection.reconnect) clearTimeout(connection.reconnect);
    if (current === connection) {
      current = null;
      lastMoved.clear();
      setSnapshot({ connected: false, peers: new Map() });
    }
  };
}

function open(connection: Connection) {
  const source = new EventSource(liveUrl(connection.deckId), {
    withCredentials: true,
  });
  connection.source = source;
  // Events of a stream let go meanwhile (suspended, reconnected) are stale.
  const stale = () => connection.closed || connection.source !== source;
  source.addEventListener(LIVE_EVENT, (message) => {
    if (stale()) return;
    handle(connection, JSON.parse((message as MessageEvent<string>).data) as LiveEvent);
  });
  source.addEventListener('error', () => {
    if (stale()) return;
    connection.connectionId = null;
    setSnapshot({ connected: false });
    // The browser retries on its own while the stream merely dropped; after an HTTP error
    // (server restarting, 5xx) it gives up – then start over ourselves.
    if (source.readyState === EventSource.CLOSED) scheduleReconnect(connection);
  });
}

/** The server can't tell a closed stream reliably – leaving is announced (best effort). */
function sayGoodbye(connection: Connection) {
  const { connectionId } = connection;
  if (!connectionId) return;
  navigator.sendBeacon(`${API_PREFIX}/live/${encodeURIComponent(connectionId)}/leave`);
}

/** Lets go of the stream while the tab is hidden; the others drop our cursor and avatar. */
function suspend(connection: Connection) {
  if (connection.closed || connection.suspended) return;
  connection.suspended = true;
  sayGoodbye(connection);
  connection.source?.close();
  connection.source = null;
  connection.connectionId = null;
  if (connection.reconnect) clearTimeout(connection.reconnect);
  connection.reconnect = null;
  if (connection.timer) clearTimeout(connection.timer);
  connection.timer = null;
  if (current === connection) {
    lastMoved.clear();
    setSnapshot({ connected: false, peers: new Map() });
  }
}

function resume(connection: Connection) {
  if (connection.closed || !connection.suspended) return;
  connection.suspended = false;
  connection.dirty = true;
  open(connection);
}

function scheduleReconnect(connection: Connection) {
  if (connection.closed || connection.suspended || connection.reconnect) return;
  sayGoodbye(connection);
  connection.source?.close();
  connection.connectionId = null;
  setSnapshot({ connected: false });
  connection.reconnect = setTimeout(() => {
    connection.reconnect = null;
    if (!connection.closed && !connection.suspended) open(connection);
  }, RECONNECT_MS);
}

function handle(connection: Connection, event: LiveEvent) {
  switch (event.type) {
    case 'hello': {
      connection.connectionId = event.connectionId;
      const now = performance.now();
      for (const peer of event.peers) lastMoved.set(peer.connectionId, now);
      setSnapshot({
        connected: true,
        peers: new Map(event.peers.map((peer) => [peer.connectionId, peer])),
      });
      // Tell the others where we are; comments may have changed while we were away.
      connection.dirty = true;
      flush(connection);
      connection.onComments();
      return;
    }
    case 'peer': {
      const previous = snapshot.peers.get(event.peer.connectionId);
      if (!sameCursor(previous?.cursor ?? null, event.peer.cursor)) {
        lastMoved.set(event.peer.connectionId, performance.now());
      }
      const peers = new Map(snapshot.peers);
      peers.set(event.peer.connectionId, event.peer);
      setSnapshot({ peers });
      return;
    }
    case 'leave': {
      if (!snapshot.peers.has(event.connectionId)) return;
      const peers = new Map(snapshot.peers);
      peers.delete(event.connectionId);
      lastMoved.delete(event.connectionId);
      setSnapshot({ peers });
      return;
    }
    case 'comments':
      connection.onComments();
      return;
  }
}

/** Reports this viewer's presence; posts are throttled and never overlap. */
export function setPresence(next: Partial<LivePresenceInput>) {
  const connection = current;
  if (!connection) return;
  const presence = { ...connection.presence, ...next };
  if (
    presence.activeSlideId === connection.presence.activeSlideId &&
    presence.focusedThreadId === connection.presence.focusedThreadId &&
    sameCursor(presence.cursor, connection.presence.cursor)
  ) {
    return;
  }
  connection.presence = presence;
  connection.dirty = true;
  flush(connection);
}

function flush(connection: Connection) {
  if (!connection.dirty || connection.inFlight || connection.timer || !connection.connectionId) {
    return;
  }
  const wait = connection.lastPost + POST_INTERVAL_MS - performance.now();
  if (wait > 0) {
    connection.timer = setTimeout(() => {
      connection.timer = null;
      flush(connection);
    }, wait);
    return;
  }
  const { connectionId, presence } = connection;
  connection.dirty = false;
  connection.inFlight = true;
  connection.lastPost = performance.now();
  fetch(`${API_PREFIX}/live/${encodeURIComponent(connectionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(presence),
  })
    .then((response) => {
      // The server forgot us (restart): start a fresh stream, it says hello again.
      if (response.status === 404 && connection.connectionId === connectionId) {
        scheduleReconnect(connection);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      connection.inFlight = false;
      if (!connection.closed) flush(connection);
    });
}
