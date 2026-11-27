import {
  API_PREFIX,
  writeDiagram,
  type Author,
  type Diagram,
  type DiagramSaved,
} from '@slider/shared';
import { diagramLiveUrl, fetchDiagram, saveDiagram } from '@/lib/api';
import { accountHeader } from '@/lib/api-client';
import { retryDelay, sendOutcome } from '@/lib/outbox';

/*
 * The diagram kept in step with its file: what is drawn is saved a moment after the last change,
 * whole, one save after the other (no spinner – the canvas is the truth on the screen); someone
 * else's save is read and joined in (`mergeDiagrams`, on the server for a save, here for theirs).
 */

export type DiagramSyncState = 'saved' | 'saving' | 'offline' | 'signedOut';

const SAVE_AFTER_MS = 600;
const RECONNECT_MS = 3_000;
/** A page leaving may send this much on its way out (`keepalive`). */
const KEEPALIVE_BYTES = 60_000;

type LiveEvent =
  | { type: 'diagram'; versionId: string; clientId: string }
  | { type: 'people'; people: Author[] }
  | { type: 'restored' }
  | { type: string };

interface Options {
  diagramId: string;
  versionId: string | null;
  diagram: Diagram;
  /** The diagram as drawn now. */
  current: () => Diagram;
  /** Theirs, saved on `base`: to be joined into what is drawn (and its steps). */
  onJoined: (base: Diagram, theirs: Diagram) => void;
  onState: (state: DiagramSyncState) => void;
  onRefused: (message: string) => void;
  onPeople: (people: Author[]) => void;
  /** What the file holds now, as saved or read: for whoever opens it next. */
  onSaved?: (versionId: string | null, diagram: Diagram) => void;
}

export class DiagramSync {
  readonly clientId = crypto.randomUUID();
  private versionId: string | null;
  /** The diagram as the file holds it, as far as known: what theirs is joined on. */
  private synced: Diagram;
  private timer = 0;
  private retryTimer = 0;
  private sending = false;
  private tries = 0;
  /** Someone else saved: read the file once nothing of one's own is on its way. */
  private stale = false;
  private gone = false;
  private state: DiagramSyncState = 'saved';
  private source: EventSource | null = null;
  private reconnect = 0;

  constructor(private readonly options: Options) {
    this.versionId = options.versionId;
    this.synced = options.diagram;
  }

  /** Listens for the others: their saves and who has it open. */
  listen(): void {
    let down = false;
    const open = () => {
      if (this.gone) return;
      const stream = new EventSource(diagramLiveUrl(this.options.diagramId), {
        withCredentials: true,
      });
      this.source = stream;
      stream.addEventListener('open', () => {
        // Back after a gap: what was saved meanwhile is read.
        if (down) this.markStale();
        down = false;
      });
      stream.addEventListener('document', (message) => {
        const event = JSON.parse((message as MessageEvent<string>).data) as LiveEvent;
        if (event.type === 'people' && 'people' in event) this.options.onPeople(event.people);
        else if (event.type === 'diagram' && 'clientId' in event) {
          if (event.clientId !== this.clientId && event.versionId !== this.versionId) {
            this.markStale();
          }
        } else if (event.type === 'restored') void this.restore();
      });
      stream.addEventListener('error', () => {
        down = true;
        if (stream.readyState === EventSource.CLOSED && !this.gone) {
          this.reconnect = window.setTimeout(open, RECONNECT_MS);
        }
      });
    };
    open();
  }

  /** Something was drawn: saved a moment after the last change. */
  changed(): void {
    if (this.gone) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.pump(), SAVE_AFTER_MS);
    this.set('saving');
  }

  /** Leaving: what is not saved yet goes now (on its way out, if it is small enough). */
  flush(): void {
    window.clearTimeout(this.timer);
    const diagram = this.options.current();
    if (this.sending || writeDiagram(diagram) === writeDiagram(this.synced)) return;
    const body = JSON.stringify({
      diagram,
      baseVersionId: this.versionId,
      clientId: this.clientId,
    });
    if (body.length > KEEPALIVE_BYTES) {
      void this.pump();
      return;
    }
    const from = this.versionId;
    void fetch(`${API_PREFIX}/diagrams/${encodeURIComponent(this.options.diagramId)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...accountHeader() },
      body,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const saved = (await response.json()) as DiagramSaved;
        // Still here (back from the page's cache): the next save goes on this version, not the
        // one before – joined on that, what was deleted since would come back.
        if (this.gone || this.sending || this.versionId !== from) return;
        this.versionId = saved.versionId;
        this.synced = saved.diagram;
        this.options.onSaved?.(saved.versionId, saved.diagram);
        if (saved.joined) this.options.onJoined(diagram, saved.diagram);
      })
      .catch(() => {});
  }

  stop(): void {
    this.flush();
    this.gone = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.reconnect);
    this.source?.close();
  }

  private set(state: DiagramSyncState) {
    if (state === this.state) return;
    this.state = state;
    this.options.onState(state);
  }

  private markStale() {
    this.stale = true;
    if (!this.sending && this.state !== 'saving') void this.refresh();
  }

  private async pump(): Promise<void> {
    if (this.sending) return;
    window.clearTimeout(this.retryTimer);
    const diagram = this.options.current();
    if (writeDiagram(diagram) === writeDiagram(this.synced)) {
      this.set('saved');
      if (this.stale) void this.refresh();
      return;
    }
    this.sending = true;
    this.tries += 1;
    // Someone's save known so far is joined in by this one on the server; one heard of while it
    // is on its way may come after it, so it stays marked and is read afterwards.
    this.stale = false;
    try {
      const saved = await saveDiagram(this.options.diagramId, {
        diagram,
        baseVersionId: this.versionId,
        clientId: this.clientId,
      });
      this.tries = 0;
      this.versionId = saved.versionId;
      this.synced = saved.diagram;
      this.options.onSaved?.(saved.versionId, saved.diagram);
      // Someone else's changes came back with it: joined into what is drawn now.
      if (saved.joined && !this.gone) this.options.onJoined(diagram, saved.diagram);
    } catch (error) {
      this.sending = false;
      const outcome = sendOutcome(error, this.tries);
      if (outcome === 'refused') {
        this.tries = 0;
        if (!this.gone) {
          this.options.onRefused(error instanceof Error ? error.message : 'Nicht gespeichert');
          // What the file holds is read again: the canvas never shows what is not kept.
          this.stale = true;
          void this.refresh(true);
        }
        return;
      }
      this.set(outcome === 'signedOut' ? 'signedOut' : 'offline');
      if (outcome !== 'signedOut') {
        this.retryTimer = window.setTimeout(() => void this.pump(), retryDelay(this.tries));
      }
      return;
    }
    this.sending = false;
    // Left while it was on its way: what was drawn since goes now, on the way out.
    if (this.gone) return this.flush();
    // Drawn on meanwhile: that is saved next (and joins in theirs).
    if (this.options.current() !== diagram) this.changed();
    else {
      this.set('saved');
      if (this.stale) void this.refresh();
    }
  }

  /** Reads the file and joins in what someone else saved. `take`: the file's diagram as it is. */
  private async refresh(take = false): Promise<void> {
    if (!this.stale || this.sending || this.gone) return;
    this.stale = false;
    const from = this.versionId;
    try {
      const opened = await fetchDiagram(this.options.diagramId);
      if (this.gone) return;
      // A save of one's own went out meanwhile: what was read may be older than it – read again
      // once it is back (`pump` does), never put over it.
      if (this.sending || this.versionId !== from) {
        this.stale = true;
        if (!this.sending) void this.refresh(take);
        return;
      }
      if (!take && opened.file.versionId === this.versionId) return;
      const base = take ? this.options.current() : this.synced;
      this.versionId = opened.file.versionId;
      this.synced = opened.diagram;
      this.options.onSaved?.(opened.file.versionId, opened.diagram);
      this.options.onJoined(base, opened.diagram);
    } catch {
      // Not reachable now: the next save joins it in on the server.
    }
  }

  /** An earlier version brought back: it is what the file holds now – shown as it is. */
  private async restore(): Promise<void> {
    window.clearTimeout(this.timer);
    this.stale = true;
    await this.refresh(true);
  }
}
