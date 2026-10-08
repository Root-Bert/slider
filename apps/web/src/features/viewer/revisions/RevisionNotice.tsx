import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { cn } from '@/ui';
import { revisionNoticeText } from '../lib/revision-changes';
import type { RevisionAnnouncement } from '../state/revision-data';

/** How long the notice stays (the countdown bar runs this long); hovering pauses it. */
const NOTICE_DURATION_MS = 6000;
const FADE_OUT_MS = 200;

/**
 * "V5 geladen · 2 Folien geändert, 1 neu" next to "Neu laden" in the version pill, for a few
 * seconds after a new revision arrived (replaces the "Neue Version" banner). Slides in, a thin
 * bar counts down – paused while the pointer is on it – then it fades out and `onDone` drops the
 * announcement. Reduced motion: no slide, no bar, it just goes after the same time.
 *
 * Not a live region itself – `RevisionControls` keeps one mounted, so screen readers hear it
 * reliably (a region that appears together with its text is often not read).
 */
export function RevisionNotice({
  announcement,
  onDone,
}: {
  announcement: RevisionAnnouncement;
  onDone: () => void;
}) {
  const text = revisionNoticeText(announcement.revisionNumber, announcement.summary);
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(NOTICE_DURATION_MS);
  const done = useEffectEvent(onDone);

  // Counts down only while not paused; a pause keeps what was left.
  useEffect(() => {
    if (paused || leaving) return;
    const startedAt = performance.now();
    const timer = window.setTimeout(() => setLeaving(true), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= performance.now() - startedAt;
    };
  }, [paused, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => done(), FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <span
      aria-hidden
      data-revision-notice
      title={text}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className={cn(
        'relative flex h-8 min-w-0 animate-slide-in-x items-center overflow-hidden rounded-control bg-white/8 px-2.5 text-xs text-fg transition-opacity duration-200',
        'max-w-[320px]',
        leaving && 'opacity-0',
      )}
    >
      {/* Phones: the controls row has no room for more than the version – the full text is the
          tooltip and the live region's. */}
      <span className="truncate">
        V{announcement.revisionNumber} geladen
        {announcement.summary?.text && (
          <span className="max-sm:hidden"> · {announcement.summary.text}</span>
        )}
      </span>
      <span
        data-revision-notice-bar
        className="absolute inset-x-2.5 bottom-1 h-0.5 origin-left animate-countdown rounded-full bg-primary/70 motion-reduce:hidden"
        style={{
          animationDuration: `${NOTICE_DURATION_MS}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </span>
  );
}
