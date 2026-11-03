import { randomBytes, randomUUID } from 'node:crypto';
import {
  SITE_COMMENT_TTL_MS,
  SITE_HEARTBEAT_MS,
  type SiteColor,
  type SiteComment,
  type SiteLiveEvent,
  type SiteLiveInput,
  type SitePointer,
  type SiteVisitor,
} from '@slider/shared';

/**
 * Live comments on the product website: one room per page, everything in memory, nothing stored.
 * A comment goes {@link SITE_COMMENT_TTL_MS} after it was last touched (written, answered, opened).
 * Kept small on purpose – it runs inside Slider's API and must never cost the app anything:
 * bounded rooms, comments and posts, no database, timers only while comments exist.
 */

/** Visitors per page; who comes later is told the room is full (and still sees the site). */
export const SITE_ROOM_MAX = 40;
/** Open streams per address (several tabs, a reconnect overlapping the old stream). */
export const SITE_MAX_PER_ADDRESS = 8;
/**
 * A stream not heard from this long is gone: Bun's Node HTTP layer doesn't report closed streams,
 * so pages post `here` every {@link SITE_HEARTBEAT_MS} (moves and writes count too).
 */
export const SITE_STALE_MS = SITE_HEARTBEAT_MS * 2.5;
export const SITE_MAX_COMMENTS = 40;
export const SITE_MAX_REPLIES = 20;
/** Pointer moves per second and stream; the website sends at most ~15. */
const MOVES_PER_SECOND = 25;
/** Comments and replies per minute and stream. */
const WRITES_PER_MINUTE = 8;
/** Touches per second and stream (hover, typing) – each is fanned out to the room. */
const TOUCHES_PER_SECOND = 4;
const COLORS: SiteColor[] = ['blue', 'violet', 'green', 'yellow', 'cyan'];

type Send = (event: SiteLiveEvent) => void;

interface Connection {
  key: string;
  page: string;
  address: string;
  visitor: SiteVisitor;
  pointer: SitePointer;
  send: Send;
  close: () => void;
  moves: Window;
  writes: Window;
  touches: Window;
  lastSeen: number;
}

interface Window {
  since: number;
  count: number;
}

interface LiveComment extends Omit<SiteComment, 'left'> {
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

interface Room {
  connections: Map<string, Connection>;
  comments: Map<string, LiveComment>;
}

export type SiteJoin = { ok: true; key: string } | { ok: false; reason: 'full' | 'busy' };

export class SiteLive {
  private readonly rooms = new Map<string, Room>();
  private readonly byKey = new Map<string, Connection>();

  constructor(
    private readonly now: () => number = Date.now,
    readonly heartbeatMs = 5_000,
  ) {}

  join(
    page: string,
    address: string,
    wish: { name?: string; color?: SiteColor },
    send: Send,
    close: () => void,
  ): SiteJoin {
    let fromAddress = 0;
    for (const connection of this.byKey.values())
      if (connection.address === address) fromAddress += 1;
    if (fromAddress >= SITE_MAX_PER_ADDRESS) return { ok: false, reason: 'busy' };
    const room = this.room(page);
    if (room.connections.size >= SITE_ROOM_MAX) return { ok: false, reason: 'full' };

    const id = randomUUID().slice(0, 8);
    const visitor: SiteVisitor = {
      id,
      name: wish.name ?? 'Guest',
      color: wish.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]!,
    };
    const key = randomBytes(18).toString('base64url');
    const start = (): Window => ({ since: this.now(), count: 0 });
    const connection: Connection = {
      key,
      page,
      address,
      visitor,
      pointer: { id, a: null, x: 0, y: 0 },
      send,
      close,
      moves: start(),
      writes: start(),
      touches: start(),
      lastSeen: this.now(),
    };
    send({
      type: 'hello',
      key,
      you: visitor,
      visitors: [...room.connections.values()].map((c) => c.visitor),
      pointers: [...room.connections.values()].map((c) => c.pointer).filter((p) => p.a),
      comments: [...room.comments.values()].map((c) => this.view(c)),
    });
    this.broadcast(room, { type: 'join', visitor });
    room.connections.set(key, connection);
    this.byKey.set(key, connection);
    return { ok: true, key };
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** Still open and heard from lately; a silent stream is dropped here (the route's loop asks). */
  alive(key: string): boolean {
    const connection = this.byKey.get(key);
    if (!connection) return false;
    if (this.now() - connection.lastSeen <= SITE_STALE_MS) return true;
    this.leave(key);
    return false;
  }

  leave(key: string): void {
    const connection = this.byKey.get(key);
    if (!connection) return;
    this.byKey.delete(key);
    const room = this.rooms.get(connection.page);
    if (!room) return;
    room.connections.delete(key);
    this.broadcast(room, { type: 'leave', id: connection.visitor.id });
    this.dropIfEmpty(connection.page, room);
  }

  /** A post from the stream signed by `key`. False: unknown key (the browser reconnects). */
  post(key: string, input: SiteLiveInput): boolean {
    const connection = this.byKey.get(key);
    if (!connection) return false;
    const room = this.rooms.get(connection.page);
    if (!room) return false;
    const { visitor } = connection;
    connection.lastSeen = this.now();

    switch (input.type) {
      case 'move': {
        if (!this.admit(connection.moves, MOVES_PER_SECOND, 1_000)) return true;
        connection.pointer = { id: visitor.id, a: input.a, x: input.x, y: input.y };
        this.broadcast(room, { type: 'move', pointer: connection.pointer }, key);
        return true;
      }
      case 'comment': {
        if (room.comments.size >= SITE_MAX_COMMENTS) return true;
        if (!this.admit(connection.writes, WRITES_PER_MINUTE, 60_000)) return true;
        const id = randomUUID().slice(0, 12);
        const comment: LiveComment = {
          id,
          by: { ...visitor },
          a: input.a,
          x: input.x,
          y: input.y,
          ...(input.w && input.h ? { w: input.w, h: input.h } : {}),
          text: input.text,
          replies: [],
          expiresAt: 0,
        };
        room.comments.set(id, comment);
        this.extend(connection.page, room, comment);
        this.broadcast(room, { type: 'comment', comment: this.view(comment) });
        return true;
      }
      case 'reply': {
        const comment = room.comments.get(input.id);
        if (!comment || comment.replies.length >= SITE_MAX_REPLIES) return true;
        if (!this.admit(connection.writes, WRITES_PER_MINUTE, 60_000)) return true;
        const reply = { id: randomUUID().slice(0, 12), by: { ...visitor }, text: input.text };
        comment.replies.push(reply);
        this.extend(connection.page, room, comment);
        this.broadcast(room, { type: 'reply', id: comment.id, reply, left: SITE_COMMENT_TTL_MS });
        return true;
      }
      case 'touch': {
        const comment = room.comments.get(input.id);
        if (!comment || !this.admit(connection.touches, TOUCHES_PER_SECOND, 1_000)) return true;
        this.extend(connection.page, room, comment);
        this.broadcast(room, { type: 'touch', id: comment.id, left: SITE_COMMENT_TTL_MS });
        return true;
      }
      case 'name': {
        visitor.name = input.name;
        // Others learn the new name with the next join/comment; pointers carry only the id.
        this.broadcast(room, { type: 'join', visitor }, key);
        return true;
      }
      case 'here':
        return true;
      case 'bye': {
        connection.close();
        this.leave(key);
        return true;
      }
    }
  }

  /** Ends every stream (shutdown, tests). */
  closeAll(): void {
    for (const connection of [...this.byKey.values()]) {
      connection.close();
      this.leave(connection.key);
    }
  }

  /** Visitors on a page right now (tests, logs). */
  count(page: string): number {
    return this.rooms.get(page)?.connections.size ?? 0;
  }

  private room(page: string): Room {
    let room = this.rooms.get(page);
    if (!room) {
      room = { connections: new Map(), comments: new Map() };
      this.rooms.set(page, room);
    }
    return room;
  }

  /** A comment stays another full TTL from now. */
  private extend(page: string, room: Room, comment: LiveComment): void {
    clearTimeout(comment.timer);
    comment.expiresAt = this.now() + SITE_COMMENT_TTL_MS;
    comment.timer = setTimeout(() => {
      room.comments.delete(comment.id);
      this.broadcast(room, { type: 'gone', id: comment.id });
      this.dropIfEmpty(page, room);
    }, SITE_COMMENT_TTL_MS);
    comment.timer.unref?.();
  }

  private dropIfEmpty(page: string, room: Room): void {
    if (room.connections.size === 0 && room.comments.size === 0) this.rooms.delete(page);
  }

  private view(comment: LiveComment): SiteComment {
    const { expiresAt, timer: _timer, ...rest } = comment;
    return { ...rest, left: Math.max(0, expiresAt - this.now()) };
  }

  private admit(window: Window, limit: number, spanMs: number): boolean {
    const now = this.now();
    if (now - window.since >= spanMs) {
      window.since = now;
      window.count = 0;
    }
    window.count += 1;
    return window.count <= limit;
  }

  private broadcast(room: Room, event: SiteLiveEvent, except?: string): void {
    for (const connection of room.connections.values()) {
      if (connection.key !== except) connection.send(event);
    }
  }
}
