import { createContext, use, useEffect, useState } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router';

/** The page shown in Cloud before this one – what `useOpenedFrom` asks where one came from. */
export const PageBefore = createContext<Location | null>(null);

/** For `CloudLayout`: the page shown before the one open now. */
export function usePageBefore(): Location | null {
  const location = useLocation();
  const [seen, setSeen] = useState<{ now: Location; before: Location | null }>({
    now: location,
    before: null,
  });
  if (seen.now.key !== location.key) setSeen({ now: location, before: seen.now });
  return seen.now.key === location.key ? seen.before : seen.now;
}

const FROM = 'cloudFrom';
const keptFrom = (state: unknown): string | null | undefined =>
  state && typeof state === 'object' && FROM in state
    ? ((state as Record<string, string | null>)[FROM] ?? null)
    : undefined;

/**
 * The overview a page was opened from, as its address (`/…/agenten`, „Dateien“ with its tab): the
 * path then goes the way one came – „Agenten › <Agent>“, not through the agent's area – and that
 * overview's row stays lit. Passed on to a page opened from such a one (`within`: an agent's call,
 * a folder's folder) and kept in the history's entry, so a reload or „Zurück“ shows the same.
 * `null`: from anywhere else (an area, a link, the search) – the page goes through its home.
 */
export function useOpenedFrom(
  overviews: readonly string[],
  within: (pathname: string) => boolean,
): string | null {
  const location = useLocation();
  const before = use(PageBefore);
  const navigate = useNavigate();
  const kept = keptFrom(location.state);
  const found =
    kept !== undefined
      ? kept
      : before
        ? overviews.includes(before.pathname)
          ? before.pathname + before.search
          : within(before.pathname)
            ? (keptFrom(before.state) ?? null)
            : null
        : undefined;
  useEffect(() => {
    // Only an overview is kept: from anywhere else the page goes through its home anyway.
    if (kept !== undefined || !found) return;
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      {
        replace: true,
        state: { ...(location.state as object | null), [FROM]: found },
        preventScrollReset: true,
      },
    );
  }, [kept, found, location, navigate]);
  return found ?? null;
}
