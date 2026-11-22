import { aiInSentence, aiNameOf, CLOUD_TRASH_DAYS } from '@slider/shared';
import { useEffect, useState, type ComponentProps } from 'react';
import { ChatPanel } from '@/features/viewer';
import { IconButton } from '@/ui';
import { useCloudChat, type ChatPlace } from '../hooks/cloud-chat';
import { useCloud } from '../hooks/useCloud';

/*
 * The AI in Cloud: ✨ in the header opens a chat in a side panel over the whole height, as
 * beside a presentation's material. It finds things, names them, makes folders and tidies –
 * with the person's own rights (`services/cloud-chat.ts`); the lists follow while it works.
 * Sender has the same chat (`WorkspaceChat`): one workspace, one AI, one conversation.
 */

const OPEN_CHAT_EVENT = 'slider:cloud-chat';

/** What a menu asks the chat to do at once, and where. */
interface Ask {
  text: string;
  folderId?: string | null;
  areaId?: string | null;
}

/** Opens the chat and sends `text` – „Aufräumen“ in a menu: the AI tidies that place. */
export function askCloudChat(ask: Ask) {
  window.dispatchEvent(new CustomEvent<Ask>(OPEN_CHAT_EVENT, { detail: ask }));
}

/** Ways in while the chat is empty – each sent as it reads. */
const STARTERS = [
  'Räum diesen Ordner auf',
  'Gib den Dateien hier passende Namen',
  'Hilf mir, eine Datei zu finden',
];
/** Where no folder is open (Sender): about the whole workspace. */
const WORKSPACE_STARTERS = [
  'Hilf mir, eine Datei zu finden',
  'Räum „Meine Dateien“ auf',
  'Erstell eine Präsentation aus meinen Dateien',
];

/** ✨ in the app's header, in Cloud. */
export function CloudChatButton({ name }: { name?: string | undefined }) {
  return (
    <IconButton
      icon="autoAwesome"
      label={aiNameOf(name)}
      title={`${aiInSentence(name, true)} fragen`}
      onClick={() => window.dispatchEvent(new Event(OPEN_CHAT_EVENT))}
    />
  );
}

/** Open while ✨ says so; an ask (from a menu) opens it and is sent. */
function useChatOpen() {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    const toggle = (event: Event) => {
      const asked = event instanceof CustomEvent ? (event.detail as Ask | null) : null;
      if (!asked) return setOpen((now) => !now);
      setAsk(asked);
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_EVENT, toggle);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, toggle);
  }, []);
  return { open, ask, asked: () => setAsk(null), close: () => setOpen(false) };
}

type Notify = ComponentProps<typeof ChatPanel>['toast'];

/** The chat's panel, shown once ✨ was pressed; closed with ✕ or Esc, the chat stays. */
export function CloudChat() {
  const ui = useCloud();
  const { open, ask, asked, close } = useChatOpen();
  if (!open) return null;
  // Asked from a menu, the chat is about that place – else about where the person is.
  const place = ask
    ? { folderId: ask.folderId ?? null, areaId: ask.areaId ?? null }
    : { folderId: ui.place.parentId ?? null, areaId: ui.place.areaId ?? null };
  return (
    <Panel
      workspace={ui.workspace}
      place={place}
      notify={(message, tone) => ui.notify(message, tone)}
      ask={ask}
      onAsked={asked}
      onClose={close}
    />
  );
}

/** The same chat where no files are open (Sender): about the whole workspace. */
export function WorkspaceChat({
  workspace,
  notify,
}: {
  workspace: { id: string; aiName?: string | undefined };
  notify: Notify;
}) {
  const { open, ask, asked, close } = useChatOpen();
  if (!open) return null;
  return (
    <Panel
      workspace={workspace}
      place={{ folderId: null, areaId: null }}
      starters={WORKSPACE_STARTERS}
      notify={notify}
      ask={ask}
      onAsked={asked}
      onClose={close}
    />
  );
}

function Panel({
  workspace,
  place,
  starters = STARTERS,
  notify,
  ask,
  onAsked,
  onClose,
}: {
  workspace: { id: string; aiName?: string | undefined };
  place: ChatPlace;
  starters?: readonly string[];
  notify: Notify;
  ask: Ask | null;
  onAsked: () => void;
  onClose: () => void;
}) {
  const chat = useCloudChat(workspace.id, place, (message) => notify(message, 'danger'));
  const { send, busy } = chat;
  useEffect(() => {
    if (!ask) return;
    if (busy) {
      notify('Die KI arbeitet noch. Warte, bis sie fertig ist.', 'danger');
      onAsked();
    } else void send(ask.text).finally(onAsked);
    // Once per ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);
  return (
    <ChatPanel
      title={aiNameOf(workspace.aiName)}
      chat={chat}
      panel={{ 'data-cloud-panel': true }}
      intro={`${aiInSentence(workspace.aiName, true)} findet Dateien, liest hinein, benennt sie passend und räumt Ordner auf, baut und ändert Präsentationen in Slider, sieht und ändert dabei nur, was du darfst. Gelöschtes liegt ${CLOUD_TRASH_DAYS} Tage unter „Gelöscht“.`}
      starters={starters}
      toast={notify}
      onClose={onClose}
    />
  );
}
