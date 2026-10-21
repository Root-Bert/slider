import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Slide } from '@slider/shared';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlideContextMenu } from './useSlideContextMenu';

const dispatch = vi.fn();
const showToast = vi.fn();
vi.mock('../../state/viewer-state', () => ({ useViewerDispatch: () => dispatch }));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => showToast }));
vi.mock('../../comments/lib/composer-focus', () => ({ focusCommentField: vi.fn() }));

const shape = { id: '4', name: 'Titel 1', bbox: { x: 0, y: 0, w: 0.5, h: 0.5 }, text: 'Agenda' };
const slide = { id: 's1', title: 'Agenda', shapes: [shape] } as unknown as Slide;

function Harness({ canComment = true }: { canComment?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const menu = useSlideContextMenu({ slide, boxRef, canComment, disabled: false });
  return (
    <>
      <div ref={boxRef} data-testid="box" onContextMenu={menu.onContextMenu} />
      {menu.contextMenu}
    </>
  );
}

/** Right click at a slide-relative position on a 1000×500 box. */
function rightClick(x: number, y: number) {
  const box = screen.getByTestId('box');
  box.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 }) as DOMRect;
  fireEvent.contextMenu(box, { clientX: x * 1000, clientY: y * 500 });
}

describe('useSlideContextMenu', () => {
  beforeEach(() => {
    dispatch.mockClear();
    showToast.mockClear();
  });

  it('on a box offers a box comment and copying its text', async () => {
    render(<Harness />);
    rightClick(0.2, 0.2);
    expect(screen.getByRole('menuitem', { name: 'Text kopieren' })).toBeTruthy();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Kommentar zur Box' }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'anchorPlaced',
        slideId: 's1',
        anchor: expect.objectContaining({ type: 'rect', rect: shape.bbox }),
      }),
    );
  });

  it('beside every box offers a comment at the spot and on the whole slide', async () => {
    render(<Harness />);
    rightClick(0.8, 0.8);
    expect(screen.queryByRole('menuitem', { name: 'Kommentar zur Box' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Kommentar hier' }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: { type: 'point', point: { x: 0.8, y: 0.8 }, shapeRef: null },
      }),
    );
    rightClick(0.8, 0.8);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Kommentar zur Folie' }));
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: { type: 'slide' } }),
    );
  });

  it('offers only copying the text to people who may not comment', () => {
    render(<Harness canComment={false} />);
    rightClick(0.2, 0.2);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Text kopieren',
    ]);
  });

  it('keeps the browser menu where there is nothing to offer', () => {
    render(<Harness canComment={false} />);
    const box = screen.getByTestId('box');
    box.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 }) as DOMRect;
    const shown = fireEvent.contextMenu(box, { clientX: 800, clientY: 400 });
    expect(shown).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('copies the box text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Harness />);
    rightClick(0.2, 0.2);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Text kopieren' }));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Text kopiert'));
    expect(writeText).toHaveBeenCalledWith('Agenda');
  });
});
