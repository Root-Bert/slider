import {
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router';
import type { CloudNode } from '@slider/shared';
import { selectionStyle } from '@/lib/accent';
import { usePageApp } from '@/lib/apps';
import { SELECT_ID, useCollectionSelection } from '@/lib/collection-selection';
import { isTextTarget, isTypingTarget } from '@/lib/dom';
import { isModKey } from '@/lib/keyboard';
import { CLOUD_FILE_PARAM } from '@/lib/routes';
import { isOnControl } from '@/lib/marquee-select';
import { useAccount } from '@/features/auth';
import { MenuButton, SenderMenuContext } from '@/features/sender';
import { cn, ContextMenu, Icon, SelectionBar, type MenuAction } from '@/ui';
import { useCloud, type CloudTarget } from '../hooks/useCloud';
import { carriesNodes, NODES_DRAG } from '../lib/drag';
import { BarFolded, CRUMB_SEARCH, useCrumbSearch } from '../lib/crumb-search';
import { CrumbSearchField } from './CrumbSearch';
import { DROP_FAILED, droppedFiles } from '../lib/upload';
import { GIVE_WAY_TO_PANEL } from '../lib/panel';
import { tabTitle } from '../lib/tab-title';
import type { CloudItems } from './FileBrowser';

export interface Crumb {
  label: string;
  to?: string;
}

interface CloudPageProps {
  /** For the browser tab: `<docTitle> | <workspace> | Cloud`. */
  docTitle: string;
  title: ReactNode;
  /** Before the title: an area's colour, a folder's symbol. */
  lead?: ReactNode;
  crumbs?: readonly Crumb[];
  subtitle?: ReactNode;
  /** Right of the title. */
  actions?: ReactNode;
  /** The row of tabs, filters and view switches under the header. */
  toolbar?: ReactNode;
  /** What can be picked on this page – in the order it is shown. */
  nodes: readonly CloudNode[];
  /** Where dropped files and „Neuer Ordner“ go; `null`: nothing can be put here. */
  target?: CloudTarget | null;
  /**
   * The page's content is as high as the window leaves room, and its lists scroll inside
   * themselves (the start page) – otherwise everything under the header scrolls as one.
   */
  fill?: boolean;
  children: (selection: CloudSelection) => ReactNode;
}

/**
 * What a page's lists need to let files be picked – and, on a page without a toolbar, the
 * `bar` of the picked ones to put where its first row stands (the start page's search).
 */
export interface CloudSelection extends CloudItems {
  bar: ReactNode;
}

/**
 * One page of Cloud: its header, and around its list everything lists share – picking several
 * (⌘/Shift-click, ⌘A, a dragged box) with their actions in the toolbar's place (as Slider's
 * presentations: nothing lies over the list), ⌫ to delete,
 * a right click on empty space, and files dragged in from the desktop.
 */
export function CloudPage({
  docTitle,
  title,
  lead,
  crumbs,
  subtitle,
  actions,
  toolbar,
  nodes,
  target = null,
  fill = false,
  children,
}: CloudPageProps) {
  const ui = useCloud();
  const { user } = useAccount();
  const folded = use(BarFolded);
  const typing = useCrumbSearch();
  // A page shown in Slider too (its „Agenten“) carries that app's name.
  const appName = usePageApp() === 'cloud' ? 'Cloud' : 'Slider';
  // The window never scrolls: header, tabs and side bar stay, the content scrolls under them.
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const selection = useCollectionSelection(
    contentRef,
    nodes.map((node) => node.id),
    scrollRef,
  );
  const selected = nodes.filter((node) => selection.selected.has(node.id));
  // The file whose details stand beside: picked with one click, it is the selection – emptied
  // (Esc, ⌫, a click beside the items), its details go too.
  const [params, setParams] = useSearchParams();
  const shownId = params.get(CLOUD_FILE_PARAM);
  const before = useRef<ReadonlySet<string>>(new Set());
  // What was picked when the selection was emptied, and when – the address may follow a click a
  // moment after the pick (a ⌫ right after the click came before the details did).
  const unpicked = useRef<{ ids: ReadonlySet<string>; at: number } | null>(null);
  const closeDetails = useCallback(
    () =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete(CLOUD_FILE_PARAM);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  useEffect(() => {
    const now = selection.selected;
    if (now.size > 0) unpicked.current = null;
    else if (before.current.size > 0) unpicked.current = { ids: before.current, at: Date.now() };
    before.current = now;
    const gone = unpicked.current;
    if (shownId && gone?.ids.has(shownId) && Date.now() - gone.at < 2000) {
      unpicked.current = null;
      closeDetails();
    }
  }, [selection.selected, shownId, closeDetails]);
  // And the other way: its details closed (Esc, ✕), the file picked for them is let go too – one
  // Esc ends both, whichever listener hears it first (the details' stays from page to page).
  const shownBefore = useRef(shownId);
  const onDetailsGone = useEffectEvent((was: string) => {
    if (selection.selected.size === 1 && selection.selected.has(was)) selection.clear();
  });
  useEffect(() => {
    const was = shownBefore.current;
    shownBefore.current = shownId;
    if (was && !shownId) onDetailsGone(was);
  }, [shownId]);
  const [selectionMenuAt, setSelectionMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [pageMenuAt, setPageMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // „Neu“ in the side bar puts things where this page is.
  const { setPlace } = ui;
  const targetKey = target ? `${target.parentId ?? ''}:${target.areaId ?? ''}:${target.name}` : '';
  useEffect(() => {
    setPlace(target);
    return () => setPlace(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `targetKey` stands for `target`
  }, [setPlace, targetKey]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;
    if (document.querySelector('dialog[open], [role="menu"]')) return;
    if (selected.length === 0) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // As the menu: only when every one of them is the caller's to delete.
      if (!ui.actionsFor(selected).some((action) => action.tone === 'danger')) return;
      event.preventDefault();
      if (selected[0]?.deleted) ui.purge(selected);
      else ui.trash(selected);
      selection.clear();
    } else if (
      event.key === 'Enter' &&
      selected.length === 1 &&
      selected[0] &&
      // On a button or a link Enter is that one's.
      !(event.target as Element | null)?.closest?.('button, a, [role="button"], [role="menuitem"]')
    ) {
      event.preventDefault();
      if (!selected[0].deleted) ui.open(selected[0]);
      selection.clear();
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ↑/↓ as in the Finder: the pick goes to the item before or after – in columns within its
  // column (`data-pick-group`) –, a file's details follow, Shift+↑/↓ pick the range.
  const onArrow = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.defaultPrevented || event.altKey || isModKey(event)) return;
    if (isTextTarget(event.target) || document.querySelector('dialog[open], [role="menu"]')) return;
    const content = contentRef.current;
    const from = event.target;
    // The page's own keys: not while the focus is in the side bar or the details.
    if (!content || !(from === document.body || (from instanceof Node && content.contains(from))))
      return;
    const item = (id: string | null | undefined) =>
      id ? content.querySelector<HTMLElement>(`[${SELECT_ID}="${CSS.escape(id)}"]`) : null;
    const current =
      (from instanceof Element ? from.closest<HTMLElement>(`[${SELECT_ID}]`) : null) ??
      item(shownId) ??
      item(selected.at(-1)?.id);
    const group = current?.closest('[data-pick-group]') ?? content;
    const items = [...group.querySelectorAll<HTMLElement>(`[${SELECT_ID}]`)];
    const at = current ? items.indexOf(current) : -1;
    const next =
      at < 0
        ? event.key === 'ArrowDown'
          ? items[0]
          : items.at(-1)
        : items[at + (event.key === 'ArrowDown' ? 1 : -1)];
    const id = next?.getAttribute(SELECT_ID);
    const node = id ? nodes.find((each) => each.id === id) : undefined;
    // Nothing to move to (no list here, its first or last one): the key stays the page's – it
    // scrolls, a mail steps (`useMailKeys`).
    if (!next || !node) return;
    event.preventDefault();
    if (event.shiftKey) selection.extendTo(node.id);
    else {
      selection.pickOne(node.id);
      // A folder's details follow only where they stand already: it is picked, not opened. In the
      // trash nothing has details – it opens nowhere until brought back.
      if (!node.deleted && (node.kind === 'file' || shownId)) ui.openFile(node.id, true);
    }
    next.querySelector<HTMLElement>('[data-name]')?.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
  });
  useEffect(() => {
    window.addEventListener('keydown', onArrow);
    return () => window.removeEventListener('keydown', onArrow);
  }, []);

  // Each action clears the selection: what it was about is done. „Details“ only while they are
  // not beside already.
  const detailsShown = selected.length === 1 && selected[0]?.id === shownId;
  const selectionActions = ui
    .actionsFor(selected)
    .filter((action) => !(detailsShown && action.label === 'Details'))
    .map((action) => ({
      ...action,
      onSelect: () => {
        action.onSelect();
        selection.clear();
      },
    }));
  // In the toolbar's place, as over Slider's presentations; what does not fit beside the details
  // goes behind its „…“.
  const selectionBar =
    selected.length > 0 ? (
      <SelectionBar
        label="Ausgewählte Dateien"
        count={selected.length}
        actions={selectionActions}
        onClear={selection.clear}
      />
    ) : null;
  const pageActions: MenuAction[] = target
    ? [
        { label: 'Neuer Ordner', icon: 'folder', onSelect: () => ui.newFolder(target) },
        { label: 'Dateien hochladen …', icon: 'upload', onSelect: () => ui.pickAndUpload(target) },
        {
          label: 'Ordner hochladen …',
          icon: 'driveFolderUpload',
          onSelect: () => ui.pickAndUpload(target, true),
        },
        ...(ui.tidy
          ? [
              {
                label: 'Aufräumen',
                icon: 'autoAwesome' as const,
                onSelect: () => ui.tidy?.(target),
              },
            ]
          : []),
      ]
    : [];

  // From the desktop, or – in the app – out of the page beside this one.
  const fromOtherPage = (event: DragEvent) => carriesNodes(event.dataTransfer);
  const fromDesktop = (event: DragEvent) =>
    target !== null &&
    ui.dragged().length === 0 &&
    (event.dataTransfer.types.includes('Files') || fromOtherPage(event));
  // However the drag ends – dropped on a folder (which takes it for itself), beside the page,
  // or given up outside the window – the frame goes: the page's own `drop` hears only its own.
  useEffect(() => {
    if (!dragOver) return;
    const end = () => setDragOver(false);
    const left = (event: globalThis.DragEvent) => {
      if (event.relatedTarget === null) end();
    };
    window.addEventListener('drop', end, true);
    window.addEventListener('dragend', end, true);
    window.addEventListener('dragleave', left, true);
    return () => {
      window.removeEventListener('drop', end, true);
      window.removeEventListener('dragend', end, true);
      window.removeEventListener('dragleave', left, true);
    };
  }, [dragOver]);

  const drop = {
    onDragEnter: (event: DragEvent) => {
      if (fromDesktop(event)) setDragOver(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!fromDesktop(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = fromOtherPage(event) ? 'move' : 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
    },
    onDrop: (event: DragEvent) => {
      setDragOver(false);
      if (!fromDesktop(event) || !target) return;
      event.preventDefault();
      if (fromOtherPage(event)) ui.takeFrom(event.dataTransfer.getData(NODES_DRAG), target);
      else {
        droppedFiles(event.dataTransfer).then(
          (files) => ui.upload(files, target),
          () => ui.notify(DROP_FAILED, 'danger'),
        );
      }
    },
  };

  return (
    <div
      // As high as the window leaves under the app's header (88) and the gap above the title.
      className="relative flex h-[calc(100dvh-104px)] flex-col gap-5"
      style={selectionStyle(user.color)}
      onMouseDown={selection.onMouseDown}
      onContextMenu={(event: MouseEvent) => {
        if (event.defaultPrevented || isOnControl(event.target) || pageActions.length === 0) return;
        event.preventDefault();
        setPageMenuAt({ x: event.clientX, y: event.clientY });
      }}
      {...drop}
    >
      <title>{tabTitle(docTitle, ui.workspace.name, appName)}</title>
      <header
        {...(folded ? { [CRUMB_SEARCH]: '' } : {})}
        className={cn(
          'flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3',
          GIVE_WAY_TO_PANEL,
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          {typing ? (
            // The bar folded: its search stands where the path stands (`CrumbSearch`).
            <div className="absolute inset-x-0 -top-8 z-(--z-overlay) flex h-6 min-w-0 items-center text-body">
              <CrumbSearchField />
            </div>
          ) : (
            crumbs &&
            crumbs.length > 0 && (
              // In the gap under the app's header: the title stays where it is on every page.
              <nav
                aria-label="Pfad"
                className="absolute inset-x-0 -top-8 z-(--z-overlay) flex h-6 min-w-0 items-center gap-1 text-body"
              >
                {crumbs.map((crumb, index) => (
                  <span key={index} className="flex min-w-0 items-center gap-1">
                    {index > 0 && (
                      <Icon name="chevronRight" size={14} className="shrink-0 text-fg-faint" />
                    )}
                    {crumb.to ? (
                      <Link
                        to={crumb.to}
                        className="truncate text-fg-subtle transition-colors hover:text-fg"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="truncate text-fg">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            )
          )}
          {/* As high as a button (`Hochladen`): the actions beside never push the title down. */}
          <div className="flex min-h-9 min-w-0 items-center gap-3">
            {/* Below lg: the side bar's places, as at the start of Sender's heads. */}
            <MenuButton />
            {lead}
            {/* Words stand right of the title, on its line – as beside „Präsentationen“; under
                it only where the window is too narrow. */}
            <hgroup className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="-m-1 min-w-0 truncate p-1 text-display leading-tight font-semibold tracking-tight text-fg">
                {title}
              </h1>
              {typeof subtitle === 'string' && (
                <p className="min-w-0 truncate text-body text-fg-subtle">{subtitle}</p>
              )}
            </hgroup>
          </div>
          {/* Anything but words (an agent's chat tabs) stands under the title, as it is. */}
          {typeof subtitle === 'string' ? null : subtitle}
        </div>
        {/* Pushed to the right also where a long title wraps them onto a line of their own. */}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {toolbar && (
        <div className={cn('shrink-0', GIVE_WAY_TO_PANEL)}>{selectionBar ?? toolbar}</div>
      )}
      <div
        ref={scrollRef}
        // Room around, so a focus ring, a card that grows or a floating field's shadow (the
        // agents' order field) is not cut: up to the title above, towards the side bar, and as
        // far right as both layouts' padding goes. What Tab scrolls to keeps its ring's room.
        className="-mt-5 -mr-4 -ml-10 min-h-0 flex-1 scroll-py-2 overflow-y-auto overscroll-contain pt-5 pr-4 pb-6 pl-10 lg:-mr-6 lg:pr-6"
      >
        <div
          ref={contentRef}
          className={cn(
            'relative flex flex-col gap-5',
            fill ? 'h-full min-h-[560px]' : 'min-h-full',
          )}
        >
          {/* The head has the menu's button: a conversation shown in the page (an area's chat,
              a mail beside the list) brings none of its own. */}
          <SenderMenuContext.Provider value={null}>
            {children({
              selected: selection.selected,
              // As over Slider's presentations: a plain click while several are picked picks
              // that one alone, else a folder opens. A file's own click does that always and
              // shows its details too (`fileClicks`).
              onModifiedClick: (id, event) =>
                (isModKey(event) ||
                  event.shiftKey ||
                  nodes.find((node) => node.id === id)?.kind !== 'file') &&
                selection.onModifiedClick(id, event),
              pickOne: selection.pickOne,
              onSelectionMenu: setSelectionMenuAt,
              bar: toolbar ? null : selectionBar,
            })}
          </SenderMenuContext.Provider>
          {selection.box}
        </div>
      </div>

      {selectionMenuAt && selected.length > 0 && (
        <ContextMenu
          label={`Aktionen für ${selected.length} ausgewählte Elemente`}
          actions={selectionActions}
          at={selectionMenuAt}
          onClose={() => setSelectionMenuAt(null)}
        />
      )}
      {pageMenuAt && (
        <ContextMenu
          label="Aktionen für diesen Ort"
          actions={pageActions}
          at={pageMenuAt}
          onClose={() => setPageMenuAt(null)}
        />
      )}
      {/* Over the page while files are dragged in from the desktop. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-3 z-(--z-panel) flex items-center justify-center rounded-panel border-2 border-dashed border-fg transition-opacity duration-200',
          dragOver ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="drop-glow absolute inset-0 rounded-panel" />
        <span className="glass relative rounded-chip px-4 py-2 text-body font-medium text-fg">
          Loslassen zum Hochladen nach „{target?.name}“
        </span>
      </div>
    </div>
  );
}
