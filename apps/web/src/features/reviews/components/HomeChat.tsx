import { aiInSentence, aiNameOf } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ChatPanel, useAgentChat } from '@/features/viewer';
import { chatHome, queryKeys } from '@/lib/api';
import { IconButton } from '@/ui';

/*
 * The AI on Slider's start: ✨ in the header opens a chat in a side panel over the whole
 * height, as beside the files in Cloud (`CloudChat`). It finds presentations, shows them in the
 * list, renames, files and archives them and makes new ones – with the person's own rights
 * (`services/home-chat.ts`); the list follows while it works.
 */

const OPEN_CHAT_EVENT = 'slider:home-chat';

/** Ways in while the chat is empty – each sent as it reads. */
const STARTERS = [
  'Hilf mir, eine Präsentation zu finden',
  'Räum meine Präsentationen in Ordner',
  'Erstell eine neue Präsentation',
];

/** ✨ in the app's header, on Slider's start. */
export function HomeChatButton({ name }: { name?: string | undefined }) {
  return (
    <IconButton
      icon="autoAwesome"
      label={aiNameOf(name)}
      title={`${aiInSentence(name, true)} fragen`}
      onClick={() => window.dispatchEvent(new Event(OPEN_CHAT_EVENT))}
    />
  );
}

interface HomeChatProps {
  workspace: { id: string; aiName?: string | undefined };
  /** The AI wants the list to show what matches these words. */
  onFilter: (query: string) => void;
  toast: (message: string, tone?: 'danger') => void;
}

/** The chat's panel, shown once ✨ was pressed; closed with ✕ or Esc, the chat stays. */
export function HomeChat(props: HomeChatProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen((now) => !now);
    window.addEventListener(OPEN_CHAT_EVENT, toggle);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, toggle);
  }, []);
  return open ? <Panel {...props} onClose={() => setOpen(false)} /> : null;
}

function Panel({ workspace, onFilter, toast, onClose }: HomeChatProps & { onClose: () => void }) {
  const queryClient = useQueryClient();
  const chat = useAgentChat<{ type: 'filter'; query: string }>(
    `home:${workspace.id}`,
    (text, history, onEvent, signal, attachments) =>
      chatHome(workspace.id, { text, attachments, history }, onEvent, signal),
    {
      changed: () => void queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
      refused: (message) => toast(message, 'danger'),
      other: (event) => {
        if (event.type === 'filter') onFilter(event.query);
      },
    },
  );
  return (
    <ChatPanel
      title={aiNameOf(workspace.aiName)}
      chat={chat}
      workspaceId={workspace.id}
      keep={`home:${workspace.id}`}
      panel={{ 'data-cloud-panel': true }}
      intro={`${aiInSentence(workspace.aiName, true)} findet Präsentationen, zeigt sie in der Liste, benennt sie um, räumt sie in Ordner und legt neue an, sieht und ändert dabei nur, was du darfst.`}
      starters={STARTERS}
      toast={toast}
      onClose={onClose}
    />
  );
}
