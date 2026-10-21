import type { PendingInvite } from '@slider/shared';
import { formatExpiry } from './roles';

/** "1 Mitglied" / "4 Mitglieder". */
export const memberCountLabel = (count: number) =>
  count === 1 ? '1 Mitglied' : `${count} Mitglieder`;

/** Who asked, for which review, until when – the second line of an invitation. */
export const inviteDetails = (invite: PendingInvite) =>
  [
    invite.deck ? `„${invite.deck.title}“` : null,
    invite.inviterName ? `Von ${invite.inviterName}` : null,
    formatExpiry(invite.expiresAt),
  ]
    .filter(Boolean)
    .join(' | ');
