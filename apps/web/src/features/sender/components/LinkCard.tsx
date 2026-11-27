import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_PREFIX, linkPreviewPaths, type LinkPreview } from '@slider/shared';
import { api } from '@/lib/api-client';
import { linkify } from '@/lib/linkify';
import { useSender } from '../hooks/useSender';

/**
 * The card of the first web address in a message (`services/link-previews.ts`): the page's
 * picture, its site, title and description – what Slider's server read of it. The whole card
 * opens the address as written, in a new tab, like the link in the words. A page without a title,
 * one the server may not read or not reached shows no card; the words stay as they are.
 */
export function LinkCard({ text }: { text: string }) {
  const ui = useSender();
  const workspaceId = ui.workspace.id;
  const url = useMemo(() => {
    for (const part of linkify(text)) {
      if (part.kind === 'url' && /^https:/i.test(part.href)) return part.href;
    }
    return undefined;
  }, [text]);
  const preview = useQuery({
    queryKey: ['link-preview', workspaceId, url],
    queryFn: () =>
      api
        .get<LinkPreview | undefined>(linkPreviewPaths.of(workspaceId, url!))
        .then((found) => found ?? null),
    enabled: !!url,
    // No card (none found, or the hour's lookups used up): asked again after a while.
    staleTime: (query) => (query.state.data === null ? 10 * 60 * 1000 : Infinity),
    retry: false,
  });
  const [pictureFailed, setPictureFailed] = useState(false);
  const card = preview.data;
  if (!url || !card) return null;
  const picture =
    card.image && !pictureFailed
      ? `${API_PREFIX}${linkPreviewPaths.image(workspaceId, url)}`
      : null;
  // A logo or an avatar beside the words; only a wide picture fills the banner.
  const small = card.image === 'small';
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="group/card flex w-full max-w-md min-w-0 flex-col overflow-hidden rounded-control bg-surface-1 ring-hairline transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
    >
      {picture && !small && (
        <img
          src={picture}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setPictureFailed(true)}
          // The common shape of a page's picture (1200 × 630): its room held before it loads.
          className="block aspect-[1.91] w-full bg-surface-2 object-cover"
        />
      )}
      <span className="flex min-w-0 items-center gap-3 px-3 py-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-caption text-fg-subtle">{card.site}</span>
          <span className="line-clamp-2 text-body font-medium text-fg group-hover/card:underline">
            {card.title}
          </span>
          {card.description && (
            <span className="line-clamp-2 text-xs text-fg-muted">{card.description}</span>
          )}
        </span>
        {picture && small && (
          <img
            src={picture}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setPictureFailed(true)}
            className="size-16 shrink-0 rounded-thumb bg-surface-2 object-cover"
          />
        )}
      </span>
    </a>
  );
}
