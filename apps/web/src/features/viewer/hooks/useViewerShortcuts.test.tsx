import { fireEvent, render, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPointerUsed, watchPointer } from '@/lib/dom';
import type * as ViewerState from '../state/viewer-state';
import type { Tool } from '../state/viewer-state';
import { useRestoreFocus } from './useRestoreFocus';
import { useViewerShortcuts } from './useViewerShortcuts';

const dispatch = vi.fn();
let tool: Tool | null = null;

const startComment = vi.fn();

vi.mock('./useGoToSlide', () => ({ useGoToSlide: () => vi.fn() }));
vi.mock('./useStartComment', () => ({ useStartComment: () => startComment }));
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
  startComment.mockClear();
  tool = null;
  resetPointerUsed();
});

const tab = () => fireEvent.keyDown(document.body, { key: 'Tab' });
/** A click on the slide: the focus stays on the body. */
const click = () => fireEvent.pointerDown(document.body);

describe('useViewerShortcuts: Tab', () => {
  it('steps through the tools after a click on the slide', () => {
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    click();
    // `fireEvent` returns false when the default was prevented.
    expect(tab()).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({ type: 'toolSelected', tool: 'pen' });
  });

  it('leaves Tab to the focus order before the pointer was used: on to the skip link', () => {
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    expect(tab()).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('counts a click from before the viewer opened (e.g. on the deck card in Reviews)', () => {
    watchPointer();
    click();
    const { unmount } = renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    expect(tab()).toBe(false);
    // Still so in the next deck.
    unmount();
    dispatch.mockClear();
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    expect(tab()).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({ type: 'toolSelected', tool: 'pen' });
  });

  it('steps back with ⇧Tab', () => {
    tool = 'arrow';
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    click();
    expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({ type: 'toolSelected', tool: 'pen' });
  });

  it('leaves Tab to the focus order once a control has the focus', () => {
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    click();
    const button = document.createElement('button');
    const toolbar = document.createElement('div');
    toolbar.setAttribute('role', 'toolbar');
    const toolButton = document.createElement('button');
    toolbar.append(toolButton);
    document.body.append(button, toolbar);
    expect(fireEvent.keyDown(button, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(toolButton, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    button.remove();
    toolbar.remove();
  });

  it('leaves Tab to fields and open menus', () => {
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    click();
    const field = document.createElement('textarea');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.append(item);
    document.body.append(field, menu);
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(item, { key: 'Tab' })).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    field.remove();
    menu.remove();
  });
});

describe('useViewerShortcuts: C', () => {
  it('starts a comment, on the hovered box if there is one', () => {
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    expect(fireEvent.keyDown(document.body, { key: 'C', shiftKey: true })).toBe(false);
    expect(startComment).toHaveBeenCalledWith({ onHoveredBox: true });
  });

  it('leaves C to fields and to ⌘C / Ctrl+C', () => {
    renderHook(() => useViewerShortcuts({ onToggleFullscreen: vi.fn() }));
    const field = document.createElement('textarea');
    document.body.append(field);
    fireEvent.keyDown(field, { key: 'c' });
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'c', altKey: true });
    field.remove();
    expect(startComment).not.toHaveBeenCalled();
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
