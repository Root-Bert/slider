import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { FilterChip, SegmentedControl, type Segment } from './SegmentedControl';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

type Filter = 'all' | 'open' | 'done';
const FILTERS: readonly Segment<Filter>[] = [
  { value: 'all', label: 'Alle', count: 3 },
  { value: 'open', label: 'Offen' },
  { value: 'done', label: 'Erledigt', disabled: true, title: 'Bald' },
];

type Kind = 'text' | 'audio' | 'video' | 'image';
const KINDS: readonly Segment<Kind>[] = [
  { value: 'text', label: 'Text' },
  { value: 'audio', label: 'Audio', disabled: true, title: 'Bald verfügbar' },
  { value: 'video', label: 'Video' },
  { value: 'image', label: 'Bild' },
];

function Tabs({ onChange }: { onChange?: (kind: Kind) => void }) {
  const [value, setValue] = useState<Kind>('text');
  return (
    <SegmentedControl
      mode="tabs"
      size="sm"
      track="soft"
      label="Kommentarart"
      segments={KINDS}
      value={value}
      onChange={(kind) => {
        setValue(kind);
        onChange?.(kind);
      }}
    />
  );
}

describe('SegmentedControl (radio)', () => {
  it('is a labelled radio group with the value checked', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Filtern" segments={FILTERS} value="all" onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Filtern' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Alle/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Offen' }).getAttribute('aria-checked')).toBe('false');
    await userEvent.click(screen.getByRole('radio', { name: 'Offen' }));
    expect(onChange).toHaveBeenCalledWith('open');
  });

  it('disables segments natively and shows the count', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Filtern" segments={FILTERS} value="all" onChange={onChange} />);
    const done = screen.getByRole('radio', { name: 'Erledigt' });
    expect(done).toHaveProperty('disabled', true);
    expect(classes(done)).toContain('opacity-40');
    await userEvent.click(done);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /Alle/ }).textContent).toBe('Alle3');
  });

  it('styles sizes, tones and the track with tokens', () => {
    render(
      <SegmentedControl
        label="Folie zeigen wie"
        size="xs"
        tone="warning"
        track="soft"
        segments={[
          { value: 'old', label: 'Alt' },
          { value: 'new', label: 'Neu' },
        ]}
        value="old"
        onChange={() => {}}
      />,
    );
    const group = screen.getByRole('radiogroup');
    expect(classes(group)).toEqual(
      expect.arrayContaining(['bg-warning/10', 'p-0.5', 'rounded-badge']),
    );
    const old = screen.getByRole('radio', { name: 'Alt' });
    expect(classes(old)).toEqual(
      expect.arrayContaining(['h-5', 'rounded-thumb', 'bg-warning', 'text-on-primary']),
    );
    expect(classes(screen.getByRole('radio', { name: 'Neu' }))).toContain('text-warning');
  });

  it('marks the selected md chip with bg-selected', () => {
    render(
      <SegmentedControl label="Filtern" segments={FILTERS} value="open" onChange={() => {}} />,
    );
    expect(classes(screen.getByRole('radio', { name: 'Offen' }))).toEqual(
      expect.arrayContaining(['bg-selected', 'font-medium', 'h-8']),
    );
  });
});

describe('SegmentedControl (radio keyboard)', () => {
  function Radios() {
    const [value, setValue] = useState<Filter>('all');
    return (
      <SegmentedControl label="Filtern" segments={FILTERS} value={value} onChange={setValue} />
    );
  }

  it('selects with the arrow keys, has one Tab stop and keeps the keys from the page', async () => {
    // Stands in for a page shortcut listener (the viewer's ←/→ slide navigation on `window`).
    const prevented: boolean[] = [];
    const onKey = (event: KeyboardEvent) => prevented.push(event.defaultPrevented);
    window.addEventListener('keydown', onKey);
    onTestFinished(() => window.removeEventListener('keydown', onKey));
    render(<Radios />);
    const all = screen.getByRole('radio', { name: /Alle/ });
    const open = screen.getByRole('radio', { name: 'Offen' });
    expect(all.tabIndex).toBe(0);
    expect(open.tabIndex).toBe(-1);

    await userEvent.click(all);
    await userEvent.keyboard('{ArrowRight}');
    expect(open.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(open);
    expect(open.tabIndex).toBe(0);
    // "Erledigt" is disabled: skipped, wraps to the first.
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(all);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(open);
    expect(prevented).toEqual([true, true, true]);
  });
});

describe('SegmentedControl (tabs)', () => {
  it('is a tab list with roving tabIndex and aria-disabled tabs', () => {
    render(<Tabs />);
    expect(screen.getByRole('tablist', { name: 'Kommentarart' })).toBeTruthy();
    const text = screen.getByRole('tab', { name: 'Text' });
    const audio = screen.getByRole('tab', { name: 'Audio' });
    expect(text.getAttribute('aria-selected')).toBe('true');
    expect(text.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Video' }).tabIndex).toBe(-1);
    expect(audio.getAttribute('aria-disabled')).toBe('true');
    expect(audio.hasAttribute('disabled')).toBe(false);
    expect(audio.tabIndex).toBe(-1);
    expect(audio.getAttribute('title')).toBe('Bald verfügbar');
  });

  it('moves with arrow keys, Home and End, skipping disabled tabs', async () => {
    const onChange = vi.fn();
    render(<Tabs onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Text' }));
    await userEvent.keyboard('{ArrowRight}');
    const video = screen.getByRole('tab', { name: 'Video' });
    expect(onChange).toHaveBeenLastCalledWith('video');
    expect(document.activeElement).toBe(video);
    expect(video.tabIndex).toBe(0);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Bild' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Text' }));
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Bild' }));
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('text');
  });

  it('ignores clicks on disabled tabs', async () => {
    const onChange = vi.fn();
    render(<Tabs onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses the soft track for sm', () => {
    render(<Tabs />);
    expect(classes(screen.getByRole('tablist'))).toEqual(
      expect.arrayContaining(['bg-surface-1', 'p-1', 'rounded-control']),
    );
    expect(classes(screen.getByRole('tab', { name: 'Text' }))).toEqual(
      expect.arrayContaining(['h-7', 'rounded-chip', 'bg-selected']),
    );
  });
});

describe('FilterChip', () => {
  it('is a checkbox by default', async () => {
    const onClick = vi.fn();
    render(
      <FilterChip selected={false} onClick={onClick}>
        Nur meine
      </FilterChip>,
    );
    const chip = screen.getByRole('checkbox', { name: 'Nur meine' });
    expect(chip.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
