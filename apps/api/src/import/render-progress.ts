import type { SlideRendering } from '@slider/shared';

/**
 * Background re-renders per deck (BER-94), in memory: what `GET /decks/:id/status` reports while
 * one is queued or running, and when the deck's images last changed, so open viewers reload
 * their slide list (the old image files are deleted).
 */
export class RenderProgress {
  private readonly active = new Map<string, SlideRendering>();
  private readonly finished = new Map<string, string>();

  queued(deckId: string): void {
    if (!this.active.has(deckId)) this.active.set(deckId, { status: 'queued', done: 0, total: 0 });
  }

  running(deckId: string, done: number, total: number): void {
    this.active.set(deckId, { status: 'running', done, total });
  }

  /** `changed`: the deck's slide images were replaced. */
  finish(deckId: string, changed: boolean, at: Date): void {
    this.active.delete(deckId);
    if (changed) this.finished.set(deckId, at.toISOString());
  }

  get(deckId: string): SlideRendering | null {
    return this.active.get(deckId) ?? null;
  }

  isActive(deckId: string): boolean {
    return this.active.has(deckId);
  }

  renderedAt(deckId: string): string | null {
    return this.finished.get(deckId) ?? null;
  }
}
