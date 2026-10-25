import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeDeck } from '../lib/deck-fixture';
import { OriginChips } from './DeckBits';

const labels = () => screen.getAllByRole('img').map((chip) => chip.getAttribute('aria-label'));

describe('OriginChips', () => {
  it('shows one logo when the cloud drew the slides itself', () => {
    render(<OriginChips deck={makeDeck({ source: 'onedrive', thumbnailRenderer: 'office' })} />);
    expect(labels()).toEqual(['Aus OneDrive, gerendert mit Microsoft']);
  });

  it('counts a Google deck’s Office render as Google', () => {
    render(<OriginChips deck={makeDeck({ source: 'google', thumbnailRenderer: 'office' })} />);
    expect(labels()).toEqual(['Aus Google Drive, gerendert mit Google']);
  });

  it('shows cloud and renderer when they differ, with why the cloud did not draw', () => {
    render(
      <OriginChips
        deck={makeDeck({
          source: 'google',
          thumbnailRenderer: 'libreoffice',
          officeFailure: 'Die Datei wurde seit dieser Version geändert.',
        })}
      />,
    );
    expect(labels()).toEqual([
      'Aus Google Drive',
      'Gerendert mit LibreOffice – Google ging nicht: Die Datei wurde seit dieser Version geändert.',
    ]);
  });

  it('shows only the cloud for a PDF’s own pages and the preview', () => {
    const { unmount } = render(
      <OriginChips deck={makeDeck({ source: 'nextcloud', thumbnailRenderer: 'pdf' })} />,
    );
    expect(labels()).toEqual(['Aus Nextcloud']);
    unmount();
    render(<OriginChips deck={makeDeck({ source: 'upload', thumbnailRenderer: 'svg' })} />);
    expect(labels()).toEqual(['Hochgeladen']);
  });
});
