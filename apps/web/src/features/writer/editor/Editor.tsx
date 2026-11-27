import {
  useEffect,
  useCallback,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { usePageCommands } from '@/features/commands';
import {
  isWriterMarkdown,
  MAX_WRITER_PICTURE_BYTES,
  writerText,
  type Author,
  type WriterAnchor,
  type WriterOpened,
  type WriterPresence,
  type WriterStep,
} from '@slider/shared';
import {
  gridTracks,
  MaterialPanel,
  MentionPeopleContext,
  statusSegments,
  type MentionPeople,
} from '@/features/viewer';
import { loadWorkPreferences, type StatusFilter } from '@/lib/preferences/work-preferences';
import { accentAlpha, selectionStyle } from '@/lib/accent';
import { DOCUMENT_ACCEPT, isImportable } from '../lib/documents';
import {
  documentFilePath,
  documentLiveUrl,
  documentPictureUrl,
  boardKeys,
  cloudKeys,
  fetchDocument,
  sendDocumentEdit,
  useCloudPeople,
  uploadDocumentPicture,
  useCreateDocument,
  useImportDocument,
} from '@/lib/api';
import { apiDownload } from '@/lib/api-client';
import { isTextTarget, rafThrottle } from '@/lib/dom';
import { isModKey } from '@/lib/keyboard';
import { readString, writeString } from '@/lib/storage';
import { wheelFactor } from '@/lib/wheel';
import { isApplePlatform } from '@/lib/platform';
import { MATERIAL_PARAM, routes } from '@/lib/routes';
import {
  AvatarStack,
  Button,
  cn,
  FilterChip,
  GlassPanel,
  Icon,
  IconButton,
  Toast,
  Toolbar,
  ToolbarDivider,
  useToast,
} from '@/ui';
import {
  inWriterDesktopBar,
  useWriterDesktopActions,
  useWriterDesktopBar,
} from '../hooks/useWriterDesktop';
import {
  findAll,
  isCollapsed,
  lengthOf,
  ordered,
  paragraphOf,
  topOf,
  type Edit,
  type Formats,
} from '../lib/model';
import { footLine } from '../lib/paginate';
import { pageGuides, useMarginOverflows, usePageGuides } from './guides';
import { useLayerRows } from './layers';
import { PageGuides } from './PageGuides';
import { LayerOutlines, LayersPanel } from './WriterLayers';
import { CommentSelectionBar } from './CommentSelection';
import { CommentColumn, type Placed } from './CommentColumn';
import {
  anchorToRaw,
  anchorToView,
  lineChanges,
  MarkdownCodec,
  notesEdit,
  plainEdit,
  type Line,
  type MarkdownView,
} from '../lib/markdown';
import { partsOf, threadsOf, useDocumentComments } from './comments';
import { WriterEngine, type WriterSync } from './engine';
import { FindBar } from './FindBar';
import { FormatBar } from './FormatBar';
import { PageStrip, STRIP_COLUMN } from './PageStrip';
import { WRITER_PAGES, WriterContext, type WriterPages, type WriterSession } from './session';
import { WriterToolbar } from './WriterToolbar';
import { clampZoom, ZOOMS, type ZoomChoice } from './zoom';
import { WriterHere } from '../voice/WriterHere';
import { WriterVoiceProvider } from '../voice/WriterVoiceProvider';
import { useRemoteCursors, useSendPresence } from './presence';
import { RemoteCursors } from './RemoteCursors';
import './writer.css';

type LiveEvent =
  | { type: 'step'; step: WriterStep }
  | { type: 'comments' }
  | { type: 'restored' }
  | { type: 'board' }
  | { type: 'cursor'; author: Author; sel: WriterPresence['sel'] }
  | { type: 'people'; people: Author[] };

interface Mark {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  strong?: boolean;
}

const GUTTER = 248;
const GUTTER_GAP = 16;
/** „Ebenen“ takes the pages' column, as wide as a slide's layers list. */
const LAYERS_COLUMN = 288;
/** Narrower than this, the comments have no room beside the sheet. */
const GUTTERS_FROM = 980;
const RECONNECT_MS = 3000;
/** Where the sheets' colour is kept (`WRITER_PAGES`). */
const PAGES_KEY = 'writer.pages';
/** A rendered Markdown file's column: Notion's page, its text 708 px wide. */
const NOTES_WIDTH = 900;

const SYNC_LABEL: Record<WriterSync, string | null> = {
  saved: null,
  saving: null,
  offline: 'Offline',
  signedOut: 'Abgemeldet',
};

/**
 * The open document. The pages lie small on the left, one under the other, with the bracket of
 * what is in the window; the sheet stands in the middle with what is said about it on both sides, each comment at its words; the tools
 * are on the right. Its material is a page of its own to the left (M, the tile above the pages):
 * it slides in while the document moves out to the right, as a presentation does.
 */
export function Editor({
  opened,
  me,
  markdownView = 'rendered',
  onMarkdownView,
}: {
  opened: WriterOpened;
  me: Author;
  /** A Markdown file: shown as written or rendered. */
  markdownView?: MarkdownView;
  /** Another way to show it: the document read anew and drawn that way. */
  onMarkdownView?: (view: MarkdownView) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const linked = params.get('kommentar');
  // „Material“ (⌘K, or `?material` from the document's ⋯ menu in the lists): beside the text.
  const [materialOpen, setMaterialOpen] = useState(() => params.has(MATERIAL_PARAM));
  const materialAsked = params.has(MATERIAL_PARAM);
  useEffect(() => {
    // Open from the start (`useState` above); the address forgets it, a reload does not reopen it.
    if (!materialAsked) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(MATERIAL_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [materialAsked, setParams]);
  const queryClient = useQueryClient();
  const [toast, notify] = useToast();
  const title = opened.document.title;
  const file = useMemo(() => ({ ...opened.document, title }), [opened.document, title]);
  const { id, workspaceId, permissions } = file;
  const comments = useDocumentComments(id, me, notify);
  // A Markdown file has no pages: one surface, as wide and tall as its text.
  const markdown = isWriterMarkdown(file.fileName);
  const view: MarkdownView | null = markdown ? markdownView : null;
  // Rendered, the editor draws Markdown read from the file's lines and writes into them.
  const [codec] = useState(() =>
    view === 'rendered'
      ? new MarkdownCodec(opened.content, opened.content.formats as Formats)
      : null,
  );

  const [engine] = useState(
    () =>
      new WriterEngine({
        content: codec ? codec.shown(opened.content) : opened.content,
        canEdit: permissions.canEdit,
        pictureUrl: (path) => documentPictureUrl(id, path),
        send: codec
          ? (input) => codec.send(input, (lines) => sendDocumentEdit(id, lines))
          : (input) => sendDocumentEdit(id, input),
        refetch: async () => {
          const { content } = await fetchDocument(id);
          return codec ? codec.refetched(content) : content;
        },
        pageless: markdown,
        ...(view === 'raw' && { normalize: plainEdit }),
        ...(codec && {
          normalize: (edit: Edit) => notesEdit(edit, opened.content.formats as Formats),
        }),
      }),
  );
  // Rendered, the comments stand in the file's lines: they move as the lines' words change.
  const linesNow = useRef<Line[] | null>(null);
  useEffect(() => {
    engine.handlers = {
      onRefused: (message) => notify(message, 'danger'),
      onText: codec
        ? () => {
            const { lines } = codec.linesFor(engine.getState().blocks);
            const before = linesNow.current ?? codec.linesFor(codec.rendered.blocks).lines;
            linesNow.current = lines;
            const changes = lineChanges(before, lines);
            if (changes.length > 0) comments.move(changes);
          }
        : comments.move,
      onPictures: (files) => void addPictures(files),
    };
  });
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  // The sheets' colour as last chosen, for every document.
  const [pages, keepPages] = useState<WriterPages>(() => {
    const stored = readString(PAGES_KEY);
    return WRITER_PAGES.find((each) => each === stored) ?? 'theme';
  });
  const setPages = useCallback((next: WriterPages) => {
    keepPages(next);
    writeString(PAGES_KEY, next);
  }, []);
  const switchView = useCallback(
    async (next: MarkdownView) => {
      if (!onMarkdownView || next === view) return;
      // What is typed goes first: the other view reads the file as the server has it.
      engine.flush();
      await new Promise<void>((done) => {
        const check = () => {
          if (engine.getState().sync === 'saving') return false;
          done();
          return true;
        };
        if (check()) return;
        const stop = engine.subscribe(() => {
          if (check()) stop();
        });
      });
      await onMarkdownView(next);
    },
    [engine, onMarkdownView, view],
  );
  const session = useMemo<WriterSession>(
    () => ({
      engine,
      document: file,
      me,
      notify,
      markdown: view,
      setMarkdown: (next: MarkdownView) => void switchView(next),
      pages,
      setPages,
    }),
    [engine, file, me, notify, view, switchView, pages, setPages],
  );
  const { metrics, blocks } = state;
  // The file's lines as the rendered text writes them: where the comments stand in it.
  const written = useMemo(() => codec?.linesFor(blocks) ?? null, [codec, blocks]);

  const stage = useRef<HTMLElement>(null);
  const flowHost = useRef<HTMLDivElement>(null);
  // A document opens with the guides as set on /konto, as a deck.
  useEffect(() => pageGuides.reset(), []);
  const [stageWidth, setStageWidth] = useState(0);
  const [zoomChoice, setZoomChoice] = useState<ZoomChoice>('fit');
  const [people, setPeople] = useState<Author[]>([]);
  // The others' carets, and mine told to them while I type.
  const remote = useRemoteCursors(me.id);
  useSendPresence(id, state, people.length);
  const [current, setCurrent] = useState(0);
  const [draft, setDraft] = useState<WriterAnchor | null>(null);
  const [active, setActive] = useState<string | null>(linked);
  // Threads picked with ⌘/⇧-click, as under the slides; ids of ones gone drop out on their own.
  const [selectedThreads, setSelectedThreads] = useState<ReadonlySet<string>>(new Set());
  const [selectionMenuAt, setSelectionMenuAt] = useState<{ x: number; y: number } | null>(null);
  const toggleSelected = (threadId: string) => {
    setActive(null);
    setSelectedThreads((now) => {
      const next = new Set(now);
      if (!next.delete(threadId)) next.add(threadId);
      return next;
    });
  };
  // The comments shown, as on a slide: Offen / Erledigt / all (none picked) / none (K) – from the
  // setting in /konto; K hides them and brings back what was shown.
  const [filter, setFilter] = useState<StatusFilter>(() => loadWorkPreferences().statusFilter);
  const [shownFilter, setShownFilter] = useState<StatusFilter>('open');
  const toggleComments = () => {
    if (filter === 'hidden') setFilter(shownFilter === 'hidden' ? 'open' : shownFilter);
    else {
      setShownFilter(filter);
      setFilter('hidden');
      setActive(null);
    }
  };
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [hitAt, setHitAt] = useState(0);
  const [placed, setPlaced] = useState<{ left: Placed[]; right: Placed[]; marks: Mark[] }>({
    left: [],
    right: [],
    marks: [],
  });

  const threads = useMemo(
    () =>
      threadsOf(
        written
          ? comments.comments.map((comment) =>
              comment.anchor
                ? { ...comment, anchor: anchorToView(written.rendered, comment.anchor) }
                : comment,
            )
          : comments.comments,
      ),
    [comments.comments, written],
  );
  // Who can be @mentioned in a comment, as on a slide: the workspace's people and whoever wrote
  // in the document's threads – not oneself, not the AI.
  const members = useCloudPeople(file.workspaceId, file.permissions.canComment).data;
  const mentionPeople = useMemo<MentionPeople>(() => {
    const byId = new Map<string, Author>();
    for (const thread of threads)
      for (const comment of [thread.root, ...thread.replies])
        byId.set(comment.author.id, comment.author);
    for (const person of members ?? [])
      if (!byId.has(person.id))
        byId.set(person.id, {
          id: person.id,
          name: person.name,
          type: person.type,
          color: person.color,
        });
    const all = [...byId.values()];
    return {
      participantNames: [...new Set([...all.map((person) => person.name), me.name])],
      mentionable: all.filter(
        (person) => person.id !== me.id && person.type !== 'deleted' && person.type !== 'ai',
      ),
      myName: me.name,
    };
  }, [threads, members, me]);
  const shownThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          thread.root.id === active ||
          filter === 'all' ||
          (filter !== 'hidden' && thread.root.status === filter),
      ),
    [threads, filter, active],
  );
  const counts = {
    open: threads.filter((thread) => thread.root.status === 'open').length,
    done: threads.filter((thread) => thread.root.status === 'done').length,
  };
  const hits = useMemo(() => (finding ? findAll(blocks, query) : []), [finding, blocks, query]);

  // ── Size ──────────────────────────────────────────────────────────────────
  const wide = stageWidth >= GUTTERS_FROM;
  // Both sides of the sheet are the comments' – kept free, so the sheet never jumps aside.
  const gutters = wide && !state.printing;
  const room = stageWidth - (gutters ? 2 * (GUTTER + GUTTER_GAP) : 0) - 32;
  const fit = markdown ? 1 : Math.max(0.3, Math.min(1, room / metrics.width));
  const zoom = state.printing ? 1 : zoomChoice === 'fit' ? fit : zoomChoice;
  // Without pages the surface fills the room, a long line wraps in it; rendered, it is a column
  // as wide as Notion's page.
  const stackWidth =
    view === 'rendered'
      ? Math.min(room / zoom, NOTES_WIDTH)
      : markdown
        ? room / zoom
        : metrics.width;
  // With the grid shown a picture's size is caught at its columns: as wide as 1, 2, … of them.
  const { grid: gridShown, layout: gridLayout, layers } = usePageGuides();
  useEffect(() => {
    const room = metrics.width - metrics.left - metrics.right;
    const tracks = gridShown ? gridTracks(gridLayout.columns, room / (96 / 2.54)) : [];
    const first = tracks[0];
    engine.setSnapWidths(
      first ? tracks.map((track) => (track.start + track.size - first.start) * room * 0.75) : [],
    );
  }, [engine, gridShown, gridLayout, metrics]);
  // „Ebenen“: the page's blocks, the one at the caret picked.
  const layerRows = useLayerRows(engine, flowHost, current, blocks, layers, [
    state.pages,
    metrics,
    zoom,
  ]);
  const layerPicked = state.sel ? (topOf(blocks, state.sel.focus.id)?.id ?? null) : null;
  // What sticks out over the margins: outlined with the guides, their button lit.
  const overflows = useMarginOverflows(flowHost, metrics, zoom, [blocks, state.pages]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setStageWidth(element.clientWidth));
    observer.observe(element);
    setStageWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const host = flowHost.current;
    const scroller = stage.current;
    if (!host || !scroller) return;
    engine.mount(host, scroller);
    return () => engine.unmount();
  }, [engine]);

  useLayoutEffect(() => {
    if (stageWidth > 0) engine.setZoom(zoom);
  }, [engine, zoom, stageWidth]);

  // ── Head and foot ─────────────────────────────────────────────────────────
  // A double click over a page's text or under it types the words there, on every page.
  const [edge, setEdge] = useState<{
    page: number;
    part: 'header' | 'footer';
    value: string;
  } | null>(null);
  const editEdge = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!permissions.canEdit || state.mode !== 'edit') return;
    const box = event.currentTarget.getBoundingClientRect();
    const y = (event.clientY - box.top) / zoom;
    const page = Math.floor(y / metrics.pitch);
    const within = y - page * metrics.pitch;
    if (page < 0 || page >= state.pages || within > metrics.height) return;
    const part =
      within < metrics.top
        ? 'header'
        : within > metrics.height - metrics.bottom - metrics.foot
          ? 'footer'
          : null;
    if (!part) return;
    event.preventDefault();
    setEdge({ page, part, value: state.page[part] ?? '' });
  };
  const saveEdge = () => {
    if (!edge) return;
    const words = edge.value.replace(/\s+/g, ' ').trim();
    setEdge(null);
    engine.setPage({ ...state.page, [edge.part]: words || undefined });
  };

  // ── Zoom ──────────────────────────────────────────────────────────────────
  // Pinch, ⌘ + wheel and ⌘+ / ⌘− / ⌘0 size the page as the handle and „Größe“ do; the point of
  // the page under the pointer (the window's middle, by key) stays where it is.
  const zoomAnchor = useRef<{ x: number; y: number; docX: number; docY: number } | null>(null);
  const zoomTo = (next: ZoomChoice, at?: { x: number; y: number }) => {
    const stack = stage.current?.querySelector('.writer-stack')?.getBoundingClientRect();
    const frame = stage.current?.getBoundingClientRect();
    if (stack && frame) {
      const x = at?.x ?? frame.left + frame.width / 2;
      const y = at?.y ?? frame.top + frame.height / 2;
      zoomAnchor.current = { x, y, docX: (x - stack.left) / zoom, docY: (y - stack.top) / zoom };
    }
    setZoomChoice(next);
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    const stack = stage.current?.querySelector('.writer-stack')?.getBoundingClientRect();
    if (!anchor || !stack) return;
    stage.current?.scrollBy({
      left: stack.left + anchor.docX * zoom - anchor.x,
      top: stack.top + anchor.docY * zoom - anchor.y,
    });
  }, [zoom]);
  /** One of „Größe“'s steps further, up or down. */
  const zoomStep = (direction: 1 | -1) => {
    const next =
      direction > 0
        ? ZOOMS.find((each) => each > zoom + 0.001)
        : ZOOMS.findLast((each) => each < zoom - 0.001);
    zoomTo(next ?? (direction > 0 ? ZOOMS[ZOOMS.length - 1]! : ZOOMS[0]));
  };
  const pinch = useEffectEvent((factor: number, x: number, y: number, from?: number) => {
    const base = from ?? zoom;
    const next = clampZoom(base * factor);
    if (next !== zoom) zoomTo(next, { x, y });
  });
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    // Chrome, Firefox and Edge report a trackpad pinch as a wheel with `ctrlKey`.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      pinch(wheelFactor(event.deltaY, event.deltaMode), event.clientX, event.clientY);
    };
    // Safari sends its own gesture events, the scale counted from the start.
    let start = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      start = engine.scale;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      pinch(gesture.scale, gesture.clientX, gesture.clientY, start);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart);
    element.addEventListener('gesturechange', onGestureChange);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
    };
  }, [engine]);

  useEffect(() => {
    engine.setMode(permissions.canEdit && !linked ? 'edit' : 'review');
  }, [engine, permissions.canEdit, linked]);

  useEffect(() => {
    document.title = `${title} | Writer`;
  }, [title]);

  // ── The page in view ──────────────────────────────────────────────────────
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const follow = rafThrottle(() => setCurrent(engine.pageInView()));
    element.addEventListener('scroll', follow.schedule, { passive: true });
    return () => {
      element.removeEventListener('scroll', follow.schedule);
      follow.cancel();
    };
  }, [engine]);

  // ── The others ────────────────────────────────────────────────────────────
  const onLive = useEffectEvent((event: LiveEvent) => {
    if (event.type === 'step') {
      const step = codec ? codec.remote(event.step) : event.step;
      if (step) engine.applyRemote(step);
    } else if (event.type === 'comments') comments.refresh();
    else if (event.type === 'restored') {
      void engine.restored();
      comments.refresh();
      void queryClient.invalidateQueries({ queryKey: cloudKeys.node(workspaceId, id) });
    } else if (event.type === 'board')
      // Its material changed (an AI app added, someone deleted): „Material“ reads it anew.
      void queryClient.invalidateQueries({ queryKey: boardKeys.board({ kind: 'document', id }) });
    else if (event.type === 'cursor') remote.onCursor(event.author, event.sel);
    else if (event.type === 'people') {
      setPeople(event.people.filter((each) => each.id !== me.id));
      remote.keep(event.people);
    }
  });
  const onBack = useEffectEvent(() => {
    void engine.resync();
    comments.refresh();
  });
  useEffect(() => {
    let source: EventSource | null = null;
    let timer = 0;
    let down = false;
    let closed = false;
    const open = () => {
      const stream = new EventSource(documentLiveUrl(id), { withCredentials: true });
      source = stream;
      stream.addEventListener('open', () => {
        if (!down) return;
        down = false;
        onBack();
      });
      stream.addEventListener('document', (message) => {
        onLive(JSON.parse((message as MessageEvent<string>).data) as LiveEvent);
      });
      stream.addEventListener('error', () => {
        down = true;
        // The browser tries again by itself unless the server answered with an error.
        if (stream.readyState === EventSource.CLOSED && !closed) {
          timer = window.setTimeout(open, RECONNECT_MS);
        }
      });
    };
    open();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      source?.close();
    };
  }, [id]);

  // ── Pictures ──────────────────────────────────────────────────────────────
  async function addPictures(files: File[]) {
    for (const picture of files) {
      if (picture.size > MAX_WRITER_PICTURE_BYTES) {
        notify(`„${picture.name}“ ist zu groß`, 'danger');
        continue;
      }
      let size: { width: number; height: number };
      try {
        size = await sizeOf(picture);
      } catch {
        notify(`„${picture.name}“ lässt sich nicht lesen`, 'danger');
        continue;
      }
      try {
        const { path } = await uploadDocumentPicture(id, picture);
        const width = Math.min(engine.contentWidthPt, size.width * 0.75);
        engine.insertPicture({
          path,
          width: Math.round(width * 100) / 100,
          height: Math.round(((width * size.height) / size.width) * 100) / 100,
        });
      } catch (error) {
        notify(
          `Bild nicht eingefügt: ${error instanceof Error ? error.message : 'nicht erreichbar'}`,
          'danger',
        );
      }
    }
  }

  // ── Comments at their words ───────────────────────────────────────────────
  useLayoutEffect(() => {
    const left: Placed[] = [];
    const right: Placed[] = [];
    const marks: Mark[] = [];
    const rectsOf = (anchor: WriterAnchor) =>
      partsOf(blocks, anchor).flatMap((part) =>
        engine.rectsOf({ id: part.id, offset: part.start }, { id: part.id, offset: part.end }),
      );
    const put = (item: Omit<Placed, 'top'>, anchor: WriterAnchor | null, color: string) => {
      const rects = anchor ? rectsOf(anchor) : [];
      const first = rects[0];
      const side = first && first.left + first.width / 2 < metrics.width / 2 ? left : right;
      side.push({ ...item, top: Math.max(0, (first?.top ?? 0) * zoom - 10) });
      rects.forEach((rect, index) => marks.push({ ...rect, key: `${item.key}:${index}`, color }));
    };
    for (const thread of shownThreads) {
      const isActive = thread.root.id === active;
      put(
        { key: thread.root.id, thread },
        thread.root.anchor,
        accentAlpha(
          thread.root.author.color,
          isActive ? 45 : thread.root.status === 'done' ? 10 : 22,
        ),
      );
    }
    if (draft) put({ key: 'draft', draft }, draft, accentAlpha(me.color, 40));
    hits.forEach((hit, index) => {
      const rects = engine.rectsOf(
        { id: hit.id, offset: hit.start },
        { id: hit.id, offset: hit.end },
      );
      for (const [part, rect] of rects.entries()) {
        marks.push({
          ...rect,
          key: `hit:${index}:${part}`,
          color: 'color-mix(in srgb, var(--selection) 28%, transparent)',
          strong: index === hitAt,
        });
      }
    });
    left.sort((a, b) => a.top - b.top);
    right.sort((a, b) => a.top - b.top);
    // Measured from the text as it lies now; drawn before the next paint.
    let stale = false;
    queueMicrotask(() => {
      if (!stale) setPlaced({ left, right, marks });
    });
    return () => {
      stale = true;
    };
  }, [engine, state.layout, blocks, shownThreads, active, draft, hits, hitAt, zoom, metrics, me]);

  // A click into commented words opens what was said about them.
  const sel = state.sel;
  const [seenSel, setSeenSel] = useState(sel);
  if (sel !== seenSel) {
    setSeenSel(sel);
    const at =
      sel && isCollapsed(sel)
        ? shownThreads.find((thread) => {
            const anchor = thread.root.anchor;
            return (
              anchor &&
              partsOf(blocks, anchor).some(
                (part) =>
                  part.id === sel.focus.id &&
                  sel.focus.offset >= part.start &&
                  sel.focus.offset <= part.end,
              )
            );
          })
        : undefined;
    if (at) setActive(at.root.id);
  }

  // A link to a comment leads to its words.
  const led = useRef(false);
  useEffect(() => {
    if (led.current || !linked) return;
    const anchor = threads.find((thread) => thread.root.id === linked)?.root.anchor;
    if (!anchor || !paragraphOf(blocks, anchor.paragraphId)) return;
    led.current = true;
    engine.select(
      {
        anchor: { id: anchor.paragraphId, offset: anchor.start },
        focus: { id: anchor.paragraphId, offset: anchor.start },
      },
      true,
    );
  }, [engine, linked, threads, blocks]);

  const startComment = () => {
    const at = state.sel;
    if (!at) return;
    const { from, to } = ordered(blocks, at);
    const block = paragraphOf(blocks, from.id);
    if (!block) return;
    const length = lengthOf(block);
    // A comment stands at the words picked – through as many paragraphs as they run – or, with
    // nothing picked, at the whole paragraph.
    const whole = isCollapsed(at);
    const start = whole ? 0 : from.offset;
    const on = !whole && to.id !== from.id;
    const end = whole || on ? length : to.offset;
    setDraft({
      paragraphId: block.id,
      start,
      end,
      quote: writerText(block).slice(start, end).slice(0, 600),
      ...(on && { to: { paragraphId: to.id, offset: to.offset } }),
    });
    setActive(null);
    // Read only, the selection did its work: the words are marked by the comment now.
    if (state.mode === 'review') document.getSelection()?.removeAllRanges();
  };

  // ── Search ────────────────────────────────────────────────────────────────
  const shownHit = hits[Math.min(hitAt, Math.max(0, hits.length - 1))];
  const hitKey = shownHit ? `${shownHit.id}:${shownHit.start}:${query}` : '';
  useEffect(() => {
    if (!hitKey || !shownHit) return;
    engine.showRange(
      { id: shownHit.id, offset: shownHit.start },
      { id: shownHit.id, offset: shownHit.end },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hit by its place, not its object
  }, [engine, hitKey]);
  const closeFind = () => {
    setFinding(false);
    if (state.mode === 'edit') engine.focus();
  };

  // ── Keys, the app's menu bar ──────────────────────────────────────────────
  const download = () =>
    void apiDownload(documentFilePath(id), file.fileName).catch((error: unknown) =>
      notify(error instanceof Error ? error.message : 'Download fehlgeschlagen', 'danger'),
    );
  const close = () => {
    engine.flush();
    void navigate(routes.documents(workspaceId));
  };
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      (event.target instanceof Element && event.target.closest('dialog'))
    )
      return;
    const key = event.key.toLowerCase();
    if (isModKey(event) && event.shiftKey && !event.altKey && key === 'e') {
      // „Exportieren“ – the app's menu bar has the same key.
      event.preventDefault();
      download();
      return;
    }
    if (isModKey(event) && event.shiftKey && !event.altKey && key === 'l') {
      // „Sperren“ / „Entsperren“ the block at the caret, as a slide's element (also in „Ebenen“).
      event.preventDefault();
      const block = blocks.find((each) => each.id === layerPicked);
      if (block) engine.setProtect(block.id, !block.protect);
      return;
    }
    // ⌘+ / ⌘− a step larger or smaller, ⌘0 back to fitting the window – not the browser's zoom.
    if (isModKey(event) && !event.altKey && ['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') zoomTo('fit');
      else zoomStep(event.key === '-' ? -1 : 1);
      return;
    }
    if (isModKey(event) && !event.altKey && !event.shiftKey) {
      if (key === 'f') {
        event.preventDefault();
        setFinding(true);
      } else if (key === 's') {
        event.preventDefault();
        engine.flush();
      } else if (key === 'enter' && active && !draft && !isTextTarget(event.target)) {
        // As on a slide: ⌘↵ with a thread open and no field typed in – its last message to the AI.
        const thread = threads.find((each) => each.root.id === active);
        if (!thread || !permissions.canEdit) return;
        event.preventDefault();
        const comment = thread.replies.at(-1) ?? thread.root;
        if (
          comments.proposals.some(
            (proposal) => proposal.commentId === comment.id && proposal.status === 'running',
          )
        )
          notify('Die KI arbeitet daran …');
        else if (!comment.body.trim()) notify('Ohne Text weiß die KI nicht, was sie tun soll');
        else comments.askAi(comment.id);
      }
      return;
    }
    if (isModKey(event) || event.altKey || isTextTarget(event.target)) return;
    if (key === 'r') engine.setMode('review');
    else if (key === 'k') toggleComments();
    else if (key === 'c' && permissions.canComment && !draft) {
      // As on a slide: a comment at the words picked, or at the paragraph of the caret.
      event.preventDefault();
      if (filter === 'hidden') toggleComments();
      startComment();
    } else if (key === 'g') pageGuides.toggleGuides();
    else if (key === 'l') pageGuides.setLayers(!pageGuides.state().layers);
    else if (key === 'h' && event.shiftKey) pageGuides.setGridPanel(!pageGuides.state().gridPanel);
    else if (key === 'h') pageGuides.toggleGrid();
    else if (key === 'e' && permissions.canEdit) {
      event.preventDefault();
      engine.setMode('edit');
      engine.focus();
    } else if (key === 'escape' && selectedThreads.size > 0) setSelectedThreads(new Set());
    else if (key === 'escape' && draft) setDraft(null);
    else if (key === 'escape' && active) setActive(null);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const inApp = inWriterDesktopBar();
  useWriterDesktopBar({ export: true, exportOpen: false });
  // ⌘K: what the document's pill offers – printing, the file, ✕ (in the app its tab bar's) – and
  // its „Material“.
  usePageCommands({
    group: 'Dokument',
    workspaceId,
    actions: [
      { label: 'Drucken', icon: 'print', onSelect: () => window.print() },
      { label: 'Exportieren', icon: 'iosShare', onSelect: download },
      { label: 'Material', icon: 'folderOpen', onSelect: () => setMaterialOpen(true) },
      { label: 'Dokument schließen', icon: 'close', onSelect: close },
    ],
  });
  // „Neues Dokument“ and „Öffnen …“ in the app's menu bar work from an open document too.
  const create = useCreateDocument(workspaceId);
  const importFile = useImportDocument(workspaceId);
  const openInput = useRef<HTMLInputElement>(null);
  const openOther = (next: { id: string }) => void navigate(routes.document(next.id));
  const refused = (error: unknown) =>
    notify(error instanceof Error ? error.message : 'Das hat nicht geklappt', 'danger');
  useWriterDesktopActions((action) => {
    if (action === 'export') download();
    else if (action === 'print') window.print();
    else if (action === 'close') close();
    // „Darstellung“'s ⌘+ / ⌘− / ⌘0: the sheets' zoom, as the keys in the browser.
    else if (action === 'zoomIn' || action === 'zoomOut') zoomStep(action === 'zoomIn' ? 1 : -1);
    else if (action === 'zoomReset') zoomTo('fit');
    else if (action === 'new') {
      if (!create.isPending)
        create.mutate({ template: 'plain' }, { onSuccess: openOther, onError: refused });
    } else openInput.current?.click();
  });

  // No room beside the page: what is being said shows over it, at its words.
  const over =
    !wide && !state.printing
      ? [...placed.left, ...placed.right]
          .filter((item) => item.draft || item.thread?.root.id === active)
          .sort((a, b) => a.top - b.top)
      : [];
  const columns = (side: 'left' | 'right' | 'over') =>
    (side === 'over' ? over.length > 0 : gutters) && (
      <CommentColumn
        side={side === 'over' ? 'right' : side}
        overlay={side === 'over'}
        items={side === 'over' ? over : placed[side]}
        width={side === 'over' ? Math.min(GUTTER, Math.max(180, stageWidth - 104)) : GUTTER}
        height={state.height * zoom}
        active={active}
        onActivate={setActive}
        selected={selectedThreads}
        onSelect={toggleSelected}
        onSelectionMenu={setSelectionMenuAt}
        comments={comments}
        onDraftCancel={() => setDraft(null)}
        onDraftSent={(body, anchor, toAi, attachments) => {
          setDraft(null);
          setActive(
            comments.add(
              body,
              written ? anchorToRaw(written.rendered, written.lines, anchor) : anchor,
              null,
              toAi,
              attachments,
            ),
          );
        }}
      />
    );

  return (
    <WriterContext value={session}>
      <MentionPeopleContext value={mentionPeople}>
        <div
          data-writer-root
          data-pages={pages}
          className="writer-editor fixed inset-0 flex text-fg"
          style={selectionStyle(me.color)}
        >
          <style>{`@media print { @page { size: ${state.page.width}pt ${state.page.height}pt; margin: 0 } }`}</style>
          <aside
            data-chrome
            aria-label={layers ? 'Ebenen' : 'Seiten'}
            className={cn('flex shrink-0 flex-col max-md:hidden', markdown && 'hidden')}
            style={{ width: layers ? LAYERS_COLUMN : STRIP_COLUMN }}
          >
            {layers ? (
              <LayersPanel page={current} rows={layerRows} picked={layerPicked} />
            ) : (
              <PageStrip stage={stage} />
            )}
          </aside>

          <main
            ref={stage}
            className="writer-stage relative mr-14 min-w-0 flex-1 overflow-auto print:mr-0"
          >
            <div
              className="writer-row mx-auto flex w-max min-w-full items-start justify-center px-4 pt-16 pb-24"
              style={{ gap: GUTTER_GAP }}
            >
              {columns('left')}
              <div
                className={cn(
                  'writer-stack',
                  view === 'raw' && 'writer-code',
                  view === 'rendered' && 'writer-notes',
                )}
                style={{ width: stackWidth, height: state.height, zoom }}
              >
                {Array.from({ length: state.pages }, (_, index) => (
                  <div
                    key={index}
                    className="writer-sheet"
                    style={{
                      top: index * metrics.pitch,
                      width: stackWidth,
                      height: markdown ? state.height : metrics.height,
                    }}
                  >
                    {state.page.header && !(edge?.part === 'header' && edge.page === index) && (
                      <span
                        className="writer-sheet-number"
                        style={{ top: metrics.top - metrics.head }}
                      >
                        {state.page.header}
                      </span>
                    )}
                    {(state.page.numbers || state.page.footer) && (
                      <span className="writer-sheet-number" style={{ bottom: metrics.bottom }}>
                        {state.page.footer && !(edge?.part === 'footer' && edge.page === index) && (
                          <span className="block">{state.page.footer}</span>
                        )}
                        {state.page.numbers && <span className="block">{index + 1}</span>}
                      </span>
                    )}
                  </div>
                ))}
                {/* Between two pages and under the last, as between two slides: ⊕ puts a blank
                  page in there. */}
                {state.mode === 'edit' &&
                  !markdown &&
                  Array.from({ length: state.pages }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      data-chrome
                      aria-label="Seite einfügen"
                      title="Seite einfügen"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => engine.addPage(index)}
                      className="absolute left-1/2 z-2 flex -translate-1/2 items-center justify-center rounded-full text-fg-muted transition-colors hover:text-fg print:hidden"
                      style={{
                        top: index * metrics.pitch + metrics.height + metrics.gap / 2,
                        width: 24 / zoom,
                        height: 24 / zoom,
                      }}
                    >
                      <Icon name="addCircle" size={Math.round(20 / zoom)} />
                    </button>
                  ))}
                {!markdown && (
                  <PageGuides pages={state.pages} metrics={metrics} overflows={overflows} />
                )}
                {layers && <LayerOutlines rows={layerRows} picked={layerPicked} />}
                <div className="writer-marks" aria-hidden>
                  {placed.marks.map((mark) => (
                    <span
                      key={mark.key}
                      style={{
                        left: mark.left,
                        top: mark.top,
                        width: mark.width,
                        height: mark.height,
                        backgroundColor: mark.color,
                        outline: mark.strong ? '1.5px solid var(--selection)' : undefined,
                      }}
                    />
                  ))}
                </div>
                <RemoteCursors
                  engine={engine}
                  cursors={remote.cursors}
                  blocks={blocks}
                  layout={state.layout}
                  zoom={zoom}
                />
                <div ref={flowHost} className="absolute inset-0" onDoubleClick={editEdge} />
                {edge && (
                  <input
                    autoFocus
                    aria-label={edge.part === 'header' ? 'Kopfzeile' : 'Fußzeile'}
                    placeholder={edge.part === 'header' ? 'Kopfzeile' : 'Fußzeile'}
                    value={edge.value}
                    maxLength={500}
                    onChange={(event) => setEdge({ ...edge, value: event.target.value })}
                    onBlur={saveEdge}
                    onKeyDown={(event) => {
                      // Enter, Esc and ⌘↵ keep the words, as for any text.
                      if (event.key === 'Enter' || event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.blur();
                      }
                    }}
                    className="writer-edge"
                    style={{
                      left: metrics.left,
                      width: metrics.width - metrics.left - metrics.right,
                      height: footLine + 6,
                      top:
                        edge.page * metrics.pitch +
                        (edge.part === 'header'
                          ? state.page.header
                            ? metrics.top - metrics.head - 3
                            : Math.max(4, metrics.top - footLine - 9)
                          : metrics.height -
                            metrics.bottom -
                            (state.page.numbers ? footLine : 0) -
                            footLine -
                            3),
                    }}
                  />
                )}
              </div>
              {columns('right')}
            </div>
            {columns('over')}
          </main>

          <div data-chrome className="fixed top-3 right-3 z-(--z-chrome) flex items-center gap-2">
            {threads.length > 0 && (
              <GlassPanel className="flex items-center p-1">
                <div
                  role="group"
                  aria-label="Kommentare nach Status filtern"
                  className="flex items-center gap-1"
                >
                  {/* As on a slide; no KI: the AI asks nothing back in a document's threads. */}
                  {statusSegments({ all: threads.length, ai: 0, ...counts })
                    .filter((segment) => segment.value !== 'ai')
                    .map((segment) => (
                      <FilterChip
                        key={segment.value}
                        selected={segment.value === filter}
                        icon={segment.icon}
                        count={segment.count}
                        title={segment.title}
                        onClick={() => setFilter(segment.value === filter ? 'all' : segment.value)}
                        iconOnly
                      >
                        {segment.label}
                      </FilterChip>
                    ))}
                </div>
              </GlassPanel>
            )}
            {people.length > 0 && <AvatarStack authors={people} size={24} interactive />}
            {/* Saved is how it should be: said only when it is not so. */}
            {(!permissions.canEdit || SYNC_LABEL[state.sync]) && (
              <span
                role="status"
                className="px-1 text-caption text-fg-subtle"
                title={
                  state.sync === 'offline'
                    ? 'Was du schreibst, bleibt und wird später gesendet'
                    : undefined
                }
              >
                {permissions.canEdit ? SYNC_LABEL[state.sync] : 'Nur ansehen'}
              </span>
            )}
            {state.sync === 'signedOut' && (
              <Button
                size="sm"
                onClick={() => void navigate(routes.login(location.pathname + location.search))}
              >
                Anmelden
              </Button>
            )}
            {/* The document's pill, as a presentation's: what one does with it, ✕ – in the app the
              tab bar has the buttons. Where one is stands in the tools' column. */}
            {!inApp && (
              <Toolbar role={false}>
                <IconButton
                  icon="print"
                  label="Drucken"
                  title={`Drucken (${isApplePlatform() ? '⌘P' : 'Strg P'})`}
                  size="sm"
                  onClick={() => window.print()}
                />
                <IconButton
                  icon="iosShare"
                  label="Exportieren"
                  title={`Exportieren (${isApplePlatform() ? '⇧⌘E' : 'Strg ⇧ E'})`}
                  size="sm"
                  onClick={download}
                />
                <ToolbarDivider />
                <IconButton icon="close" label="Dokument schließen" size="sm" onClick={close} />
              </Toolbar>
            )}
          </div>

          {/* Speaking to the AI: its bar opens at the tools' handle; a comment clicked in its list
            is the one in front, its words in the window. */}
          <WriterVoiceProvider
            onOpen={(item) => {
              setActive(item.threadId);
              const anchor = threads.find((thread) => thread.root.id === item.threadId)?.root
                .anchor;
              const paragraphId = anchor?.paragraphId ?? item.paragraphId;
              if (!paragraphId || !paragraphOf(blocks, paragraphId)) return;
              engine.showRange(
                { id: paragraphId, offset: anchor?.start ?? 0 },
                { id: paragraphId, offset: anchor?.end ?? 0 },
              );
            }}
          >
            <WriterToolbar
              current={current}
              crossed={overflows.length > 0}
              zoom={zoomChoice}
              shownZoom={zoom}
              onZoom={setZoomChoice}
            />
          </WriterVoiceProvider>
          <WriterHere />
          <FormatBar onComment={startComment} onPictures={(files) => void addPictures(files)} />
          {materialOpen && (
            <MaterialPanel
              owner={{ kind: 'document', id }}
              canComment={permissions.canComment}
              canManage={permissions.canManage}
              onClose={() => setMaterialOpen(false)}
              onRefused={(message) => notify(message, 'danger')}
            />
          )}
          {finding && (
            <FindBar
              query={query}
              onQuery={(next) => {
                setQuery(next);
                setHitAt(0);
              }}
              hits={hits}
              at={Math.min(hitAt, Math.max(0, hits.length - 1))}
              onAt={setHitAt}
              onClose={closeFind}
            />
          )}
          <div data-chrome>
            <input
              ref={openInput}
              type="file"
              hidden
              accept={DOCUMENT_ACCEPT}
              onChange={(event) => {
                const picked = [...(event.target.files ?? [])].find(isImportable);
                event.target.value = '';
                if (picked) importFile.mutate(picked, { onSuccess: openOther, onError: refused });
              }}
            />
          </div>
        </div>
        <div className="print:hidden">
          <Toast toast={toast} />
        </div>
        <CommentSelectionBar
          threads={threads.filter((thread) => selectedThreads.has(thread.root.id))}
          comments={comments}
          onClear={() => setSelectedThreads(new Set())}
          menuAt={selectionMenuAt}
          onMenuClose={() => setSelectionMenuAt(null)}
        />
      </MentionPeopleContext>
    </WriterContext>
  );
}

/** A picture's own size in px. */
async function sizeOf(picture: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(picture);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    if (size.width > 0 && size.height > 0) return size;
  } catch {
    // A drawing without a size of its own: read as the browser shows it.
  }
  const url = URL.createObjectURL(picture);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth || 400, height: image.naturalHeight || 300 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
