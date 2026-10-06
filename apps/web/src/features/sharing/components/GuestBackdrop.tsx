import type { ReactNode } from 'react';
import { Logo } from '@/ui';
import { OriginalUntouchedNote } from './OriginalUntouchedNote';

/** Dark, blurred stage behind the guest entry card (C2): deck thumbnail, dot grid, vignette. */
export function GuestBackdrop({
  thumbnailUrl,
  children,
}: {
  thumbnailUrl: string | null;
  children: ReactNode;
}) {
  return (
    <div className="dot-grid relative isolate flex min-h-full flex-col overflow-hidden">
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 -z-10 size-full scale-110 object-cover opacity-25 blur-2xl"
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgb(0_0_0/0.75)_70%)]"
      />
      <header className="p-4 md:px-6 md:py-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-6">
        <div className="glass-elevated w-full max-w-[400px] animate-pop-in rounded-panel p-6">
          {children}
        </div>
      </main>
      <footer className="flex justify-center px-4 pb-6">
        <OriginalUntouchedNote />
      </footer>
    </div>
  );
}
