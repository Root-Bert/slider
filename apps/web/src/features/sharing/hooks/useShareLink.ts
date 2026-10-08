import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useCreateReviewLink, useReviewLinks, useRevokeReviewLink } from '@/lib/queries';
import { findActiveLink, linkLifetimeDays } from '../lib/review-links';

export interface LinkSettings {
  role: 'view';
  expiresInDays: number | null;
}

/** Review links are view-only (BER-130); commenting is for members of the organisation. */
const DEFAULT_SETTINGS: LinkSettings = { role: 'view', expiresInDays: null };

/**
 * The deck's current review link (C1, BER-102).
 *
 * - Opening the dialog without an active link creates one (view only, no expiry).
 * - Links are immutable on the server, so changing role or expiry creates a new link and
 *   revokes the old one – new first, so the deck is never without a link in between.
 * - After an explicit revoke nothing is recreated until the dialog is opened again.
 */
export function useShareLink(deckId: string, open: boolean) {
  const links = useReviewLinks(deckId, open);
  const {
    mutate: createLink,
    mutateAsync: createLinkAsync,
    ...create
  } = useCreateReviewLink(deckId);
  const { mutateAsync: revokeLinkAsync } = useRevokeReviewLink(deckId);
  const activeLink = links.data ? findActiveLink(links.data) : null;

  // Set once per dialog session: after the auto-create, or when the user revoked on purpose.
  const autoCreateHandled = useRef(false);

  useEffect(() => {
    if (!open) {
      autoCreateHandled.current = false;
      return;
    }
    if (!links.isSuccess || activeLink || autoCreateHandled.current) return;
    autoCreateHandled.current = true;
    createLink(DEFAULT_SETTINGS);
  }, [open, links.isSuccess, activeLink, createLink]);

  const replace = useMutation({
    mutationFn: async (settings: LinkSettings) => {
      const previous = activeLink;
      const created = await createLinkAsync(settings);
      if (previous) await revokeLinkAsync(previous.id);
      return created;
    },
  });

  const revokeActive = useMutation({
    mutationFn: async () => {
      if (!activeLink) return;
      autoCreateHandled.current = true;
      await revokeLinkAsync(activeLink.id);
    },
  });

  const settings: LinkSettings = activeLink
    ? { role: 'view', expiresInDays: linkLifetimeDays(activeLink) }
    : DEFAULT_SETTINGS;

  return {
    activeLink,
    settings,
    loading: links.isPending || (create.isPending && !activeLink),
    busy: create.isPending || replace.isPending || revokeActive.isPending,
    error: links.error ?? create.error ?? replace.error ?? revokeActive.error,
    update: (changes: Partial<LinkSettings>) => replace.mutate({ ...settings, ...changes }),
    createNew: () => createLink(DEFAULT_SETTINGS),
    revoke: () => revokeActive.mutate(),
    revoking: revokeActive.isPending,
  };
}
