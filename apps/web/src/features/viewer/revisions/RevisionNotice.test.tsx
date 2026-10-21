import type { DeletedSlide, SyncSummary } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RevisionNotice } from './RevisionNotice';

const slides = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
const revision = {
  badges: new Map<string, unknown>(),
  deletedSlides: [] as DeletedSlide[],
};
const dispatch = vi.fn();
const goToSlide = vi.fn();

vi.mock('../state/viewer-data', () => ({ useViewerData: () => ({ slides }) }));
vi.mock('../state/revision-data', () => ({ useRevisionData: () => revision }));
vi.mock('../state/viewer-state', () => ({ useViewerDispatch: () => dispatch }));
vi.mock('../hooks/useGoToSlide', () => ({ useGoToSlide: () => goToSlide }));

const summary = { text: '2 Folien geändert, 1 gelöscht' } as SyncSummary;

beforeEach(() => {
  revision.badges = new Map();
  revision.deletedSlides = [];
  dispatch.mockClear();
  goToSlide.mockClear();
});

const notice = () => document.querySelector<HTMLElement>('[data-revision-notice]')!;

describe('RevisionNotice', () => {
  it('names the version and the changes, also as its tooltip', () => {
    render(<RevisionNotice announcement={{ revisionNumber: 5, summary }} onDone={vi.fn()} />);
    expect(notice().getAttribute('title')).toBe('V5 geladen | 2 Folien geändert, 1 gelöscht');
    expect(notice().textContent).toContain('V5 geladen');
  });

  it('offers no "Änderungen ansehen" when nothing can be shown', () => {
    render(<RevisionNotice announcement={{ revisionNumber: 2, summary: null }} onDone={vi.fn()} />);
    expect(notice().getAttribute('title')).toBe('V2 geladen');
    expect(screen.queryByRole('button', { name: 'Änderungen ansehen' })).toBeNull();
  });

  it('turns the markers on and goes to the first changed slide', async () => {
    revision.badges = new Map([['s2', {}]]);
    const onDone = vi.fn();
    render(<RevisionNotice announcement={{ revisionNumber: 5, summary }} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Änderungen ansehen' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'showChangesSet', show: true });
    expect(goToSlide).toHaveBeenCalledWith(1);
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'deletedPanelSet', open: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('opens the deleted slides when only slides were removed', async () => {
    revision.deletedSlides = [{ slideId: 'gone' } as DeletedSlide];
    render(<RevisionNotice announcement={{ revisionNumber: 5, summary }} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Änderungen ansehen' }));
    expect(goToSlide).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'deletedPanelSet', open: true });
  });

  it('closes', async () => {
    const onDone = vi.fn();
    render(<RevisionNotice announcement={{ revisionNumber: 5, summary }} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hinweis schließen' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
