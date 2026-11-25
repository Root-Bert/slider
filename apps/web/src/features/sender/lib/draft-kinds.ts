import { searchFold } from '@slider/shared';
import type { Draft } from '@/lib/drafts';
import type { IconName } from '@/ui';
import type { DraftEntry, DraftPlace } from '../hooks/useWorkspaceDrafts';
import { markupPlain } from './markup';

/** A draft's words in one line – a new mail without any yet: to whom it goes. */
export const summary = (draft: Draft) =>
  // A chat's words without their marks; a mail's as written.
  (draft.target?.kind.startsWith('mail') ? draft.text : markupPlain(draft.text))
    .replace(/\s+/g, ' ')
    .trim() ||
  (draft.target?.kind === 'mail-new' && draft.target.to.trim()
    ? `An ${draft.target.to.trim()}`
    : '');

/** The kinds a list of drafts is filtered by – as the side bar names them; to-dos have none. */
export const DRAFT_KINDS = [
  { value: 'all', label: 'Alle', icon: 'edit' },
  { value: 'chats', label: 'Chats', icon: 'chatBubble' },
  { value: 'agents', label: 'Agenten', icon: 'autoAwesome' },
  { value: 'mails', label: 'Mails', icon: 'mail' },
] as const satisfies readonly { value: string; label: string; icon: IconName }[];
export type DraftKind = (typeof DRAFT_KINDS)[number]['value'];

const kindOf = (place: DraftPlace): Exclude<DraftKind, 'all'> =>
  place.kind === 'conversation'
    ? 'chats'
    : place.kind === 'mail' || place.kind === 'mail-new'
      ? 'mails'
      : 'agents';

/** The drafts of a kind with every word of the search in their place's name or their text. */
export function draftsOf(entries: readonly DraftEntry[], kind: DraftKind, query: string) {
  const words = searchFold(query.trim()).split(/\s+/).filter(Boolean);
  return entries.filter(
    (entry) =>
      (kind === 'all' || kindOf(entry.place) === kind) &&
      words.every((word) => searchFold(`${entry.name} ${summary(entry.draft)}`).includes(word)),
  );
}

export type DraftView = 'list' | 'tiles';
