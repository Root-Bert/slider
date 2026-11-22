import { useState } from 'react';
import type { AccountAuthor, SenderChannel } from '@slider/shared';
import { useAddToSenderGroup } from '@/lib/api';
import { Button } from '@/ui';
import { useSender } from '../hooks/useSender';
import { PeoplePicker } from './PeoplePicker';

/** „Personen hinzufügen“ to a group: under its header, in the page. */
export function AddPeople({ channel, onDone }: { channel: SenderChannel; onDone: () => void }) {
  const ui = useSender();
  const add = useAddToSenderGroup(ui.workspace.id, channel.id);
  const inside = new Set(channel.members.map((person) => person.id));
  const people = (ui.home?.people ?? []).filter((person) => !inside.has(person.id));
  const [picked, setPicked] = useState<AccountAuthor[]>([]);
  const ids = new Set(picked.map((person) => person.id));
  return (
    <section
      aria-label="Personen hinzufügen"
      className="glass flex shrink-0 flex-col gap-3 rounded-panel p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
    >
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
