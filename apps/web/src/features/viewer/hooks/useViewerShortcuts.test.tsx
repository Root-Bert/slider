import { fireEvent, render, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ViewerState from '../state/viewer-state';
import type { Tool } from '../state/viewer-state';
import { useRestoreFocus } from './useRestoreFocus';
import { useViewerShortcuts } from './useViewerShortcuts';

const dispatch = vi.fn();
let tool: Tool | null = null;

vi.mock('./useGoToSlide', () => ({ useGoToSlide: () => vi.fn() }));
vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({ slides: [], slideIndex: new Map(), canComment: true }),
}));
vi.mock('../state/viewer-state', async (importOriginal) => ({
  ...(await importOriginal<typeof ViewerState>()),
  useViewerState: () => ({
    activeSlideId: null,
    draft: null,
    tool,
    lastDrawing: null,
    focusedThreadId: null,
    threadPanelOpen: false,
    deletedPanelOpen: false,
  }),
  useViewerDispatch: () => dispatch,
}));

beforeEach(() => {
  dispatch.mockClear();
  tool = null;
});

const tab = () => fireEvent.keyDown(document.body, { key: 'Tab' });

describe('useViewerShortcuts: Tab', () => {
  it('leaves Tab to the browser for keyboard users, so they reach the controls', () => {
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    // `fireEvent` returns false when the default was prevented.
    expect(tab()).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('steps through the tools after a click on the page', () => {
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    fireEvent.pointerDown(document.body);
    expect(tab()).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({ type: 'toolSelected', tool: 'pen' });
    // Esc hands the keyboard back.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    dispatch.mockClear();
    expect(tab()).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('useRestoreFocus', () => {
  function Panel() {
    useRestoreFocus();
    return <section tabIndex={-1} ref={(element) => element?.focus()} aria-label="Panel" />;
  }
  function Page() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(!open)}>Karte</button>
        {open && <Panel />}
      </>
    );
  }

  it('gives the focus back to the opener when the panel closes', () => {
    const view = render(<Page />);
    const card = view.getByRole('button', { name: 'Karte' });
    card.focus();
    fireEvent.click(card);
    expect(document.activeElement).toBe(view.getByLabelText('Panel'));
    fireEvent.click(card);
    expect(view.queryByLabelText('Panel')).toBeNull();
    expect(document.activeElement).toBe(card);
  });
});
