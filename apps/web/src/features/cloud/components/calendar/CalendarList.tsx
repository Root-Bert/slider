import type { Calendar, CloudAreaColor } from '@slider/shared';
import { useId, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useCreateCalendar, useDeleteCalendar, useUpdateCalendar } from '@/lib/api';
import { routes } from '@/lib/routes';
import { readJson, writeString } from '@/lib/storage';
import {
  ConfirmDialog,
  ContextMenu,
  Icon,
  IconButton,
  Menu,
  Tooltip,
  cn,
  type MenuAction,
} from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { AreaColorPicker } from '../AreaColorPicker';
import { useCalendarAccounts, type CalendarAccount } from './CalendarAccounts';
import { colorOf, TODOS } from './entries';

const hiddenKey = (workspaceId: string) => `slider.calendar.hidden:${workspaceId}`;

/** The calendars – and the to-dos – one hid, remembered in this browser. */
export function useHiddenCalendars(workspaceId: string) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        readJson(
          hiddenKey(workspaceId),
          (value) => (Array.isArray(value) ? value.filter((each) => typeof each === 'string') : []),
          [] as string[],
        ),
      ),
  );
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    writeString(hiddenKey(workspaceId), JSON.stringify([...next]));
  };
  return { hidden, toggle };
}

interface Node {
  calendar: Calendar;
  children: Node[];
}

/** Areas' calendars as their areas stand (an area in an area under it), sub-calendars under theirs. */
function tree(
  calendars: readonly Calendar[],
  areaOrder: (areaId: string) => number,
  areaParent: (areaId: string) => string | null,
) {
  const nodes = new Map(
    calendars.map((calendar) => [calendar.id, { calendar, children: [] } as Node]),
  );
  const areaRoot = new Map(
    calendars
      .filter((each) => each.kind === 'area' && !each.parentId)
      .map((each) => [each.areaId!, each.id]),
  );
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const { calendar } = node;
    const above =
      calendar.parentId ??
      (calendar.kind === 'area' && calendar.areaId && areaParent(calendar.areaId)
        ? (areaRoot.get(areaParent(calendar.areaId)!) ?? null)
        : null);
    const parent = above ? nodes.get(above) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (node: Node) =>
    node.calendar.kind === 'area' && !node.calendar.parentId
      ? areaOrder(node.calendar.areaId!)
      : 1e6;
  const sort = (list: Node[]) => {
    list.sort((a, b) => order(a) - order(b));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/**
 * The calendars one sees, beside the calendar as Apple's: the workspace's areas, one's private
 * ones, each account's under its name, the to-dos – each shown or hidden with its box. A
 * sub-calendar is made where it goes (its parent's „+“), typed in place. A calendar's „…“ or a
 * right click on it renames it in place, colours it (not an area's: the area's colour; not one's
 * private one: one's own) and deletes it. The accounts themselves – connected, signed in anew,
 * renamed, deleted – are on „Konten“.
 */
export function CalendarList({
  calendars,
  hidden,
  onToggle,
}: {
  calendars: readonly Calendar[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const ui = useCloud();
  const areas = ui.home?.areas ?? [];
  const areaIndex = (areaId: string) => {
    const index = areas.findIndex((area) => area.id === areaId);
    return index < 0 ? -1 : index;
  };
  const areaParent = (areaId: string) => areas.find((area) => area.id === areaId)?.parentId ?? null;
  const own = calendars.filter((each) => each.kind !== 'mail');
  const shared = tree(
    own.filter((each) => each.kind === 'area'),
    areaIndex,
    areaParent,
  );
  const mine = tree(
    own.filter((each) => each.kind === 'private'),
    areaIndex,
    areaParent,
  );
  const accounts = useCalendarAccounts(ui.workspace.id, calendars) ?? [];
  return (
    <nav aria-label="Kalender" className="flex flex-col gap-4">
      <Group title={ui.workspace.name}>
        {shared.map((node) => (
          <Row key={node.calendar.id} node={node} hidden={hidden} onToggle={onToggle} />
        ))}
      </Group>
      <Group title="Meine Kalender">
        {mine.map((node) => (
          <Row key={node.calendar.id} node={node} hidden={hidden} onToggle={onToggle} />
        ))}
      </Group>
      {accounts
        .filter((account) => account.calendars.length > 0)
        .map((account) => (
          <AccountGroup key={account.id} account={account} hidden={hidden} onToggle={onToggle} />
        ))}
      <Group title="Weiteres">
        <Check
          label="Aufgaben"
          color="var(--color-fg-subtle)"
          checked={!hidden.has(TODOS)}
          onChange={() => onToggle(TODOS)}
          lead={<Icon name="checklist" size="xs" className="text-fg-subtle" />}
        />
      </Group>
    </nav>
  );
}

/**
 * An account's calendars under its name: a new one made in it with its „+“ (typed in place, as a
 * sub-calendar). Signed out or kept to reading: a quiet mark to „Konten“, where it signs in anew.
 */
function AccountGroup({
  account,
  hidden,
  onToggle,
}: {
  account: CalendarAccount;
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const ui = useCloud();
  const create = useCreateCalendar(ui.workspace.id);
  const [adding, setAdding] = useState(false);
  const canAdd = account.calendars.some((each) => each.canAddCalendar);
  const why = account.signedOut
    ? 'Abgemeldet – unter „Konten“ neu anmelden'
    : account.readOnly
      ? 'Nur zum Ansehen – zum Ändern unter „Konten“ neu anmelden'
      : null;
  return (
    <Group
      title={account.name}
      hint={
        why && (
          <Tooltip label={why} side="bottom" className="shrink-0">
            <Link
              to={routes.cloudCalendarAccounts(ui.workspace.id)}
              aria-label={why}
              className="flex rounded-badge text-fg-faint transition-colors hover:text-fg"
            >
              <Icon name="key" size={12} />
            </Link>
          </Tooltip>
        )
      }
      action={
        canAdd && (
          <IconButton
            icon="add"
            label={`Neuer Kalender in ${account.name}`}
            size="xs"
            onClick={() => setAdding(true)}
          />
        )
      }
    >
      {account.calendars.map((calendar) => (
        <Row
          key={calendar.id}
          node={{ calendar, children: [] }}
          hidden={hidden}
          onToggle={onToggle}
        />
      ))}
      {adding && (
        <NameField
          depth={0}
          initial=""
          label="Neuer Kalender"
          onDone={(name) => {
            setAdding(false);
            if (name) {
              create.mutate(
                { mailAccountId: account.id, name },
                { onError: (error: Error) => ui.notify(error.message, 'danger') },
              );
            }
          }}
        />
      )}
    </Group>
  );
}

function Group({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  /** Right after the title, always there (an account to sign in anew). */
  hint?: ReactNode;
  /** At the end, e.g. the group's „+“ – there on pointing or focus. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      {action || hint ? (
        <div className="group flex h-6 min-w-0 items-center gap-1 pr-1 pl-2">
          <h3 className="min-w-0 truncate text-xs font-medium text-fg-subtle">{title}</h3>
          {hint}
          {/* As a calendar's „…“: there on pointing or focus. */}
          <span className="ml-auto flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            {action}
          </span>
        </div>
      ) : (
        <h3 className="truncate px-2 pb-1 text-xs font-medium text-fg-subtle">{title}</h3>
      )}
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

/** A box in the calendar's colour: filled while it is shown. */
function Check({
  label,
  color,
  checked,
  onChange,
  depth = 0,
  lead,
  trailing,
  onContextMenu,
}: {
  label: string;
  color: string;
  checked: boolean;
  onChange: () => void;
  depth?: number;
  lead?: ReactNode;
  trailing?: ReactNode;
  /** A right click: the row's „…“ at the pointer. */
  onContextMenu?: (event: MouseEvent) => void;
}) {
  return (
    <li
      className="group flex h-8 min-w-0 items-center rounded-control hover:bg-hover"
      style={{ paddingLeft: 8 + depth * 16 }}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onChange}
        title={checked ? `${label} ausblenden` : `${label} einblenden`}
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-sm"
      >
        <span
          aria-hidden
          style={{ '--check': color } as CSSProperties}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-mark border-[1.5px] border-(--check)',
            checked && 'bg-(--check)',
          )}
        >
          {checked && <Icon name="check" size={12} className="text-white" />}
        </span>
        {lead}
        <span className={cn('truncate', checked ? 'text-fg' : 'text-fg-muted')}>{label}</span>
      </button>
      {trailing && <span className="flex shrink-0 items-center pr-1">{trailing}</span>}
    </li>
  );
}

function Row({
  node,
  hidden,
  onToggle,
  depth = 0,
}: {
  node: Node;
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
  depth?: number;
}) {
  const ui = useCloud();
  const create = useCreateCalendar(ui.workspace.id);
  const update = useUpdateCalendar(ui.workspace.id);
  const remove = useDeleteCalendar(ui.workspace.id);
  const { calendar } = node;
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [coloring, setColoring] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  /** Deleted – or, someone else's at a mailbox's provider, only taken off one's list there. */
  const [deleting, setDeleting] = useState<'delete' | 'remove' | null>(null);
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  const canAdd = calendar.canEdit && calendar.kind !== 'mail' && depth < 3;
  const actions: MenuAction[] = [];
  if (calendar.canManage) {
    actions.push({
      label: 'Umbenennen',
      icon: 'edit',
      onSelect: () => setRenaming(true),
    });
    // An area's calendars are in the area's colour.
    if (calendar.kind !== 'area') {
      actions.push({
        label: 'Farbe …',
        icon: 'palette',
        onSelect: () => setColoring(true),
      });
    }
  }
  if (calendar.canDelete) {
    actions.push({
      label: 'Löschen',
      icon: 'delete',
      tone: 'danger',
      onSelect: () => setDeleting('delete'),
    });
  }
  if (calendar.canRemove) {
    actions.push({
      label: 'Entfernen',
      icon: 'delete',
      tone: 'danger',
      onSelect: () => setDeleting('remove'),
    });
  }
  return (
    <>
      {renaming ? (
        <NameField
          depth={depth}
          initial={calendar.name}
          label="Name des Kalenders"
          onDone={(name) => {
            setRenaming(false);
            if (name && name !== calendar.name) {
              update.mutate({ id: calendar.id, change: { name } }, { onError: fail });
            }
          }}
        />
      ) : (
        <Check
          label={calendar.name}
          color={colorOf(calendar.color)}
          checked={!hidden.has(calendar.id)}
          onChange={() => onToggle(calendar.id)}
          depth={depth}
          onContextMenu={
            actions.length > 0
              ? (event) => {
                  if (event.shiftKey) return;
                  event.preventDefault();
                  setMenuAt({ x: event.clientX, y: event.clientY });
                }
              : undefined
          }
          trailing={
            (canAdd || actions.length > 0) && (
              <span className="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                {canAdd && (
                  <IconButton
                    icon="add"
                    label={`Unterkalender in ${calendar.name}`}
                    size="xs"
                    onClick={() => setAdding(true)}
                  />
                )}
                {actions.length > 0 && (
                  <Menu label={`Mehr zu ${calendar.name}`} triggerSize="xs" actions={actions} />
                )}
              </span>
            )
          }
        />
      )}
      {node.children.map((child) => (
        <Row
          key={child.calendar.id}
          node={child}
          hidden={hidden}
          onToggle={onToggle}
          depth={depth + 1}
        />
      ))}
      {adding && (
        <NameField
          depth={depth + 1}
          initial=""
          label="Neuer Unterkalender"
          onDone={(name) => {
            setAdding(false);
            if (name) create.mutate({ parentId: calendar.id, name }, { onError: fail });
          }}
        />
      )}
      {menuAt && (
        <ContextMenu
          label={`Aktionen für ${calendar.name}`}
          at={menuAt}
          onClose={() => setMenuAt(null)}
          actions={actions}
        />
      )}
      {coloring && (
        <CalendarColorDialog
          calendar={calendar}
          onClose={() => setColoring(false)}
          onPick={(color) => {
            setColoring(false);
            if (color !== calendar.color) {
              update.mutate({ id: calendar.id, change: { color } }, { onError: fail });
            }
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(null)}
          title={`„${calendar.name}“ ${deleting === 'remove' ? 'entfernen' : 'löschen'}?`}
          description={
            deleting === 'remove'
              ? 'Er verschwindet aus deiner Liste. Der Kalender selbst und seine Termine bleiben.'
              : calendar.kind === 'mail'
                ? 'Der Kalender und alle seine Termine sind dann auch beim Anbieter weg.'
                : 'Der Kalender und alle seine Termine sind dann für alle weg.'
          }
          confirmLabel={deleting === 'remove' ? 'Entfernen' : 'Löschen'}
          confirmIcon="delete"
          onConfirm={() => {
            const how = deleting;
            setDeleting(null);
            remove
              .mutateAsync(calendar.id)
              .then(
                () => ui.notify(`„${calendar.name}“ ${how === 'remove' ? 'entfernt' : 'gelöscht'}`),
                fail,
              );
          }}
        />
      )}
    </>
  );
}

/** „Farbe …“: a calendar's colour – one on offer or one of one's own, as a folder's. */
function CalendarColorDialog({
  calendar,
  onClose,
  onPick,
}: {
  calendar: Calendar;
  onClose: () => void;
  onPick: (color: CloudAreaColor) => void;
}) {
  const label = useId();
  const [color, setColor] = useState<CloudAreaColor>(calendar.color as CloudAreaColor);
  return (
    <ConfirmDialog
      onClose={onClose}
      title="Farbe des Kalenders"
      tone="primary"
      confirmLabel="Sichern"
      onConfirm={() => onPick(color)}
    >
      <div className="flex flex-col gap-2">
        <span id={label} className="truncate text-xs text-fg-subtle">
          {calendar.name}
        </span>
        <AreaColorPicker
          value={color}
          onChange={(next) => next && setColor(next)}
          labelledBy={label}
        />
      </div>
    </ConfirmDialog>
  );
}

/** A name typed where the calendar will stand: Enter keeps it, Esc or leaving empty drops it. */
function NameField({
  depth,
  initial,
  label,
  onDone,
}: {
  depth: number;
  initial: string;
  label: string;
  onDone: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <li className="flex h-8 items-center" style={{ paddingLeft: 8 + depth * 16 }}>
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => onDone(name.trim())}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.stopPropagation();
            onDone('');
          }
        }}
        maxLength={80}
        placeholder={label}
        aria-label={label}
        className="focus-field h-7 min-w-0 flex-1 rounded-control-sm bg-surface-1 px-2 text-sm text-fg outline-none placeholder:text-fg-faint"
      />
    </li>
  );
}
