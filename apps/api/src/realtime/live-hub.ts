import type { Author, LiveEvent, LivePeer, LivePresenceInput } from '@slider/shared';

type Send = (event: LiveEvent) => void;
/** Ends the connection's stream (the browser then reconnects, or not, if access is gone). */
type Close = () => void;

/**
 * A connection not heard from this long is gone. Closed streams can't be relied on to report it
 * (Bun's Node HTTP layer doesn't), so clients post a heartbeat (`LIVE_HEARTBEAT_MS`) and say
 * goodbye when they can.
 */
export const LIVE_STALE_MS = 45_000;
const SWEEP_MS = 10_000;
/**
 * Keeps idle streams open through proxies and runtimes that close quiet connections (Bun's
 * default idle timeout is 10 s); a comment line, ignored by `EventSource`.
 */
export const LIVE_STREAM_HEARTBEAT_MS = 5_000;
/** An open stream re-checks session and deck access this often (removed members, deleted decks). */
export const LIVE_ACCESS_CHECK_MS = 30_000;

export interface LiveHubTiming {
  heartbeatMs?: number;
  accessCheckMs?: number;
}

interface Connection extends LivePeer {
  /**
   * The connection's secret, sent only in its own `hello`: presence posts and goodbyes are
   * accepted by it alone. Everyone else in the deck sees the public `connectionId`.
   */
  key: string;
  deckId: string;
  send: Send;
  close: Close | null;
  lastSeen: number;
  /** The browser tab (page load) the connection belongs to, if it said so. */
  tab: string | null;
}

/** Which tab a connection comes from – lets a reload take over its old connection at once. */
export interface LiveTab {
  /** This page load. A second connection of it (reconnect, React's dev double mount) replaces the first. */
  tab: string | null;
  /** The page load before a reload of the same tab: its connection is gone, drop it now. */
  replaces: string | null;
}

/**
 * Who has which deck open right now (BER-104), in the API process – like the in-process import
 * queue, one server holds all of it. Every open viewer is a connection; presence (active slide,
 * pointer) is kept per connection and fanned out to the others in the same deck. Nothing is
 * stored: a restart drops the streams, the browsers reconnect and say hello again.
 */
export class LiveHub {
  private readonly rooms = new Map<string, Map<string, Connection>>();
  /** By secret key; rooms are by public connection id. */
  private readonly connections = new Map<string, Connection>();
  private readonly commentGenerations = new Map<string, number>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  readonly heartbeatMs: number;
  readonly accessCheckMs: number;

  constructor(
    private readonly now: () => number = Date.now,
    timing: LiveHubTiming = {},
  ) {
    this.heartbeatMs = timing.heartbeatMs ?? LIVE_STREAM_HEARTBEAT_MS;
    this.accessCheckMs = timing.accessCheckMs ?? LIVE_ACCESS_CHECK_MS;
  }

  /**
   * Opens a connection; `send` gets the `hello` (with the others already here) right away.
   * Returns the connection's secret key – the `connectionId` of its `hello`, the only id presence
   * updates and goodbyes are accepted by. Peers learn a different, public id, so knowing someone's
   * peer id lets nobody move their cursor or kick them out.
   *
   * A closed stream isn't reported reliably, so after a reload the old connection would linger
   * until it times out: a connection of the same person from the same or the replaced tab goes
   * right away.
   */
  join(
    deckId: string,
    author: Author,
    send: Send,
    { tab, replaces }: LiveTab = { tab: null, replaces: null },
    close: Close | null = null,
  ): string {
    for (const old of [...(this.rooms.get(deckId)?.values() ?? [])]) {
      const sameTab = old.tab !== null && (old.tab === tab || old.tab === replaces);
      if (sameTab && old.author.id === author.id) this.leave(old.key);
    }
    const connection: Connection = {
      connectionId: crypto.randomUUID(),
      key: crypto.randomUUID(),
      deckId,
      author,
      activeSlideId: null,
      cursor: null,
      focusedThreadId: null,
      send,
      close,
      lastSeen: this.now(),
      tab,
    };
    let room = this.rooms.get(deckId);
    if (!room) {
      room = new Map();
      this.rooms.set(deckId, room);
    }
    send({
      type: 'hello',
      connectionId: connection.key,
      peers: [...room.values()].map(toPeer),
    });
    room.set(connection.connectionId, connection);
    this.connections.set(connection.key, connection);
    this.broadcast(deckId, { type: 'peer', peer: toPeer(connection) }, connection.connectionId);
    this.startSweeper();
    return connection.key;
  }

  /** Whether the connection with this secret key is open. */
  has(key: string): boolean {
    return this.connections.has(key);
  }

  /** The public id the others know the connection by (tests, diagnostics). */
  peerIdOf(key: string): string | null {
    return this.connections.get(key)?.connectionId ?? null;
  }

  leave(key: string): void {
    const connection = this.connections.get(key);
    if (!connection) return;
    const { connectionId } = connection;
    this.connections.delete(key);
    const room = this.rooms.get(connection.deckId);
    room?.delete(connectionId);
    if (room?.size === 0) this.rooms.delete(connection.deckId);
    if (this.connections.size === 0) this.stopSweeper();
    connection.close?.();
    this.broadcast(connection.deckId, { type: 'leave', connectionId });
  }

  /** Shutdown: ends every stream at once, so the HTTP server can close (no goodbyes sent). */
  closeAll(): void {
    const all = [...this.connections.values()];
    this.connections.clear();
    this.rooms.clear();
    this.stopSweeper();
    for (const connection of all) connection.close?.();
  }

  /**
   * Presence (or just a heartbeat, when nothing changed). `false` when the connection is gone
   * (server restarted, timed out) – the client reconnects.
   */
  update(key: string, input: LivePresenceInput): boolean {
    const connection = this.connections.get(key);
    if (!connection) return false;
    connection.lastSeen = this.now();
    if (
      connection.activeSlideId === input.activeSlideId &&
      connection.focusedThreadId === input.focusedThreadId &&
      JSON.stringify(connection.cursor) === JSON.stringify(input.cursor)
    ) {
      return true;
    }
    connection.activeSlideId = input.activeSlideId;
    connection.cursor = input.cursor;
    connection.focusedThreadId = input.focusedThreadId;
    this.broadcast(
      connection.deckId,
      { type: 'peer', peer: toPeer(connection) },
      connection.connectionId,
    );
    return true;
  }

  /** Comments of a deck changed: everyone there refetches them (the author too – other tabs). */
  commentsChanged(deckId: string): void {
    this.commentGenerations.set(deckId, this.commentsGeneration(deckId) + 1);
    this.broadcast(deckId, { type: 'comments' });
  }

  /**
   * Counts {@link commentsChanged} per deck: the refetches one change sets off may share one
   * query, but never one that started before the change.
   */
  commentsGeneration(deckId: string): number {
    return this.commentGenerations.get(deckId) ?? 0;
  }

  /** Open connections of a deck (tests, diagnostics). */
  peers(deckId: string): LivePeer[] {
    return [...(this.rooms.get(deckId)?.values() ?? [])].map(toPeer);
  }

  /** Drops connections without a sign of life for {@link LIVE_STALE_MS}. */
  sweep(): void {
    const cutoff = this.now() - LIVE_STALE_MS;
    for (const connection of [...this.connections.values()]) {
      if (connection.lastSeen < cutoff) this.leave(connection.key);
    }
  }

  private startSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref?.();
  }

  private stopSweeper() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  private broadcast(deckId: string, event: LiveEvent, except?: string): void {
    for (const connection of this.rooms.get(deckId)?.values() ?? []) {
      if (connection.connectionId !== except) connection.send(event);
    }
  }
}

const toPeer = ({
  connectionId,
  author,
  activeSlideId,
  cursor,
  focusedThreadId,
}: LivePeer): LivePeer => ({ connectionId, author, activeSlideId, cursor, focusedThreadId });
