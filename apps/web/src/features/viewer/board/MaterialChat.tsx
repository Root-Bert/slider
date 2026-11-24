import { aiInSentence, type Material, type MaterialChatSummary } from '@slider/shared';
import { useMemo, useState } from 'react';
import { useDeleteMaterialChat, useMaterialChats, type BoardRef } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { ConfirmDialog, IconButton, type Avatar } from '@/ui';
import { useBoardOwner } from './board-owner';
import { ChatPanel } from './ChatPanel';
import { useMaterialChat } from './material-chat';
import { withoutSources } from './note-answers';
import { onMaterialPage } from './material-page';
import { WithSources } from './NoteAnswer';

/*
 * The AI on the material page (✨ in its controls): a chat in the page's side panel, as with
 * Claude or ChatGPT – it reads the material, answers, writes, and puts what it makes on the
 * board. Each person's chats are kept: an empty chat lists the earlier ones. The chat itself:
 * `material-chat.ts`; the AI's side: `services/material-chat.ts`.
 */

/** Ways in while the chat is empty – each sent as it reads; the outline's names the host. */
const STARTERS = ['Fasse das Material zusammen', 'Welche Fragen lässt das Material offen?'];

export interface MaterialChatProps {
  ai: Parameters<typeof Avatar>[0]['author'];
  /** The board's files by id: an answer's sources. */
  byId: ReadonlyMap<string, Material>;
  openSource: (material: Material, page: number | null) => void;
  onClose: () => void;
}

export const MaterialChat = (props: MaterialChatProps) =>
  onMaterialPage(<MaterialChatView {...props} />);

/** The chat itself, wherever it shows: on the material page (`MaterialChat`) or over the slides. */
export function MaterialChatView({ ai, byId, openSource, onClose }: MaterialChatProps) {
  const { kind, id, workspaceId, toast, wording } = useBoardOwner();
  const owner = useMemo(() => ({ kind, id }), [kind, id]);
  const starters = useMemo(() => [...STARTERS, wording.outline], [wording.outline]);
  const chat = useMaterialChat(owner, (message) => toast(message, 'danger'));
  return (
    <ChatPanel
      title={ai.name}
      chat={chat}
      workspaceId={workspaceId}
      keep={`${kind}:${id}`}
      panel={{ 'data-board-panel': true, 'data-material-chat': true }}
      earlier={
        <EarlierChats
          owner={owner}
          onOpen={(chatId) => void chat.openChat(chatId)}
          onDeleted={() => toast('Chat gelöscht')}
        />
      }
      intro={`Frag ${aiInSentence(ai.name)} zum Material oder lass dir etwas schreiben. Ergebnisse kommen auf Wunsch als Notizen, Links oder Dateien aufs Board.`}
      starters={starters}
      renderText={(run) => <WithSources text={run} byId={byId} onOpen={openSource} />}
      copyText={(text) => withoutSources(text, byId)}
      toast={toast}
      onClose={onClose}
    />
  );
}

/** One's earlier chats on the board, latest first – opened with a click, deleted after asking. */
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
          deleting
            ? `„${deleting.title}“ mit allen Nachrichten wird gelöscht. Was die KI aufs Board gelegt hat, bleibt.`
            : undefined
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
