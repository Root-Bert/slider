import { aiInSentence, type MaterialChatSummary } from '@slider/shared';
import { useMemo, useState } from 'react';
import { usePanelForCalls } from '@/features/calls';
import {
  deckBoard,
  useDeleteMaterialChat,
  useDeckMaterial,
  useMaterialChats,
  type BoardRef,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { ConfirmDialog, IconButton } from '@/ui';
import { useAiPresence } from '../controls/ParticipantAvatars';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';
import { ChatPanel } from './ChatPanel';
import { useMaterialChat } from './material-chat';
import { openSource, withoutSources } from './source-text';
import { WithSources } from './sources';

/*
 * The AI's chat over the slides, opened by a click on its avatar: one of the presentation's side
 * panels, as with Claude or ChatGPT – it reads the deck's material (the files given at its start),
 * answers and writes. Each person's chats are kept: an empty chat lists the earlier ones. The
 * chat itself: `material-chat.ts`; the AI's side: `services/material-chat.ts`.
 */

/** Ways in while the chat is empty – each sent as it reads; about the material where there is some. */
const STARTERS = [
  'Fasse das Material zusammen',
  'Welche Fragen lässt das Material offen?',
  'Schreib eine Gliederung für die Präsentation',
];
const STARTERS_WITHOUT_MATERIAL = [
  'Schreib eine Gliederung für die Präsentation',
  'Welche Fragen sollte die Präsentation beantworten?',
];

export function DeckAiChat() {
  const { aiChatOpen } = useViewerState();
  const { canComment } = useViewerData();
  // The call stays in this panel, open or closed – where its button (the AI's avatar) is; also
  // while the comments are closed (working on the slides alone): nothing floats over them.
  const { aiPresent } = useAiPresence();
  usePanelForCalls(canComment && aiPresent);
  // Asking spends the workspace's AI: not for Betrachter.
  if (!aiChatOpen || !canComment) return null;
  return <OpenAiChat />;
}

function OpenAiChat() {
  const { deck, aiAuthor } = useViewerData();
  const dispatch = useViewerDispatch();
  const toast = useViewerToast();
  const owner = useMemo(() => deckBoard(deck.id), [deck.id]);
  const materials = useDeckMaterial(deck.id).data?.materials;
  const byId = useMemo(
    () => new Map((materials ?? []).map((file) => [file.id, file])),
    [materials],
  );
  const chat = useMaterialChat(owner, (message) => toast(message, 'danger'));
  return (
    <ChatPanel
      title={aiAuthor.name}
      chat={chat}
      workspaceId={deck.workspaceId}
      keep={`deck:${deck.id}`}
      panel={{ 'data-material-chat': true }}
      earlier={
        <EarlierChats
          owner={owner}
          onOpen={(chatId) => void chat.openChat(chatId)}
          onDeleted={() => toast('Chat gelöscht')}
        />
      }
      intro={
        byId.size > 0
          ? `Frag ${aiInSentence(aiAuthor.name)} zum Material der Präsentation oder lass dir etwas schreiben.`
          : `Frag ${aiInSentence(aiAuthor.name)} zur Präsentation oder lass dir etwas schreiben.`
      }
      starters={byId.size > 0 ? STARTERS : STARTERS_WITHOUT_MATERIAL}
      renderText={(run) => <WithSources text={run} byId={byId} onOpen={openSource} />}
      copyText={(text) => withoutSources(text, byId)}
      toast={toast}
      onClose={() => dispatch({ type: 'aiChatSet', open: false })}
    />
  );
}

/** One's earlier chats over this presentation, latest first – opened with a click, deleted after asking. */
function EarlierChats({
  owner,
  onOpen,
  onDeleted,
}: {
  owner: BoardRef;
  onOpen: (chatId: string) => void;
  onDeleted: () => void;
}) {
  const { data: chats = [] } = useMaterialChats(owner);
  const remove = useDeleteMaterialChat(owner);
  const [deleting, setDeleting] = useState<MaterialChatSummary | null>(null);
  if (chats.length === 0) return null;
  return (
    <section aria-label="Frühere Chats" className="flex flex-col gap-1">
      <h3 className="px-2 text-caption font-medium text-fg-subtle">Frühere Chats</h3>
      <ul className="flex flex-col">
        {chats.map((each) => (
          <li key={each.id} className="group flex items-center rounded-control hover:bg-hover">
            <button
              type="button"
              onClick={() => onOpen(each.id)}
              className="flex min-w-0 flex-1 items-baseline gap-2 px-2 py-1.5 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-body text-fg">{each.title}</span>
              <span className="shrink-0 text-caption text-fg-subtle">
                {formatRelativeTime(each.updatedAt)}
              </span>
            </button>
            <IconButton
              icon="delete"
              label="Chat löschen"
              size="sm"
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              onClick={() => setDeleting(each)}
            />
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Chat löschen?"
        description={
          deleting ? `„${deleting.title}“ mit allen Nachrichten wird gelöscht.` : undefined
        }
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSuccess: onDeleted });
          setDeleting(null);
        }}
      />
    </section>
  );
}
