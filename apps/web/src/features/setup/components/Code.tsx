import type { ReactNode } from 'react';

/** A command or value from the server, e.g. `docker logs slider`. */
export const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-badge bg-surface-2 px-1 py-0.5 text-xs text-fg-muted">{children}</code>
);
