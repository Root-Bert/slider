import type { Author, ReaderMark, ReaderMarkBody } from '@slider/shared';
import { deletePdfMark, fetchPdf, putPdfMark } from '@/lib/api';
import { ApiError } from '@/lib/api-client';

export type MarkSync = 'saved' | 'saving' | 'offline' | 'signedOut';

interface Step {
  id: string;
  before: ReaderMarkBody | null;
  after: ReaderMarkBody | null;
}

/** Typing into a field is sent once the hand rests this long. */
const TYPING_MS = 400;
const RETRY_MS = 3000;
const HISTORY = 200;

/**
 * What is filled in on the PDF – fields, words, ticks, signatures – held in the page and sent
 * after: every change shows at once, the server is told, its refusal is said and taken back.
 * ⌘Z / ⇧⌘Z step through one's own changes. What the others do comes in live and is kept,
 * unless one's own change to the same mark is still on its way.
 */
export class MarkStore {
  private marks = new Map<string, ReaderMark>();
  private listeners = new Set<() => void>();
  private snapshot: { marks: ReaderMark[]; sync: MarkSync; canUndo: boolean; canRedo: boolean };
  /** Waiting to be sent: the latest body (or `null`: delete) per mark. */
  private outbox = new Map<string, ReaderMarkBody | null>();
  private timers = new Map<string, number>();
  private sending = new Set<string>();
  private failing = false;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  /** A field typed into keeps one step until it is left. */
  private typingStep: Step | null = null;
  sync: MarkSync = 'saved';
  private onRefused: (message: string) => void = () => {};

  /** Who says a refusal; the next one takes over. */
  onRefusal(say: (message: string) => void) {
    this.onRefused = say;
    return () => {
      if (this.onRefused === say) this.onRefused = () => {};
    };
  }

  constructor(
    private readonly pdfId: string,
    initial: readonly ReaderMark[],
    private readonly me: Author,
  ) {
    for (const mark of initial) this.marks.set(mark.id, mark);
    this.snapshot = this.take();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.snapshot;

  get(id: string): ReaderMark | undefined {
    return this.marks.get(id);
  }

  private take() {
    return {
      marks: [...this.marks.values()],
      sync: this.sync,
      canUndo: this.undoStack.length > 0 || this.typingStep !== null,
      canRedo: this.redoStack.length > 0,
    };
  }
  private emit() {
    this.snapshot = this.take();
    for (const listener of this.listeners) listener();
  }

  private put(id: string, body: ReaderMarkBody | null) {
    if (body) {
      this.marks.set(id, {
        ...body,
        id,
        author: this.me,
        updatedAt: new Date().toISOString(),
      } as ReaderMark);
    } else this.marks.delete(id);
  }

  /** A change of one's own: shown now, sent soon. `typing` folds keystrokes into one step. */
  set(id: string, body: ReaderMarkBody | null, { typing = false } = {}) {
    const before = this.bodyOf(id);
    if (typing) {
      if (this.typingStep?.id !== id) {
        this.endTyping();
        this.typingStep = { id, before, after: body };
      } else this.typingStep.after = body;
    } else {
      this.endTyping();
      this.record({ id, before, after: body });
    }
    this.apply(id, body, typing ? TYPING_MS : 0);
  }

  /** The field typed into is left: its keystrokes become one step back. */
  endTyping() {
    const step = this.typingStep;
    if (!step) return;
    this.typingStep = null;
    this.record(step);
    const waiting = this.timers.get(step.id);
    if (waiting) {
      window.clearTimeout(waiting);
      this.timers.delete(step.id);
      void this.send(step.id);
    }
  }

  private record(step: Step) {
    if (JSON.stringify(step.before) === JSON.stringify(step.after)) return;
    this.undoStack.push(step);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    this.endTyping();
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push(step);
    this.apply(step.id, step.before, 0);
    return step.id;
  }
  redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push(step);
    this.apply(step.id, step.after, 0);
    return step.id;
  }

  private bodyOf(id: string): ReaderMarkBody | null {
    const mark = this.marks.get(id);
    if (!mark) return null;
    const { id: _id, author: _author, updatedAt: _at, ...body } = mark;
    return body as ReaderMarkBody;
  }

  private apply(id: string, body: ReaderMarkBody | null, delay: number) {
    this.put(id, body);
    this.outbox.set(id, body);
    this.setSync('saving');
    window.clearTimeout(this.timers.get(id));
    if (delay > 0) {
      this.timers.set(
        id,
        window.setTimeout(() => {
          this.timers.delete(id);
          void this.send(id);
        }, delay),
      );
    } else {
      this.timers.delete(id);
      void this.send(id);
    }
    this.emit();
  }

  private async send(id: string) {
    if (this.sending.has(id) || !this.outbox.has(id)) return;
    const body = this.outbox.get(id) ?? null;
    this.outbox.delete(id);
    this.sending.add(id);
    try {
      if (body) await putPdfMark(this.pdfId, id, body);
      else await deletePdfMark(this.pdfId, id);
      this.failing = false;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.outbox.set(id, this.outbox.get(id) ?? body);
        this.setSync('signedOut');
      } else if (!(error instanceof ApiError) || error.status >= 500) {
        // Not reached: kept, tried again.
        if (!this.outbox.has(id)) this.outbox.set(id, body);
        this.failing = true;
        this.setSync('offline');
        window.setTimeout(() => void this.send(id), RETRY_MS);
      } else if (!(body === null && error.status === 404)) {
        this.onRefused(error.message);
        void this.resync();
      }
    } finally {
      this.sending.delete(id);
    }
    if (this.outbox.has(id) && !this.failing) void this.send(id);
    this.settle();
  }

  private settle() {
    if (this.outbox.size === 0 && this.sending.size === 0 && this.timers.size === 0) {
      if (this.sync !== 'signedOut') this.setSync('saved');
    }
  }
  private setSync(sync: MarkSync) {
    if (this.sync === sync) return;
    this.sync = sync;
    this.emit();
  }

  private busy(id: string) {
    return this.outbox.has(id) || this.sending.has(id) || this.timers.has(id);
  }

  /** The others' change, as the live stream told it. */
  applyRemote(event: { type: 'mark'; mark: ReaderMark } | { type: 'unmark'; id: string }) {
    const id = event.type === 'mark' ? event.mark.id : event.id;
    if (this.busy(id)) return;
    if (event.type === 'mark') this.marks.set(id, event.mark);
    else this.marks.delete(id);
    this.emit();
  }

  /** Back after being away: the server's marks, one's own on the way kept over them. */
  async resync() {
    try {
      const { marks } = await fetchPdf(this.pdfId);
      const next = new Map(marks.map((mark) => [mark.id, mark]));
      for (const id of [...this.outbox.keys(), ...this.sending, ...this.timers.keys()]) {
        const mine = this.marks.get(id);
        if (mine) next.set(id, mine);
        else next.delete(id);
      }
      this.marks = next;
      this.emit();
    } catch {
      // Tried again on the next reconnect.
    }
  }

  /** Before leaving: what is waiting goes now. */
  flush() {
    this.endTyping();
    for (const [id, timer] of this.timers) {
      window.clearTimeout(timer);
      this.timers.delete(id);
      void this.send(id);
    }
  }

  /** Everything sent: before the file leaves (export, print). Gives up after `ms`. */
  whenSaved(ms = 5000): Promise<void> {
    this.flush();
    if (!this.pending()) return Promise.resolve();
    return new Promise((done) => {
      const timer = window.setTimeout(finish, ms);
      const leave = this.subscribe(() => {
        if (!this.pending()) finish();
      });
      function finish() {
        window.clearTimeout(timer);
        leave();
        done();
      }
    });
  }

  pending() {
    return this.outbox.size + this.sending.size + this.timers.size > 0;
  }
}
