import { useQuery } from '@tanstack/react-query';
import { loadIconLibrary } from './icon-library';

/**
 * Both sets, loaded once – kept for good, they never change while the page is open. `enabled`
 * false: not fetched (yet), what was fetched before is there.
 */
export function useIconLibrary(enabled = true) {
  return useQuery({
    queryKey: ['icon-library'],
    enabled,
    queryFn: loadIconLibrary,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
