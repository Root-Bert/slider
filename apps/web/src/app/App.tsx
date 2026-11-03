import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { installEditOutbox } from '@/features/viewer';
import { createQueryClient } from './query-client';
import { router } from './router';

const queryClient = createQueryClient();
// The editor's unsent edits go out whichever page is open – also those a closed tab left.
installEditOutbox(queryClient);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* Own pointer (`shell/OwnCursor`) off for now: the system's cursors everywhere. */}
    </QueryClientProvider>
  );
}
