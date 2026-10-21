import type { DeletedSlide } from '@slider/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeletedSlidesPanel } from './DeletedSlidesPanel';

const deleted: DeletedSlide = {
  slideId: 'gone',
  title: 'Agenda',
  previousPosition: 2,
  imageUrl: '/files/gone-2400.webp',
  thumbnailUrl: '/files/gone-640.webp',
  aspectRatio: 16 / 9,
  lastRevisionNumber: 3,
  confidence: 1,
  comments: [],
};
const shown = { slides: [deleted] };

vi.mock('../state/viewer-state', () => ({
  useViewerState: () => ({ deletedPanelOpen: true }),
  useViewerDispatch: () => vi.fn(),
}));
vi.mock('../state/revision-data', () => ({
  useRevisionData: () => ({ deletedSlides: shown.slides, deletedThreads: new Map() }),
}));
vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({ deck: { id: 'd1' }, canComment: false }),
}));
vi.mock('../hooks/useRestoreFocus', () => ({ useRestoreFocus: () => undefined }));

describe('DeletedSlidesPanel', () => {
  afterEach(() => {
    shown.slides = [deleted];
  });

  it('previews a deleted slide with its thumbnail, not the full-size image', () => {
    render(<DeletedSlidesPanel />);
    const image = screen.getByRole('img', { name: 'Agenda' });
    expect(image.getAttribute('src')).toBe('/files/gone-640.webp');
    expect(image.getAttribute('loading')).toBe('lazy');
  });

  it('shows a neutral placeholder once the older version’s files were deleted', () => {
    shown.slides = [{ ...deleted, filesDeleted: true }];
    render(<DeletedSlidesPanel />);
    expect(screen.getByRole('img', { name: 'Ältere Version gelöscht' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Agenda' })).toBeNull();
    expect(document.querySelector('img[src="/files/gone-640.webp"]')).toBeNull();
  });

  it('falls back to the placeholder when the thumbnail fails to load', () => {
    render(<DeletedSlidesPanel />);
    fireEvent.error(screen.getByRole('img', { name: 'Agenda' }));
    expect(screen.getByRole('img', { name: 'Ältere Version gelöscht' })).toBeTruthy();
  });
});
