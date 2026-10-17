import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolBar } from './ToolBar';

const state = {
  tool: null as string | null,
  boxMode: true,
  boxModeFlipped: false,
  showGuides: false,
  showHiddenSlides: false,
};

vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({ canComment: true, hiddenSlideCount: 2 }),
}));
vi.mock('../state/viewer-state', () => ({
  isBoxModeActive: ({ boxMode }: { boxMode: boolean }) => boxMode,
  useViewerState: () => state,
  useViewerDispatch: () => vi.fn(),
}));

beforeEach(() => {
  Object.assign(state, { tool: null, boxMode: true, showGuides: false, showHiddenSlides: false });
});

describe('ToolBar', () => {
  it('names each toggle by what it switches and says whether it is on', () => {
    const { rerender } = render(<ToolBar />);
    // On: "Box-Modus, gedrückt" – not "Box-Modus aus, gedrückt".
    const boxes = screen.getByRole('button', { name: 'Box-Modus', pressed: true });
    expect(boxes.getAttribute('title')).toMatch(/^Box-Modus aus \(B\)/);
    expect(screen.getByRole('button', { name: 'Hilfslinien zeigen', pressed: false })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Ausgeblendete Folien zeigen (2)', pressed: false }),
    ).toBeTruthy();

    state.boxMode = false;
    state.showGuides = true;
    rerender(<ToolBar />);
    expect(screen.getByRole('button', { name: 'Box-Modus', pressed: false })).toBeTruthy();
    const guides = screen.getByRole('button', { name: 'Hilfslinien zeigen', pressed: true });
    expect(guides.getAttribute('title')).toBe('Hilfslinien ausblenden (G)');
  });

  it('announces the tools that are not picked as toggles too', () => {
    state.tool = 'pen';
    render(<ToolBar />);
    expect(screen.getByRole('button', { name: 'Freihand', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pfeil', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Zeiger/, pressed: false })).toBeTruthy();
  });
});
