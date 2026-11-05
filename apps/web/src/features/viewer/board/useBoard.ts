import {
  boardSchema,
  BOARD_LINK,
  MATERIAL_CARD,
  materialKindOf,
  type AccentColor,
  type Board,
  type BoardFrame,
  type BoardItem,
  type Material,
} from '@slider/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/api';
import { sendInParts } from '@/lib/upload-in-parts';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { boardOutbox, withQueued } from './board-outbox';
import { eachLimited, FOLDER_CARD, FOLDER_PARALLEL } from './folder-files';

/*
 * The deck's board (Folie 0) as the viewer shows it: the server's, with the changes queued here
 * (`board-outbox.ts`) and the files on their way laid over it – every change shows at once.
 * Others' changes come over the live stream (`board` event → refetch, `useLive`).
 */

/** A file on its way to the board: shown as its card at once, with how much got through. */
export interface UploadingMaterial extends Material {
  progress: number;
}

type Uploads = Map<string, UploadingMaterial>;
const uploads = new Map<string, Uploads>();
const uploadListeners = new Set<() => void>();
const EMPTY_UPLOADS: Uploads = new Map();

function setUpload(deckId: string, id: string, upload: UploadingMaterial | null) {
  const next = new Map(uploads.get(deckId) ?? EMPTY_UPLOADS);
  if (upload) next.set(id, upload);
  else next.delete(id);
  uploads.set(deckId, next);
  for (const listener of uploadListeners) listener();
}

const subscribeUploads = (listener: () => void) => {
  uploadListeners.add(listener);
  return () => void uploadListeners.delete(listener);
};

const EMPTY_BOARD: Board = { materials: [], items: [] };

/** A folder's files on their way: how many of how many, the bytes, the ones that did not go. */
export interface FolderUpload {
  total: number;
  done: number;
  failed: string[];
  bytesTotal: number;
  bytesSent: number;
}

const folderUploads = new Map<string, FolderUpload>();
const folderListeners = new Set<() => void>();
let folderSnapshot: ReadonlyMap<string, FolderUpload> = new Map();

function setFolderUpload(folderId: string, upload: FolderUpload | null) {
  if (upload) folderUploads.set(folderId, upload);
  else folderUploads.delete(folderId);
  folderSnapshot = new Map(folderUploads);
  for (const listener of folderListeners) listener();
}

const subscribeFolders = (listener: () => void) => {
  folderListeners.add(listener);
  return () => void folderListeners.delete(listener);
};

/** The folders whose files are on their way (or some did not go), by folder id. */
export function useFolderUploads(): ReadonlyMap<string, FolderUpload> {
  return useSyncExternalStore(
    subscribeFolders,
    () => folderSnapshot,
    () => folderSnapshot,
  );
}

/** Room kept between a new card and those already there. */
const SPACING = 24;

/**
 * Where a new card of `size` goes near `at`: there, or as far right as it takes to lie on none
 * of the cards already there (`taken`, which it joins).
 */
export function freeSpot(
  at: { x: number; y: number },
  size: { w: number; h: number },
  taken: BoardFrame[],
): { x: number; y: number } {
  let x = at.x;
  for (let tries = 0; tries < 200; tries++) {
    const hit = taken.find(
      (frame) =>
        x < frame.x + frame.w + SPACING &&
        x + size.w + SPACING > frame.x &&
        at.y < frame.y + frame.h + SPACING &&
        at.y + size.h + SPACING > frame.y,
    );
    if (!hit) break;
    x = hit.x + hit.w + SPACING;
  }
  taken.push({ x, y: at.y, ...size });
  return { x, y: at.y };
}

/** Waits until the browser has a connection again. */
const online = () =>
  navigator.onLine === false
    ? new Promise<void>((resolve) =>
        window.addEventListener('online', () => resolve(), { once: true }),
      )
    : Promise.resolve();

export interface BoardActions {
  board: Board;
  /** Still loading the first time. */
  loading: boolean;
  /** Files dropped, pasted or picked, laid out from `at` (board units) side by side. */
  addFiles(files: readonly File[], at: { x: number; y: number }): void;
  /**
   * A folder dropped or picked: its card at `at` at once, its files sent into it a few at a time
   * (`FOLDER_PARALLEL`) – one failing, the others go on (`useFolderUploads`).
   */
  addFolder(name: string, files: readonly File[], at: { x: number; y: number }): void;
  /**
   * A note: its box on the board (board units) and its text, hanging on `boundIds` (files, links,
   * notes) – none: a sticker on its own.
   */
  addNote(
    frame: BoardFrame,
    text: string,
    boundIds?: string[],
    rich?: Record<string, unknown> | null,
  ): string;
  /** A box: where, its text (Markdown, with its rich text), the things it holds. */
  addBox(
    frame: BoardFrame,
    text: string,
    boundIds: string[],
    rich?: Record<string, unknown> | null,
  ): string;
  /** What a frame holds now. */
  setBound(itemId: string, boundIds: string[]): void;
  /** A note's or frame's colour; `null`: its author's. */
  setColor(itemId: string, color: AccentColor | null): void;
  addLink(at: { x: number; y: number }, url: string): void;
  /** A note's text – a sticker's with its rich text. */
  updateText(itemId: string, text: string, rich?: Record<string, unknown> | null): void;
  move(frames: (BoardFrame & { id: string })[]): void;
  remove(itemIds: readonly string[]): void;
}

export function useBoard(): BoardActions {
  const { deck, viewer } = useViewerData();
  const deckId = deck.id;
  const userId = viewer.author.id;
  const queryClient = useQueryClient();
  const toast = useViewerToast();
  const outbox = boardOutbox();
  const queryKey = queryKeys.board(deckId);

  const queued = useSyncExternalStore(
    outbox.subscribe,
    () => outbox.queued(deckId),
    () => outbox.queued(deckId),
  );
  const onTheirWay = useSyncExternalStore(
    subscribeUploads,
    () => uploads.get(deckId) ?? EMPTY_UPLOADS,
    () => EMPTY_UPLOADS,
  );
  // When the board last fetched was asked for: what the server took before is in it.
  const fetchedFrom = useRef(0);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const startedAt = Date.now();
      const board = boardSchema.parse(await api.get(`/decks/${deckId}/board`));
      fetchedFrom.current = startedAt;
      return board;
    },
    // Live events refetch it; polling is only a slow safety net.
    refetchInterval: 120_000,
    networkMode: 'always',
  });

  useEffect(() => outbox.resume(deckId, userId), [outbox, deckId, userId]);
  useEffect(() => {
    if (query.dataUpdatedAt > 0) outbox.forget(deckId, fetchedFrom.current);
  }, [outbox, deckId, query.dataUpdatedAt]);
  useEffect(
    () =>
      outbox.onSettled((settledDeck, refused) => {
        if (settledDeck !== deckId) return;
        if (refused) {
          toast(
            refused instanceof ApiError
              ? refused.message
              : 'Änderung am Material nicht gespeichert',
            'danger',
          );
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.board(deckId) });
      }),
    [outbox, deckId, queryClient, toast],
  );

  const board = useMemo(() => {
    const shown = withQueued(query.data ?? EMPTY_BOARD, queued);
    if (onTheirWay.size === 0) return shown;
    const saved = new Set(shown.materials.map((material) => material.id));
    return {
      ...shown,
      materials: [
        ...shown.materials,
        ...[...onTheirWay.values()].filter((upload) => !saved.has(upload.id)),
      ],
    };
  }, [query.data, queued, onTheirWay]);

  // The cards as shown now, for placing new ones beside them.
  const shownRef = useRef(board);
  shownRef.current = board;
  const taken = () => [...shownRef.current.materials, ...shownRef.current.items] as BoardFrame[];

  const enqueue = useCallback(
    (action: Parameters<typeof outbox.enqueue>[2]) => outbox.enqueue(deckId, userId, action),
    [outbox, deckId, userId],
  );

  const sendFile = useCallback(
    async (file: File, material: UploadingMaterial) => {
      const frame = { x: material.x, y: material.y, w: material.w, h: material.h };
      for (;;) {
        try {
          await online();
          const upload = await sendInParts(
            file,
            { purpose: 'material', deckId },
            (progress) => setUpload(deckId, material.id, { ...material, progress }),
            new AbortController().signal,
          );
          const saved = await api.post<Material>(`/decks/${deckId}/materials`, {
            id: material.id,
            upload,
            ...frame,
          });
          queryClient.setQueryData<Board>(queryKeys.board(deckId), (current) =>
            current && !current.materials.some((each) => each.id === saved.id)
              ? { ...current, materials: [...current.materials, saved] }
              : current,
          );
          break;
        } catch (error) {
          const status = error instanceof ApiError ? error.status : 0;
          // No connection, the server away or busy: again once it can be reached.
          if (status === 0 || status === 429 || status >= 500) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }
          toast(
            error instanceof ApiError ? error.message : `„${file.name}“ nicht abgelegt`,
            'danger',
          );
          break;
        }
      }
      if (material.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(material.previewUrl);
      setUpload(deckId, material.id, null);
    },
    [deckId, queryClient, toast],
  );

  const addFiles = useCallback<BoardActions['addFiles']>(
    (files, at) => {
      const occupied = taken();
      files.forEach((file) => {
        const spot = freeSpot(at, MATERIAL_CARD, occupied);
        const kind = materialKindOf(file.name);
        const material: UploadingMaterial = {
          id: crypto.randomUUID(),
          deckId,
          author: viewer.author,
          name: file.name,
          kind,
          mimeType: file.type,
          sizeBytes: file.size,
          url: '',
          previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
          readState: 'pending',
          pages: null,
          sheets: [],
          expanded: false,
          folderId: null,
          createdAt: new Date().toISOString(),
          x: spot.x,
          y: spot.y,
          w: MATERIAL_CARD.w,
          h: MATERIAL_CARD.h,
          progress: 0,
        };
        setUpload(deckId, material.id, material);
        void sendFile(file, material);
      });
    },
    [deckId, viewer.author, sendFile],
  );

  const addFolder = useCallback<BoardActions['addFolder']>(
    (name, files, at) => {
      const id = crypto.randomUUID();
      const spot = freeSpot(at, FOLDER_CARD, taken());
      const input = {
        id,
        kind: 'folder' as const,
        text: name,
        url: null,
        boundIds: [],
        ...spot,
        ...FOLDER_CARD,
      };
      const progress: FolderUpload = {
        total: files.length,
        done: 0,
        failed: [],
        bytesTotal: files.reduce((sum, file) => sum + file.size, 0),
        bytesSent: 0,
      };
      const sent = new Map<File, number>();
      const report = () =>
        setFolderUpload(id, {
          ...progress,
          bytesSent: [...sent.values()].reduce((sum, bytes) => sum + bytes, 0),
        });
      report();
      const board = queryKeys.board(deckId);
      void (async () => {
        try {
          await online();
          const folder = await api.post<BoardItem>(`/decks/${deckId}/board/items`, input);
          queryClient.setQueryData<Board>(board, (current) =>
            current && !current.items.some((each) => each.id === id)
              ? { ...current, items: [...current.items, folder] }
              : current,
          );
        } catch (error) {
          setFolderUpload(id, null);
          toast(error instanceof ApiError ? error.message : `„${name}“ nicht abgelegt`, 'danger');
          return;
        }
        await eachLimited(files, FOLDER_PARALLEL, async (file) => {
          const fileId = crypto.randomUUID();
          for (let attempt = 0; ; attempt++) {
            try {
              await online();
              const upload = await sendInParts(
                file,
                { purpose: 'material', deckId },
                (fraction) => {
                  sent.set(file, fraction * file.size);
                  report();
                },
                new AbortController().signal,
              );
              const saved = await api.post<Material>(`/decks/${deckId}/materials`, {
                id: fileId,
                upload,
                folderId: id,
                x: spot.x,
                y: spot.y,
                ...MATERIAL_CARD,
              });
              // In its folder at once, as the server keeps it.
              queryClient.setQueryData<Board>(board, (current) =>
                current
                  ? {
                      materials: current.materials.some((each) => each.id === saved.id)
                        ? current.materials
                        : [...current.materials, saved],
                      items: current.items.map((item) =>
                        item.id === id && !item.boundIds.includes(saved.id)
                          ? { ...item, boundIds: [...item.boundIds, saved.id] }
                          : item,
                      ),
                    }
                  : current,
              );
              progress.done += 1;
              sent.set(file, file.size);
              break;
            } catch (error) {
              const status = error instanceof ApiError ? error.status : 0;
              if ((status === 0 || status === 429 || status >= 500) && attempt < 3) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
                continue;
              }
              progress.failed = [...progress.failed, file.name];
              sent.set(file, 0);
              break;
            } finally {
              report();
            }
          }
        });
        // All there: the bar goes; some did not go: they stay named on the card.
        if (progress.failed.length === 0) setFolderUpload(id, null);
        else
          toast(
            `${progress.failed.length} ${progress.failed.length === 1 ? 'Datei' : 'Dateien'} aus „${name}“ nicht abgelegt`,
            'danger',
          );
      })();
    },
    [deckId, queryClient, toast],
  );

  const create = useCallback(
    (
      kind: BoardItem['kind'],
      frame: BoardFrame,
      text: string,
      url: string | null,
      boundIds: string[] = [],
      rich: Record<string, unknown> | null = null,
    ) => {
      const id = crypto.randomUUID();
      const input = { id, kind, text, url, boundIds, rich, ...frame };
      const item: BoardItem = {
        ...input,
        color: null,
        deckId,
        author: viewer.author,
        createdAt: new Date().toISOString(),
      };
      enqueue({ type: 'create', item, input });
      return id;
    },
    [deckId, viewer.author, enqueue],
  );

  return {
    board,
    loading: query.isPending,
    addFiles,
    addFolder,
    addNote: (frame, text, boundIds = [], rich = null) =>
      create('note', frame, text, null, boundIds, rich),
    addBox: (frame, text, boundIds, rich = null) =>
      create('box', frame, text, null, boundIds, rich),
    setBound: (itemId, boundIds) => enqueue({ type: 'update', itemId, input: { boundIds } }),
    setColor: (itemId, color) => enqueue({ type: 'update', itemId, input: { color } }),
    addLink: (at, url) =>
      void create('link', { ...freeSpot(at, BOARD_LINK, taken()), ...BOARD_LINK }, '', url),
    updateText: (itemId, text, rich) =>
      enqueue({
        type: 'update',
        itemId,
        input: rich === undefined ? { text } : { text, rich },
      }),
    move: (frames) => enqueue({ type: 'move', frames }),
    remove: (itemIds) => {
      for (const itemId of itemIds) enqueue({ type: 'delete', itemId });
    },
  };
}
