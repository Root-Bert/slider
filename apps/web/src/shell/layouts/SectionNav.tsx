import { useEffect, useState, type CSSProperties } from 'react';
import { cn, Icon, type IconName } from '@/ui';
import { useActiveSection } from './useActiveSection';

/** Height of one entry – the highlight moves by it. */
const ITEM_PX = 32;
/** The highlight's edges: the leading one goes first, the trailing one follows this much later. */
const STRETCH_MS = 260;
const TRAIL_MS = 90;

/**
 * The page's groups at its side, each with its icon, the one being read in bold on the selected
 * backing of a filter chip. The backing moves like something liquid: its leading edge runs ahead
 * to the next group, the trailing one follows. Inside it, a darker shade fills from the left as far as the
 * group has been read. Sticks while the page scrolls; a click scrolls to the group. Only groups
 * on the page are listed: a section that shows only to some (admins, a setting) leaves its entry
 * out while it is not there.
 */
export function SectionNav({
  sections,
  className,
}: {
  sections: readonly { id: string; title: string; icon: IconName }[];
  className?: string;
}) {
  const shown = useShownSections(sections);
  const { active, progress, go } = useActiveSection(shown.map((section) => section.id));
  const index = Math.max(
    0,
    shown.findIndex((section) => section.id === active),
  );
  // Which way the highlight last moved – which of its edges leads.
  const [last, setLast] = useState(index);
  const [down, setDown] = useState(true);
  if (index !== last) {
    setDown(index > last);
    setLast(index);
  }
  const edge = (side: 'top' | 'bottom', leads: boolean) =>
    `${side} ${STRETCH_MS}ms var(--ease-emphasized) ${leads ? 0 : TRAIL_MS}ms`;
  const highlight: CSSProperties = {
    top: index * ITEM_PX,
    bottom: (shown.length - 1 - index) * ITEM_PX,
    transition: `${edge('top', !down)}, ${edge('bottom', down)}`,
  };

  return (
    <nav aria-label="Abschnitte" className={cn('sticky top-8', className)}>
      <div className="relative">
        <span
          aria-hidden
          className="absolute inset-x-0 overflow-hidden rounded-control bg-selected"
          style={highlight}
        >
          <span
            className="absolute inset-0 origin-left bg-fg/8 transition-transform duration-150 ease-linear"
            style={{ transform: `scaleX(${progress})` }}
          />
        </span>
        <ul className="flex flex-col">
          {shown.map((section) => {
            const current = section.id === active;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  aria-current={current ? 'location' : undefined}
                  onClick={() => go(section.id)}
                  style={{ height: ITEM_PX }}
                  className={cn(
                    'group relative flex w-full items-center gap-2 rounded-control px-2.5 text-left text-body transition-colors',
                    current
                      ? 'font-semibold text-fg'
                      : 'text-fg-subtle hover:bg-hover hover:text-fg',
                  )}
                >
                  <Icon
                    name={section.icon}
                    size={16}
                    className={cn(
                      'shrink-0 transition-[color,transform] duration-300 ease-(--ease-overshoot)',
                      current ? 'scale-110 text-fg' : 'group-hover:text-fg',
                    )}
                  />
                  {section.title}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** The sections whose group is on the page – watched, as groups come and go with their data. */
function useShownSections<T extends { id: string }>(sections: readonly T[]): readonly T[] {
  const key = sections.map((section) => section.id).join(' ');
  const [present, setPresent] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setPresent(
        key
          .split(' ')
          // An empty group: its section shows only to others (`empty:hidden`).
          .filter((id) => id && document.getElementById(id)?.firstElementChild)
          .join(' '),
      );
    };
    update();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(update);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [key]);
  // Before the first look: all of them.
  if (present === null) return sections;
  const ids = present.split(' ');
  return sections.filter((section) => ids.includes(section.id));
}
