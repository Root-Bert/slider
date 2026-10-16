import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Divider, GlassPanel, Toast, Toolbar, ToolbarDivider } from '@/ui';

const classesOf = (element: Element) => element.className.split(/\s+/);

describe('Toolbar', () => {
  it('is a labelled glass toolbar pill and passes events through', () => {
    const onMouseDown = vi.fn();
    render(
      <Toolbar label="Werkzeuge" onMouseDown={onMouseDown}>
        <button type="button">Stift</button>
      </Toolbar>,
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Werkzeuge' });
    expect(classesOf(toolbar)).toEqual(
      expect.arrayContaining(['glass-control', 'rounded-panel', 'flex', 'gap-1', 'p-1']),
    );
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Stift' }));
    expect(onMouseDown).toHaveBeenCalled();
  });

  it('can be a plain pill without a role', () => {
    render(
      <Toolbar role={false} data-testid="pill">
        <button type="button">Hochladen</button>
      </Toolbar>,
    );
    const pill = screen.getByTestId('pill');
    expect(pill.hasAttribute('role')).toBe(false);
    expect(classesOf(pill)).toEqual(expect.arrayContaining(['glass-control', 'p-1']));
  });

  it('can be a group and elevated', () => {
    render(<Toolbar role="group" label="Ansicht" tone="elevated" />);
    expect(classesOf(screen.getByRole('group', { name: 'Ansicht' }))).toContain('glass-elevated');
  });
});

describe('ToolbarDivider', () => {
  it('is a decorative 20px hairline-strong line by default', () => {
    const { container } = render(<ToolbarDivider />);
    const line = container.firstElementChild!;
    expect(line.getAttribute('aria-hidden')).toBe('true');
    expect(classesOf(line)).toEqual(
      expect.arrayContaining(['w-px', 'h-5', 'bg-hairline-strong', 'mx-0.5', 'shrink-0']),
    );
  });

  it('maps size, tone and spacing', () => {
    const { container } = render(
      <>
        <ToolbarDivider size="sm" tone="subtle" spacing="md" />
        <ToolbarDivider spacing="none" />
      </>,
    );
    const [first, second] = [...container.children];
    expect(classesOf(first!)).toEqual(expect.arrayContaining(['h-4', 'bg-hairline', 'mx-1']));
    expect(second!.className).not.toMatch(/\bmx-/);
  });
});

describe('Divider', () => {
  it('is a hairline separator without a label', () => {
    render(<Divider />);
    expect(classesOf(screen.getByRole('separator'))).toEqual(
      expect.arrayContaining(['h-px', 'bg-hairline']),
    );
  });

  it('with a label reads the word and draws decorative lines', () => {
    const { container } = render(
      <>
        <Divider label="oder" data-testid="center" />
        <Divider label="oder" labelPosition="start" data-testid="start" style={{ opacity: 0 }} />
      </>,
    );
    expect(screen.queryByRole('separator')).toBeNull();
    const center = screen.getByTestId('center');
    expect(center.textContent).toBe('oder');
    expect(center.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    const start = screen.getByTestId('start');
    expect(start.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(start.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(start.style.opacity).toBe('0');
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});

describe('GlassPanel', () => {
  it('switches tone and renders as another element', () => {
    render(
      <>
        <GlassPanel data-testid="default" />
        <GlassPanel as="section" tone="elevated" data-testid="elevated" />
      </>,
    );
    expect(classesOf(screen.getByTestId('default'))).toContain('glass-control');
    const elevated = screen.getByTestId('elevated');
    expect(elevated.tagName).toBe('SECTION');
    expect(classesOf(elevated)).toContain('glass-elevated');
  });
});

describe('Toast', () => {
  it('keeps the live region mounted on the toast layer', () => {
    const { rerender } = render(<Toast toast={null} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(classesOf(region)).toContain('z-(--z-toast)');

    rerender(<Toast toast={{ id: 1, text: 'Ordner gelöscht', tone: 'danger' }} />);
    const message = screen.getByText('Ordner gelöscht');
    expect(classesOf(message)).toEqual(expect.arrayContaining(['text-body', 'text-danger']));
  });
});
