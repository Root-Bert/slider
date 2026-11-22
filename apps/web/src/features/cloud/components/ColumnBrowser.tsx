import { useEffect, useRef } from 'react';
import type { CloudNode } from '@slider/shared';
import { cn, highlightedRowClass, Icon, selectedRowClass } from '@/ui';
import { Marks, NameLink, RowIcon, useItem, type CloudItems } from './FileBrowser';

/** One column: what lies in a place; `null` while it loads, a message when it could not. */
export interface BrowserColumn {
  /** The folder it shows; the first one is the page's place. */
  id: string;
  nodes: readonly CloudNode[] | null;
  error?: string | undefined;
}

function ColumnRow({
  node,
  nodes,
  open,
  selection,
  onPick,
}: {
  node: CloudNode;
  nodes: readonly CloudNode[];
  /** Its content stands in the next column. */
  open: boolean;
  selection: CloudItems;
  onPick: (node: CloudNode) => void;
}) {
  const { selected, alone, over, props, menu } = useItem(node, selection, nodes);
  return (
    <li
      {...props}
      className={cn(
        'group relative flex h-9 shrink-0 items-center gap-2.5 rounded-control-sm pr-1.5 pl-2 transition-colors hover:bg-surface-1 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus',
        open && 'bg-surface-2',
        selected && (alone ? highlightedRowClass : selectedRowClass),
        over && 'bg-selected ring-1 ring-focus',
      )}
    >
      <RowIcon node={node} size={20} />
      <NameLink
        node={node}
        className="min-w-0 flex-1 text-body text-fg"
        onPick={onPick}
        pick={selection.pickOne}
      />
      <Marks node={node} />
      {node.kind === 'folder' && (
        <Icon
          name="chevronRight"
          size={16}
          className={cn('shrink-0', open ? 'text-fg-muted' : 'text-fg-faint')}
        />
      )}
      {menu}
    </li>
  );
}

/**
 * A place as columns side by side: a click on a folder shows what lies in it in the next
 * column, a double click goes there; a file opens as in every list. Rows pick, drag and drop
 * like the rows of a list.
 */
export function ColumnBrowser({
  columns,
  trail,
  selection,
  onPick,
}: {
  columns: readonly BrowserColumn[];
  /** The folders opened, one per column after the first. */
  trail: readonly string[];
  selection: CloudItems;
  /** A row of column `depth` was clicked. */
  onPick: (depth: number, node: CloudNode) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // A column more: it is the one to see.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTo({ left: element.scrollWidth, behavior: 'smooth' });
  }, [columns.length]);
  // Picking goes over every column at once.
  const all = columns.flatMap((column) => column.nodes ?? []);
  return (
    <div
      ref={scroller}
      className="flex h-[max(360px,calc(100dvh-320px))] overflow-x-auto rounded-panel bg-surface-1/40 inset-ring inset-ring-hairline"
    >
      {columns.map((column, depth) => (
        <ul
          key={column.id}
          aria-label={depth === 0 ? 'Dateien' : 'Inhalt des Ordners'}
          // ↑/↓ step within a column (`CloudPage`).
          data-pick-group
          className="flex w-[264px] shrink-0 flex-col gap-px overflow-y-auto border-r border-hairline p-1.5"
        >
          {column.nodes === null ? (
            column.error ? (
              <li className="px-2 py-2 text-xs text-danger">{column.error}</li>
            ) : (
              Array.from({ length: 4 }, (_, index) => (
                <li key={index} aria-hidden className="flex h-9 items-center gap-2.5 px-2">
                  <span className="skeleton size-5 rounded-mark" />
                  <span
                    className="skeleton h-3.5 rounded-mark"
                    style={{ width: `${40 + ((index * 23) % 40)}%` }}
                  />
                </li>
              ))
            )
          ) : column.nodes.length === 0 ? (
            <li className="px-2 py-2 text-xs text-fg-subtle">Nichts hier</li>
          ) : (
            column.nodes.map((node) => (
              <ColumnRow
                key={node.id}
                node={node}
                nodes={all}
                open={trail[depth] === node.id}
                selection={selection}
                onPick={(picked) => onPick(depth, picked)}
              />
            ))
          )}
        </ul>
      ))}
    </div>
  );
}
