import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { CloudNode } from '@slider/shared';
import { useCloudSearch } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { isModKey } from '@/lib/keyboard';
import { routes } from '@/lib/routes';
import { cn, Icon, Kbd, ReturnKey, useDebounced, type IconName } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { askCrumbSearch, CRUMB_SEARCH } from '../lib/crumb-search';
import { AreaDot } from './AreaDot';
import { FileIcon } from './FileIcon';

/** Dispatched on `window` to open the search from anywhere on the page. */
export const OPEN_SEARCH_EVENT = 'slider:cloud-search';

interface Entry {
  key: string;
  group: string;
  leading: ReactNode;
  title: ReactNode;
  subtitle?: string;
  run: () => void;
}

/** The name with what was typed set in bold. */
function Marked({ text, query }: { text: string; query: string }) {
  const word = query.trim().split(/\s+/)[0] ?? '';
  const at = word ? text.toLocaleLowerCase('de').indexOf(word.toLocaleLowerCase('de')) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-fg">{text.slice(at, at + word.length)}</span>
      {text.slice(at + word.length)}
    </>
  );
}

const whereOf = (node: CloudNode) =>
  [
    node.location?.areaName ?? (node.location?.areaId === null ? 'Meine Dateien' : null),
    ...(node.location?.folders ?? []).map((folder) => folder.name),
  ]
    .filter(Boolean)
    .join(' › ');

/**
 * ⌘F: one field for everything – files and folders by name wherever one may look, the areas,
 * and the few things to do from anywhere. ↑ ↓ pick, ↵ opens, Esc closes.
 */
export function SearchPalette() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const show = useEffectEvent(() => {
    // A field that stands there: typing goes into it, nothing opens over the page – the page's
    // own (Gelöscht) before the bar's; the bar folded: one in the page's path (`CrumbSearch`);
    // a panel (narrow) or a page of no list: the palette.
    const fields = [
      ...document.querySelectorAll<HTMLInputElement>(`[${SEARCH_FIELD}] input`),
    ].filter((each) => each.checkVisibility());
    const field =
      fields.find(
        (each) => each.closest(`[${SEARCH_FIELD}]`)?.getAttribute(SEARCH_FIELD) !== 'bar',
      ) ?? fields[0];
    if (field) {
      field.focus();
      field.select();
    } else if (document.querySelector(`[${CRUMB_SEARCH}]`)) {
      // The bar folded beside a page: typed where the page's path stands.
      askCrumbSearch(true);
    } else setOpen(true);
  });
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'f' || !isModKey(event) || event.altKey || event.shiftKey)
      return;
    // Over an open dialog nothing opens: its question comes first.
    if (!open && document.querySelector('dialog[open]')) return;
    event.preventDefault();
    if (open) setOpen(false);
    else show();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_SEARCH_EVENT, show);
    };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const close = () => setOpen(false);
  return (
    <dialog
      ref={dialog}
      aria-label="Suchen"
      onClose={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="glass-elevated m-0 mx-auto mt-[min(120px,14vh)] w-[min(660px,calc(100vw-32px))] rounded-panel p-0 text-left text-fg backdrop:bg-scrim backdrop:backdrop-blur-sm open:animate-pop-in"
    >
      {open && <SearchPanel onClose={close} />}
    </dialog>
  );
}

/** Marks the search field that stands in a page, for ⌘F to find it. */
const SEARCH_FIELD = 'data-cloud-search';

/** The search itself: the field, what it finds and the few things to do. In the ⌘F panel. */
function SearchPanel({ onClose }: { onClose: () => void }) {
  const ui = useCloud();
  const navigate = useNavigate();
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const settled = useDebounced(query, 150);
  // Small, as the bar: what is called so. What the files say is the page's (`SearchResults`).
  const search = useCloudSearch(ui.workspace.id, settled.trim());

  const close = () => {
    setQuery('');
    setActive(0);
    onClose();
  };
  const go = (run: () => void) => () => {
    close();
    run();
  };
  const words = query.trim().toLocaleLowerCase('de');
  const command = (key: string, icon: IconName, title: string, run: () => void): Entry => ({
    key,
    group: 'Befehle',
    leading: (
      <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
        <Icon name={icon} size={18} />
      </span>
    ),
    title,
    run: go(run),
  });
  const entries: Entry[] = [
    ...(words && search.data ? search.data.nodes : []).map((node): Entry => ({
      key: node.id,
      group: 'Dateien',
      leading: <FileIcon kind={node.kind} type={node.fileType} />,
      title: <Marked text={node.name} query={query} />,
      subtitle: [whereOf(node), node.updatedBy.name, formatRelativeTime(node.updatedAt)]
        .filter(Boolean)
        .join(' | '),
      // As a click in the list: a file shows its details, a folder opens.
      run: go(() => (node.kind === 'file' ? ui.openFile(node.id) : ui.open(node))),
    })),
    ...(ui.home?.areas ?? [])
      .filter((area) => words && area.name.toLocaleLowerCase('de').includes(words))
      .map((area): Entry => ({
        key: area.id,
        group: 'Bereiche',
        leading: <AreaDot color={area.color} size="lg" />,
        title: <Marked text={area.name} query={query} />,
        subtitle: area.description || undefined,
        run: go(() => void navigate(routes.cloudArea(ui.workspace.id, area.id))),
      })),
    ...[
      command('upload', 'uploadFile', 'Dateien hochladen', () => ui.pickAndUpload(ui.place)),
      command('folder', 'createNewFolder', 'Neuer Ordner', () => ui.newFolder(ui.place)),
      ...(ui.home?.canCreateAreas
        ? [command('area', 'workspaces', 'Neuer Bereich', () => ui.newArea())]
        : []),
      ...(ui.home?.ownFiles !== false
        ? [
            command(
              'own',
              'folder',
              'Zu „Meine Dateien“',
              () => void navigate(routes.cloudOwn(ui.workspace.id)),
            ),
          ]
        : []),
      command(
        'slider',
        'slideshow',
        'Zu Slider wechseln',
        () => void navigate(routes.workspace(ui.workspace.id)),
      ),
    ].filter((entry) => !words || String(entry.title).toLocaleLowerCase('de').includes(words)),
  ];
  const picked = Math.min(active, Math.max(0, entries.length - 1));
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [picked]);

  let lastGroup = '';
  const searching = Boolean(words) && (settled !== query || search.isFetching);
  return (
    <div className="flex max-h-[min(560px,70vh)] flex-col">
      <label className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-5">
        <Icon name="search" size={20} className="text-fg-muted" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive(Math.min(entries.length - 1, picked + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max(0, picked - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              entries[picked]?.run();
            }
          }}
          aria-label="Dateien, Ordner und Bereiche durchsuchen"
          aria-controls={listId}
          aria-activedescendant={entries[picked] ? `${listId}-${picked}` : undefined}
          placeholder="Dateien, Ordner und Bereiche durchsuchen"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
        />
        <Kbd>esc</Kbd>
      </label>
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Treffer"
        className="flex-1 overflow-y-auto p-2"
      >
        {entries.map((entry, index) => {
          const heading = entry.group !== lastGroup;
          lastGroup = entry.group;
          const current = index === picked;
          return (
            <div key={`${entry.group}:${entry.key}`}>
              {heading && (
                <p className="px-2.5 pt-2.5 pb-1.5 text-caption font-semibold tracking-wider text-fg-subtle uppercase">
                  {entry.group}
                </p>
              )}
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                aria-selected={current}
                data-active={current}
                onMouseMove={() => setActive(index)}
                onClick={entry.run}
                className={cn(
                  'flex h-12 w-full items-center gap-3 rounded-control px-2.5 text-left',
                  current && 'bg-hover',
                )}
              >
                {entry.leading}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-fg-muted">{entry.title}</span>
                  {entry.subtitle && (
                    <span className="truncate text-xs text-fg-subtle">{entry.subtitle}</span>
                  )}
                </span>
                {current && (
                  <Kbd>
                    <ReturnKey />
                  </Kbd>
                )}
              </button>
            </div>
          );
        })}
        {words && !searching && search.data?.nodes.length === 0 && (
          <p className="px-2.5 py-3 text-body text-fg-subtle">
            Keine Datei und kein Ordner heißt so.
          </p>
        )}
        {search.data?.more && words && (
          <p className="px-2.5 py-2 text-xs text-fg-subtle">
            Es gibt mehr Treffer. Tippe weiter, um sie einzugrenzen.
          </p>
        )}
      </div>
      <footer className="flex shrink-0 items-center gap-4 border-t border-hairline px-5 py-2.5 text-xs text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <Kbd>↑↓</Kbd> wählen
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>
            <ReturnKey />
          </Kbd>{' '}
          öffnen
        </span>
      </footer>
    </div>
  );
}
