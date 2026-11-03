import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Author, Comment, CreateCommentInput } from '@slider/shared';
import { pendingComment, withQueued } from './comment-cache';
import {
  createCommentOutbox,
  memoryCommentStore,
  type CommentAction,
  type CommentTransport,
} from './comment-outbox';

const ana: Author = { id: 'ana', name: 'Ana', type: 'owner', color: 'blue' } as Author;
const ROOT = '11111111-1111-4111-8111-111111111111';
const REPLY = '22222222-2222-4222-8222-222222222222';

const create = (id: string, body: string, parentId: string | null = null): CommentAction => {
  const input = {
    id,
    slideId: 's1',
    parentId,
    body,
    anchor: parentId
      ? { type: 'slide' }
      : { type: 'point', point: { x: 0.5, y: 0.5 }, shapeRef: null },
    strokes: [],
  } as CreateCommentInput & { id: string };
  return { type: 'create', comment: pendingComment(input, 'd1', ana), input };
};

/** A server by hand: what it was sent, answered as told; `online` the browser's connection. */
function fakeServer() {
  const sent: CommentAction[] = [];
  const answers: CommentAction[] = [];
  const refusals: unknown[] = [];
  let online = true;
  let fail: ((action: CommentAction) => unknown) | null = null;
  const transport: CommentTransport = {
    send: async (_deckId, action) => {
      sent.push(action);
      const failure = fail?.(action);
      if (failure) throw failure;
      return action.type === 'create' ? { ...action.comment, body: action.input.body } : null;
    },
    answered: (_deckId, action) => void answers.push(action),
    refused: (_deckId, _action, error) => void refusals.push(error),
    online: () => online,
    currentUser: () => 'ana',
    whoAmI: async () => 'ana',
    sessionEnded: () => {},
  };
  return {
    transport,
    sent,
    answers,
    refusals,
    setOnline: (value: boolean) => (online = value),
    failWith: (next: typeof fail) => (fail = next),
  };
}

const flush = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe('the comment outbox', () => {
  it('keeps what is done offline across a reload, folds changes into what has not gone, and sends it in order once back', async () => {
    const store = memoryCommentStore();
    const server = fakeServer();
    server.setOnline(false);
    const outbox = createCommentOutbox(store, server.transport);
    outbox.setUser('ana');

    // Offline: a comment, a reply naming it, a change to the comment, a reaction – nothing goes,
    // each goes on at once and shows pending.
    const root = create(ROOT, 'Logo fehlt');
    expect(await outbox.enqueue('d1', 'ana', root, { shown: false }).done).toEqual({ sent: false });
    await outbox.enqueue('d1', 'ana', create(REPLY, 'Stimmt', ROOT)).done;
    await outbox.enqueue('d1', 'ana', {
      type: 'update',
      commentId: ROOT,
      input: { body: 'Logo fehlt oben' },
    }).done;
    await outbox.enqueue('d1', 'ana', { type: 'react', commentId: REPLY, kind: 'up', author: ana })
      .done;
    expect(server.sent).toEqual([]);
    expect(outbox.isPending(ROOT)).toBe(true);
    // The change went into the comment not sent yet: three to send, not four.
    expect(store.entries.size).toBe(3);
    const shown = withQueued([], outbox.queued('d1'));
    expect(
      shown.map((comment) => [comment.id, comment.body, comment.reactions?.length ?? 0]),
    ).toEqual([
      [ROOT, 'Logo fehlt oben', 0],
      [REPLY, 'Stimmt', 1],
    ]);
    // A deleted one not sent yet never goes – nor what was queued on it.
    const gone = '33333333-3333-4333-8333-333333333333';
    await outbox.enqueue('d1', 'ana', create(gone, 'Doch nicht')).done;
    await outbox.enqueue('d1', 'ana', { type: 'delete', commentId: gone }).done;
    expect(store.entries.size).toBe(3);

    // Reloaded: a new page takes over what the last one kept, and sends it once back online –
    // the comment before its reply, the reply before its reaction, each once.
    // The page before is gone, and with it its hold on what it kept (its tab lock).
    store.release([...store.entries.keys()]);
    const after = createCommentOutbox(store, server.transport);
    after.setUser('ana');
    await flush();
    expect(after.queued('d1')).toHaveLength(3);
    server.setOnline(true);
    after.retryNow();
    await flush();
    expect(
      server.sent.map((action) => [
        action.type,
        action.type === 'create' ? action.input.id : action.commentId,
      ]),
    ).toEqual([
      ['create', ROOT],
      ['create', REPLY],
      ['react', REPLY],
    ]);
    expect(server.sent[0]?.type === 'create' && server.sent[0].input.body).toBe('Logo fehlt oben');
    expect(store.entries.size).toBe(0);
    expect(after.isPending(ROOT)).toBe(false);
    expect(after.queued('d1')).toHaveLength(0);
    // Nothing queued: the server's list as it is (the query's `select` keeps its result).
    const list: Comment[] = [];
    expect(withQueued(list, after.queued('d1'))).toBe(list);
  });

  it('sends again under the same id after a lost answer, and drops a refused comment with what depends on it once', async () => {
    vi.useFakeTimers();
    const store = memoryCommentStore();
    const server = fakeServer();
    const outbox = createCommentOutbox(store, server.transport);
    outbox.setUser('ana');
    const refused: unknown[] = [];
    outbox.onRefused((error) => refused.push(error));

    // The answer lost on the way: held (whoever waits goes on), tried again with the same id.
    let lost = true;
    server.failWith((action) => {
      if (action.type !== 'create' || !lost) return null;
      lost = false;
      return { status: 0 };
    });
    expect(await outbox.enqueue('d1', 'ana', create(ROOT, 'Hallo')).done).toEqual({ sent: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.sent.map((action) => action.type === 'create' && action.input.id)).toEqual([
      ROOT,
      ROOT,
    ]);
    expect(server.answers).toHaveLength(1);

    // Refused (its slide gone meanwhile) while someone waits: told to them, not as a toast; a reply
    // queued on it goes too, never sent.
    server.failWith((action) =>
      action.type === 'create' && action.input.id === REPLY
        ? null
        : { status: 400, message: 'Folie weg' },
    );
    server.setOnline(false);
    const other = '44444444-4444-4444-8444-444444444444';
    const first = outbox.enqueue('d1', 'ana', create(other, 'Weg'));
    await outbox.enqueue('d1', 'ana', create(REPLY, 'Antwort', other)).done;
    expect(await first.done).toEqual({ sent: false });
    server.setOnline(true);
    outbox.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    // Nobody waited any more (it was held): said once, nothing tried again.
    expect(refused).toEqual([{ status: 400, message: 'Folie weg' }]);
    expect(
      server.sent.filter((action) => action.type === 'create' && action.input.id === REPLY),
    ).toEqual([]);
    expect(store.entries.size).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.refusals).toHaveLength(1);

    // A delete of what is gone already is done all the same; an error without an answer (a file
    // that cannot be read) is tried a few times, then given up on – never a loop.
    server.failWith((action) => (action.type === 'delete' ? { status: 404 } : new Error('kaputt')));
    await outbox.enqueue('d1', 'ana', { type: 'delete', commentId: ROOT }).done;
    expect(store.entries.size).toBe(0);
    void outbox.enqueue('d1', 'ana', create(other, 'Kaputt')).done.catch(() => {});
    await vi.advanceTimersByTimeAsync(120_000);
    expect(
      server.sent.filter((action) => action.type === 'create' && action.input.body === 'Kaputt'),
    ).toHaveLength(5);
    expect(store.entries.size).toBe(0);
  });
});
