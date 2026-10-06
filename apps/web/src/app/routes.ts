/** Typed URL builders – the only place that knows the URL structure. */
export const routes = {
  reviews: () => '/',
  newReview: () => '/neu',
  /** Deep links use the stable slide id, never the slide number (BER-95). */
  deck: (deckId: string, slideId?: string | null) =>
    slideId ? `/d/${deckId}?slide=${encodeURIComponent(slideId)}` : `/d/${deckId}`,
  invite: (token: string) => `/r/${token}`,
};

/** Absolute URL for sharing (review links). */
export const absoluteUrl = (path: string) => new URL(path, window.location.origin).toString();
