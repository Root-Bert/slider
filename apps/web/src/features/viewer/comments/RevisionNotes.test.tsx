import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RemovedInSourceNote } from './RevisionNotes';

describe('RemovedInSourceNote', () => {
  it('marks the comment as archived', () => {
    const { container } = render(<RemovedInSourceNote source="pptx" />);
    const note = container.querySelector('[data-removed-in-source]')!;
    expect(note.textContent).toBe('In PowerPoint entfernt – hier archiviert');
    expect(note.getAttribute('title')).toContain('In Slider bleibt er');
  });
});
