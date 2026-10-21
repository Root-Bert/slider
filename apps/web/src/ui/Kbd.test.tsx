import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Kbd } from './Kbd';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('Kbd', () => {
  it('uses the strong hairline and caption size', () => {
    render(<Kbd>⌘K</Kbd>);
    expect(classes(screen.getByText('⌘K'))).toEqual(
      expect.arrayContaining(['ring-hairline-strong', 'text-caption']),
    );
  });
});
