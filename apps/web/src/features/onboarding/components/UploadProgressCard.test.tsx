import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UploadProgressCard } from './UploadProgressCard';

const file = new File(['x'], 'Q4.pptx');

describe('UploadProgressCard', () => {
  it('can be cancelled while the bytes are still going up', async () => {
    const onCancel = vi.fn();
    render(<UploadProgressCard file={file} progress={0.4} onCancel={onCancel} />);
    expect(screen.getByText(/40 %/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Upload abbrechen' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('offers no cancel once the server has the file – it creates the deck anyway', () => {
    render(<UploadProgressCard file={file} progress={1} onCancel={vi.fn()} />);
    expect(screen.getByText(/\| wird verarbeitet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upload abbrechen' })).toBeNull();
  });
});
