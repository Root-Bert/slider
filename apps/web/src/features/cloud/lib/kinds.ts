import {
  cloudExtension,
  type CloudAgentWatch,
  type CloudFileType,
  type CloudNode,
} from '@slider/shared';
import type { IconName } from '@/ui';

/** How a kind of file is called and drawn: its name, its symbol, its tint. */
interface Kind {
  label: string;
  icon: IconName;
  /** Tile fill and symbol colour (design tokens, so both themes carry them). */
  tile: string;
  ink: string;
}

export const FILE_KINDS: Record<CloudFileType, Kind> = {
  document: { label: 'Dokument', icon: 'article', tile: 'bg-accent-blue/15', ink: 'text-sky' },
  presentation: {
    label: 'Präsentation',
    icon: 'slideshow',
    tile: 'bg-logo/15',
    ink: 'text-logo',
  },
  spreadsheet: {
    label: 'Tabelle',
    icon: 'tableChart',
    tile: 'bg-success/15',
    ink: 'text-success',
  },
  pdf: { label: 'PDF', icon: 'pictureAsPdf', tile: 'bg-danger/15', ink: 'text-danger' },
  image: { label: 'Bild', icon: 'image', tile: 'bg-accent-violet/15', ink: 'text-accent-violet' },
  video: { label: 'Video', icon: 'movie', tile: 'bg-warning/15', ink: 'text-warning' },
  audio: { label: 'Audio', icon: 'audiotrack', tile: 'bg-accent-cyan/15', ink: 'text-accent-cyan' },
  archive: { label: 'Archiv', icon: 'folderZip', tile: 'bg-surface-2', ink: 'text-fg-muted' },
  text: { label: 'Text', icon: 'textSnippet', tile: 'bg-surface-2', ink: 'text-fg-muted' },
  other: { label: 'Datei', icon: 'insertDriveFile', tile: 'bg-surface-2', ink: 'text-fg-muted' },
};

/** The presentations Slider opens as its own (the API's `toDeckBytes`): not a Keynote, not an old `.ppt`. */
const SLIDER_DECKS = new Set(['pptx', 'pptm', 'ppsx', 'odp']);

/**
 * Which of the apps opens the file: a presentation Slider (`decks`: the caller may make
 * presentations), a PDF Reader, a text document Writer. `null`: none – it belongs to an app on the
 * computer.
 */
export function appFor(
  node: Pick<CloudNode, 'name' | 'fileType'>,
  decks: boolean,
): 'slider' | 'reader' | 'writer' | null {
  const extension = cloudExtension(node.name);
  if (node.fileType === 'presentation' && decks && SLIDER_DECKS.has(extension)) return 'slider';
  if (extension === 'pdf') return 'reader';
  if (['odt', 'md', 'markdown'].includes(extension)) return 'writer';
  return null;
}

/** The chips over a list: which kinds each lets through. */
export const TYPE_FILTERS = [
  { value: 'all', label: 'Alle', icon: 'description', types: null },
  { value: 'documents', label: 'Dokumente', icon: 'article', types: ['document', 'text'] },
  { value: 'presentations', label: 'Präsentationen', icon: 'slideshow', types: ['presentation'] },
  { value: 'pdf', label: 'PDF', icon: 'pictureAsPdf', types: ['pdf'] },
  { value: 'spreadsheets', label: 'Tabellen', icon: 'tableChart', types: ['spreadsheet'] },
  { value: 'media', label: 'Medien', icon: 'image', types: ['image', 'video', 'audio'] },
] as const satisfies readonly {
  value: string;
  label: string;
  icon: IconName;
  types: readonly CloudFileType[] | null;
}[];
export type TypeFilter = (typeof TYPE_FILTERS)[number]['value'];

export const CLOUD_SORTS = ['changed', 'name', 'size', 'type'] as const;
export type CloudSort = (typeof CLOUD_SORTS)[number];
export const SORT_LABELS: Record<CloudSort, string> = {
  changed: 'Zuletzt geändert',
  name: 'Name',
  size: 'Größe',
  type: 'Typ',
};

/** `columns` only where there are folders to step into (a place); elsewhere it shows as the list. */
export const CLOUD_VIEWS = ['list', 'tiles', 'columns'] as const;
export type CloudView = (typeof CLOUD_VIEWS)[number];

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** The order of „Typ“ among files: the kinds as `FILE_KINDS` lists them (as the chips). */
const KIND_ORDER = Object.keys(FILE_KINDS);
const kindRank = (node: CloudNode) => KIND_ORDER.indexOf(node.fileType ?? 'other');

/** Folders first (they are places), then by the chosen order; „Typ“ also puts each kind together. */
export function sortNodes(nodes: readonly CloudNode[], sort: CloudSort): CloudNode[] {
  const byName = (a: CloudNode, b: CloudNode) => collator.compare(a.name, b.name);
  const order = (a: CloudNode, b: CloudNode) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'size') return b.sizeBytes - a.sizeBytes || byName(a, b);
    if (sort === 'type') return kindRank(a) - kindRank(b) || byName(a, b);
    return b.updatedAt.localeCompare(a.updatedAt) || byName(a, b);
  };
  return [...nodes].sort((a, b) =>
    a.kind === b.kind ? order(a, b) : a.kind === 'folder' ? -1 : 1,
  );
}

export function filterNodes(nodes: readonly CloudNode[], filter: TypeFilter): CloudNode[] {
  const types: readonly CloudFileType[] | null =
    TYPE_FILTERS.find((each) => each.value === filter)?.types ?? null;
  if (!types) return [...nodes];
  return nodes.filter(
    (node) => node.kind === 'file' && node.fileType && types.includes(node.fileType),
  );
}

/** „24 Dateien | 1,2 GB“ under a folder. */
export const folderSummary = (node: CloudNode, size: string) =>
  `${node.fileCount === 1 ? '1 Datei' : `${node.fileCount ?? 0} Dateien`}${node.sizeBytes > 0 ? ` | ${size}` : ''}`;

/** The side bar's two widths: with names, or folded in to the icons alone. */
export const SIDEBAR_STATES = ['open', 'icons'] as const;
export const SIDEBAR_KEY = 'slider.cloud.sidebar';

/** What an agent is up to, in a few words. */
export function agentState(agent: { running: boolean; interrupted: boolean; openFiles: number }) {
  if (agent.running) return 'Arbeitet';
  if (agent.interrupted) return 'Unterbrochen';
  if (agent.openFiles > 0) return `${agent.openFiles} auf dem Schreibtisch`;
  return 'Fertig';
}

/** The days of a weekly order, as the server counts them: `0` Sunday to `6` Saturday. */
export const WEEKDAYS = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
] as const;

/** When a repeated order runs, in words: „Täglich um 08:00“, „Montags um 08:00“. */
export function repeatWords(repeat: {
  every: 'day' | 'weekdays' | 'week';
  at: string;
  day?: number;
}) {
  const when =
    repeat.every === 'day'
      ? 'Täglich'
      : repeat.every === 'weekdays'
        ? 'Werktags'
        : `${WEEKDAYS[repeat.day ?? 1]}s`;
  return `${when} um ${repeat.at}`;
}

/** What an agent keeps an eye on, as a sentence's start: „Wenn sich in „Vertrieb“ etwas ändert“. */
export function watchWords(watch: Pick<CloudAgentWatch, 'on' | 'name'>) {
  switch (watch.on) {
    case 'area':
    case 'folder':
      return `Wenn sich in „${watch.name}“ etwas ändert`;
    case 'file':
      return `Wenn sich „${watch.name}“ ändert`;
    case 'people':
      return `Wenn im Bereich „${watch.name}“ jemand dazukommt oder geht`;
  }
}

/** What an agent does by itself, in a line – `null`: it works when written to. */
export function autoWords(agent: {
  repeat: Parameters<typeof repeatWords>[0] | null;
  watches: readonly Pick<CloudAgentWatch, 'on' | 'name'>[];
  paused: boolean;
}): string | null {
  const parts = [
    ...(agent.repeat ? [repeatWords(agent.repeat)] : []),
    ...agent.watches.map(watchWords),
  ];
  if (parts.length === 0) return null;
  return `${agent.paused ? 'Pausiert' : 'Arbeitet von selbst'}: ${parts.join(', ')}`;
}
