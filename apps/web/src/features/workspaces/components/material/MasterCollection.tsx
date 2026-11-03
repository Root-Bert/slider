import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { WorkspaceMaster } from '@slider/shared';
import { selectableItemProps, type SelectableItems } from '@/lib/collection-selection';
import { routes } from '@/lib/routes';
import {
  Button,
  cn,
  collectionGridClass,
  ContextMenu,
  Icon,
  Menu,
  SelectedMark,
  selectedCardClass,
  selectedRowClass,
  type MenuAction,
  type ShowToast,
} from '@/ui';
import type { MaterialView } from '../../lib/font-families';
import { layoutName, metaLine } from '../../lib/masters';
import { MasterNameInput } from './MasterNameInput';

// The fonts' (and the reviews') grid, so every view of the material lines up.
interface MasterCollectionProps extends SelectableItems {
  workspaceId: string;
  masters: readonly WorkspaceMaster[];
  view: MaterialView;
  /**
   * "Neue Präsentation" on a design: a button on it, and first in its menu – a click on it already
   * opens it.
   */
  createActionFor?: (master: WorkspaceMaster) => MenuAction | null;
  /** The actions of one design after "Umbenennen" – its ⋯ menu and right click. */
  actionsFor: (master: WorkspaceMaster) => MenuAction[];
  /** Members and admins: "Umbenennen" turns the name into an input. */
  canRename: boolean;
  onNotify: ShowToast;
}

/**
 * The workspace's slide masters as stacks of their layouts (grid) or rows (list); a click opens
 * a design's own page with every layout. Selected like the decks and fonts
 * (`selectableItemProps`).
 */
export function MasterCollection({
  workspaceId,
  masters,
  view,
  createActionFor,
  actionsFor,
  canRename,
  onNotify,
  selected,
  onModifiedClick,
  onSelectionMenu,
}: MasterCollectionProps) {
  const selection = { selected, onModifiedClick, onSelectionMenu };
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    at: { x: number; y: number };
    master: WorkspaceMaster;
  } | null>(null);
  const allActions = (master: WorkspaceMaster): MenuAction[] => [
    ...[createActionFor?.(master)].filter((action) => action != null),
    ...(canRename
      ? [{ label: 'Umbenennen', icon: 'edit', onSelect: () => setRenaming(master.id) }]
      : []),
    ...actionsFor(master),
  ];
  const Item = view === 'grid' ? MasterCard : MasterRow;
  return (
    <>
      <ul
        className={
          view === 'grid'
            ? // Room for the stacks fanned out above their front layout.
              cn(collectionGridClass, 'pt-12')
            : 'glass flex flex-col gap-1 rounded-panel p-1.5'
        }
      >
        {masters.map((master) => (
          <li
            key={master.id}
            className="min-w-0"
            {...selectableItemProps(master.id, selection)}
            onContextMenu={(event: MouseEvent) => {
              if (event.shiftKey) return;
              event.preventDefault();
              setMenu({ at: { x: event.clientX, y: event.clientY }, master });
            }}
          >
            <Item
              master={master}
              selected={selected.has(master.id)}
              create={createActionFor?.(master) ?? null}
              actions={allActions(master)}
              to={routes.workspaceMaster(workspaceId, master.id)}
              name={
                renaming === master.id ? (
                  <MasterNameInput
                    workspaceId={workspaceId}
                    master={master}
                    onDone={() => setRenaming(null)}
                    onNotify={onNotify}
                  />
                ) : null
              }
            />
          </li>
        ))}
      </ul>
      {menu && (
        <ContextMenu
          label={`Aktionen für „${menu.master.name}“`}
          actions={allActions(menu.master)}
          at={menu.at}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

interface MasterItemProps {
  master: WorkspaceMaster;
  selected: boolean;
  /** A presentation made from it, where the decks have their comments; `null` when none can be. */
  create: MenuAction | null;
  actions: MenuAction[];
  /** The design's own page. */
  to: string;
  /** In place of the name while it is renamed. */
  name: ReactNode;
}

/** A layout's picture, letterboxed in the 16:9 frame when the design has another format. */
export function LayoutPicture({
  master,
  index,
  full = false,
  className,
}: {
  master: WorkspaceMaster;
  index: number;
  full?: boolean;
  className?: string;
}) {
  const layout = master.layouts[index];
  if (!layout) return <div className={cn('bg-placeholder', className)} />;
  return (
    <img
      src={full ? layout.imageUrl : layout.thumbnailUrl}
      alt=""
      loading="lazy"
      draggable={false}
      className={cn('bg-white object-contain', className)}
    />
  );
}

/**
 * A design as a stack: its first layout in front, the next two fanned out behind it. Hovered,
 * it does what a deck card does: the front steps back with a ring and its halo lights up.
 */
function MasterCard({ master, selected, create, actions, to, name }: MasterItemProps) {
  return (
    <article className="group relative flex min-w-0 flex-col gap-3 has-[[aria-expanded=true]]:z-(--z-chrome)">
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-16 -z-(--z-raised) p-16 opacity-15 blur-2xl transition-[opacity,scale] duration-300 will-change-[opacity,scale] group-hover:scale-105 group-hover:opacity-30"
        >
          <LayoutPicture master={master} index={0} className="size-full rounded-panel" />
        </div>
        {[2, 1].map((index) =>
          master.layouts[index] ? (
            <LayoutPicture
              key={index}
              master={master}
              index={index}
              className={cn(
                'absolute inset-0 aspect-video w-full rounded-panel opacity-70 shadow-mark transition-transform duration-300',
                // Fanned up and right, never further than the grid's top padding.
                index === 1
                  ? 'translate-x-2.5 -translate-y-2.5 rotate-[1.5deg] group-hover:translate-x-4 group-hover:-translate-y-3.5'
                  : 'translate-x-5 -translate-y-5 rotate-3 group-hover:translate-x-7 group-hover:-translate-y-6',
              )}
            />
          ) : null,
        )}
        <Link
          to={to}
          aria-label={`„${master.name}“ öffnen`}
          className={cn(
            'relative block aspect-video w-full overflow-hidden rounded-panel ring-2 ring-transparent transition-[box-shadow,scale] duration-300 group-hover:scale-[0.97] group-hover:ring-fg focus-visible:ring-fg focus-visible:outline-none',
            selected && selectedCardClass,
          )}
        >
          <LayoutPicture master={master} index={0} className="size-full" />
          {selected && <SelectedMark />}
        </Link>
        <Menu
          label={`Aktionen für „${master.name}“`}
          actions={actions}
          triggerVariant="glass"
          className="absolute top-2 right-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-lg font-medium text-fg">
          {name ?? master.name}
        </h3>
        <span
          title={metaLine(master)}
          aria-label={metaLine(master)}
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-sm text-fg-subtle"
        >
          <Icon name="slideStack" size={16} />
          {master.layouts.length}
        </span>
        {create && (
          <Button size="sm" icon="add" onClick={create.onSelect} className="shrink-0">
            Präsentation erstellen
          </Button>
        )}
      </div>
    </article>
  );
}

/** Compact row with the same information as the card. */
function MasterRow({ master, selected, create, actions, to, name }: MasterItemProps) {
  return (
    <article
      className={cn(
        'group relative flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors hover:bg-surface-1',
        selected && selectedRowClass,
      )}
    >
      <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-badge">
        <LayoutPicture master={master} index={0} className="size-full" />
        {selected && <SelectedMark compact />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="truncate text-sm font-medium text-fg">
          {/* The whole row opens it; the menu sits above the link. */}
          {name ?? (
            <Link to={to} className="after:absolute after:inset-0 focus-visible:outline-none">
              {master.name}
            </Link>
          )}
        </h3>
        <p className="truncate text-body text-fg-subtle">
          {master.layouts.map(layoutName).join(', ')}
        </p>
      </div>
      <span className="shrink-0 text-body text-fg-subtle max-md:hidden">{metaLine(master)}</span>
      {create && (
        // Positioned, so it sits above the row's stretched link.
        <Button
          size="xs"
          icon="add"
          onClick={create.onSelect}
          className="relative shrink-0 max-sm:hidden"
        >
          Präsentation erstellen
        </Button>
      )}
      <span className="relative flex w-8 shrink-0 justify-end">
        <Menu label={`Aktionen für „${master.name}“`} actions={actions} />
      </span>
    </article>
  );
}

/** Every layout of a design with its name; grouped by master when the file has several. */
export function MasterLayouts({ master }: { master: WorkspaceMaster }) {
  const groups: { name: string | null; items: number[] }[] = [];
  for (const [index, layout] of master.layouts.entries()) {
    const last = groups.at(-1);
    if (last && last.name === layout.master) last.items.push(index);
    else groups.push({ name: layout.master, items: [index] });
  }
  const grouped = groups.length > 1;
  return (
    <div className="flex flex-col gap-12">
      {groups.map((group, groupIndex) => (
        <section key={groupIndex} className="flex flex-col gap-5">
          {grouped && (
            <h2 className="text-base font-medium text-fg-subtle">
              {group.name ?? `Master ${groupIndex + 1}`}
            </h2>
          )}
          <ul className="grid grid-cols-1 gap-x-10 gap-y-10 min-[700px]:grid-cols-2 min-[1200px]:grid-cols-3">
            {group.items.map((index) => (
              <li key={index} className="group flex min-w-0 flex-col gap-3">
                {/* Hovered like a deck card: the picture steps back with a ring, its halo lights up. */}
                <div className="relative isolate">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -inset-16 -z-(--z-raised) p-16 opacity-15 blur-2xl transition-[opacity,scale] duration-300 will-change-[opacity,scale] group-hover:scale-105 group-hover:opacity-30"
                  >
                    <LayoutPicture
                      master={master}
                      index={index}
                      className="size-full rounded-panel"
                    />
                  </div>
                  <div className="relative aspect-video w-full overflow-hidden rounded-panel ring-2 ring-transparent transition-[box-shadow,scale] duration-300 group-hover:scale-[0.97] group-hover:ring-fg">
                    <LayoutPicture master={master} index={index} full className="size-full" />
                  </div>
                </div>
                <span className="truncate text-sm text-fg">
                  {layoutName(master.layouts[index]!, index)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function MasterCollectionSkeleton({ view }: { view: MaterialView }) {
  const items = [0, 1, 2];
  if (view === 'list') {
    return (
      <div className="glass flex flex-col gap-1 rounded-panel p-1.5" aria-hidden>
        {items.map((index) => (
          <div key={index} className="flex items-center gap-4 px-3 py-2.5">
            <div className="skeleton aspect-video w-24 rounded-badge" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-3.5 w-40 rounded-thumb" />
              <div className="skeleton h-3 w-56 rounded-thumb" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={cn(collectionGridClass, 'pt-12')} aria-hidden>
      {items.map((index) => (
        <div key={index} className="flex flex-col gap-3">
          <div className="skeleton aspect-video rounded-control-sm" />
          <div className="skeleton h-4 w-2/5 rounded-thumb" />
          <div className="skeleton h-3 w-3/5 rounded-thumb" />
        </div>
      ))}
    </div>
  );
}
