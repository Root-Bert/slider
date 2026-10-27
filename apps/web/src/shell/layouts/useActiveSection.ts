import { useCallback, useEffect, useRef, useState } from 'react';
import { smoothScroll } from '@/lib/motion';

/** A group counts as read once its top passed this share of the window's height. */
const READ_LINE = 0.3;

/**
 * Scroll spy for a page of groups: the one being read – the last whose top is above the line a
 * third down the window; at the very bottom the last one that shows, so a short last group gets
 * its turn too. `progress` (0–1): how far that line got through it. `go` scrolls a group to the
 * top and marks it right away; it stays marked – even where the page ends before it reaches the
 * top – until one scrolls on oneself.
 */
export function useActiveSection(ids: readonly string[]) {
  const [state, setState] = useState({ active: ids[0], progress: 0 });
  // Clicked: that group stays marked until the person scrolls (wheel, touch, keys).
  const clicked = useRef(false);
  const key = ids.join(' ');

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (clicked.current) return;
      const elements = ids
        .map((id) => document.getElementById(id))
        .filter((element): element is HTMLElement => element !== null);
      if (elements.length === 0) return;
      const { scrollHeight } = document.documentElement;
      // Only a page that scrolls has a bottom to reach.
      const atBottom =
        scrollHeight > window.innerHeight &&
        window.innerHeight + window.scrollY >= scrollHeight - 2;
      const line = atBottom ? window.innerHeight : window.innerHeight * READ_LINE;
      const passed = elements.filter((element) => element.getBoundingClientRect().top <= line);
      const current = passed.at(-1) ?? elements[0]!;
      const rect = current.getBoundingClientRect();
      const progress = atBottom
        ? 1
        : Math.min(1, Math.max(0, (line - rect.top) / (rect.height || 1)));
      setState((prev) =>
        prev.active === current.id && Math.abs(prev.progress - progress) < 0.005
          ? prev
          : { active: current.id, progress },
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const release = () => {
      if (!clicked.current) return;
      clicked.current = false;
      onScroll();
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    for (const type of ['wheel', 'touchmove', 'keydown'] as const) {
      window.addEventListener(type, release, { passive: true });
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      for (const type of ['wheel', 'touchmove', 'keydown'] as const) {
        window.removeEventListener(type, release);
      }
    };
    // `key` stands for `ids`: a new array with the same groups doesn't start over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const go = useCallback((id: string) => {
    clicked.current = true;
    setState({ active: id, progress: 0 });
    document.getElementById(id)?.scrollIntoView({ behavior: smoothScroll(), block: 'start' });
  }, []);

  return { ...state, go };
}
