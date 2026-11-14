import { describe, expect, it, vi } from 'vitest';
import type { Author, Board, BoardItem } from '@slider/shared';
import type { OutboxStore } from '@/lib/outbox';
import type { BoardEntry } from './board-outbox';

const sent: { method: string; path: string; body?: unknown }[] = [];
let fail: ((path: string) => unknown) | null = null;
vi.mock('@/lib/api-client', () => {
  const call = (method: string) => async (path: string, body?: unknown) => {
    sent.push({ method, path, body });
    const failure = fail?.(path);
    if (failure) throw failure;
  };
  return { api: { post: call('POST'), patch: call('PATCH'), delete: call('DELETE') } };
});
vi.mock('../editing/outbox', () => ({ BOARD_STORE: 'board', browserQueue: () => null }));

const { createBoardOutbox, withQueued } = await import('./board-outbox');
const { besidePlace, boardNodes, holding, liesIn, reflow } = await import('./board-nodes');
const { isHiddenFile } = await import('./folder-files');

const ana = { id: 'ana', name: 'Ana', type: 'owner', color: 'blue' } as Author;
const note = (id: string, text: string): BoardItem => ({
  id,
  deckId: 'd1',
  author: ana,
  kind: 'box',
  text,
  url: null,
  boundIds: [],
  color: null,
  rich: null,
  x: 0,
  y: 0,
  w: 200,
  h: 160,
  createdAt: '2026-11-04T10:00:00.000Z',
});

function memoryStore(): OutboxStore<BoardEntry> & { entries: Map<string, BoardEntry> } {
  const entries = new Map<string, BoardEntry>();
  return {
    entries,
    keep: async (entry) => void entries.set(entry.id, entry),
    drop: async (id) => void entries.delete(id),
    takeOver: async () => ({ entries: [], outdated: 0 }),
    release: () => {},
    keptOf: async () => [...entries.keys()],
    onForgotten: () => () => {},
  };
}

describe('the board outbox', () => {
  it('shows changes at once, keeps them offline, drops a note deleted before it went, sends the rest in order', async () => {
    // The node project has no window: just what the outbox listens on.
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    let connected = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => connected });
    const store = memoryStore();
    const outbox = createBoardOutbox(store);
    const settled: unknown[] = [];
    outbox.onSettled((_deck, refused) => settled.push(refused));
    const server: Board = { materials: [], items: [note('n1', 'Alt')] };

    const create = (item: BoardItem) =>
      outbox.enqueue('d1', 'ana', {
        type: 'create',
        item,
        input: { ...item, kind: 'note', url: null },
      });
    create(note('n2', 'Offline'));
    create(note('n3', 'Gleich weg'));
    // Asking about a note waits till it is on the server; one deleted before it went never is.
    let n2Saved = false;
    void outbox.saved('d1', 'n2').then(() => (n2Saved = true));
    const n3Saved = outbox.saved('d1', 'n3');
    await expect(outbox.saved('d1', 'n1')).resolves.toBeUndefined();
    outbox.enqueue('d1', 'ana', { type: 'update', itemId: 'n1', input: { text: 'Neu' } });
    outbox.enqueue('d1', 'ana', {
      type: 'move',
      frames: [{ id: 'n1', x: 50, y: 60, w: 200, h: 160 }],
    });
    outbox.enqueue('d1', 'ana', { type: 'delete', itemId: 'n3' });
    await vi.waitFor(() => expect(store.entries.size).toBe(3));

    // Shown at once over the server's board; the note deleted before it went is gone for good.
    const shown = withQueued(server, outbox.queued('d1'));
    expect(shown.items.map((item) => [item.id, item.text, item.x])).toEqual([
      ['n1', 'Neu', 50],
      ['n2', 'Offline', 0],
    ]);
    expect(sent).toEqual([]);
    await expect(n3Saved).rejects.toThrow('deleted');
    expect(n2Saved).toBe(false);
    // React Flow only shows it: nodes from the board as shown, a drag under way laid over it,
    // the picked ones picked, the note being written not dragged.
    const nodes = boardNodes(shown, {
      selected: new Set(['n2']),
      live: new Map([['n2', { x: 7, y: 8, w: 300, h: 200 }]]),
      canMove: true,
      editing: 'n1',
    });
    expect(
      nodes.map((node) => [node.id, node.position, node.width, node.selected, node.draggable]),
    ).toEqual([
      ['n1', { x: 50, y: 60 }, 200, false, false],
      ['n2', { x: 7, y: 8 }, 300, true, true],
    ]);
    // A note beside one thing is a card column by it, one round several its box round them
    // (following them); the thing deleted, the note on it alone goes, the other lets go of it.
    const link = { ...note('l1', ''), kind: 'link' as const, url: 'https://x.de', x: 400 };
    const besideLink = { ...note('b1', 'Daneben'), kind: 'note' as const, boundIds: ['l1'] };
    const round = { ...note('g1', 'Beide'), boundIds: ['l1'] };
    const withThings = { ...shown, items: [...shown.items, link, besideLink, round] };
    const laid = boardNodes(withThings, {
      selected: new Set(),
      live: new Map(),
      canMove: true,
      editing: null,
    });
    expect(laid.map((node) => [node.id, node.data.role, node.position.x])).toEqual([
      ['n1', 'item', 50],
      ['n2', 'item', 0],
      ['g1', 'item', 0],
      ['l1', 'item', 400],
      ['notes:l1', 'notes', 612],
    ]);
    // A box holding things lies under them, a free one over them.
    const z = (id: string) => laid.find((node) => node.id === id)!.zIndex!;
    expect([z('g1') < z('l1'), z('n1') > z('l1')]).toEqual([true, true]);
    // Dragged, a thing lies over every box (never under one's glass on its way), its notes too.
    const dragging = boardNodes(withThings, {
      selected: new Set(),
      live: new Map(),
      canMove: true,
      editing: null,
      lifted: new Set(['l1']),
    });
    const zd = (id: string) => dragging.find((node) => node.id === id)!.zIndex!;
    expect([zd('l1') > zd('n1'), zd('notes:l1') > zd('l1')]).toEqual([true, true]);
    // Dropped on a box sticking out, the box grows round it once – never smaller.
    expect(holding({ x: 0, y: 0, w: 300, h: 200 }, { x: 250, y: 150, w: 100, h: 100 })).toEqual({
      x: 0,
      y: 0,
      w: 366,
      h: 266,
    });
    // Resized narrow, what a box holds wraps underneath, in its order; never narrower than the
    // widest with its room.
    const two = [
      { id: 'a', x: 20, y: 60, w: 200, h: 100 },
      { id: 'b', x: 240, y: 60, w: 200, h: 100 },
    ];
    const narrow = reflow({ x: 0, y: 0, w: 240, h: 100 }, two);
    expect(narrow.frames.map(({ id, x, y }) => [id, x, y])).toEqual([
      ['a', 16, 16],
      ['b', 16, 132],
    ]);
    expect([narrow.minW, narrow.minH]).toEqual([232, 248]);
    // A frame holds what lies mostly or by its centre in it; notes' cards cover no other card.
    expect(liesIn({ x: 90, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 150, h: 150 })).toBe(true);
    expect(liesIn({ x: 120, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 150, h: 150 })).toBe(false);
    expect(
      besidePlace({ x: 0, y: 0, w: 100, h: 100 }, 1, [{ x: 112, y: 0, w: 100, h: 100 }]),
    ).toEqual({ x: -300, y: 0 });
    // A folder's files: none hidden or of the system's own.
    expect(
      ['Ordner/a.pdf', 'Ordner/.DS_Store', 'Ordner/__MACOSX/b.pdf', 'Ordner/Thumbs.db'].map(
        isHiddenFile,
      ),
    ).toEqual([false, true, true, true]);
    const after = withQueued(withThings, [{ type: 'delete', itemId: 'l1' }]).items;
    expect(after.map((item) => [item.id, item.boundIds])).toEqual([
      ['n1', []],
      ['n2', []],
      ['g1', []],
    ]);

    // Back online: sent in the order made; a refusal is dropped and said, never tried again.
    fail = (path) =>
      path.endsWith('/items/n1') ? Object.assign(new Error('Nein'), { status: 403 }) : null;
    connected = true;
    win.dispatchEvent(new Event('online'));
    // Taken, the changes stay shown till a board asked for after that is in (dropped at once, a
    // move showed the old place till then: the dragged thing jumped back for a frame or more).
    await vi.waitFor(() =>
      expect(outbox.queued('d1').map((action) => action.type)).toEqual(['create', 'move']),
    );
    expect(n2Saved).toBe(true);
    outbox.forget('d1', 0);
    expect(outbox.queued('d1')).toHaveLength(2);
    outbox.forget('d1', Date.now() + 1);
    expect(outbox.queued('d1')).toEqual([]);
    expect(sent.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /decks/d1/board/items',
      'PATCH /decks/d1/board/items/n1',
      'PATCH /decks/d1/board',
    ]);
    expect(settled.filter(Boolean)).toHaveLength(1);
    expect(store.entries.size).toBe(0);
    Reflect.deleteProperty(navigator, 'onLine');
    vi.unstubAllGlobals();
  });
});
