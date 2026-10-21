import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolBar } from './ToolBar';

const state = {
  tool: null as string | null,
  boxMode: true,
  boxModeFlipped: false,
  showGuides: false,
  showHiddenSlides: false,
  showChanges: true,
};
const revision = { revisionNumber: 3, badges: new Map([['s1', {}]]) };
const dispatch = vi.fn();

vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({ canComment: true, hiddenSlideCount: 2 }),
}));
vi.mock('../state/revision-data', () => ({ useRevisionData: () => revision }));
vi.mock('../state/viewer-state', () => ({
  isBoxModeActive: ({ boxMode }: { boxMode: boolean }) => boxMode,
  useViewerState: () => state,
  useViewerDispatch: () => dispatch,
}));

beforeEach(() => {
  Object.assign(state, {
    tool: null,
    boxMode: true,
    showGuides: false,
    showHiddenSlides: false,
    showChanges: true,
  });
  Object.assign(revision, { revisionNumber: 3, badges: new Map([['s1', {}]]) });
  dispatch.mockReset();
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

  it('switches the change markers of the latest version', () => {
    const { rerender } = render(<ToolBar />);
    const changes = screen.getByRole('button', { name: 'Änderungshinweise zeigen', pressed: true });
    expect(changes.getAttribute('title')).toBe('Änderungshinweise der Version 3 ausblenden');
    fireEvent.click(changes);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'showChangesSet', show: false });

    state.showChanges = false;
    rerender(<ToolBar />);
    expect(changes.getAttribute('aria-pressed')).toBe('false');
    expect(changes.getAttribute('title')).toBe('Änderungshinweise der Version 3 zeigen');
    fireEvent.click(changes);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'showChangesSet', show: true });
  });

  it('has no changes switch for a first version or a version without changes', () => {
    revision.revisionNumber = 1;
    const { rerender } = render(<ToolBar />);
    expect(screen.queryByRole('button', { name: 'Änderungshinweise zeigen' })).toBeNull();

    revision.revisionNumber = 2;
    revision.badges = new Map();
    rerender(<ToolBar />);
    expect(screen.queryByRole('button', { name: 'Änderungshinweise zeigen' })).toBeNull();
  });
});
