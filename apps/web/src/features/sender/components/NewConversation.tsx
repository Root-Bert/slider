import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { MAX_SENDER_NAME, type AccountAuthor } from '@slider/shared';
import { useCreateSenderGroup, useOpenSenderDirect } from '@/lib/api';
import { canCreateDecks } from '@/features/workspaces';
import { Avatar, Button, cn, SegmentedControl, TextField, type IconName } from '@/ui';
import { useSender, type ChannelPlace } from '../hooks/useSender';
import { newKinds, type NewKind, type PickedKind } from '../lib/new';
import { PAGE_HEADER, PAGE_TITLE } from '../lib/title';
import { MenuButton } from './MenuButton';
import { NewAgent } from './NewAgent';
import { PeoplePicker } from './PeoplePicker';

/** A form under the page's choice: what it is says the choice above, nothing more. */
function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="glass flex w-full max-w-[560px] flex-col gap-5 rounded-panel p-6"
    >
      {children}
    </section>
  );
}

/**
 * „Neue Gruppe“: a few people – one alone opens the conversation with them (a single person is
 * found faster by the side bar's search, a click there starts it).
 */
function NewDirect() {
  const ui = useSender();
  const navigate = useNavigate();
  const create = useCreateSenderGroup(ui.workspace.id);
  const open = useOpenSenderDirect(ui.workspace.id);
  const people = (ui.home?.people ?? []).filter((person) => person.id !== ui.me.id);
  const [picked, setPicked] = useState<AccountAuthor[]>([]);
  const [name, setName] = useState('');
  const ids = new Set(picked.map((person) => person.id));
  const toggle = (person: AccountAuthor) =>
    setPicked((now) =>
      ids.has(person.id) ? now.filter((each) => each.id !== person.id) : [...now, person],
    );
  const show = (channel: ChannelPlace) => void navigate(ui.pathOf(channel), { replace: true });
  const failed = (error: Error) => ui.notify(error.message, 'danger');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const [first, ...more] = picked;
    if (!first) return;
    if (more.length > 0) {
      create.mutate(
        { name, userIds: picked.map((person) => person.id) },
        { onSuccess: show, onError: failed },
      );
      return;
    }
    // Already there: straight to it, no waiting.
    const known = ui.home?.direct.find((each) => each.person?.id === first.id);
    if (known) show(known);
    else open.mutate(first.id, { onSuccess: show, onError: failed });
  };
  return (
    <Frame label="Neue Gruppe">
      <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
        {picked.length > 0 && (
          <ul aria-label="Dabei" className="flex flex-wrap gap-1.5">
            {picked.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => toggle(person)}
                  aria-label={`${person.name} herausnehmen`}
                  className="flex h-7 items-center gap-1.5 rounded-full bg-hover pr-2.5 pl-1 text-xs text-fg transition-colors hover:bg-selected"
                >
                  <Avatar author={person} size={20} nativeTitle={false} />
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <PeoplePicker people={people} picked={ids} multiple onPick={toggle} />
        {picked.length > 1 && (
          <TextField
            label="Name"
            placeholder={picked.map((person) => person.name.split(/\s+/)[0]).join(', ')}
            maxLength={MAX_SENDER_NAME}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void navigate(-1)}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            disabled={picked.length === 0}
            loading={create.isPending || open.isPending}
          >
            Schreiben
          </Button>
        </div>
      </form>
    </Frame>
  );
}

const KIND_WORDS: Record<PickedKind, { label: string; icon: IconName }> = {
  agent: { label: 'Agent', icon: 'autoAwesome' },
  gruppe: { label: 'Gruppe', icon: 'groups' },
};

/**
 * What „Neu“ opens, in the page in the conversation's place: what is new is picked here – an
 * agent or a group – and its form stands under the choice. Esc goes back.
 */
export function NewConversation({ kind, inCloud = false }: { kind: NewKind; inCloud?: boolean }) {
  const ui = useSender();
  const navigate = useNavigate();
  const kinds = newKinds(canCreateDecks(ui.workspace.role));
  const asked = kind === 'direkt' || kind === 'kanal' ? 'gruppe' : kind;
  const picked: PickedKind = kinds.includes(asked) ? asked : 'gruppe';
  const pick = (next: PickedKind) => void navigate(ui.newPath(next), { replace: true });
  return (
    <section
      aria-label="Neu"
      className="flex min-h-0 flex-1 flex-col gap-3"
      onKeyDown={(event) => {
        // Not an Esc that closed something first – a card's menu, the delete question (portals
        // bubble here in React, but stand outside the page).
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        event.preventDefault();
        void navigate(-1);
      }}
    >
      <header className={PAGE_HEADER}>
        <MenuButton />
        <h1 className={cn(PAGE_TITLE, 'mr-3 shrink-0')}>Neu</h1>
        <SegmentedControl
          label="Was neu"
          track="soft"
          value={picked}
          onChange={pick}
          segments={kinds.map((each) => ({ value: each, ...KIND_WORDS[each] }))}
          // 40px beside the 36px title row: it reaches over it rather than pushing the title down.
          className="-my-0.5 shrink-0"
        />
      </header>
      {picked === 'agent' ? (
        <NewAgent inCloud={inCloud} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pt-2 pb-6">
          <NewDirect />
        </div>
      )}
    </section>
  );
}
