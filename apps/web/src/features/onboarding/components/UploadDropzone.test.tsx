import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UploadDropzone } from './UploadDropzone';

const file = new File(['x'], 'deck.pptx');

/** A drag event's `dataTransfer` with the given types and files. */
const transfer = (types: string[], files: File[] = []) => ({
  dataTransfer: { types, files, dropEffect: 'none' },
});

function setup(error: string | null = null) {
  const onFile = vi.fn();
  const onBrowse = vi.fn();
  render(<UploadDropzone onFile={onFile} onBrowse={onBrowse} error={error} />);
  const zone = screen.getByText(/Präsentation hierher ziehen/).parentElement!;
  return { onFile, onBrowse, zone };
}

describe('UploadDropzone', () => {
  it('"Datei auswählen" is a button that opens the file picker', async () => {
    const { onBrowse } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Datei auswählen' }));
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it('a click on the row itself opens the picker too', () => {
    const { onBrowse, zone } = setup();
    fireEvent.click(zone);
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it('dragging files in shows the drop hint; dropping hands over the first file', () => {
    const { onFile, zone } = setup();
    fireEvent.dragEnter(zone, transfer(['Files']));
    expect(screen.getByText('Loslassen zum Hochladen')).toBeTruthy();
    expect(zone.className).toContain('bg-surface-1');
    fireEvent.drop(zone, transfer(['Files'], [file]));
    expect(onFile).toHaveBeenCalledWith(file);
    expect(screen.queryByText('Loslassen zum Hochladen')).toBeNull();
  });

  it('ignores drags without files (text, links)', () => {
    const { zone } = setup();
    fireEvent.dragEnter(zone, transfer(['text/plain']));
    expect(screen.queryByText('Loslassen zum Hochladen')).toBeNull();
  });

  it('leaving the zone ends the drag state', () => {
    const { zone } = setup();
    fireEvent.dragEnter(zone, transfer(['Files']));
    fireEvent.dragLeave(zone, { relatedTarget: document.body });
    expect(screen.queryByText('Loslassen zum Hochladen')).toBeNull();
  });

  it('shows the error as an alert and tints the edge', () => {
    const { zone } = setup('Nur PPTX-Dateien');
    expect(screen.getByRole('alert').textContent).toBe('Nur PPTX-Dateien');
    expect(zone.className).toContain('border-danger/45');
    // The rest edge would win in the CSS order, so it must not be there too.
    expect(zone.className).not.toContain('border-hairline-strong');
  });

  it('without an error: the plain edge; dragging over shows the bright one', () => {
    const { zone } = setup();
    expect(zone.className).toContain('border-hairline-strong');
    expect(zone.className).not.toContain('border-danger');
    fireEvent.dragEnter(zone, transfer(['Files']));
    expect(zone.className).toContain('border-fg');
    expect(zone.className).not.toContain('border-hairline-strong');
  });
});
