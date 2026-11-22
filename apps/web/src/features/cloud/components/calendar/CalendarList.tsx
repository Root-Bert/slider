import type { Calendar, MailCalendarRefusal } from '@slider/shared';
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  startMailOAuth,
  useCreateCalendar,
  useDeleteCalendar,
  useMailAccounts,
  useMailCalendarRefusals,
  useUpdateCalendar,
} from '@/lib/api';
import { readJson, writeString } from '@/lib/storage';
import { ConfirmDialog, Icon, IconButton, Menu, cn } from '@/ui';
import { useCloud } from '../../hooks/useCloud';
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
 * ones, the mail accounts', the to-dos – each shown or hidden with its box. A sub-calendar is made
 * where it goes (its parent's „+“), typed in place.
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
  const mail = calendars.filter((each) => each.kind === 'mail');
  const accounts = [...new Set(mail.map((each) => each.mailAccountId!))];
  const mailAccounts = useMailAccounts(ui.workspace.id);
  const refused = useMailCalendarRefusals(ui.workspace.id).data ?? [];
  const addressOf = (account: string) =>
    mailAccounts.data?.find((each) => each.id === account)?.address ?? 'Postfach';
  // To the provider's sign-in, back to this page; there it asks for the calendars too.
  const signInAnew = (refusal: MailCalendarRefusal) =>
    startMailOAuth(ui.workspace.id, {
      provider: refusal.signIn,
      accountId: refusal.accountId,
      returnTo: `${window.location.pathname}${window.location.search}`,
    }).then(
      ({ url }) => window.location.assign(url),
      (error: Error) => ui.notify(error.message, 'danger'),
    );
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
      {accounts.map((account) => (
        <Group key={account} title={addressOf(account)}>
          {mail
            .filter((each) => each.mailAccountId === account)
            .map((calendar) => (
              <Row
                key={calendar.id}
                node={{ calendar, children: [] }}
                hidden={hidden}
                onToggle={onToggle}
              />
            ))}
        </Group>
      ))}
      {refused
        .filter((refusal) => !accounts.includes(refusal.accountId))
        .map((refusal) => (
          <Group key={refusal.accountId} title={addressOf(refusal.accountId)}>
            <li>
              <button
                type="button"
                onClick={() => void signInAnew(refusal)}
                title="Slider darf die Kalender dieses Postfachs noch nicht lesen – nach dem neuen Anmelden stehen sie hier."
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-sm text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Icon name="key" size="xs" className="shrink-0" />
                <span className="truncate">Für Kalender neu anmelden</span>
              </button>
            </li>
          </Group>
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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="truncate px-2 pb-1 text-xs font-medium text-fg-subtle">{title}</h3>
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
}: {
  label: string;
  color: string;
  checked: boolean;
  onChange: () => void;
  depth?: number;
  lead?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li
      className="group flex h-8 min-w-0 items-center rounded-control hover:bg-hover"
      style={{ paddingLeft: 8 + depth * 16 }}
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
  const [deleting, setDeleting] = useState(false);
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  const canAdd = calendar.canEdit && calendar.kind !== 'mail' && depth < 3;
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
          trailing={
            (canAdd || calendar.canManage) && (
              <span className="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                {canAdd && (
                  <IconButton
                    icon="add"
                    label={`Unterkalender in ${calendar.name}`}
                    size="xs"
                    onClick={() => setAdding(true)}
                  />
                )}
                {calendar.canManage && (
                  <Menu
                    label={`Mehr zu ${calendar.name}`}
                    triggerSize="xs"
                    actions={[
                      {
                        label: 'Umbenennen',
                        icon: 'driveFileRename',
                        onSelect: () => setRenaming(true),
                      },
                      {
                        label: 'Löschen',
                        icon: 'delete',
                        tone: 'danger',
                        onSelect: () => setDeleting(true),
                      },
                    ]}
                  />
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
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(false)}
          title={`„${calendar.name}“ löschen?`}
          description="Der Kalender und alle seine Termine sind dann für alle weg."
          confirmLabel="Löschen"
          confirmIcon="delete"
          onConfirm={() => {
            setDeleting(false);
            remove
              .mutateAsync(calendar.id)
              .then(() => ui.notify(`„${calendar.name}“ gelöscht`), fail);
          }}
        />
      )}
    </>
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
