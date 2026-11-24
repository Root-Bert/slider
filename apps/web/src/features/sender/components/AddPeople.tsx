import { useState } from 'react';
import type { AccountAuthor, SenderChannel } from '@slider/shared';
import { useAddToSenderGroup, useRemoveFromSenderGroup } from '@/lib/api';
import { Avatar, Button, IconButton } from '@/ui';
import { useSender } from '../hooks/useSender';
import { PeoplePicker } from './PeoplePicker';

/**
 * A group's „Personen …“: under its header, in the page – who is in it (who manages it takes
 * someone out: „Entfernen“, they stay in the workspace), and more to add.
 */
export function AddPeople({ channel, onDone }: { channel: SenderChannel; onDone: () => void }) {
  const ui = useSender();
  const add = useAddToSenderGroup(ui.workspace.id, channel.id);
  const remove = useRemoveFromSenderGroup(ui.workspace.id, channel.id);
  const inside = new Set(channel.members.map((person) => person.id));
  const people = (ui.home?.people ?? []).filter((person) => !inside.has(person.id));
  const [picked, setPicked] = useState<AccountAuthor[]>([]);
  const ids = new Set(picked.map((person) => person.id));
  return (
    <section
      aria-label="Personen"
      className="glass flex shrink-0 flex-col gap-3 rounded-panel p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
    >
      <ul aria-label="In der Gruppe" className="flex flex-wrap gap-1.5">
        {channel.members.map((person) => (
          <li
            key={person.id}
            className="flex h-8 items-center gap-2 rounded-full bg-surface-2 pr-1 pl-1"
          >
            <Avatar author={person} size={24} nativeTitle={false} />
            <span className="max-w-40 truncate pr-1.5 text-sm text-fg">
              {person.id === ui.me.id ? 'Du' : person.name}
            </span>
            {channel.canManage && person.id !== ui.me.id && (
              <IconButton
                icon="close"
                label={`${person.name} entfernen`}
                size="xs"
                iconSize={14}
                variant="subtle"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(person.id, {
                    onError: (error) => ui.notify(error.message, 'danger'),
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>
      <PeoplePicker
        people={people}
        picked={ids}
        multiple
        onPick={(person) =>
          setPicked((now) =>
            ids.has(person.id) ? now.filter((each) => each.id !== person.id) : [...now, person],
          )
        }
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Abbrechen
        </Button>
        <Button
          disabled={picked.length === 0}
          loading={add.isPending}
          onClick={() =>
            add.mutate(
              picked.map((person) => person.id),
              {
                onSuccess: () => {
                  onDone();
                  ui.notify(
                    picked.length === 1
                      ? `${picked[0]?.name ?? ''} hinzugefügt`
                      : `${picked.length} Personen hinzugefügt`,
                  );
                },
                onError: (error) => ui.notify(error.message, 'danger'),
              },
            )
          }
        >
          Hinzufügen
        </Button>
      </div>
    </section>
  );
}
