import { useId } from 'react';
import { MAX_MATERIAL_CHAT_MESSAGE, type Attachment } from '@slider/shared';
import type { Attachments } from '@/features/attachments';
import { Composer } from '@/features/sender';
import type { DraftTarget } from '@/lib/drafts';
import { useAgentAttachments } from '../hooks/useAgentAttachments';

/**
 * The field an agent is written to: Sender's (`Composer`) – a chat with an agent is written as one
 * with people (files, a recorded video, Enter sends) – handed the agent's files and draft. While
 * the agent works one writes on – it takes the message up as soon as it can –, and „Stoppen“
 * stands beside „Senden“.
 */
export function AgentComposer({
  workspaceId,
  draft,
  keep,
  autoFocus = false,
  inline = false,
  top = false,
  typeInto = false,
  attach: given,
  ...props
}: {
  /** Where files put on the message go up – with it, the clip, pasting and recording are there. */
  workspaceId?: string;
  /** A text to start from, put into the field each time it is another one. */
  draft?: { text: string } | null;
  /** What is written and not sent is kept under this key (`Entwürfe`) and comes back here. */
  keep?: { key: string; target: DraftTarget };
  placeholder: string;
  /** Nothing is sent right now: an order is being placed. */
  busy?: boolean;
  /** The agent works: it can be stopped, and written to all the same. */
  working?: boolean;
  autoFocus?: boolean;
  /** In a column that scrolls (`MailAside`): a field in the page, no float shadow cut at its edges. */
  inline?: boolean;
  /**
   * At a page's top, beside its buttons (`Agenten`, „Zuletzt“): a field as high as they are and
   * dressed as every other field there (`TextField`). Otherwise the slim one under a conversation.
   */
  top?: boolean;
  /** `false`: refused – the text and the files go back into the field. */
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onStop?: () => void;
  /** Something is being written – as often as a key is pressed. */
  onTyping?: () => void;
  /** Esc in the field – where the page has one (back, on „Neu“); else the field keeps it. */
  onEscape?: () => void;
  /** ↑ in an empty field: one's last message changed, as in every conversation. */
  onEditLast?: () => void;
  /** Typing with the focus on no field (the chat just picked in the side bar) writes here. */
  typeInto?: boolean;
  /**
   * The files on the message, where the page holds them (`useAgentAttachments`) – files dropped on the
   * whole chat go there. Otherwise its own.
   */
  attach?: Attachments;
}) {
  const own = useAgentAttachments(given ? undefined : workspaceId, keep?.key);
  const attach = given ?? own;
  // Nothing kept: a key of its own, so the field never shows another one's draft.
  const unkept = useId();
  return (
    <Composer
      {...props}
      conversationId={keep?.key ?? unkept}
      target={keep?.target}
      keepDraft={!!keep}
      prefill={draft}
      label="Nachricht an den Agenten"
      people={[]}
      attach={attach}
      maxLength={MAX_MATERIAL_CHAT_MESSAGE}
      maxHeight={200}
      variant={top ? 'top' : inline ? 'inline' : 'float'}
      focusOnOpen={autoFocus}
      typeInto={typeInto}
    />
  );
}
