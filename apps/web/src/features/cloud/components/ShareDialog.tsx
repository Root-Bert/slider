import { useMemo, useState } from 'react';
import type { CloudNode, CloudPerson, CloudShare, CloudShareRole } from '@slider/shared';
import {
  useCloudHome,
  useCloudNode,
  useCloudPeople,
  useCreateCloudShare,
  useRemoveCloudShare,
  useUpdateCloudShare,
} from '@/lib/api';
import { formatDay } from '@/lib/format';
import {
  Avatar,
  Button,
  Dialog,
  Icon,
  IconButton,
  MenuItem,
  PopoverPanel,
  Select,
  TextField,
  useCopyToClipboard,
  usePopover,
} from '@/ui';
import { FILE_KINDS } from '../lib/kinds';
import { AreaDot } from './AreaDot';

const ROLES = [
  { value: 'view', label: 'Kann ansehen' },
  { value: 'edit', label: 'Kann bearbeiten' },
] as const satisfies readonly { value: CloudShareRole; label: string }[];

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRIES = [
  { value: 'never', label: 'Läuft nicht ab' },
  { value: '7', label: 'Läuft in 7 Tagen ab' },
  { value: '30', label: 'Läuft in 30 Tagen ab' },
  { value: 'kept', label: 'Ablauf beibehalten' },
] as const;
type Expiry = (typeof EXPIRIES)[number]['value'];

/**
 * „Teilen“ in one step: a person of the workspace and what they may do, who reaches it already
 * through where it lies. Where the instance offers links (off unless it says so): one switch, a
 * link for people outside, to look and load only.
 */
export function ShareDialog({
  workspaceId,
  node,
  userId,
  onClose,
  notify,
}: {
  workspaceId: string;
  node: CloudNode;
  userId: string;
  onClose: () => void;
  notify: (text: string, tone?: 'neutral' | 'danger') => void;
}) {
  const detail = useCloudNode(workspaceId, node.id);
  const links = useCloudHome(workspaceId).data?.links === true;
  const people = useCloudPeople(workspaceId);
  const create = useCreateCloudShare(workspaceId);
  const update = useUpdateCloudShare(workspaceId);
  const remove = useRemoveCloudShare(workspaceId);
  const clipboard = useCopyToClipboard();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<CloudShareRole>('view');
  const [shownLink, setShownLink] = useState(false);
  const {
    open: pickerOpen,
    setOpen: setPickerOpen,
    close: closePicker,
    wrapperRef: pickerRef,
    panelId: pickerId,
  } = usePopover({ returnFocus: false });

  const shares = detail.data?.shares ?? [];
  const link = shares.find((share) => share.kind === 'link') ?? null;
  const withPeople = shares.filter((share) => share.kind === 'user');
  const sharedIds = new Set(withPeople.map((share) => share.user?.id));
  const candidates = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (people.data ?? [])
      .filter((person) => person.id !== userId && !sharedIds.has(person.id))
      .filter(
        (person) =>
          !words ||
          person.name.toLowerCase().includes(words) ||
          person.email.toLowerCase().includes(words),
      )
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sharedIds` is rebuilt from `shares` each render
  }, [people.data, query, userId, shares]);

  const failed = (error: Error) => notify(error.message, 'danger');
  // Listed at once, as every step here; the server's answer follows, a refusal takes it back.
  const share = (person: CloudPerson) => {
    setQuery('');
    closePicker();
    create.mutate(
      {
        nodeId: node.id,
        userId: person.id,
        role,
        shown: {
          id: `new-${person.id}`,
          nodeId: node.id,
          kind: 'user',
          user: person,
          role,
          url: null,
          expiresAt: null,
          opens: 0,
          createdAt: new Date().toISOString(),
          createdBy: person,
        },
      },
      { onSuccess: () => notify(`Mit ${person.name} geteilt`), onError: failed },
    );
  };
  const expiryOf = (value: Expiry) =>
    value === 'never' ? null : new Date(Date.now() + Number(value) * DAY_MS).toISOString();
  // Not copied (no permission, no secure context): the link stays in the dialog to copy by hand.
  const copy = (url: string) =>
    void clipboard.copy(url).then((copied) => {
      if (copied) notify('Link kopiert');
      else {
        setShownLink(true);
        notify('Der Link ließ sich nicht kopieren', 'danger');
      }
    });
  const openLink = () =>
    create.mutate(
      { nodeId: node.id, link: true, expiresAt: null },
      { onSuccess: (made) => made.url && copy(made.url), onError: failed },
    );

  const area = detail.data?.area ?? null;
  const audience = detail.data?.audience;
  const subtitle = [
    area
      ? `Bereich ${area.name}`
      : node.areaId === null && node.owner.id === userId
        ? 'Meine Dateien'
        : null,
    node.kind === 'folder' ? 'Ordner' : FILE_KINDS[node.fileType ?? 'other'].label,
  ]
    .filter(Boolean)
    .join(' | ');

  return (
    <Dialog
      open
      onClose={onClose}
      title={`„${node.name}“ teilen`}
      description={subtitle}
      className="w-[min(540px,calc(100vw-32px))]"
      footer={
        <Button variant="soft" onClick={onClose}>
          Fertig
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {/* A person and what they may do. */}
        <div ref={pickerRef} className="relative">
          <TextField
            aria-label="Person aus dem Workspace"
            placeholder="Name oder E-Mail"
            icon="personAdd"
            autoFocus
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPickerOpen(true);
            }}
            onFocus={() => setPickerOpen(true)}
            onKeyDown={(event) => {
              const first = candidates[0];
              // Only for a name typed: Enter in the empty field shares with nobody.
              if (event.key === 'Enter' && first && query.trim()) {
                event.preventDefault();
                share(first);
              }
            }}
            trailing={
              <Select
                aria-label="Was die Person darf"
                size="sm"
                value={role}
                onChange={setRole}
                options={ROLES}
              />
            }
          />
          {pickerOpen && candidates.length > 0 && (
            <PopoverPanel id={pickerId} padding="sm" className="w-full" offset="sm">
              <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {candidates.map((person) => (
                  <li key={person.id}>
                    <MenuItem
                      size="md"
                      icon={<Avatar author={person} size={24} nativeTitle={false} />}
                      onClick={() => share(person)}
                      truncate
                    >
                      <span className="truncate">{person.name}</span>
                      <span className="truncate text-xs text-fg-subtle">{person.email}</span>
                    </MenuItem>
                  </li>
                ))}
              </ul>
            </PopoverPanel>
          )}
        </div>

        <section aria-label="Zugriff" className="flex flex-col gap-1">
          <h3 className="pb-1 text-caption font-semibold tracking-wider text-fg-subtle uppercase">
            Zugriff
          </h3>
          <Row
            leading={<Avatar author={node.owner} size={28} nativeTitle={false} />}
            title={node.owner.id === userId ? 'Du' : node.owner.name}
            subtitle={node.kind === 'folder' ? 'Hat den Ordner angelegt' : 'Hat die Datei angelegt'}
            trailing={
              node.owner.id === userId ? (
                <span className="pr-2 text-body text-fg-subtle">Gehört dir</span>
              ) : null
            }
          />
          {area && audience && (
            <Row
              leading={<AreaDot color={area.color} size="lg" className="size-7" />}
              title={`Bereich ${area.name}`}
              subtitle={
                audience.kind === 'workspace'
                  ? `Alle im Workspace | ${audience.count} ${audience.count === 1 ? 'Person' : 'Personen'}`
                  : `${audience.count} ${audience.count === 1 ? 'Person' : 'Personen'}`
              }
              trailing={
                <span className="pr-2 text-body text-fg-subtle">Nach Rolle im Workspace</span>
              }
            />
          )}
          {withPeople.map((each) => (
            <PersonShare
              key={each.id}
              share={each}
              onRole={(next) => update.mutate({ id: each.id, role: next }, { onError: failed })}
              onRemove={() =>
                remove.mutate(each.id, {
                  onSuccess: () =>
                    notify(`Freigabe für ${each.user?.name ?? 'die Person'} entfernt`),
                  onError: failed,
                })
              }
            />
          ))}
        </section>

        {/* People outside: a link to look and load – only where the instance offers links. */}
        {links && (
          <section aria-label="Link" className="flex flex-col gap-3 border-t border-hairline pt-4">
            {/* Not known yet is not „no link“: nothing to create before it is. */}
            {detail.isPending ? (
              <div aria-hidden className="skeleton h-8 rounded-chip" />
            ) : detail.isLoadingError ? (
              <p className="flex min-h-8 items-center justify-between gap-3 text-body text-fg-muted">
                <span className="min-w-0">{detail.error.message}</span>
                <button
                  type="button"
                  className="shrink-0 text-body text-fg underline"
                  onClick={() => void detail.refetch()}
                >
                  Erneut versuchen
                </button>
              </p>
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
                  <Icon name={link ? 'public' : 'lock'} size={18} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body font-medium text-fg">
                    {link ? 'Jede Person mit dem Link' : 'Nur geteilte Personen'}
                  </span>
                  <span className="text-xs text-fg-subtle">
                    {link
                      ? `Kann ansehen und herunterladen | ${link.opens} ${link.opens === 1 ? 'Aufruf' : 'Aufrufe'}${
                          link.expiresAt ? ` | bis ${formatDay(link.expiresAt)}` : ''
                        }`
                      : 'Ein Link öffnet es auch Personen außerhalb des Workspace.'}
                  </span>
                </div>
                {link?.url ? (
                  <Button
                    variant="soft"
                    size="sm"
                    icon="link"
                    onClick={() => link.url && copy(link.url)}
                  >
                    {clipboard.state === 'copied' ? 'Kopiert' : 'Link kopieren'}
                  </Button>
                ) : (
                  <Button
                    variant="soft"
                    size="sm"
                    icon="link"
                    disabled={create.isPending}
                    onClick={openLink}
                  >
                    Link erstellen
                  </Button>
                )}
              </div>
            )}
            {link?.url && shownLink && (
              <TextField
                aria-label="Link"
                readOnly
                value={link.url}
                onFocus={(event) => event.currentTarget.select()}
                className="pl-11"
              />
            )}
            {link && (
              <div className="flex items-center justify-between gap-2 pl-11">
                <Select
                  aria-label="Wie lange der Link gilt"
                  size="sm"
                  value={link.expiresAt ? 'kept' : 'never'}
                  onChange={(value: Expiry) => {
                    if (value !== 'kept') {
                      update.mutate(
                        { id: link.id, expiresAt: expiryOf(value) },
                        { onError: failed },
                      );
                    }
                  }}
                  options={EXPIRIES.filter(
                    (option) => option.value !== 'kept' || link.expiresAt,
                  ).map((option) =>
                    option.value === 'kept' && link.expiresAt
                      ? { value: option.value, label: `Läuft am ${formatDay(link.expiresAt)} ab` }
                      : option,
                  )}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="linkOff"
                  onClick={() =>
                    remove.mutate(link.id, {
                      onSuccess: () => notify('Link entfernt'),
                      onError: failed,
                    })
                  }
                >
                  Link entfernen
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}

function Row({
  leading,
  title,
  subtitle,
  trailing,
}: {
  leading: React.ReactNode;
  title: string;
  subtitle: string;
  trailing: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <span className="flex w-8 shrink-0 justify-center">{leading}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-fg">{title}</span>
        <span className="truncate text-xs text-fg-subtle">{subtitle}</span>
      </div>
      {trailing}
    </div>
  );
}

function PersonShare({
  share,
  onRole,
  onRemove,
}: {
  share: CloudShare;
  onRole: (role: CloudShareRole) => void;
  onRemove: () => void;
}) {
  if (!share.user) return null;
  return (
    <Row
      leading={<Avatar author={share.user} size={28} nativeTitle={false} />}
      title={share.user.name}
      subtitle={share.user.email}
      trailing={
        <span className="flex items-center gap-1">
          <Select
            aria-label={`Was ${share.user.name} darf`}
            size="sm"
            value={share.role}
            onChange={onRole}
            options={ROLES}
          />
          <IconButton
            icon="close"
            label={`Freigabe für ${share.user.name} entfernen`}
            size="compact"
            onClick={onRemove}
          />
        </span>
      }
    />
  );
}
