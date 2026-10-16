import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tooltip } from '@/ui';

const classesOf = (element: Element) => element.className.split(/\s+/);

describe('Tooltip', () => {
  it('renders a role=tooltip bubble in its own group, centred and animated', () => {
    render(
      <Tooltip label="Anna Berg" data-testid="wrapper">
        <span>A</span>
      </Tooltip>,
    );
    const wrapper = screen.getByTestId('wrapper');
    expect(classesOf(wrapper)).toEqual(
      expect.arrayContaining(['group/tooltip', 'relative', 'inline-flex']),
    );
    const bubble = screen.getByRole('tooltip');
    expect(bubble.textContent).toBe('Anna Berg');
    expect(bubble.id).not.toBe('');
    expect(classesOf(bubble)).toEqual(
      expect.arrayContaining([
        'bg-glass-solid',
        'text-caption',
        'ring-hover',
        'shadow-float',
        'left-1/2',
        '-translate-x-1/2',
        'max-w-48',
        'opacity-0',
        'group-hover/tooltip:opacity-100',
        'group-has-focus-visible/tooltip:opacity-100',
      ]),
    );
  });

  it('maps align, maxWidth, animated and showOnFocus', () => {
    render(
      <Tooltip label="Lang" align="end" maxWidth="none" animated={false} showOnFocus={false}>
        <span />
      </Tooltip>,
    );
    const bubble = screen.getByRole('tooltip');
    expect(classesOf(bubble)).toEqual(
      expect.arrayContaining([
        'right-0',
        'whitespace-nowrap',
        'hidden',
        'group-hover/tooltip:flex',
      ]),
    );
    expect(classesOf(bubble)).not.toContain('opacity-0');
    expect(bubble.className).not.toContain('focus-visible');
  });

  it('start alignment and wider wrap', () => {
    render(
      <Tooltip label="Aus OneDrive" align="start" maxWidth={64}>
        <span />
      </Tooltip>,
    );
    expect(classesOf(screen.getByRole('tooltip'))).toEqual(
      expect.arrayContaining(['left-0', 'max-w-64']),
    );
  });

  it('is aria-hidden when decorative and passes wrapper props (role=img)', () => {
    render(
      <Tooltip label="Aus OneDrive" decorative role="img" aria-label="Aus OneDrive" display="flex">
        <span />
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    const chip = screen.getByRole('img', { name: 'Aus OneDrive' });
    expect(classesOf(chip)).toContain('flex');
    expect(chip.querySelector('[aria-hidden="true"]')?.textContent).toBe('Aus OneDrive');
  });

  it('renders no bubble while disabled', () => {
    render(
      <Tooltip label="Anna" disabled>
        <span>A</span>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByText('A')).toBeTruthy();
  });
});
