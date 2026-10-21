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
/**
 * Open connections per person, over all decks: each holds a request open and re-checks access
 * every {@link LIVE_ACCESS_CHECK_MS}. Beyond this a new one is refused ({@link LiveHub.admits}) –
 * not the oldest ended, whose tab would reconnect and end the next one, round and round. Hidden
 * tabs let go of their stream, closed ones time out, so a refused tab gets in on a later retry.
 */
export const LIVE_MAX_CONNECTIONS_PER_PERSON = 30;
/**
 * Presence posts one connection may make per second; each is fanned out to the whole deck. The
 * client sends at most one per 40 ms (25/s); posts beyond this are dropped unheard.
 */
export const LIVE_MAX_POSTS_PER_SECOND = 30;

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
  /** Presence posts in the current second ({@link LIVE_MAX_POSTS_PER_SECOND}). */
  posts: { since: number; count: number };
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
  /** Per deck with open connections: the {@link commentChanges} count of its latest change. */
  private readonly commentGenerations = new Map<string, number>();
  /** Comment changes over all decks; only ever grows. */
  private commentChanges = 0;
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
   * right away. Ask {@link admits} first.
   */
  join(
    deckId: string,
    author: Author,
    send: Send,
    { tab, replaces }: LiveTab = { tab: null, replaces: null },
    close: Close | null = null,
  ): string {
    for (const old of [...(this.rooms.get(deckId)?.values() ?? [])]) {
      if (replacedBy(old, deckId, author.id, { tab, replaces })) this.leave(old.key);
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
      posts: { since: 0, count: 0 },
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

  /**
   * Whether the person may open another connection: fewer than
   * {@link LIVE_MAX_CONNECTIONS_PER_PERSON}, not counting the ones this one would replace.
   */
  admits(deckId: string, authorId: string, tab: LiveTab = { tab: null, replaces: null }): boolean {
    let open = 0;
    for (const old of this.connections.values()) {
      if (old.author.id === authorId && !replacedBy(old, deckId, authorId, tab)) open += 1;
    }
    return open < LIVE_MAX_CONNECTIONS_PER_PERSON;
  }

  /** Whether the connection with this secret key is open. */
  has(key: string): boolean {
    return this.connections.has(key);
  }

  /**
   * Counts a presence post of the connection: `false` beyond {@link LIVE_MAX_POSTS_PER_SECOND}
   * (or when the connection is gone) – such a post is dropped, the next one in time goes through.
   */
  admitPost(key: string): boolean {
    const connection = this.connections.get(key);
    if (!connection) return false;
    const now = this.now();
    const { posts } = connection;
    if (now - posts.since >= 1_000) {
      posts.since = now;
      posts.count = 0;
    }
    posts.count += 1;
    return posts.count <= LIVE_MAX_POSTS_PER_SECOND;
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
    if (room?.size === 0) {
      this.rooms.delete(connection.deckId);
      this.commentGenerations.delete(connection.deckId);
    }
    if (this.connections.size === 0) this.stopSweeper();
    connection.close?.();
    this.broadcast(connection.deckId, { type: 'leave', connectionId });
  }

  /**
   * Ends the deck's connections of everyone `keeps` turns away (access withdrawn): the others see
   * them leave, their browser reconnects and gets the 404.
   */
  evict(deckId: string, keeps: (authorId: string) => boolean): void {
    for (const connection of [...(this.rooms.get(deckId)?.values() ?? [])]) {
      if (!keeps(connection.author.id)) this.leave(connection.key);
    }
  }

  /** Shutdown: ends every stream at once, so the HTTP server can close (no goodbyes sent). */
  closeAll(): void {
    const all = [...this.connections.values()];
    this.connections.clear();
    this.rooms.clear();
    this.commentGenerations.clear();
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
    this.commentChanges += 1;
    if (this.rooms.has(deckId)) this.commentGenerations.set(deckId, this.commentChanges);
    this.broadcast(deckId, { type: 'comments' });
  }

  /**
   * Changes with {@link commentsChanged}: the refetches one change sets off may share one query,
   * but never one that started before the change. Kept per deck only while it has connections
   * (else the map would grow with every deck ever commented on); a deck without falls back to
   * the count over all decks – never lower than any value it had before, so an older query is
   * never shared, at worst a newer one is not.
   */
  commentsGeneration(deckId: string): number {
    return this.commentGenerations.get(deckId) ?? this.commentChanges;
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

/** A connection a new one of the person from the same (or the reloaded) tab takes over. */
const replacedBy = (
  old: Connection,
  deckId: string,
  authorId: string,
  { tab, replaces }: LiveTab,
) =>
  old.deckId === deckId &&
  old.author.id === authorId &&
  old.tab !== null &&
  (old.tab === tab || old.tab === replaces);

const toPeer = ({
  connectionId,
  author,
  activeSlideId,
  cursor,
  focusedThreadId,
}: LivePeer): LivePeer => ({ connectionId, author, activeSlideId, cursor, focusedThreadId });
