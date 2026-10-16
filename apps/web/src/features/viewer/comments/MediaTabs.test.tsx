import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MediaTabs } from './MediaTabs';
import type { MediaKindId } from './lib/media-kinds';

vi.mock('../media/RecordReplyDialog', () => ({ RecordReplyDialog: () => null }));
vi.mock('../media/SketchReplyDialog', () => ({ SketchReplyDialog: () => null }));

function Harness({ onChange }: { onChange: (kind: MediaKindId) => void }) {
  const [value, setValue] = useState<MediaKindId>('text');
  return (
    <MediaTabs
      value={value}
      onChange={(kind) => {
        setValue(kind);
        onChange(kind);
      }}
    />
  );
}

describe('MediaTabs', () => {
  it('is a tab list of the four comment kinds', () => {
    render(<Harness onChange={vi.fn()} />);
    expect(screen.getByRole('tablist', { name: 'Kommentarart' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Text', 'Audio', 'Video', 'Bild']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    // Roving focus: only the selected tab is a Tab stop.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('switches on click and with the arrow keys', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Video' }));
    expect(onChange).toHaveBeenLastCalledWith('video');
    expect(screen.getByRole('tab', { name: 'Video' }).getAttribute('aria-selected')).toBe('true');

    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('image');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Bild' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('text');
  });
});
