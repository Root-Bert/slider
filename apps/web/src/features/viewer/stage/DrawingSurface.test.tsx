import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { author, comment, slide } from '../lib/test-fixtures';
import type { Thread } from '../comments/lib/comment-selectors';
import { DrawingSurface } from './DrawingSurface';

const me = author('me');
const erase = { mutateAsync: vi.fn<(id: string) => Promise<void>>() };
const showToast = vi.fn();

vi.mock('@/lib/api', () => ({ useEraseDrawing: () => erase }));
vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({ deck: { id: 'd1' }, viewer: { author: me } }),
}));
vi.mock('../state/viewer-toast', () => ({ useViewerToast: () => showToast }));

const box = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
} as HTMLElement;

const drawing: Thread = (() => {
  const root = comment({
    author: me,
    body: '',
    strokes: [
      {
        tool: 'pen',
        color: 'blue',
        points: [
          { x: 0.1, y: 0.5 },
          { x: 0.9, y: 0.5 },
        ],
      },
    ],
  });
  return {
    id: root.id,
    root,
    replies: [],
    repliers: [],
    participants: [me],
    lastActivityAt: root.createdAt,
  };
})();

const wipe = (surface: Element) => {
  fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
  fireEvent.pointerUp(surface, { pointerId: 1 });
};

function renderEraser() {
  const { container } = render(
    <DrawingSurface
      slide={slide('s1', 0)}
      boxRef={{ current: box }}
      tool="eraser"
      color="blue"
      threads={[drawing]}
    />,
  );
  const surface = container.firstElementChild!;
  // happy-dom: pointer capture on a synthetic pointer id.
  (surface as HTMLElement).setPointerCapture = () => undefined;
  return surface;
}

beforeEach(() => {
  erase.mutateAsync.mockReset();
  showToast.mockClear();
});

describe('EraserSurface', () => {
  it('erases a touched drawing only once per wipe', async () => {
    erase.mutateAsync.mockResolvedValue(undefined);
    const surface = renderEraser();
    wipe(surface);
    wipe(surface);
    await Promise.resolve();
    expect(erase.mutateAsync).toHaveBeenCalledTimes(1);
    expect(erase.mutateAsync).toHaveBeenCalledWith(drawing.id);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('says why a failed erase brought the drawing back, and lets it be erased again', async () => {
    erase.mutateAsync.mockRejectedValueOnce(new Error('Keine Verbindung zum Server.'));
    erase.mutateAsync.mockResolvedValue(undefined);
    const surface = renderEraser();
    wipe(surface);
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Keine Verbindung zum Server.', 'danger'),
    );
    wipe(surface);
    expect(erase.mutateAsync).toHaveBeenCalledTimes(2);
  });
});
