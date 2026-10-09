import { ACCENT_COLORS, type AccentColor, type Author } from '@slider/shared';
import type { GuestSessionRow, UserRow } from './db/schema';
import { fileUrl } from './storage/blob-storage';

/** Deterministic accent colour for a name, so a PowerPoint author keeps their colour across imports. */
export function colorForName(name: string): AccentColor {
  let hash = 0x811c9dc5;
  for (const char of name.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return ACCENT_COLORS[(hash >>> 0) % ACCENT_COLORS.length] ?? 'blue';
}

export const ownerAuthor = (user: UserRow): Author => ({
  id: user.id,
  name: user.name,
  type: 'owner',
  color: user.color,
  avatarUrl: user.avatarKey ? fileUrl(user.avatarKey) : null,
  avatarSeed: user.avatarSeed,
});

export const guestAuthor = (session: GuestSessionRow): Author => ({
  id: session.id,
  name: session.name,
  type: 'guest',
  color: session.color,
  avatarUrl: null,
});

/** Someone who commented in PowerPoint; identified by name only. */
export const externalAuthor = (name: string): Author => ({
  id: `pptx:${name.trim().toLowerCase()}`,
  name: name.trim() || 'Unbekannt',
  type: 'external',
  color: colorForName(name),
  avatarUrl: null,
});
