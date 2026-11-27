import { useContext, useEffect, type ContextType } from 'react';
import { parsePath, UNSAFE_DataRouterContext, type Path, type To } from 'react-router';
import {
  CLOUD_CALL_PARAM,
  CLOUD_EVENT_PARAM,
  CLOUD_FILE_PARAM,
  CLOUD_TODO_PARAM,
  routes,
} from '@/lib/routes';

/** Each panel beside the page with what belongs to it in the address (a new event's day, hour). */
const PANELS = [
  [CLOUD_TODO_PARAM],
  [CLOUD_FILE_PARAM],
  [CLOUD_EVENT_PARAM, 'neu-tag', 'neu-um', 'neu-meeting', 'am'],
  [CLOUD_CALL_PARAM],
] as const;

/**
 * Where a way leads with the panel open beside the page taken along: from one Cloud page to
 * another, the panel stays until ✕ or Esc closes it. Untouched (`null`): a way within the same
 * page (the panel's own close is one), out of Cloud, relative, or one that names a panel itself.
 */
export function keptPanel(from: Pick<Path, 'pathname' | 'search'>, to: To, base: string) {
  const target = typeof to === 'string' ? parsePath(to) : to;
  if (!target.pathname?.startsWith('/')) return null;
  const inside = (pathname: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (!inside(from.pathname) || !inside(target.pathname)) return null;
  if (target.pathname === from.pathname) return null;
  const now = new URLSearchParams(from.search);
  const next = new URLSearchParams(target.search);
  if (PANELS.some(([key]) => next.has(key))) return null;
  const open = PANELS.find(([key]) => now.has(key));
  if (!open) return null;
  for (const key of open) {
    const value = now.get(key);
    if (value !== null) next.set(key, value);
  }
  return { ...target, search: `?${next}` };
}

type DataRouter = NonNullable<ContextType<typeof UNSAFE_DataRouterContext>>['router'];

/** Puts `keptPanel` in front of the router's every way; gives back what takes it out again. */
function keepPanel(router: DataRouter, base: string) {
  const navigate = router.navigate;
  router.navigate = ((to: To | number | null, options?: object) =>
    typeof to === 'number'
      ? navigate(to)
      : navigate(
          (to !== null && keptPanel(router.state.location, to, base)) || to,
          options,
        )) as typeof navigate;
  return () => {
    router.navigate = navigate;
  };
}

/**
 * While Cloud is open, every way to another of its pages (the side bar, a link, a jump from the
 * panel) keeps the panel beside the page – set on the way itself, so the panel neither closes nor
 * slides in anew.
 */
export function useKeptPanel(workspaceId: string) {
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const base = routes.cloud(workspaceId);
  useEffect(() => (router ? keepPanel(router, base) : undefined), [router, base]);
}
