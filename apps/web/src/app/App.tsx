import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { CallProvider } from '@/features/calls';
import { installEditOutbox } from '@/features/viewer';
import { followAccountSwitches } from '@/lib/api';
import { createQueryClient } from './query-client';
import { router } from './router';

const queryClient = createQueryClient();
// The editor's unsent edits go out whichever page is open – also those a closed tab left.
installEditOutbox(queryClient);
// Another tab switched accounts or signed out: this one follows.
followAccountSwitches();

const navigate = (to: string) => void router.navigate(to);
const pathname = () => router.state.location.pathname;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Calls ring and go on on every page – around the router, not inside a route. */}
      <CallProvider navigate={navigate} pathname={pathname}>
        <RouterProvider router={router} />
      </CallProvider>
      {/* Own pointer (`shell/OwnCursor`) off for now: the system's cursors everywhere. */}
    </QueryClientProvider>
  );
}
