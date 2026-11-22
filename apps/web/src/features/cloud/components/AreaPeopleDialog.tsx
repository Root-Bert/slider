import { useMemo, useState } from 'react';
import type { CloudArea } from '@slider/shared';
import { useCloudPeople, useSetCloudAreaMembers } from '@/lib/api';
import { ROLE_LABELS } from '@/features/workspaces';
import { Avatar, Button, cn, Dialog, Icon, TextField } from '@/ui';

/**
 * „Personen …“ of an area: tick who belongs to it and say what each does there („Leitung
 * Vertrieb“). Saved as a whole; the people come from the workspace.
 */
export function AreaPeopleDialog({
  workspaceId,
  area,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  area: CloudArea;
  onClose: () => void;
  onSaved: (area: CloudArea) => void;
}) {
  const people = useCloudPeople(workspaceId);
  const save = useSetCloudAreaMembers(workspaceId);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(
    () => new Map(area.members.map((member) => [member.id, member.title ?? ''])),
  );
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (people.data ?? []).filter(
      (person) =>
        !words ||
        person.name.toLowerCase().includes(words) ||
        person.email.toLowerCase().includes(words),
    );
  }, [people.data, query]);
  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, '');
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Personen in „${area.name}“`}
      description={
        area.visibility === 'members'
          ? 'Nur diese Personen und die Admins sehen den Bereich.'
          : 'Alle im Workspace sehen den Bereich. Hier steht, wer dazugehört.'
      }
      className="w-[min(540px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  id: area.id,
                  members: [...picked].map(([userId, title]) => ({
                    userId,
                    title: title.trim() || null,
                  })),
                },
                { onSuccess: onSaved },
              )
            }
          >
            Sichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          aria-label="Person suchen"
          placeholder="Person suchen"
          icon="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="-mx-1 flex h-80 flex-col gap-0.5 overflow-y-auto">
          {people.isPending
            ? [0, 1, 2].map((row) => (
                <li key={row} className="flex min-h-12 items-center gap-3 px-2">
                  <span className="skeleton size-8 rounded-full" />
                  <span className="skeleton block h-4 w-40 rounded-mark" />
                </li>
              ))
            : shown.length === 0 && (
                <li className="flex h-full items-center justify-center text-body text-fg-subtle">
                  {people.isError
                    ? 'Die Personen ließen sich nicht laden.'
                    : query.trim()
                      ? 'Niemand gefunden'
                      : 'Noch niemand im Workspace'}
                </li>
              )}
          {shown.map((person) => {
            const inArea = picked.has(person.id);
            return (
              <li
                key={person.id}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-control-sm px-2',
                  inArea ? 'bg-surface-1' : 'hover:bg-surface-1',
                )}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={inArea}
                  aria-label={`${person.name} gehört dazu`}
                  onClick={() => toggle(person.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
                >
                  <span
                    className={cn(
                      'flex size-4.5 shrink-0 items-center justify-center rounded-thumb',
                      inArea ? 'bg-primary text-on-primary' : 'ring-hairline-strong',
                    )}
                  >
                    {inArea && <Icon name="check" size={14} />}
                  </span>
                  <Avatar author={person} size={28} nativeTitle={false} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-medium text-fg">{person.name}</span>
                    <span className="truncate text-xs text-fg-subtle">
                      {ROLE_LABELS[person.role]}
                    </span>
                  </span>
                </button>
                {inArea && (
                  <input
                    aria-label={`Was ${person.name} im Bereich macht`}
                    placeholder="Aufgabe, z. B. Leitung"
                    maxLength={80}
                    value={picked.get(person.id) ?? ''}
                    onChange={(event) =>
                      setPicked((current) => new Map(current).set(person.id, event.target.value))
                    }
                    className="focus-field h-8 w-44 shrink-0 rounded-chip bg-surface-2 px-2.5 text-body text-fg placeholder:text-fg-subtle"
                  />
                )}
              </li>
            );
          })}
        </ul>
        {save.error && (
          <p role="alert" className="text-body text-danger">
            {save.error.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
