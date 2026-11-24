import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EmptyState, type IconName } from '@/ui';
import { EmptyScene } from './EmptyScene';

/** Marks a page's frame (`CloudPage`): an `Empty` in it stands at the same height on every page. */
const EMPTY_FRAME = 'data-empty-frame';
/**
 * How far below the frame's top an `Empty`'s box begins (its picture 80 px lower, the box's own
 * room above it) – whatever stands between: tabs, a field, chips, nothing.
 */
const FRAME_TOP = 116;
/** The box's own room above the picture (`EmptyState`'s `py-20`): it may give that up. */
const OWN_ROOM = 80;

/**
 * The shift that puts the box at `FRAME_TOP` in its page's frame: down where little stands above
 * it, up into its own room where more does – measured again when anything around it changes size.
 */
function useFramedShift(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const box = ref.current;
    const frame = enabled ? box?.closest<HTMLElement>(`[${EMPTY_FRAME}]`) : null;
    if (!box || !frame) return;
    const around: HTMLElement[] = [];
    for (let each = box.parentElement; each && each !== frame; each = each.parentElement)
      around.push(each);
    const place = () => {
      const scrolled = around.reduce((sum, each) => sum + each.scrollTop, 0);
      // Where the box stands without its shift.
      const at =
        box.getBoundingClientRect().top +
        scrolled -
        frame.getBoundingClientRect().top -
        (parseFloat(box.style.marginTop) || 0);
      setShift(Math.max(-OWN_ROOM, Math.round(FRAME_TOP - at)));
    };
    place();
    const observer = new ResizeObserver(place);
    for (const each of [frame, ...around]) observer.observe(each);
    return () => observer.disconnect();
  }, [enabled]);
  return { ref, shift };
}

/**
 * „Nothing here“ in a list (Cloud, and Sender's lists it shows): a symbol, large and free on the
 * page (a little at work where it has a scene, see `EmptyScene`), what it means, what to do about
 * it. On a Cloud page it stands at the same height on every one (`FRAME_TOP`); `inline` keeps it
 * where it is – in a part of a page (the start page's „Zuletzt geändert“).
 */
export function Empty({
  icon,
  title,
  message,
  action,
  inline = false,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
  inline?: boolean;
}) {
  const { ref, shift } = useFramedShift(!inline);
  return (
    <div ref={ref} style={shift ? { marginTop: shift } : undefined}>
      <EmptyState
        illustration={
          <span className="text-fg-muted">
            <EmptyScene icon={icon} />
          </span>
        }
        title={title}
        message={message}
        action={action}
      />
    </div>
  );
}

/** A list that could not be loaded – only shown when there is nothing to show instead. */
export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      title="Das konnte nicht geladen werden"
      message={message}
      action={
        <button type="button" className="text-body text-fg underline" onClick={onRetry}>
          Erneut versuchen
        </button>
      }
    />
  );
}
