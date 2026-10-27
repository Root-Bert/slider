import type { ReactNode } from 'react';

/** A section to jump to from the nav; hidden while the section inside shows nothing (others'). */
export function Part({ section, children }: { section: { id: string }; children: ReactNode }) {
  return (
    <div id={section.id} className="flex scroll-mt-8 flex-col empty:hidden">
      {children}
    </div>
  );
}
