import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TimeWindow } from '../hooks/useTimeWindow';
import { HistoryStrip } from './HistoryStrip';

const DAY = 86_400_000;
const now = new Date(2026, 9, 22).getTime();
const history = {
  from: new Date(now - 100 * DAY).toISOString(),
  to: new Date(now).toISOString(),
  stretchDays: 1,
  buckets: Array.from({ length: 100 }, (_, index) => ({
    start: new Date(now - (100 - index) * DAY).toISOString(),
    users: index % 7,
    workspaces: 0,
    decks: 0,
  })),
};

/** A 31-day window ending at `end` over 100 days of history; its moves are recorded. */
const strip = (end: number) => {
  const view = {
    interval: '31d',
    chooseInterval: vi.fn(),
    from: end - 31 * DAY,
    end,
    liveEnd: now,
    live: end === now,
    windowMs: 31 * DAY,
    stepMs: DAY,
    domainStart: now - 100 * DAY,
    moveTo: vi.fn(),
    pan: vi.fn(),
    follow: vi.fn(),
  } satisfies TimeWindow;
  render(<HistoryStrip history={history} metric="users" view={view} />);
  return { view, slider: screen.getByRole('slider', { name: 'Zeitraum verschieben' }) };
};

describe('HistoryStrip (BER-167)', () => {
  it('moves the window by a stretch or a whole window, to the start and back to now', () => {
    const { view, slider } = strip(now - 10 * DAY);
    expect(slider.getAttribute('aria-valuetext')).toBe('11. Sept. – 11. Okt.');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(view.moveTo).toHaveBeenLastCalledWith(now - 11 * DAY);
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(view.moveTo).toHaveBeenLastCalledWith(now + 21 * DAY);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(view.moveTo).toHaveBeenLastCalledWith(now - 69 * DAY);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(view.follow).toHaveBeenCalledOnce();
  });

  it("scrolling sideways over the strip moves the window at the strip's scale", () => {
    const { view, slider } = strip(now);
    const track = slider.parentElement!;
    Object.defineProperty(track, 'clientWidth', { value: 500 });
    // 100 days of history on 500px: 50px are 10 days.
    fireEvent.wheel(track, { deltaX: 50, deltaY: 2 });
    expect(view.pan).toHaveBeenCalledWith(10 * DAY);
    // Up and down stay with the page.
    fireEvent.wheel(track, { deltaX: 1, deltaY: 40 });
    expect(view.pan).toHaveBeenCalledOnce();
    // Shift with a plain mouse wheel goes sideways (jsdom's WheelEvent has no `shiftKey`).
    const shifted = new WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true });
    Object.defineProperty(shifted, 'shiftKey', { value: true });
    fireEvent(track, shifted);
    expect(view.pan).toHaveBeenLastCalledWith(-10 * DAY);
  });

  it('pressing the frame as drawn drags it; pressing beside it moves the window there', () => {
    const { view, slider } = strip(now - 10 * DAY);
    const track = slider.parentElement!;
    track.setPointerCapture = vi.fn();
    track.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
    // On the frame: nothing jumps.
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 10 });
    expect(view.moveTo).not.toHaveBeenCalled();
    fireEvent.pointerUp(track, { pointerId: 1 });
    // Beside it (10 % of 100 days = day 10): the window, centred there.
    fireEvent.pointerDown(track, { button: 0, pointerId: 2, clientX: 100 });
    expect(view.moveTo).toHaveBeenCalledWith(now - 90 * DAY + 15.5 * DAY);
  });
});
