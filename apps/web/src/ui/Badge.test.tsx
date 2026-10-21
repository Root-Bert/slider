import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Icon } from './Icon';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('Badge', () => {
  it('tints by tone', () => {
    render(
      <>
        <Badge>V2</Badge>
        <Badge tone="warning">Import läuft</Badge>
        <Badge tone="overlay">Ausgeblendet</Badge>
      </>,
    );
    expect(classes(screen.getByText('V2'))).toEqual(
      expect.arrayContaining(['bg-hover', 'text-fg-muted', 'h-5', 'text-caption']),
    );
    expect(classes(screen.getByText('Import läuft'))).toContain('bg-warning/10');
    expect(classes(screen.getByText('Ausgeblendet'))).toEqual(
      expect.arrayContaining(['glass-dark', 'text-fg']),
    );
  });

  it('has a square icon-only chip that passes aria and title through', () => {
    render(
      <Badge tone="overlay" iconOnly title="Aus OneDrive" aria-label="Aus OneDrive">
        <Icon name="check" size="sm" />
      </Badge>,
    );
    const chip = screen.getByLabelText('Aus OneDrive');
    expect(chip.getAttribute('title')).toBe('Aus OneDrive');
    expect(classes(chip)).toEqual(expect.arrayContaining(['size-6', 'rounded-chip']));
    expect(classes(chip)).not.toContain('h-5');
  });
});
