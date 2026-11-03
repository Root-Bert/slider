import type { ApplyEditInput, ApplyEditResult, SlideOperation } from '@slider/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditOutbox, type OutboxListener, type OutboxTransport } from './edit-outbox';
import { OUTBOX_VERSION, type OutboxEntry, type OutboxStore, type TakenOver } from './outbox';

/** The browser's outbox, in memory. */
function memoryStore(leftBehind: OutboxEntry[] = []) {
  const kept = new Map<string, OutboxEntry>();
  let forget: () => void = () => {};
  const store: OutboxStore = {
    keep: async (entry) => void kept.set(entry.id, entry),
    drop: async (id) => void kept.delete(id),
    takeOver: async (userId, deckId): Promise<TakenOver> => {
      const entries = leftBehind.filter(
        (item) => item.userId === userId && (deckId === undefined || item.deckId === deckId),
      );
      leftBehind = leftBehind.filter((item) => !entries.includes(item));
      return { entries, outdated: 0 };
    },
    release: () => {},
    keptOf: async (userId) =>
      [...kept.values(), ...leftBehind]
        .filter((entry) => entry.userId === userId)
        .map((entry) => entry.id),
    onForgotten: (listener) => {
      forget = listener;
      return () => {};
    },
  };
  return { store, kept, forget: () => forget() };
}

const move = (elementId: string, x = 0): SlideOperation => ({
  type: 'setBox',
  elementId,
  box: { x, y: 0, w: 0.1, h: 0.1 },
});

const answer = (seq: number): ApplyEditResult =>
  ({ seq, step: seq, dropped: 0 }) as unknown as ApplyEditResult;

interface Call {
  deckId: string;
  input: ApplyEditInput;
  resolve: (answer: ApplyEditResult) => void;
  reject: (error: unknown) => void;
}

/** The API by hand: each send waits until the test answers it. */
function fakeTransport() {
  const calls: Call[] = [];
  let seq = 1;
  let user: string | undefined = 'ana';
  const transport = {
    send: vi.fn(
      (deckId: string, input: ApplyEditInput) =>
        new Promise<ApplyEditResult>((resolve, reject) =>
          calls.push({ deckId, input, resolve, reject }),
        ),
    ),
    answered: vi.fn((_deckId: string, result: ApplyEditResult) => {
      seq = result.seq;
    }),
    currentSeq: () => seq,
    currentUser: () => user,
    whoAmI: vi.fn(async (): Promise<string | null | undefined> => user ?? null),
    sessionEnded: vi.fn(),
  } satisfies OutboxTransport;
  return {
    transport,
    calls,
    setUser: (next: string | undefined) => (user = next),
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

function listener(): OutboxListener & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    added: (id) => void log.push(`added ${id}`),
    taken: (id) => void log.push(`taken ${id}`),
    refused: (id) => void log.push(`refused ${id}`),
    settled: (id, ok) => void log.push(`settled ${id} ${ok}`),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the editor’s outbox', () => {
  it('sends one edit at a time, in order, under its own id – also once the editor is gone', async () => {
    {
      // sends one edit at a time, in order, each under its own id and on the step before made
      const { store, kept } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      const detach = outbox.attach('deck', listener());
      const first = outbox.enqueue('deck', 'ana', [move('a')]);
      const second = outbox.enqueue('deck', 'ana', [move('b')]);
      await settle();
      expect(kept.size).toBe(2);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toMatchObject({ clientEditId: first.id, baseSeq: 1 });
      calls[0]!.resolve(answer(2));
      expect(await first.done).toBe(true);
      await settle();
      expect(calls).toHaveLength(2);
      // On the step the first one made (the answer is in the cache by then).
      expect(calls[1]!.input).toMatchObject({ clientEditId: second.id, baseSeq: 2 });
      calls[1]!.resolve(answer(3));
      expect(await second.done).toBe(true);
      await settle();
      expect(kept.size).toBe(0);
      expect(outbox.status('deck').pending).toBe(0);
      detach();
    }
    {
      // keeps sending once the editor is gone – on the step each edit was made on
      const { store } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      const detach = outbox.attach('deck', listener());
      outbox.enqueue('deck', 'ana', [move('a')]);
      outbox.enqueue('deck', 'ana', [move('b')]);
      await settle();
      detach();
      calls[0]!.resolve(answer(5));
      await settle();
      expect(calls).toHaveLength(2);
      // Nobody shows a refusal any more: the server applies what still fits.
      expect(calls[1]!.input.baseSeq).toBe(1);
      calls[1]!.resolve(answer(6));
      await settle();
      expect(transport.answered).toHaveBeenCalledTimes(2);
    }
    {
      // shows an editor attaching later the edits still queued
      const { store } = memoryStore();
      const { transport } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      const edit = outbox.enqueue('deck', 'ana', [move('a')]);
      const heard = listener();
      outbox.attach('deck', heard);
      expect(heard.log).toContain(`added ${edit.id}`);
    }
  });

  it('merges an edit into the last queued one with the same key, never into one already sent', async () => {
    const { store } = memoryStore();
    const { transport, calls } = fakeTransport();
    const outbox = createEditOutbox(store, transport);
    const sent = outbox.enqueue('deck', 'ana', [move('a', 1)], { coalesce: 'colour' });
    await settle();
    const queued = outbox.enqueue('deck', 'ana', [move('a', 2)], { coalesce: 'colour' });
    const merged = outbox.enqueue('deck', 'ana', [move('a', 3)], { coalesce: 'colour' });
    expect(queued.id).not.toBe(sent.id);
    expect(merged.id).toBe(queued.id);
    // Another edit after it (an undo's way back): a newer one of the key goes after that, not
    // into the one before – it would go out first and lose to it.
    const between = outbox.enqueue('deck', 'ana', [move('a', 9)]);
    const after = outbox.enqueue('deck', 'ana', [move('a', 4)], { coalesce: 'colour' });
    expect(after.id).not.toBe(queued.id);
    expect(outbox.queued('deck')).toEqual([sent.id, queued.id, between.id, after.id]);
    calls[0]!.resolve(answer(2));
    await settle();
    expect(calls[1]!.input.operations).toEqual([move('a', 3)]);
  });

  it('holds edits while the server is out of reach and tries again on the step they were made on', async () => {
    {
      // holds edits while the server is out of reach and tries again, waiting longer each time
      const { store, kept } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.attach('deck', listener());
      const edit = outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      calls[0]!.reject({ status: 0 });
      // Whoever waits goes on: the edit is kept, to be sent later.
      expect(await edit.done).toBe(true);
      await settle();
      expect(outbox.status('deck')).toMatchObject({ pending: 1, unreachable: true });
      expect(outbox.unsentWhileUnreachable()).toBe(true);
      // A new edit meanwhile goes on at once too, and waits for the next try.
      expect(await outbox.enqueue('deck', 'ana', [move('b')]).done).toBe(true);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(2);
      // Held: sent on the step it was made on, the server applying what still fits.
      expect(calls[1]!.input.baseSeq).toBe(1);
      calls[1]!.reject({ status: 503 });
      await settle();
      await vi.advanceTimersByTimeAsync(1999);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      calls[2]!.resolve(answer(2));
      await settle();
      calls[3]!.resolve(answer(3));
      await settle();
      expect(outbox.status('deck')).toMatchObject({ pending: 0, unreachable: false });
      expect(kept.size).toBe(0);
    }
    {
      // tells the step an edit held back was sent on: the one it was made on
      const { store } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      const taken: (number | undefined)[] = [];
      outbox.attach('deck', { ...listener(), taken: (_id, _answer, sentOn) => taken.push(sentOn) });
      outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      calls[0]!.reject({ status: 0 });
      await settle();
      // Meanwhile the deck went on (someone else's step reached the cache).
      transport.answered('deck', answer(4));
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls[1]!.input.baseSeq).toBe(1);
      calls[1]!.resolve(answer(5));
      await settle();
      expect(taken).toEqual([1]);
    }
  });

  it('tries again quietly while the server is busy, and gives up on an edit it keeps failing on or refuses', async () => {
    {
      // tries again quietly while the server is there but busy – not offline
      const { store, kept } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.attach('deck', listener());
      const edit = outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      calls[0]!.reject({ status: 503 });
      expect(await edit.done).toBe(true);
      await settle();
      // Kept and pending, but the server answered: the editor is not shown offline.
      expect(outbox.status('deck')).toMatchObject({ pending: 1, unreachable: false });
      expect(outbox.unsentWhileUnreachable()).toBe(false);
      expect(kept.size).toBe(1);
      // An edit made meanwhile waits for the try pending, the busy server not asked at once.
      expect(await outbox.enqueue('deck', 'ana', [move('b')]).done).toBe(true);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toHaveLength(2);
      calls[1]!.reject({ status: 429 });
      await settle();
      expect(outbox.status('deck').unreachable).toBe(false);
      // Only no answer at all, a timeout or a proxy without its server is out of reach.
      await vi.advanceTimersByTimeAsync(2000);
      calls[2]!.reject({ status: 502 });
      await settle();
      expect(outbox.status('deck').unreachable).toBe(true);
    }
    {
      // gives up on an edit the server keeps failing on, after a few tries
      const { store, kept } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      const heard = listener();
      outbox.attach('deck', heard);
      const edit = outbox.enqueue('deck', 'ana', [move('a')]);
      for (let tries = 1; tries <= 5; tries += 1) {
        await vi.advanceTimersByTimeAsync(30_000);
        calls.at(-1)!.reject({ status: 500 });
      }
      await settle();
      expect(calls).toHaveLength(5);
      expect(heard.log).toContain(`refused ${edit.id}`);
      expect(kept.size).toBe(0);
    }
    {
      // drops an edit the server refused for good, and says so
      const { store, kept } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      const heard = listener();
      outbox.attach('deck', heard);
      const edit = outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      calls[0]!.reject({ status: 409 });
      expect(await edit.done).toBe(false);
      expect(heard.log).toEqual([`refused ${edit.id}`, `settled ${edit.id} false`]);
      expect(kept.size).toBe(0);
    }
  });

  it('pauses on an ended session or another account instead of trying again', async () => {
    {
      // pauses on an ended session instead of trying again, and goes on once the same account is back
      const { store, kept } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      const edit = outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      calls[0]!.reject({ status: 401 });
      expect(await edit.done).toBe(true);
      await settle();
      expect(transport.sessionEnded).toHaveBeenCalledOnce();
      expect(outbox.status('deck')).toMatchObject({ pending: 1, paused: true });
      // No blind retries.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls).toHaveLength(1);
      expect(kept.size).toBe(1);
      // An answer of the server's: who is signed in? The same account – it goes on.
      outbox.resume();
      await settle();
      expect(transport.whoAmI).toHaveBeenCalledOnce();
      expect(calls).toHaveLength(2);
      expect(calls[1]!.input.clientEditId).toBe(edit.id);
    }
    {
      // never sends an edit under another account
      const { store } = memoryStore();
      const { transport, calls, setUser } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      setUser('ben');
      outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      expect(calls).toHaveLength(0);
      expect(outbox.status('deck').paused).toBe(true);
      // Still Ben when asked: it stays where it is.
      await vi.advanceTimersByTimeAsync(10_000);
      outbox.resume();
      await settle();
      expect(calls).toHaveLength(0);
    }
    {
      // sends each edit naming the account it was made under, and pauses when the server finds another
      const { store, kept } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      const edit = outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      expect(calls[0]!.input.userId).toBe('ana');
      // This tab still thought Ana signed in; the server knows better.
      calls[0]!.reject({ status: 409, code: 'account_changed' });
      expect(await edit.done).toBe(true);
      await settle();
      expect(transport.sessionEnded).toHaveBeenCalledOnce();
      expect(outbox.status('deck')).toMatchObject({ pending: 1, paused: true });
      expect(kept.size).toBe(1);
    }
  });

  it('lets go of edits made under an account no longer signed in', async () => {
    {
      // lets go of an edit on its way when another account signs in – never sent again, nor in the way
      const { store, kept } = memoryStore();
      const released: string[] = [];
      store.release = (ids) => void released.push(...ids);
      const { transport, calls, setUser } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      const heard = listener();
      outbox.attach('deck', heard);
      outbox.setUser('ana');
      const anas = outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      setUser('ben');
      outbox.setUser('ben');
      // Whoever waited for it is told at once; Ben's edits do not count it.
      expect(await anas.done).toBe(false);
      expect(heard.log).toContain(`settled ${anas.id} false`);
      expect(outbox.status('deck')).toMatchObject({ pending: 0, paused: false });
      const bens = outbox.enqueue('deck', 'ben', [move('b')]);
      // Out of reach for Ana's try: left in the browser for her, not tried again here.
      calls[0]!.reject({ status: 0 });
      await settle();
      expect(released).toContain(anas.id);
      expect(calls.map((call) => call.input.clientEditId)).toEqual([anas.id, bens.id]);
      calls[1]!.resolve(answer(2));
      expect(await bens.done).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toHaveLength(2);
      expect(kept.has(bens.id)).toBe(false);
    }
    {
      // lets go of a queued edit made under an account no longer signed in, instead of pausing
      const { store } = memoryStore();
      const { transport, calls, setUser } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      setUser('ben');
      outbox.setUser('ben');
      // An editor that had not heard of the switch yet.
      const stale = outbox.enqueue('deck', 'ana', [move('a')]);
      const bens = outbox.enqueue('deck', 'ben', [move('b')]);
      expect(await stale.done).toBe(false);
      await settle();
      expect(outbox.status('deck').paused).toBe(false);
      expect(calls.map((call) => call.input.clientEditId)).toEqual([bens.id]);
    }
  });

  it('takes over what closed tabs left of the signed-in account, once when asked twice', async () => {
    {
      // takes over and sends what closed tabs left of the signed-in account, whichever deck
      const left = (id: string, deckId: string, userId: string, at: number): OutboxEntry => ({
        v: OUTBOX_VERSION,
        id,
        deckId,
        userId,
        tab: 'closed',
        operations: [move(id)],
        baseSeq: 7,
        at,
      });
      const { store } = memoryStore([
        left('one', 'deck-a', 'ana', 1),
        left('two', 'deck-b', 'ana', 2),
        left('bens', 'deck-a', 'ben', 3),
      ]);
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      await settle();
      expect(
        calls.map((call) => [call.deckId, call.input.clientEditId, call.input.baseSeq]),
      ).toEqual([
        ['deck-a', 'one', 7],
        ['deck-b', 'two', 7],
      ]);
    }
    {
      // takes over once when asked twice at once
      const { store } = memoryStore();
      const takeOver = vi.spyOn(store, 'takeOver');
      const { transport } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      await settle();
      takeOver.mockClear();
      await Promise.all([outbox.drain(), outbox.drain()]);
      expect(takeOver).toHaveBeenCalledOnce();
    }
  });

  it('lets go of everything when the outbox is wiped, keeping nothing until signed in again', async () => {
    {
      // lets go of every queued edit when the outbox is wiped (signed out in another tab)
      const { store, forget } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.enqueue('deck', 'ana', [move('a')]);
      const queued = outbox.enqueue('deck', 'ana', [move('b')]);
      await settle();
      forget();
      expect(await queued.done).toBe(false);
      calls[0]!.resolve(answer(2));
      await settle();
      expect(calls).toHaveLength(1);
      expect(outbox.status('deck').pending).toBe(0);
    }
    {
      // keeps nothing in the browser for an account signed out, until the server takes its edits
      const { store, kept, forget } = memoryStore();
      const takeOver = vi.spyOn(store, 'takeOver');
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      await settle();
      forget();
      takeOver.mockClear();
      // Its editor still open: edits go out, but its wiped outbox is not opened anew for them.
      outbox.enqueue('deck', 'ana', [move('a')]);
      const second = outbox.enqueue('deck', 'ana', [move('b')]);
      await outbox.drain();
      expect(kept.size).toBe(0);
      expect(takeOver).not.toHaveBeenCalled();
      // Signed in after all: what is still queued is kept again.
      calls[0]!.resolve(answer(2));
      await settle();
      expect([...kept.keys()]).toEqual([second.id]);
    }
  });

  it('tries edits made while out of reach on other decks and after earlier tries were let go of', async () => {
    {
      // tries a new edit again by itself once the tries before were let go of
      const { store } = memoryStore();
      const { transport, calls, setUser } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      outbox.enqueue('deck-a', 'ana', [move('a')]);
      await settle();
      calls[0]!.reject({ status: 0 });
      await settle();
      expect(outbox.status('deck-a').unreachable).toBe(true);
      // Another account, and back: Ana's try is let go of, and with it its timer.
      setUser('ben');
      outbox.setUser('ben');
      setUser('ana');
      outbox.setUser('ana');
      await settle();
      const edit = outbox.enqueue('deck-b', 'ana', [move('b')]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls.at(-1)!.input.clientEditId).toBe(edit.id);
    }
    {
      // tries an edit made while out of reach on a deck without a try of its own
      const { store } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      outbox.enqueue('deck-a', 'ana', [move('a')]);
      await settle();
      calls[0]!.reject({ status: 0 });
      await settle();
      // Deck A tries again in a second; deck B has nothing pending until its first edit.
      const edit = outbox.enqueue('deck-b', 'ana', [move('b')]);
      expect(await edit.done).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls.map((call) => call.input.clientEditId)).toContain(edit.id);
    }
  });

  it('holds the deck’s edits while a take-back is on its way, but only once they settle', async () => {
    {
      // holds the deck’s edits while a take-back is on its way, then sends them on its step
      const { store } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.attach('deck', listener());
      const release = await outbox.holdWhenSettled('deck', 1000);
      expect(release).toBeTypeOf('function');
      const edit = outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      expect(calls).toHaveLength(0);
      // The take-back's answer is in the cache: the edit goes out on it.
      transport.answered('deck', answer(4));
      release!();
      await settle();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toMatchObject({ clientEditId: edit.id, baseSeq: 4 });
    }
    {
      // holds nothing while the deck’s edits do not settle
      const { store } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.enqueue('deck', 'ana', [move('a')]);
      const held = outbox.holdWhenSettled('deck', 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await held).toBeNull();
      calls[0]!.resolve(answer(2));
      outbox.enqueue('deck', 'ana', [move('b')]);
      await settle();
      expect(calls).toHaveLength(2);
    }
  });

  it('waits for the edits to be sent and counts those left, other tabs’ included', async () => {
    {
      // resolves once the deck’s edits are all sent, or gives up after the wait
      const { store } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      expect(await outbox.settled('deck', 1000)).toBe(true);
      outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      const waited = outbox.settled('deck', 1000);
      calls[0]!.resolve(answer(2));
      expect(await waited).toBe(true);
      outbox.enqueue('deck', 'ana', [move('b')]);
      const timedOut = outbox.settled('deck', 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await timedOut).toBe(false);
    }
    {
      // tells how many edits of every deck are left before signing out
      const { store } = memoryStore();
      const { transport, calls } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      expect(await outbox.allSettled(1000)).toBe(true);
      outbox.enqueue('deck-a', 'ana', [move('a')]);
      outbox.enqueue('deck-b', 'ana', [move('b')]);
      await settle();
      expect(await outbox.unsent()).toBe(2);
      calls[0]!.resolve(answer(2));
      const waited = outbox.allSettled(3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await waited).toBe(false);
      expect(await outbox.unsent()).toBe(1);
    }
    {
      // counts the account’s edits other tabs keep too – signing out drops them all
      const other = (id: string, userId = 'ana'): OutboxEntry => ({
        v: OUTBOX_VERSION,
        id,
        deckId: 'deck-b',
        userId,
        tab: 'open-tab',
        operations: [move('x')],
        baseSeq: 1,
        at: 1,
      });
      const { store, kept } = memoryStore();
      kept.set('other-tab', other('other-tab'));
      kept.set('bens', other('bens', 'ben'));
      const { transport } = fakeTransport();
      const outbox = createEditOutbox(store, transport);
      outbox.setUser('ana');
      // Nothing of this tab's on its way: the other tab's edit still counts.
      expect(await outbox.allSettled(1000)).toBe(true);
      expect(await outbox.unsent()).toBe(1);
      // This tab's edit, kept in the browser as well, is counted once.
      outbox.enqueue('deck', 'ana', [move('a')]);
      await settle();
      expect(await outbox.unsent()).toBe(2);
    }
  });
});
