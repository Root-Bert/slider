import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorText } from './ErrorText';

describe('ErrorText', () => {
  it('is 13px danger text by default', () => {
    render(<ErrorText>Netzwerkfehler</ErrorText>);
    const text = screen.getByText('Netzwerkfehler');
    expect(text.tagName).toBe('P');
    expect(text.className).toContain('text-body');
    expect(text.className).toContain('text-danger');
  });

  it('xs size and passes attributes (role, id)', () => {
    render(
      <ErrorText size="xs" role="alert" id="name-error">
        Pflichtfeld
      </ErrorText>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('name-error');
    expect(alert.className).toContain('text-xs');
  });
});
