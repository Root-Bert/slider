import type { Author } from '@slider/shared';
import { LIVE_STALE_MS } from './live-hub';

interface Seen {
  author: Author;
  at: number;
}

/**
 * Who of a workspace is in Slider right now (the header's avatars): everyone whose tab posted a
 * heartbeat (`POST /workspaces/:id/presence`) or holds a deck's live stream in the last
 * {@link LIVE_STALE_MS}. In the API process like the {@link LiveHub}, nothing stored – after a
 * restart the next heartbeats fill it again.
 */
export class WorkspacePresence {
  private readonly workspaces = new Map<string, Map<string, Seen>>();
  private sweptAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** The person is here (again). */
  touch(workspaceId: string, author: Author): void {
    const now = this.now();
    let seen = this.workspaces.get(workspaceId);
    if (!seen) {
      seen = new Map();
      this.workspaces.set(workspaceId, seen);
    }
    seen.set(author.id, { author, at: now });
    // Workspaces nobody asks about anymore would keep their last visitors forever.
    if (now - this.sweptAt >= LIVE_STALE_MS) {
      this.sweptAt = now;
      for (const id of [...this.workspaces.keys()]) this.prune(id, now);
    }
  }

  /** Gone at once (removed from the workspace), not only once the heartbeats stop. */
  forget(workspaceId: string, authorId: string): void {
    this.workspaces.get(workspaceId)?.delete(authorId);
  }

  /** Who is here, but `exceptId` (the asker) – longest here first, so the row doesn't reshuffle. */
  online(workspaceId: string, exceptId: string): Author[] {
    this.prune(workspaceId, this.now());
    return [...(this.workspaces.get(workspaceId)?.values() ?? [])]
      .filter(({ author }) => author.id !== exceptId)
      .map(({ author }) => author);
  }

  private prune(workspaceId: string, now: number): void {
    const seen = this.workspaces.get(workspaceId);
    if (!seen) return;
    for (const [id, { at }] of seen) if (now - at > LIVE_STALE_MS) seen.delete(id);
    if (seen.size === 0) this.workspaces.delete(workspaceId);
  }
}
