import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slide } from '../lib/test-fixtures';
import { SlideFrame } from './SlideFrame';

vi.mock('./AnnotationLayer', () => ({ AnnotationLayer: () => null }));
vi.mock('../live/LiveSlidePresence', () => ({ LiveSlidePresence: () => null }));
vi.mock('../state/viewer-state', () => ({ useViewerDispatch: () => vi.fn() }));
vi.mock('../state/stage-registry', () => ({
  useStageRegistry: () => ({ setHoveredBox: vi.fn() }),
}));

describe('SlideFrame – hidden / shown in this revision', () => {
  function renderWithChange(hidden: boolean, hiddenChanged?: 'hidden' | 'shown', w = 800) {
    render(
      <SlideFrame
        slide={slide('s1', 0, {
          title: 'Agenda',
          hidden,
          change: { status: 'unchanged', moved: false, confidence: 1, hiddenChanged },
        })}
        index={0}
        total={1}
        x={0}
        top={0}
        w={w}
        h={w * (9 / 16)}
        isActive
        threads={[]}
        emphasisId={null}
        draft={null}
        tool={null}
        canSelect={false}
        color="red"
        badge={null}
        badgeVersion={2}
        boxMode={false}
        showGuides={false}
      />,
    );
  }

  it('says "Wieder eingeblendet" on a slide shown again', () => {
    renderWithChange(false, 'shown');
    const chip = document.querySelector('[data-visibility-change="shown"]');
    expect(chip?.textContent).toBe('Wieder eingeblendet');
    expect(chip?.getAttribute('title')).toBe('In dieser Version wieder eingeblendet');
  });

  it('marks the "Ausgeblendet" chip of a slide hidden in this revision', () => {
    renderWithChange(true, 'hidden');
    const chip = document.querySelector('[data-visibility-change="hidden"]');
    expect(chip?.getAttribute('title')).toBe('In dieser Version ausgeblendet');
    expect(screen.getByText(/In dieser Version ausgeblendet/)).toBeTruthy();
  });

  it('shows no visibility chip when nothing changed', () => {
    renderWithChange(true);
    expect(screen.getByText('Ausgeblendet')).toBeTruthy();
    expect(document.querySelector('[data-visibility-change]')).toBeNull();
  });

  it('leaves tiny thumbnails alone', () => {
    renderWithChange(false, 'shown', 150);
    expect(document.querySelector('[data-visibility-change]')).toBeNull();
  });
});

describe('SlideFrame – dragging an area', () => {
  afterEach(() => vi.restoreAllMocks());

  function renderSelecting() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 450),
    );
    render(
      <SlideFrame
        slide={slide('s1', 0)}
        index={0}
        total={1}
        x={0}
        top={0}
        w={800}
        h={450}
        isActive
        threads={[]}
        emphasisId={null}
        draft={null}
        tool={null}
        canSelect
        color="red"
        badge={null}
        badgeVersion={1}
        boxMode={false}
        showGuides={false}
      />,
    );
    return document.querySelector<HTMLElement>('[data-slide-box]')!;
  }
  const mouse = (x: number, y: number) => ({
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: x,
    clientY: y,
  });

  it('shows the dragged area while the button is held', () => {
    const box = renderSelecting();
    fireEvent.pointerDown(box, mouse(100, 100));
    fireEvent.pointerMove(box, mouse(300, 300));
    expect(document.querySelector('.border-dashed')).not.toBeNull();
  });

  it('forgets a press that left the slide before it became a drag', () => {
    const box = renderSelecting();
    fireEvent.pointerDown(box, mouse(100, 100));
    fireEvent.pointerLeave(box, mouse(100, -10));
    // Back over the slide, the button long released elsewhere: no area follows the pointer.
    fireEvent.pointerMove(box, mouse(300, 300));
    expect(document.querySelector('.border-dashed')).toBeNull();
  });
});

describe('SlideFrame – image that fails to load', () => {
  function renderSlide(w = 800) {
    render(
      <SlideFrame
        slide={slide('s1', 0)}
        index={0}
        total={1}
        x={0}
        top={0}
        w={w}
        h={w * (9 / 16)}
        isActive
        threads={[]}
        emphasisId={null}
        draft={null}
        tool={null}
        canSelect
        color="red"
        badge={null}
        badgeVersion={1}
        boxMode={false}
        showGuides={false}
      />,
    );
  }

  it('stops pulsing, says so and loads again on request', () => {
    renderSlide();
    fireEvent.error(document.querySelector('img')!);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.skeleton')).toBeNull();
    expect(screen.getByText('Folie konnte nicht geladen werden')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    expect(document.querySelector('img')).not.toBeNull();
    expect(document.querySelector('.skeleton')).not.toBeNull();
  });

  it('keeps a thumbnail to the icon', () => {
    renderSlide(200);
    fireEvent.error(document.querySelector('img')!);
    expect(document.querySelector('[data-slide-image-error]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Erneut laden' })).toBeNull();
  });
});
