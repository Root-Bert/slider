import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { usePageCommands } from '@/features/commands';
import type {
  Author,
  ReaderAnchor,
  ReaderEvent,
  ReaderMarkBody,
  ReaderOpened,
  ReaderRect,
} from '@slider/shared';
import { accentAlpha, accentColor, selectionStyle } from '@/lib/accent';
import { fetchPdfExport, pdfExportPath, pdfFileUrl, pdfLiveUrl } from '@/lib/api';
import { apiDownload } from '@/lib/api-client';
import { isTextTarget, rafThrottle } from '@/lib/dom';
import { pluralize } from '@/lib/format';
import { isModKey } from '@/lib/keyboard';
import { isApplePlatform } from '@/lib/platform';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';
import {
  Avatar,
  AvatarStack,
  Button,
  cn,
  GlassPanel,
  IconButton,
  LoadingState,
  Spinner,
  Toast,
  Toolbar,
  ToolbarDivider,
  useToast,
} from '@/ui';
import { findInPdf, type PdfHit } from '../lib/find';
import {
  closePdf,
  fieldsOf,
  formWidgets,
  openPdfFile,
  pageSizes,
  type FormWidget,
  type PageSize,
  type PDFDocumentProxy,
} from '../lib/pdf';
import { printPdf } from '../lib/print';
import {
  inReaderDesktopBar,
  useReaderDesktopActions,
  useReaderDesktopBar,
} from '../hooks/useReaderDesktop';
import { CommentColumn, type Placed } from './CommentColumn';
import { threadsOf, usePdfComments } from './comments';
import { MarkStore, type MarkSync } from './marks';
import { PageStrip, type Flow } from './PageStrip';
import { PdfPageView, type PageMark, type Tool } from './PdfPageView';
import { ReaderToolbar, ZOOMS, type ZoomChoice } from './ReaderToolbar';
import { ReaderContext, type ReaderSession } from './session';
import './reader.css';

const GUTTER = 248;
const GUTTER_GAP = 16;
/** Narrower than this, the comments have no room beside the page. */
const GUTTERS_FROM = 980;
const PAGE_GAP = 16;
const PAD_TOP = 64;
/** The tool bar along the bottom. */
const BAR_ROOM = 64;
/** Slider's film strip above it, when the pages lie side by side. */
const STRIP_ROOM = 84;
/** Side by side, the pages take this much of the height; the comments below them the rest. */
const ACROSS_SHARE = 0.72;
const RECONNECT_MS = 3000;
const NO_HITS: PdfHit[] = [];

const SYNC_LABEL: Record<MarkSync, string> = {
  saved: 'Gespeichert',
  saving: 'Speichert …',
  offline: 'Offline',
  signedOut: 'Abgemeldet',
};

type Loaded =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; doc: PDFDocumentProxy; sizes: PageSize[] };

/** The open PDF: loads the file, then shows it. */
export function Viewer({ opened, me }: { opened: ReaderOpened; me: Author }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const id = opened.pdf.id;
  useEffect(() => {
    let alive = true;
    let doc: PDFDocumentProxy | null = null;
    void (async () => {
      try {
        doc = await openPdfFile(pdfFileUrl(id));
        const sizes = await pageSizes(doc);
        if (alive) setLoaded({ status: 'ready', doc, sizes });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (alive)
          setLoaded({
            status: 'failed',
            message:
              name === 'PasswordException'
                ? 'Das PDF ist mit einem Passwort geschützt.'
                : 'Die Datei ist beschädigt oder kein PDF.',
          });
      }
    })();
    return () => {
      alive = false;
      if (doc) void closePdf(doc);
    };
  }, [id]);
  useEffect(() => {
    document.title = `${opened.pdf.title} | Reader`;
  }, [opened.pdf.title]);

  if (loaded.status === 'failed') {
    return <CenteredMessage title="Das PDF lässt sich nicht öffnen" message={loaded.message} />;
  }
  if (loaded.status === 'loading') return <LoadingState fullPage height="screen" />;
  return <Open opened={opened} me={me} doc={loaded.doc} sizes={loaded.sizes} />;
}

/**
 * Mostly landscape pages lie side by side and scroll across, as Slider's slides; portrait ones
 * stand one under the other and scroll down, as Writer's pages.
 */
const flowOf = (sizes: readonly PageSize[]): Flow =>
  sizes.filter((size) => size.width > size.height).length * 2 > sizes.length ? 'across' : 'down';

/**
 * Where each page stands in the pages' block (px, its top left corner), and the block's size:
 * one under the other centred, or side by side centred on the middle line.
 */
function layoutOf(sizes: readonly PageSize[], zoom: number, flow: Flow) {
  const across = flow === 'across';
  let run = 0;
  let cross = 0;
  for (const size of sizes) cross = Math.max(cross, (across ? size.height : size.width) * zoom);
  const origins = sizes.map((size) => {
    const along = (across ? size.width : size.height) * zoom;
    const side = (cross - (across ? size.height : size.width) * zoom) / 2;
    const origin = across ? { x: run, y: side } : { x: side, y: run };
    run += along + PAGE_GAP;
    return origin;
  });
  const length = Math.max(0, run - PAGE_GAP);
  return {
    origins,
    width: across ? length : cross,
    height: across ? cross : length,
  };
}

/** The anchor's box on its page: the area, or all its lines together. */
const boxOf = (anchor: ReaderAnchor): ReaderRect | null => {
  if (anchor.rect) return anchor.rect;
  const rects = anchor.rects ?? [];
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
};

const NEW_ID: Record<'text' | 'check' | 'signature', string> = {
  text: 'text',
  check: 'check',
  signature: 'signature',
};

/**
 * The open PDF. The pages lie small on the left; they stand in the middle, one under the other,
 * with what is said about them on both sides, each comment at its place; the tools are on the
 * right. Fields are typed into where they stand; words, ticks and signatures are put down with
 * a tool and moved, sized, deleted when picked. Nothing changes the file – export and print
 * bake it all in.
 */
function Open({
  opened,
  me,
  doc,
  sizes,
}: {
  opened: ReaderOpened;
  me: Author;
  doc: PDFDocumentProxy;
  sizes: PageSize[];
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const linked = params.get('kommentar');
  const [toast, notify] = useToast();
  const pdf = opened.pdf;
  const { id, workspaceId, permissions } = pdf;
  const [store] = useState(() => new MarkStore(id, opened.marks, me));
  useEffect(() => store.onRefusal((message) => notify(message, 'danger')), [store, notify]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const session = useMemo<ReaderSession>(
    () => ({ pdf, me, notify, marks: store }),
    [pdf, me, notify, store],
  );

  // ── The file's own fields ─────────────────────────────────────────────────
  const [widgets, setWidgets] = useState<FormWidget[][]>(() => sizes.map(() => []));
  useEffect(() => {
    let alive = true;
    void (async () => {
      const all: FormWidget[][] = [];
      for (let index = 0; index < doc.numPages; index += 1) {
        const page = await doc.getPage(index + 1);
        all.push(await formWidgets(page, index).catch(() => []));
        if (!alive) return;
      }
      setWidgets(all);
    })();
    return () => {
      alive = false;
    };
  }, [doc]);
  const fieldsRef = useRef(() => fieldsOf(widgets.flat()));
  useEffect(() => {
    fieldsRef.current = () => fieldsOf(widgets.flat());
  }, [widgets]);
  const comments = usePdfComments(id, me, notify, fieldsRef);

  // ── Size ──────────────────────────────────────────────────────────────────
  const stage = useRef<HTMLElement>(null);
  /** The pages' block: where it begins in the stage's scroll is its offset. */
  const block = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageWidth = stageSize.width;
  const flow = useMemo(() => flowOf(sizes), [sizes]);
  const across = flow === 'across';
  const [zoomChoice, setZoomChoice] = useState<ZoomChoice>('fit');
  const wide = stageWidth >= GUTTERS_FROM;
  const widest = Math.max(...sizes.map((size) => size.width));
  const tallest = Math.max(...sizes.map((size) => size.height));
  const fit = (() => {
    if (!across) {
      const room = stageWidth - (wide ? 2 * (GUTTER + GUTTER_GAP) : 0) - 32;
      return Math.max(0.25, Math.min(1.5, room / widest));
    }
    // As in Slider: a page as large as the window lets it, the comments under it in view.
    const height = (stageSize.height - PAD_TOP - BAR_ROOM - STRIP_ROOM) * (wide ? ACROSS_SHARE : 1);
    return Math.max(0.25, Math.min(1.5, height / tallest, (stageWidth - 64) / widest));
  })();
  const zoom = zoomChoice === 'fit' ? fit : zoomChoice;
  const layout = useMemo(() => layoutOf(sizes, zoom, flow), [sizes, zoom, flow]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () =>
      setStageSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  /** The zoom changed: the point in the middle of the window stays there. */
  const zoomTo = (next: ZoomChoice) => {
    const element = stage.current;
    const nextZoom = next === 'fit' ? fit : next;
    if (element && nextZoom !== zoom) {
      const ratio = nextZoom / zoom;
      if (across) {
        const start = block.current?.offsetLeft ?? 0;
        const middle = element.scrollLeft + element.clientWidth / 2 - start;
        requestAnimationFrame(() => {
          element.scrollLeft = middle * ratio + start - element.clientWidth / 2;
        });
      } else {
        const start = block.current?.offsetTop ?? PAD_TOP;
        const middle = element.scrollTop + element.clientHeight / 2 - start;
        requestAnimationFrame(() => {
          element.scrollTop = middle * ratio + start - element.clientHeight / 2;
        });
      }
    }
    setZoomChoice(next);
  };
  const stepZoom = (by: 1 | -1) => {
    const list = [...ZOOMS] as number[];
    const next =
      by > 0
        ? list.find((each) => each > zoom + 0.001)
        : [...list].reverse().find((each) => each < zoom - 0.001);
    if (next) zoomTo(next);
  };

  // ── The page in view ──────────────────────────────────────────────────────
  const [current, setCurrent] = useState(0);
  const origins = layout.origins;
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const follow = rafThrottle(() => {
      // Down: the page a third into the window; across: the one in its middle.
      const at = across
        ? element.scrollLeft - (block.current?.offsetLeft ?? 0) + element.clientWidth / 2
        : element.scrollTop - (block.current?.offsetTop ?? PAD_TOP) + element.clientHeight / 3;
      const of = (index: number) => (across ? origins[index]!.x : origins[index]!.y);
      let index = 0;
      while (index + 1 < origins.length && of(index + 1) <= at) index += 1;
      setCurrent(index);
    });
    follow.schedule();
    element.addEventListener('scroll', follow.schedule, { passive: true });
    return () => {
      element.removeEventListener('scroll', follow.schedule);
      follow.cancel();
    };
  }, [origins, across]);
  const showPage = useCallback(
    (index: number, y = 0, smooth = false) => {
      const element = stage.current;
      const origin = origins[index];
      const size = sizes[index];
      if (!element || !origin || !size) return;
      const behavior = smooth ? 'smooth' : 'auto';
      if (across) {
        // The page in the middle of the window, as Slider's slide.
        const left = (block.current?.offsetLeft ?? 0) + origin.x + (size.width * zoom) / 2;
        element.scrollTo({ left: Math.max(0, left - element.clientWidth / 2), behavior });
        return;
      }
      const top = (block.current?.offsetTop ?? PAD_TOP) + origin.y + y * size.height * zoom;
      element.scrollTo({
        top: Math.max(0, top - (y > 0 ? element.clientHeight / 3 : 16)),
        behavior,
      });
    },
    [origins, sizes, zoom, across],
  );

  // ── The others ────────────────────────────────────────────────────────────
  const [people, setPeople] = useState<Author[]>([]);
  const onLive = useEffectEvent((event: ReaderEvent) => {
    if (event.type === 'mark' || event.type === 'unmark') store.applyRemote(event);
    else if (event.type === 'comments') comments.refresh();
    else setPeople(event.people.filter((each) => each.id !== me.id));
  });
  const onBack = useEffectEvent(() => {
    void store.resync();
    comments.refresh();
  });
  useEffect(() => {
    let source: EventSource | null = null;
    let timer = 0;
    let down = false;
    let closed = false;
    const open = () => {
      const stream = new EventSource(pdfLiveUrl(id), { withCredentials: true });
      source = stream;
      stream.addEventListener('open', () => {
        if (!down) return;
        down = false;
        onBack();
      });
      stream.addEventListener('pdf', (message) => {
        onLive(JSON.parse((message as MessageEvent<string>).data) as ReaderEvent);
      });
      stream.addEventListener('error', () => {
        down = true;
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
  // Leaving with something on its way: it goes now.
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      store.flush();
      if (store.pending()) event.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [store]);

  // ── Tools and what is picked ──────────────────────────────────────────────
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [picked, setPicked] = useState<string | null>(null);
  const place = useCallback(
    (body: ReaderMarkBody) => {
      if (body.kind === 'field') return;
      const markId = `${NEW_ID[body.kind]}:${crypto.randomUUID()}`;
      store.set(markId, body);
      setPicked(markId);
      // One word, one tick: the tool goes back to picking; a signature too.
      setTool({ kind: 'select' });
    },
    [store],
  );
  const pickedMark = picked ? state.marks.find((mark) => mark.id === picked) : undefined;
  if (picked && !pickedMark) setPicked(null);
  const removePicked = () => {
    if (!pickedMark) return;
    store.set(pickedMark.id, null);
    setPicked(null);
  };
  const undo = () => {
    const changed = store.undo();
    if (changed) setPicked(store.get(changed) ? changed : null);
  };
  const redo = () => {
    const changed = store.redo();
    if (changed) setPicked(store.get(changed) ? changed : null);
  };
  const endTyping = useCallback(() => store.endTyping(), [store]);

  // ── Comments at their places ──────────────────────────────────────────────
  const [draft, setDraft] = useState<ReaderAnchor | null>(null);
  const [active, setActive] = useState<string | null>(linked);
  const [showDone, setShowDone] = useState(false);
  const threads = useMemo(() => threadsOf(comments.comments), [comments.comments]);
  const shownThreads = useMemo(
    () =>
      threads.filter(
        (thread) => showDone || thread.root.status === 'open' || thread.root.id === active,
      ),
    [threads, showDone, active],
  );
  const doneCount = threads.filter((thread) => thread.root.status === 'done').length;

  // Down: beside the page, on the side its words are on, at their height. Across: in the row under
  // the pages, at their left edge.
  const placed = useMemo(() => {
    const left: Placed[] = [];
    const right: Placed[] = [];
    const below: Placed[] = [];
    const put = (item: Omit<Placed, 'at'>, anchor: ReaderAnchor | null) => {
      const box = anchor ? boxOf(anchor) : null;
      const page = anchor?.page ?? 0;
      const origin = layout.origins[page] ?? { x: 0, y: 0 };
      const size = sizes[page];
      if (flow === 'across') {
        const at = origin.x + (box && size ? box.x * size.width * zoom : 0);
        below.push({ ...item, at: Math.max(0, at) });
        return;
      }
      const top = origin.y + (box && size ? box.y * size.height * zoom : 0);
      (box && box.x + box.w / 2 < 0.5 ? left : right).push({ ...item, at: Math.max(0, top - 10) });
    };
    for (const thread of shownThreads) put({ key: thread.root.id, thread }, thread.root.anchor);
    if (draft) put({ key: 'draft', draft }, draft);
    for (const list of [left, right, below]) list.sort((a, b) => a.at - b.at);
    return { left, right, below };
  }, [shownThreads, draft, layout, sizes, zoom, flow]);

  // ── Search ────────────────────────────────────────────────────────────────
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; hits: PdfHit[] }>({ query: '', hits: [] });
  const hits = finding && query.trim() !== '' && found.query === query ? found.hits : NO_HITS;
  const [hitAt, setHitAt] = useState(0);
  useEffect(() => {
    if (!finding || query.trim() === '') return;
    const signal = { cancelled: false };
    const timer = window.setTimeout(() => {
      void findInPdf(doc, query, signal).then((found) => {
        if (!signal.cancelled) {
          setFound({ query, hits: found });
          setHitAt(0);
        }
      });
    }, 150);
    return () => {
      signal.cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, finding, query]);
  const shownHit = hits[Math.min(hitAt, Math.max(0, hits.length - 1))];
  useEffect(() => {
    if (shownHit) showPage(shownHit.page, shownHit.rects[0]?.y ?? 0);
  }, [shownHit, showPage]);

  /** Per page: comments' places, the draft's, the hits. */
  const pageMarks = useMemo(() => {
    const byPage = sizes.map((): PageMark[] => []);
    const add = (page: number, mark: PageMark) => byPage[page]?.push(mark);
    for (const thread of shownThreads) {
      const anchor = thread.root.anchor;
      if (!anchor) continue;
      const isActive = thread.root.id === active;
      const color = accentAlpha(
        thread.root.author.color,
        isActive ? 45 : thread.root.status === 'done' ? 10 : 24,
      );
      const rects = anchor.rects?.length ? anchor.rects : anchor.rect ? [anchor.rect] : [];
      rects.forEach((rect, index) =>
        add(anchor.page, { key: `${thread.root.id}:${index}`, rect, color }),
      );
    }
    if (draft) {
      const rects = draft.rects?.length ? draft.rects : draft.rect ? [draft.rect] : [];
      rects.forEach((rect, index) =>
        add(draft.page, { key: `draft:${index}`, rect, color: accentAlpha(me.color, 40) }),
      );
    }
    hits.forEach((hit, index) =>
      hit.rects.forEach((rect, part) =>
        add(hit.page, {
          key: `hit:${index}:${part}`,
          rect,
          color: 'color-mix(in srgb, var(--selection) 30%, transparent)',
          strong: index === hitAt,
        }),
      ),
    );
    return byPage;
  }, [sizes, shownThreads, active, draft, hits, hitAt, me.color]);
  const filledPages = useMemo(() => new Set(state.marks.map((mark) => mark.page)), [state.marks]);

  // A link to a comment leads to its place.
  const led = useRef(false);
  useEffect(() => {
    if (led.current || !linked) return;
    const anchor = threads.find((thread) => thread.root.id === linked)?.root.anchor;
    if (!anchor) return;
    led.current = true;
    showPage(anchor.page, boxOf(anchor)?.y ?? 0);
  }, [linked, threads, showPage]);

  // ── Words picked in the text: „Kommentieren“ beside them ──────────────────
  const [chosen, setChosen] = useState<{ anchor: ReaderAnchor; x: number; y: number } | null>(null);
  useEffect(() => {
    const read = rafThrottle(() => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setChosen(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const start =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const pageBox = start?.closest<HTMLElement>('.reader-page');
      if (!pageBox || !start?.closest('.textLayer')) {
        setChosen(null);
        return;
      }
      const page = Number(pageBox.dataset.page);
      const frame = pageBox.getBoundingClientRect();
      const rects = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1)
        .filter((rect) => rect.top < frame.bottom && rect.bottom > frame.top)
        .map((rect) => ({
          x: Math.max(0, (rect.left - frame.left) / frame.width),
          y: Math.max(0, (rect.top - frame.top) / frame.height),
          w: Math.min(1, rect.width / frame.width),
          h: Math.min(1, rect.height / frame.height),
        }))
        .slice(0, 60);
      if (rects.length === 0) {
        setChosen(null);
        return;
      }
      const end = range.getBoundingClientRect();
      setChosen({
        anchor: {
          page,
          rects,
          quote: selection.toString().replace(/\s+/g, ' ').trim().slice(0, 600),
        },
        x: end.left + end.width / 2,
        y: end.top,
      });
    });
    document.addEventListener('selectionchange', read.schedule);
    return () => {
      document.removeEventListener('selectionchange', read.schedule);
      read.cancel();
    };
  }, []);
  const commentOn = (anchor: ReaderAnchor) => {
    setDraft(anchor);
    setActive(null);
    setChosen(null);
    document.getSelection()?.removeAllRanges();
  };
  const onAreaComment = useCallback((page: number, rect: ReaderRect) => {
    setDraft({ page, rect });
    setActive(null);
    setTool({ kind: 'select' });
  }, []);

  // ── Leaving: the file with what is filled in ──────────────────────────────
  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const download = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await store.whenSaved();
      await apiDownload(pdfExportPath(id), pdf.fileName);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Download fehlgeschlagen', 'danger');
    } finally {
      setExporting(false);
    }
  };
  const print = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      await store.whenSaved();
      await printPdf(await fetchPdfExport(id), pdf.title);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Drucken fehlgeschlagen', 'danger');
    } finally {
      setPrinting(false);
    }
  };
  const close = () => {
    store.flush();
    void navigate(routes.pdfs(workspaceId));
  };
  // Reader's desktop app: print, export and ✕ stand in its tab bar, its menu bar asks for them.
  const inApp = inReaderDesktopBar();
  useReaderDesktopBar({ export: true, exportOpen: false });
  useReaderDesktopActions((action) => {
    if (action === 'export') void download();
    else if (action === 'print') void print();
    else if (action === 'close') close();
  });
  // ⌘K: what the PDF's pill offers – printing, the file with what is filled in, ✕.
  usePageCommands({
    group: 'PDF',
    workspaceId,
    actions: [
      { label: 'Drucken', icon: 'print', onSelect: () => void print() },
      { label: 'Exportieren', icon: 'iosShare', onSelect: () => void download() },
      { label: 'PDF schließen', icon: 'close', onSelect: close },
    ],
  });

  // ── Keys ──────────────────────────────────────────────────────────────────
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const key = event.key.toLowerCase();
    const mod = isModKey(event);
    if (mod && event.shiftKey && !event.altKey && key === 'e') {
      event.preventDefault();
      void download();
      return;
    }
    if (mod && !event.altKey && key === 'z') {
      if (!permissions.canEdit) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && !event.altKey && !event.shiftKey) {
      if (key === 'f') {
        event.preventDefault();
        setFinding(true);
      } else if (key === 'p') {
        event.preventDefault();
        void print();
      } else if (key === '=' || key === '+') {
        event.preventDefault();
        stepZoom(1);
      } else if (key === '-') {
        event.preventDefault();
        stepZoom(-1);
      } else if (key === '0') {
        event.preventDefault();
        zoomTo('fit');
      } else if (key === 'enter' && picked) {
        // ⌘↵ keeps the element and lets it go.
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        setPicked(null);
      }
      return;
    }
    if (key === 'escape') {
      if (isTextTarget(event.target)) {
        if (picked) {
          (event.target as HTMLElement).blur();
          setPicked(null);
        }
        return;
      }
      if (tool.kind !== 'select') setTool({ kind: 'select' });
      else if (picked) setPicked(null);
      else if (draft) setDraft(null);
      else if (active) setActive(null);
      return;
    }
    if (mod || event.altKey || isTextTarget(event.target)) return;
    if ((key === 'backspace' || key === 'delete') && pickedMark) {
      event.preventDefault();
      removePicked();
      return;
    }
    if (pickedMark && pickedMark.kind !== 'field' && key.startsWith('arrow')) {
      event.preventDefault();
      const size = sizes[pickedMark.page]!;
      const step = event.shiftKey ? 10 : 1;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      const { id: markId, author: _a, updatedAt: _u, ...body } = pickedMark;
      const rect = body.rect;
      store.set(markId, {
        ...body,
        rect: {
          ...rect,
          x: Math.min(1 - rect.w, Math.max(0, rect.x + dx / size.width)),
          y: Math.min(1 - rect.h, Math.max(0, rect.y + dy / size.height)),
        },
      });
      return;
    }
    if (key === 'v') setTool({ kind: 'select' });
    else if (key === 't' && permissions.canEdit) setTool({ kind: 'text' });
    else if (key === 'x' && permissions.canEdit) setTool({ kind: 'check' });
    else if (key === 'c' && permissions.canComment) setTool({ kind: 'comment' });
    else if (key === 's' && permissions.canEdit) {
      document.querySelector<HTMLButtonElement>('button[aria-label="Unterschrift (S)"]')?.click();
    } else if (
      key === 'pagedown' ||
      key === 'pageup' ||
      // Side by side, the arrows go from page to page, as from slide to slide in Slider.
      (across && !pickedMark && (key === 'arrowright' || key === 'arrowleft'))
    ) {
      event.preventDefault();
      const by = key === 'pagedown' || key === 'arrowright' ? 1 : -1;
      showPage(Math.max(0, Math.min(sizes.length - 1, current + by)), 0, true);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // ── Drawn ─────────────────────────────────────────────────────────────────
  // Narrow and down, there is no room beside the page: the open one lies over it.
  const over =
    !wide && !across
      ? [...placed.left, ...placed.right]
          .filter((item) => item.draft || item.thread?.root.id === active)
          .sort((a, b) => a.at - b.at)
      : [];
  const columns = (side: 'left' | 'right' | 'over' | 'below') =>
    (side === 'over'
      ? over.length > 0
      : side === 'below'
        ? across && placed.below.length > 0
        : wide && !across) && (
      <CommentColumn
        side={side === 'left' ? 'left' : 'right'}
        axis={side === 'below' ? 'x' : 'y'}
        overlay={side === 'over'}
        items={side === 'over' ? over : placed[side]}
        width={side === 'over' ? Math.min(GUTTER, Math.max(180, stageWidth - 104)) : GUTTER}
        length={side === 'below' ? layout.width : layout.height}
        active={active}
        onActivate={(next) => {
          setActive(next);
          const anchor = threads.find((thread) => thread.root.id === next)?.root.anchor;
          if (anchor && (!wide || across)) showPage(anchor.page, boxOf(anchor)?.y ?? 0, true);
        }}
        comments={comments}
        onDraftCancel={() => setDraft(null)}
        onDraftSent={(body, anchor, toAi, attachments) => {
          setDraft(null);
          setActive(comments.add(body, anchor, null, toAi, attachments));
        }}
      />
    );

  // Each comment's pin at its place: a click opens it.
  const pins = shownThreads.flatMap((thread) => {
    const anchor = thread.root.anchor;
    const box = anchor ? boxOf(anchor) : null;
    const size = anchor ? sizes[anchor.page] : undefined;
    const origin = anchor ? layout.origins[anchor.page] : undefined;
    if (!anchor || !box || !size || !origin) return [];
    return [
      {
        thread,
        left: origin.x + (box.x + box.w) * size.width * zoom,
        top: origin.y + box.y * size.height * zoom,
      },
    ];
  });

  const markBar = (() => {
    if (!pickedMark || pickedMark.kind === 'field' || !permissions.canEdit) return null;
    const size = sizes[pickedMark.page];
    const origin = layout.origins[pickedMark.page];
    if (!size || !origin) return null;
    const top = origin.y + pickedMark.rect.y * size.height * zoom;
    const left = origin.x + pickedMark.rect.x * size.width * zoom;
    const { id: markId, author: _a, updatedAt: _u, ...body } = pickedMark;
    return (
      <Toolbar
        data-chrome
        label="Markierung"
        className="absolute z-(--z-chrome) -translate-y-full animate-pop-in"
        style={{ left, top: top - 8 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {body.kind === 'text' && (
          <>
            <IconButton
              icon="remove"
              label="Kleiner"
              size="compact"
              disabled={body.size <= 6}
              onClick={() => store.set(markId, { ...body, size: Math.max(6, body.size - 1) })}
            />
            <span className="min-w-8 text-center text-caption text-fg-muted tabular-nums">
              {body.size} pt
            </span>
            <IconButton
              icon="add"
              label="Größer"
              size="compact"
              disabled={body.size >= 72}
              onClick={() => store.set(markId, { ...body, size: Math.min(72, body.size + 1) })}
            />
            <ToolbarDivider />
          </>
        )}
        <IconButton icon="delete" label="Löschen (⌫)" size="compact" onClick={removePicked} />
        <IconButton
          icon="close"
          label="Fertig (Esc)"
          size="compact"
          onClick={() => setPicked(null)}
        />
      </Toolbar>
    );
  })();

  const filledCount = state.marks.length;

  return (
    <ReaderContext value={session}>
      <div className="reader-viewer fixed inset-0 flex text-fg" style={selectionStyle(me.color)}>
        {across ? (
          <div
            data-chrome
            aria-label="Seiten"
            className="fixed inset-x-3 z-(--z-chrome) max-md:hidden"
            style={{ bottom: BAR_ROOM + 4 }}
          >
            <PageStrip
              doc={doc}
              sizes={sizes}
              current={current}
              filledPages={filledPages}
              onShow={(index) => showPage(index, 0, true)}
              flow="across"
            />
          </div>
        ) : (
          <aside
            data-chrome
            aria-label="Seiten"
            className="flex w-36 shrink-0 flex-col max-md:hidden"
          >
            <PageStrip
              doc={doc}
              sizes={sizes}
              current={current}
              filledPages={filledPages}
              onShow={(index) => showPage(index)}
            />
          </aside>
        )}

        <main ref={stage} className="relative min-w-0 flex-1 overflow-auto" aria-label={pdf.title}>
          <div
            className={
              across
                ? 'flex w-max min-w-full flex-col items-center px-8'
                : 'mx-auto flex w-max min-w-full items-start justify-center px-4 pb-24'
            }
            style={{
              gap: across ? PAGE_GAP : GUTTER_GAP,
              paddingTop: PAD_TOP,
              ...(across && { paddingBottom: BAR_ROOM + STRIP_ROOM + 16 }),
            }}
          >
            {columns('left')}
            <div
              ref={block}
              data-flow={flow}
              className={cn(
                'relative flex shrink-0',
                across ? 'items-center' : 'flex-col items-center',
              )}
              style={{
                width: layout.width,
                ...(across && { height: layout.height }),
                gap: PAGE_GAP,
              }}
            >
              {sizes.map((size, index) => (
                <PdfPageView
                  key={index}
                  doc={doc}
                  index={index}
                  size={size}
                  zoom={zoom}
                  widgets={widgets[index] ?? []}
                  marks={pageMarks[index] ?? []}
                  tool={tool}
                  picked={picked}
                  onPick={setPicked}
                  onPlace={place}
                  onComment={onAreaComment}
                  onTyped={endTyping}
                />
              ))}
              {pins.map(({ thread, left, top }) => (
                <button
                  key={thread.root.id}
                  type="button"
                  data-chrome
                  aria-label={`Kommentar von ${thread.root.author.name}`}
                  onClick={() => setActive(thread.root.id)}
                  className="focus-ring absolute z-10 -translate-y-full rounded-full rounded-bl-none p-0.5 shadow-md transition-transform hover:scale-110"
                  style={{
                    left,
                    top,
                    background: accentColor(thread.root.author.color),
                    opacity: thread.root.status === 'done' && thread.root.id !== active ? 0.6 : 1,
                  }}
                >
                  <Avatar author={thread.root.author} size={20} nativeTitle={false} />
                </button>
              ))}
              {markBar}
            </div>
            {columns('right')}
            {columns('below')}
          </div>
          {columns('over')}
        </main>

        <div data-chrome className="fixed top-3 right-3 z-(--z-chrome) flex items-center gap-2">
          {doneCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowDone((shown) => !shown)}>
              {showDone ? 'Erledigte ausblenden' : `Erledigte zeigen (${doneCount})`}
            </Button>
          )}
          {people.length > 0 && <AvatarStack authors={people} size={24} interactive />}
          <span
            role="status"
            className="px-1 text-caption text-fg-subtle"
            title={
              state.sync === 'offline'
                ? 'Was du ausfüllst, bleibt und wird später gesendet'
                : filledCount > 0
                  ? `${pluralize(filledCount, 'Eintrag', 'Einträge')} ausgefüllt`
                  : undefined
            }
          >
            {permissions.canEdit ? SYNC_LABEL[state.sync] : 'Nur ansehen'}
          </span>
          {state.sync === 'signedOut' && (
            <Button
              size="sm"
              onClick={() => void navigate(routes.login(location.pathname + location.search))}
            >
              Anmelden
            </Button>
          )}
          <Toolbar role={false}>
            <IconButton
              icon="search"
              label="Suchen"
              title={`Suchen (${isApplePlatform() ? '⌘F' : 'Strg F'})`}
              size="sm"
              active={finding}
              onClick={() => setFinding((open) => !open)}
            />
            {printing ? (
              <span
                className="flex size-8 items-center justify-center"
                role="status"
                aria-label="Wird gedruckt"
              >
                <Spinner size="sm" />
              </span>
            ) : (
              !inApp && (
                <IconButton
                  icon="print"
                  label="Drucken"
                  title={`Drucken (${isApplePlatform() ? '⌘P' : 'Strg P'})`}
                  size="sm"
                  onClick={() => void print()}
                />
              )
            )}
            {exporting ? (
              <span
                className="flex size-8 items-center justify-center"
                role="status"
                aria-label="Wird exportiert"
              >
                <Spinner size="sm" />
              </span>
            ) : (
              !inApp && (
                <IconButton
                  icon="iosShare"
                  label="Exportieren"
                  title={`Exportieren (${isApplePlatform() ? '⇧⌘E' : 'Strg ⇧ E'})`}
                  size="sm"
                  onClick={() => void download()}
                />
              )
            )}
            <ToolbarDivider />
            <span className="px-1.5 text-caption text-fg-muted tabular-nums" aria-live="polite">
              {current + 1} / {sizes.length}
            </span>
            {!inApp && (
              <>
                <ToolbarDivider />
                <IconButton icon="close" label="PDF schließen" size="sm" onClick={close} />
              </>
            )}
          </Toolbar>
        </div>

        <ReaderToolbar
          tool={tool}
          onTool={(next) => {
            setTool(next);
            setPicked(null);
          }}
          onSignature={(signature) => setTool({ kind: 'signature', ...signature })}
          zoom={zoomChoice}
          shownZoom={zoom}
          onZoom={zoomTo}
          onUndo={undo}
          onRedo={redo}
        />

        {tool.kind !== 'select' && (
          <div
            data-chrome
            role="status"
            className="pointer-events-none fixed bottom-18 left-1/2 z-(--z-chrome) -translate-x-1/2 animate-pop-in rounded-full bg-surface-3/90 px-3 py-1.5 text-caption text-fg-muted shadow-md backdrop-blur"
          >
            {tool.kind === 'text'
              ? 'Klicken, wo der Text stehen soll'
              : tool.kind === 'check'
                ? 'Klicken, wo der Haken stehen soll'
                : tool.kind === 'signature'
                  ? 'Klicken, wo die Unterschrift stehen soll'
                  : 'Bereich ziehen oder klicken, um zu kommentieren'}
            <span className="ml-2 text-fg-subtle">Esc</span>
          </div>
        )}

        {chosen && permissions.canComment && !draft && (
          <Toolbar
            data-chrome
            role={false}
            className="fixed z-(--z-chrome) -translate-x-1/2 -translate-y-full animate-pop-in"
            style={{ left: chosen.x, top: chosen.y - 8 }}
            onPointerDown={(event) => event.preventDefault()}
          >
            <Button
              variant="ghost"
              size="sm"
              icon="addComment"
              onClick={() => commentOn(chosen.anchor)}
            >
              Kommentieren
            </Button>
          </Toolbar>
        )}

        {finding && (
          <FindBar
            query={query}
            onQuery={setQuery}
            count={hits.length}
            at={Math.min(hitAt, Math.max(0, hits.length - 1))}
            onAt={setHitAt}
            onClose={() => {
              setFinding(false);
              setQuery('');
            }}
          />
        )}
        <div data-chrome>
          <Toast toast={toast} />
        </div>
      </div>
    </ReaderContext>
  );
}

/** „Suchen“, in the page above the sheets: every place is marked, ↵ leads to the next. */
function FindBar({
  query,
  onQuery,
  count,
  at,
  onAt,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  count: number;
  at: number;
  onAt: (index: number) => void;
  onClose: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const step = (by: 1 | -1) => {
    if (count > 0) onAt((at + by + count) % count);
  };
  return (
    <GlassPanel
      data-chrome
      role="search"
      aria-label="Suchen"
      className="fixed top-3 left-1/2 z-(--z-chrome) flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-pop-in items-center gap-1.5 rounded-panel p-1.5"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <label className="field-well focus-field flex h-8 w-52 min-w-0 items-center rounded-control-sm px-2.5">
        <input
          ref={field}
          type="text"
          aria-label="Suchen"
          placeholder="Suchen"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
          className="w-full min-w-0 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle"
        />
      </label>
      <span
        aria-live="polite"
        className="min-w-16 text-center text-caption text-fg-subtle tabular-nums"
      >
        {query.trim() === '' ? '' : count === 0 ? 'Nichts gefunden' : `${at + 1} von ${count}`}
      </span>
      <IconButton
        icon="chevronLeft"
        label="Vorige Stelle (⇧↵)"
        size="compact"
        variant="subtle"
        disabled={count === 0}
        onClick={() => step(-1)}
      />
      <IconButton
        icon="chevronRight"
        label="Nächste Stelle (↵)"
        size="compact"
        variant="subtle"
        disabled={count === 0}
        onClick={() => step(1)}
      />
      <IconButton
        icon="close"
        label="Suche schließen"
        size="compact"
        variant="subtle"
        onClick={onClose}
      />
    </GlassPanel>
  );
}
