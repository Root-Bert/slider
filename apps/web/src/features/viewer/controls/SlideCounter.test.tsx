import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlideCounter } from './SlideCounter';

const view = vi.hoisted(() => ({ activeSlideId: 's2' as string | null }));
const goTo = vi.hoisted(() => vi.fn<(index: number) => void>());

vi.mock('../state/viewer-data', () => {
  const slides = [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}` }));
  return {
    useViewerData: () => ({
      slides,
      slideIndex: new Map(slides.map((s, index) => [s.id, index])),
    }),
  };
});
vi.mock('../state/viewer-state', () => ({ useViewerState: () => view }));
vi.mock('../hooks/useGoToSlide', () => ({ useGoToSlide: () => goTo }));

const field = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: 'Aktuelle Folie, 1 bis 5' });

describe('SlideCounter', () => {
  beforeEach(() => {
    view.activeSlideId = 's2';
    goTo.mockReset();
  });

  it('shows the active position and the total, and announces it', () => {
    render(<SlideCounter />);
    expect(field().value).toBe('2');
    expect(screen.getByRole('status').textContent).toBe('Folie 2 von 5');
  });

  it('starts at 1 without an active slide', () => {
    view.activeSlideId = null;
    render(<SlideCounter />);
    expect(field().value).toBe('1');
  });

  it('jumps to a typed number on Enter (0-based) and gives the field up', async () => {
    render(<SlideCounter />);
    await userEvent.click(field());
    await userEvent.keyboard('4{Enter}');
    expect(goTo).toHaveBeenCalledExactlyOnceWith(3);
    expect(document.activeElement).not.toBe(field());
  });

  it('clamps numbers past the deck and ignores the current slide or text', async () => {
    render(<SlideCounter />);
    await userEvent.click(field());
    await userEvent.keyboard('99{Enter}');
    expect(goTo).toHaveBeenLastCalledWith(4);

    goTo.mockReset();
    await userEvent.click(field());
    await userEvent.keyboard('2{Enter}');
    await userEvent.click(field());
    await userEvent.keyboard('abc{Enter}');
    expect(goTo).not.toHaveBeenCalled();
    expect(field().value).toBe('2');
  });

  it('commits when the field loses focus', async () => {
    render(
      <>
        <SlideCounter />
        <button type="button">Weiter</button>
      </>,
    );
    await userEvent.click(field());
    await userEvent.keyboard('5');
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(goTo).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('Escape restores the number without jumping', async () => {
    render(<SlideCounter />);
    await userEvent.click(field());
    await userEvent.keyboard('4{Escape}');
    expect(goTo).not.toHaveBeenCalled();
    expect(field().value).toBe('2');
  });

  it('↑/↓ step one slide from the typed or shown number', async () => {
    render(<SlideCounter />);
    await userEvent.click(field());
    await userEvent.keyboard('{ArrowUp}');
    expect(goTo).toHaveBeenLastCalledWith(2);
    await userEvent.keyboard('{ArrowDown}');
    expect(goTo).toHaveBeenLastCalledWith(0);
  });

  it('does not step past the first slide', async () => {
    view.activeSlideId = 's1';
    render(<SlideCounter />);
    await userEvent.click(field());
    await userEvent.keyboard('{ArrowDown}');
    expect(goTo).not.toHaveBeenCalled();
  });
});
