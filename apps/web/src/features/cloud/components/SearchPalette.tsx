import { useEffect, useEffectEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCloudSearch } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { isSearchKey } from '@/lib/keyboard';
import { routes } from '@/lib/routes';
import { useMailHits } from '@/features/sender';
import {
  PaletteBody,
  PaletteDialog,
  PaletteMark,
  PaletteMarked as Marked,
  useDebounced,
  type IconName,
  type PaletteEntry as Entry,
} from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { shownName, useShowExtensions } from '../hooks/useShowExtensions';
import { whereOf } from '../lib/kinds';
import { useCloudNewActions } from '../hooks/useNewActions';
import { askCrumbSearch, CRUMB_SEARCH } from '../lib/crumb-search';
import { AreaDot } from './AreaDot';
import { FileIcon } from './FileIcon';

/** Dispatched on `window` to open the search from anywhere on the page. */
export const OPEN_SEARCH_EVENT = 'slider:cloud-search';

/**
 * ⇧⌘F: one field for everything – files and folders by name wherever one may look, the areas, the
 * mails, and the few things to do from anywhere. ↑ ↓ pick, ↵ opens, Esc closes.
 */
export function SearchPalette() {
  const [open, setOpen] = useState(false);

  const show = useEffectEvent(() => {
    // The side bar's field – the whole app's search, never a page's own (that is ⌘F's,
    // `ViewSearch`): typed where it stands, nothing opens over the page; the bar folded: the one in
    // the page's path (`CrumbSearch`); a panel (narrow) or no bar: the palette.
    const field = [
      ...document.querySelectorAll<HTMLInputElement>(
        `[${SEARCH_FIELD}="bar"] input, [${SEARCH_FIELD}="page"] input`,
      ),
    ].find((each) => each.checkVisibility());
    if (field) {
      field.focus();
      field.select();
    } else if (document.querySelector(`[${CRUMB_SEARCH}]`)) {
      // The bar folded beside a page: typed where the page's path stands.
      askCrumbSearch(true);
    } else setOpen(true);
  });
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isSearchKey(event, 'main')) return;
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
  const close = () => setOpen(false);
  return (
    <PaletteDialog open={open} onClose={close} label="Suchen">
      {open && <SearchPanel />}
    </PaletteDialog>
  );
}

/** Marks the side bar's search field (`bar`) and its stand-in in the page's path (`page`), for ⇧⌘F. */
const SEARCH_FIELD = 'data-cloud-search';

/** The search itself: the field, what it finds and the few things to do. In the ⇧⌘F panel. */
function SearchPanel() {
  const ui = useCloud();
  const extensions = useShowExtensions();
  const navigate = useNavigate();
  const newActions = useCloudNewActions();
  const [query, setQuery] = useState('');
  const settled = useDebounced(query, 150);
  // Small, as the bar: what is called so. What the files say is the page's (`SearchResults`).
  const search = useCloudSearch(ui.workspace.id, settled.trim());
  const mails = useMailHits(ui.workspace.id, settled.trim());

  const words = query.trim().toLocaleLowerCase('de');
  const command = (key: string, icon: IconName, title: string, run: () => void): Entry => ({
    key,
    group: 'Befehle',
    leading: <PaletteMark icon={icon} />,
    title,
    run,
  });
  const entries: Entry[] = [
    ...(words && search.data ? search.data.nodes : []).map((node): Entry => ({
      key: node.id,
      group: 'Dateien',
      leading: <FileIcon kind={node.kind} type={node.fileType} />,
      title: <Marked text={shownName(node, extensions)} query={query} />,
      subtitle: [whereOf(node), node.updatedBy.name, formatRelativeTime(node.updatedAt)]
        .filter(Boolean)
        .join(' | '),
      // As a click in the list: a file shows its details, a folder opens.
      run: () => (node.kind === 'file' ? ui.openFile(node.id) : ui.open(node)),
    })),
    ...(ui.home?.areas ?? [])
      .filter((area) => words && area.name.toLocaleLowerCase('de').includes(words))
      .map((area): Entry => ({
        key: area.id,
        group: 'Bereiche',
        leading: <AreaDot color={area.color} size="lg" />,
        title: <Marked text={area.name} query={query} />,
        subtitle: area.description || undefined,
        run: () => void navigate(routes.cloudArea(ui.workspace.id, area.id)),
      })),
    // Subject, names, addresses – every mailbox and folder; one opens in Post.
    ...(words ? mails.threads : []).map((thread): Entry => ({
      key: thread.id,
      group: 'Mails',
      leading: <PaletteMark icon="mail" />,
      title: (
        <Marked
          text={thread.subject || thread.person.name.trim() || thread.person.address}
          query={query}
        />
      ),
      subtitle: [
        thread.person.name.trim() || thread.person.address,
        formatRelativeTime(thread.updatedAt),
      ]
        .filter(Boolean)
        .join(' | '),
      run: () => void navigate(routes.cloudMailThread(ui.workspace.id, thread.id)),
    })),
    // What „Neu“ makes here – the side bar's menu, the command panel's (⌘K) „Neu“.
    ...newActions
      .filter((action) => !action.disabled)
      .filter((action) => !words || action.label.toLocaleLowerCase('de').includes(words))
      .map((action) =>
        command(action.key ?? action.label, action.icon as IconName, action.label, action.onSelect),
      ),
  ];
  const searching = Boolean(words) && (settled !== query || search.isFetching || mails.settling);
  return (
    <PaletteBody
      label="Dateien, Ordner, Bereiche und Mails durchsuchen"
      query={query}
      onQuery={setQuery}
      entries={entries}
    >
      {words && !searching && search.data?.nodes.length === 0 && mails.threads.length === 0 && (
        <p className="px-2.5 py-3 text-body text-fg-subtle">
          Keine Datei, kein Ordner und keine Mail heißt so.
        </p>
      )}
      {search.data?.more && words && (
        <p className="px-2.5 py-2 text-xs text-fg-subtle">
          Es gibt mehr Treffer. Tippe weiter, um sie einzugrenzen.
        </p>
      )}
    </PaletteBody>
  );
}
